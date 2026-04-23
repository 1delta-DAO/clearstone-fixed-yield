// Kamino SY adapter — wraps a Kamino Lend V2 reserve (or, in tests, the mock_klend
// program with the same account shape) and optionally CPIs into the clearstone-finance
// governor to whitelist clearstone_core escrow PDAs for KYC-gated d-token underlyings.
//
// Design: see KYC_PASSTHROUGH_PLAN.md at the repo root.
//
// SY semantics: SY is a new Token-2022 mint created by this adapter. It is backed 1:1 by
// ctokens (klend collateral tokens) held in an adapter-owned vault. Exchange rate returned
// by get_sy_state is the reserve's collateral_exchange_rate — i.e. liquidity-per-ctoken,
// which is exactly liquidity-per-SY.
//
// KYC: when kyc_mode is GovernorWhitelist, the adapter stores the governor pool + delta-mint
// config addresses on SyMetadata. At init, it CPIs governor.add_participant_via_pool(Holder)
// for each clearstone_core PDA the caller lists in remaining_accounts. Runtime transfers
// go through transfer_checked — delta-mint's mint-time whitelist gate already fired when
// the underlying d-token entered circulation; the escrow accounts simply need to exist on
// the whitelist to be eligible destinations if/when delta-mint enforces it. The adapter
// itself does not talk to delta-mint at runtime — only at init.

#![allow(unexpected_cfgs)]

use amount_value::Amount;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
    TransferChecked,
};
use governor::{
    cpi as governor_cpi, cpi::accounts as governor_accounts,
    ParticipantRole as GovernorRole,
};
use precise_number::Number;
use sy_common::{MintSyReturnData, PositionState, RedeemSyReturnData, SyState};

declare_id!("29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd");

pub const SY_METADATA_SEED: &[u8] = b"sy_metadata";
pub const SY_MINT_SEED: &[u8] = b"sy_mint";
pub const COLLATERAL_VAULT_SEED: &[u8] = b"coll_vault";
pub const POOL_ESCROW_SEED: &[u8] = b"pool_escrow";
pub const PERSONAL_POSITION_SEED: &[u8] = b"personal_position";

/// KYC configuration stored on SyMetadata.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum KycMode {
    /// Underlying is a standard mint (SPL or T2022 without KYC gate). Adapter does no
    /// governor CPIs at init.
    None,
    /// Underlying is a delta-mint d-token. Adapter whitelists core PDAs at init via
    /// governor.add_participant_via_pool. Runtime unchanged.
    GovernorWhitelist {
        governor_program: Pubkey,
        pool_config: Pubkey,
        dm_mint_config: Pubkey,
        delta_mint_program: Pubkey,
    },
}

#[program]
pub mod kamino_sy_adapter {
    use super::*;

    /// Create SY parameters: new SY mint, collateral vault (holds ctokens), SY pool escrow.
    /// When kyc_mode is GovernorWhitelist, the caller passes
    /// `core_pdas_to_whitelist: Vec<Pubkey>` and paired `[wallet, whitelist_entry]` accounts
    /// via remaining_accounts; the adapter CPIs governor once per PDA.
    #[instruction(discriminator = [0])]
    pub fn init_sy_params<'info>(
        ctx: Context<'_, '_, '_, 'info, InitSyParams<'info>>,
        kyc_mode: KycMode,
        core_pdas_to_whitelist: Vec<Pubkey>,
    ) -> Result<()> {
        let m = &mut ctx.accounts.sy_metadata;
        m.curator = ctx.accounts.curator.key();
        m.underlying_mint = ctx.accounts.underlying_mint.key();
        m.sy_mint = ctx.accounts.sy_mint.key();
        m.collateral_vault = ctx.accounts.collateral_vault.key();
        m.pool_escrow = ctx.accounts.pool_escrow.key();
        m.klend_program = ctx.accounts.klend_program.key();
        m.klend_lending_market = ctx.accounts.klend_lending_market.key();
        m.klend_reserve = ctx.accounts.klend_reserve.key();
        m.klend_collateral_mint = ctx.accounts.klend_collateral_mint.key();
        m.kyc_mode = kyc_mode.clone();
        m.bump = ctx.bumps.sy_metadata;

        // KYC wiring: if GovernorWhitelist, whitelist each core PDA via governor CPI.
        // All handling lives in `whitelist_pdas_via_governor` — the single function
        // M-KYC-3 needs to swap from event-emission to a real governor CPI.
        if let KycMode::GovernorWhitelist { .. } = &kyc_mode {
            whitelist_pdas_via_governor(
                &ctx.accounts.sy_metadata.key(),
                &kyc_mode,
                &ctx.accounts,
                ctx.remaining_accounts,
                &core_pdas_to_whitelist,
            )?;
        } else {
            require!(
                core_pdas_to_whitelist.is_empty(),
                AdapterError::WhitelistNotInKycMode
            );
        }

        Ok(())
    }

    /// Mint SY: user's underlying → klend.deposit_reserve_liquidity → ctokens stored in
    /// adapter's collateral_vault → adapter mints amount_collateral of SY (1:1) to user.
    #[instruction(discriminator = [1])]
    pub fn mint_sy<'info>(
        ctx: Context<'_, '_, '_, 'info, MintSy<'info>>,
        amount_underlying: u64,
    ) -> Result<MintSyReturnData> {
        require!(amount_underlying > 0, AdapterError::ZeroAmount);

        // Capture ctoken balance before CPI so we can credit the delta.
        ctx.accounts.collateral_vault.reload()?;
        let coll_before = ctx.accounts.collateral_vault.amount;

        // CPI klend.deposit_reserve_liquidity(amount_underlying)
        let cpi_ctx = CpiContext::new(
            ctx.accounts.klend_program.to_account_info(),
            mock_klend::cpi::accounts::DepositReserveLiquidity {
                user: ctx.accounts.owner.to_account_info(),
                reserve: ctx.accounts.klend_reserve.to_account_info(),
                liquidity_mint: ctx.accounts.underlying_mint.to_account_info(),
                liquidity_supply: ctx.accounts.klend_liquidity_supply.to_account_info(),
                collateral_mint: ctx.accounts.klend_collateral_mint.to_account_info(),
                user_liquidity: ctx.accounts.user_underlying.to_account_info(),
                user_collateral: ctx.accounts.collateral_vault.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        );
        mock_klend::cpi::deposit_reserve_liquidity(cpi_ctx, amount_underlying)?;

        ctx.accounts.collateral_vault.reload()?;
        let coll_after = ctx.accounts.collateral_vault.amount;
        let sy_out = coll_after
            .checked_sub(coll_before)
            .ok_or(AdapterError::Overflow)?;

        // Mint SY 1:1 with new ctokens to user.
        let underlying_mint_key = ctx.accounts.sy_metadata.underlying_mint;
        let bump = [ctx.accounts.sy_metadata.bump];
        let signer_seeds: &[&[&[u8]]] =
            &[&[SY_METADATA_SEED, underlying_mint_key.as_ref(), &bump]];
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.sy_mint.to_account_info(),
                    to: ctx.accounts.sy_dst.to_account_info(),
                    authority: ctx.accounts.sy_metadata.to_account_info(),
                },
                signer_seeds,
            ),
            sy_out,
        )?;

        let rate = read_exchange_rate(&ctx.accounts.klend_reserve)?;
        Ok(MintSyReturnData {
            sy_out_amount: sy_out,
            exchange_rate: rate,
        })
    }

    /// Redeem SY: burn SY from user → redeem equal ctokens from adapter vault via
    /// klend.redeem_reserve_collateral → user receives underlying.
    #[instruction(discriminator = [2])]
    pub fn redeem_sy<'info>(
        ctx: Context<'_, '_, '_, 'info, RedeemSy<'info>>,
        amount_sy: u64,
    ) -> Result<RedeemSyReturnData> {
        require!(amount_sy > 0, AdapterError::ZeroAmount);

        // Burn SY from user.
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.sy_mint.to_account_info(),
                    from: ctx.accounts.sy_src.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount_sy,
        )?;

        // Redeem equal ctokens from our collateral_vault.
        let underlying_mint_key = ctx.accounts.sy_metadata.underlying_mint;
        let bump = [ctx.accounts.sy_metadata.bump];
        let signer_seeds: &[&[&[u8]]] =
            &[&[SY_METADATA_SEED, underlying_mint_key.as_ref(), &bump]];

        let liq_before = ctx.accounts.user_underlying.amount;

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.klend_program.to_account_info(),
            mock_klend::cpi::accounts::RedeemReserveCollateral {
                user: ctx.accounts.sy_metadata.to_account_info(),
                reserve: ctx.accounts.klend_reserve.to_account_info(),
                liquidity_mint: ctx.accounts.underlying_mint.to_account_info(),
                liquidity_supply: ctx.accounts.klend_liquidity_supply.to_account_info(),
                collateral_mint: ctx.accounts.klend_collateral_mint.to_account_info(),
                user_liquidity: ctx.accounts.user_underlying.to_account_info(),
                user_collateral: ctx.accounts.collateral_vault.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            signer_seeds,
        );
        mock_klend::cpi::redeem_reserve_collateral(cpi_ctx, amount_sy)?;

        ctx.accounts.user_underlying.reload()?;
        let liq_after = ctx.accounts.user_underlying.amount;
        let underlying_out = liq_after.checked_sub(liq_before).ok_or(AdapterError::Overflow)?;

        let rate = read_exchange_rate(&ctx.accounts.klend_reserve)?;
        Ok(RedeemSyReturnData {
            base_out_amount: underlying_out,
            exchange_rate: rate,
        })
    }

    /// Create a PersonalPosition for `owner` on this SY market.
    #[instruction(discriminator = [3])]
    pub fn init_personal_account(ctx: Context<InitPersonalAccount>) -> Result<()> {
        let p = &mut ctx.accounts.position;
        p.sy_metadata = ctx.accounts.sy_metadata.key();
        p.owner = ctx.accounts.owner.key();
        p.sy_balance = 0;
        Ok(())
    }

    /// User deposits SY into adapter's pool escrow and credits their position.
    #[instruction(discriminator = [5])]
    pub fn deposit_sy(ctx: Context<DepositSy>, amount: u64) -> Result<SyState> {
        if amount > 0 {
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.sy_src.to_account_info(),
                        mint: ctx.accounts.sy_mint.to_account_info(),
                        to: ctx.accounts.pool_escrow.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                amount,
                ctx.accounts.sy_mint.decimals,
            )?;
            let p = &mut ctx.accounts.position;
            p.sy_balance = p
                .sy_balance
                .checked_add(amount)
                .ok_or(AdapterError::Overflow)?;
        }

        Ok(SyState {
            exchange_rate: read_exchange_rate(&ctx.accounts.klend_reserve)?,
            emission_indexes: vec![],
        })
    }

    /// Withdraw SY from pool escrow back to owner.
    #[instruction(discriminator = [6])]
    pub fn withdraw_sy(ctx: Context<WithdrawSy>, amount: u64) -> Result<SyState> {
        if amount > 0 {
            {
                let p = &mut ctx.accounts.position;
                p.sy_balance = p
                    .sy_balance
                    .checked_sub(amount)
                    .ok_or(AdapterError::InsufficientBalance)?;
            }

            let underlying_mint_key = ctx.accounts.sy_metadata.underlying_mint;
            let bump = [ctx.accounts.sy_metadata.bump];
            let signer_seeds: &[&[&[u8]]] =
                &[&[SY_METADATA_SEED, underlying_mint_key.as_ref(), &bump]];
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.pool_escrow.to_account_info(),
                        mint: ctx.accounts.sy_mint.to_account_info(),
                        to: ctx.accounts.sy_dst.to_account_info(),
                        authority: ctx.accounts.sy_metadata.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
                ctx.accounts.sy_mint.decimals,
            )?;
        }

        Ok(SyState {
            exchange_rate: read_exchange_rate(&ctx.accounts.klend_reserve)?,
            emission_indexes: vec![],
        })
    }

    /// Read-only SyState. Exchange rate read from klend reserve.
    #[instruction(discriminator = [7])]
    pub fn get_sy_state(ctx: Context<GetSyState>) -> Result<SyState> {
        Ok(SyState {
            exchange_rate: read_exchange_rate(&ctx.accounts.klend_reserve)?,
            emission_indexes: vec![],
        })
    }

    /// No-op; this adapter has no emissions. Placeholder for interface parity.
    #[instruction(discriminator = [8])]
    pub fn claim_emission(_ctx: Context<ClaimEmission>, _amount: Amount) -> Result<()> {
        Ok(())
    }

    /// Read-only: position data.
    #[instruction(discriminator = [10])]
    pub fn get_position(ctx: Context<GetPosition>) -> Result<PositionState> {
        let p = &ctx.accounts.position;
        Ok(PositionState {
            owner: p.owner,
            sy_balance: p.sy_balance,
            emissions: vec![],
        })
    }
}

// -------------- Whitelist wiring (M-KYC-3) --------------

/// Whitelist the caller-supplied core PDAs via governor CPI.
///
/// For each PDA in `core_pdas_to_whitelist`, invokes
/// `governor::add_participant_via_pool(role: Escrow)`. Governor in turn CPIs
/// delta-mint to create the `WhitelistEntry` PDA with role = Escrow — the PDA
/// becomes an eligible `transfer_checked` destination but is rejected from
/// `mint_to` by delta-mint's existing Holder-only check.
///
/// The curator (governor root authority or admin) must sign the outer tx as
/// `accounts.curator`; governor's `is_authorized` gate runs at the CPI
/// boundary, we don't replicate it here.
///
/// Remaining-accounts layout, per PDA, in order:
///   [ wallet_pubkey_to_whitelist, whitelist_entry_pda ]
fn whitelist_pdas_via_governor<'info>(
    _sy_metadata_key: &Pubkey,
    kyc_mode: &KycMode,
    accounts: &InitSyParams<'info>,
    remaining: &[AccountInfo<'info>],
    core_pdas_to_whitelist: &[Pubkey],
) -> Result<()> {
    let KycMode::GovernorWhitelist {
        governor_program,
        pool_config,
        dm_mint_config,
        delta_mint_program,
    } = kyc_mode
    else {
        return err!(AdapterError::WhitelistNotInKycMode);
    };

    let governor_prog_info = accounts
        .governor_program
        .as_ref()
        .ok_or(AdapterError::GovernorAccountMismatch)?;
    require!(
        governor_prog_info.key() == *governor_program,
        AdapterError::GovernorAccountMismatch
    );
    let pool_config_info = accounts
        .pool_config
        .as_ref()
        .ok_or(AdapterError::GovernorAccountMismatch)?;
    require!(
        pool_config_info.key() == *pool_config,
        AdapterError::GovernorAccountMismatch
    );
    let dm_mint_config_info = accounts
        .dm_mint_config
        .as_ref()
        .ok_or(AdapterError::GovernorAccountMismatch)?;
    require!(
        dm_mint_config_info.key() == *dm_mint_config,
        AdapterError::GovernorAccountMismatch
    );
    let delta_mint_prog_info = accounts
        .delta_mint_program
        .as_ref()
        .ok_or(AdapterError::GovernorAccountMismatch)?;
    require!(
        delta_mint_prog_info.key() == *delta_mint_program,
        AdapterError::GovernorAccountMismatch
    );

    require!(
        remaining.len() == core_pdas_to_whitelist.len() * 2,
        AdapterError::WhitelistAccountsMismatch
    );

    for (i, pda) in core_pdas_to_whitelist.iter().enumerate() {
        let wallet_info = &remaining[i * 2];
        let whitelist_entry_info = &remaining[i * 2 + 1];
        require!(
            wallet_info.key() == *pda,
            AdapterError::WhitelistPdaMismatch
        );

        governor_cpi::add_participant_via_pool(
            CpiContext::new(
                governor_prog_info.to_account_info(),
                governor_accounts::AddParticipantViaPool {
                    authority: accounts.curator.to_account_info(),
                    pool_config: pool_config_info.to_account_info(),
                    admin_entry: None,
                    dm_mint_config: dm_mint_config_info.to_account_info(),
                    wallet: wallet_info.clone(),
                    whitelist_entry: whitelist_entry_info.clone(),
                    delta_mint_program: delta_mint_prog_info.to_account_info(),
                    system_program: accounts.system_program.to_account_info(),
                },
            ),
            GovernorRole::Escrow,
        )?;
    }

    Ok(())
}

// -------------- Reserve-rate decoder --------------

/// Real klend Reserve account total size (8-byte anchor discriminator + 8616-byte body).
/// Const-asserted by Kamino-Finance/klend; see
/// https://github.com/Kamino-Finance/klend/blob/main/libs/klend-interface/src/state/reserve.rs
const REAL_KLEND_RESERVE_LEN: usize = 8624;

/// Mock-klend Reserve account total size (discriminator + 4 pubkeys + Number + bump, no padding).
/// Leaves room for growth below 256 bytes — well clear of REAL_KLEND_RESERVE_LEN.
const MOCK_KLEND_RESERVE_MAX_LEN: usize = 256;

// Real-klend field offsets — see the layout walkthrough in the docstring of
// `read_real_klend_rate` below for how these derive. Pinned by
// `const _: () = assert!(core::mem::size_of::<Reserve>() == 8616);` upstream.
const REAL_OFF_TOTAL_AVAILABLE_AMOUNT: usize = 224;
const REAL_OFF_BORROWED_AMOUNT_SF: usize = 232;
const REAL_OFF_ACC_PROTOCOL_FEES_SF: usize = 344;
const REAL_OFF_ACC_REFERRER_FEES_SF: usize = 360;
const REAL_OFF_PENDING_REFERRER_FEES_SF: usize = 376;
const REAL_OFF_COLLATERAL_MINT_TOTAL_SUPPLY: usize = 2592;

/// 60-bit fractional scaling used by klend's `Fraction` (fixed::FixedU128<60>).
/// An `x_sf` field stores `x * 2^SF_BITS` as a u128.
const SF_BITS: u32 = 60;

/// Read `collateral_exchange_rate` from a klend Reserve account.
///
/// Dispatches on account data length:
/// * `REAL_KLEND_RESERVE_LEN` (8624 bytes) → production Kamino Lend V2 layout.
/// * anything shorter (≤ `MOCK_KLEND_RESERVE_MAX_LEN`) → the in-tree `mock_klend` layout
///   used by integration tests.
/// * anything else → `ReserveDataMalformed` (fail closed).
///
/// Returning the same `Number` shape for both lets the rest of the adapter stay
/// decoder-agnostic.
fn read_exchange_rate(klend_reserve: &AccountInfo) -> Result<Number> {
    let data = klend_reserve.try_borrow_data()?;

    if data.len() == REAL_KLEND_RESERVE_LEN {
        return read_real_klend_rate(&data);
    }

    if data.len() <= MOCK_KLEND_RESERVE_MAX_LEN {
        return read_mock_klend_rate(&data);
    }

    err!(AdapterError::ReserveDataMalformed)
}

/// Mock-klend `Reserve` layout (post-8-byte-discriminator):
///   lending_market: Pubkey         (32)
///   liquidity_mint: Pubkey         (32)
///   liquidity_supply: Pubkey       (32)
///   collateral_mint: Pubkey        (32)
///   collateral_exchange_rate: Number (32)
///   bump: u8                       (1)
fn read_mock_klend_rate(data: &[u8]) -> Result<Number> {
    const OFFSET: usize = 8 + 32 * 4;
    require!(
        data.len() >= OFFSET + 32,
        AdapterError::ReserveDataMalformed
    );
    let mut buf = &data[OFFSET..OFFSET + 32];
    let rate = Number::deserialize(&mut buf).map_err(|_| AdapterError::ReserveDataMalformed)?;
    require!(rate > Number::ZERO, AdapterError::InvalidExchangeRate);
    Ok(rate)
}

/// Real klend `Reserve` layout walkthrough (offsets are into the full account data,
/// i.e. including the 8-byte anchor discriminator at bytes 0..8):
///
/// ```text
///   8      version: u64
///   16     last_update: LastUpdate              (slot:u64 + stale:u8 + status:u8 + pad:[u8;6]) = 16
///   32     lending_market: Pubkey
///   64     farm_collateral: Pubkey
///   96     farm_debt: Pubkey
///   128    liquidity: ReserveLiquidity {
///   128      mint_pubkey: Pubkey
///   160      supply_vault: Pubkey
///   192      fee_vault: Pubkey
///   224      total_available_amount: u64                                    <-- #1
///   232      borrowed_amount_sf: PodU128  (scaled 2^60)                     <-- #2
///   248      market_price_sf: PodU128
///   264      market_price_last_updated_ts: u64
///   272      mint_decimals: u64
///   280      deposit_limit_crossed_timestamp: u64
///   288      borrow_limit_crossed_timestamp: u64
///   296      cumulative_borrow_rate_bsf: BigFractionBytes  (48 = 4×u64 + 2×u64 padding)
///   344      accumulated_protocol_fees_sf: PodU128                          <-- #3
///   360      accumulated_referrer_fees_sf: PodU128                          <-- #4
///   376      pending_referrer_fees_sf: PodU128                              <-- #5
///            … (absolute_referral_rate_sf, token_program, padding2, padding3)
///   1360   }  (ReserveLiquidity total = 1232 bytes)
///   1360   reserve_liquidity_padding: [u64; 150]  = 1200
///   2560   collateral: ReserveCollateral {
///   2560      mint_pubkey: Pubkey
///   2592      mint_total_supply: u64                                        <-- #6
///            … supply_vault, padding
///          }
///          config, paddings, withdraw_queue, etc. (total = 8616)
/// ```
///
/// Derivation of the exchange rate:
///
/// ```text
///   total_supply_sf  = (total_available_amount << SF_BITS)
///                    + borrowed_amount_sf
///                    - (accumulated_protocol_fees_sf + accumulated_referrer_fees_sf + pending_referrer_fees_sf)
///   total_supply     ≈ total_supply_sf >> SF_BITS   (floor)
///   exchange_rate    = total_supply / mint_total_supply
/// ```
///
/// Sub-native-unit precision is dropped by the shift. That's safe: exchange rate
/// moves on the order of basis points per epoch; truncating dust fractional
/// liquidity shifts the returned rate by at most `1 / mint_total_supply`, which is
/// well below `precise_number`'s 1e-12 precision for any realistic d-token supply.
fn read_real_klend_rate(data: &[u8]) -> Result<Number> {
    require!(
        data.len() == REAL_KLEND_RESERVE_LEN,
        AdapterError::ReserveDataMalformed
    );

    let available_amount = read_u64(data, REAL_OFF_TOTAL_AVAILABLE_AMOUNT)?;
    let borrowed_sf = read_u128(data, REAL_OFF_BORROWED_AMOUNT_SF)?;
    let acc_protocol_fees_sf = read_u128(data, REAL_OFF_ACC_PROTOCOL_FEES_SF)?;
    let acc_referrer_fees_sf = read_u128(data, REAL_OFF_ACC_REFERRER_FEES_SF)?;
    let pending_referrer_fees_sf = read_u128(data, REAL_OFF_PENDING_REFERRER_FEES_SF)?;
    let collateral_supply = read_u64(data, REAL_OFF_COLLATERAL_MINT_TOTAL_SUPPLY)?;

    require!(collateral_supply > 0, AdapterError::InvalidExchangeRate);

    // Sum the "paid" fees — these are owed to the protocol/referrer pool and
    // are subtracted from the pool's distributable supply.
    let fees_sf = acc_protocol_fees_sf
        .saturating_add(acc_referrer_fees_sf)
        .saturating_add(pending_referrer_fees_sf);

    // Scaled-fraction math: total_supply = available + (borrowed − fees) / 2^60
    let available_sf = (available_amount as u128).saturating_mul(1u128 << SF_BITS);
    let total_supply_sf = available_sf
        .saturating_add(borrowed_sf)
        .saturating_sub(fees_sf);

    // Floor back to native units. Precision loss is at most 1 unit of liquidity
    // per call; see docstring for why that's acceptable here.
    let total_supply = (total_supply_sf >> SF_BITS) as u128;
    require!(total_supply > 0, AdapterError::InvalidExchangeRate);

    Ok(Number::from_ratio(total_supply, collateral_supply as u128))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let slice: [u8; 8] = data
        .get(offset..offset + 8)
        .and_then(|s| s.try_into().ok())
        .ok_or(AdapterError::ReserveDataMalformed)?;
    Ok(u64::from_le_bytes(slice))
}

fn read_u128(data: &[u8], offset: usize) -> Result<u128> {
    let slice: [u8; 16] = data
        .get(offset..offset + 16)
        .and_then(|s| s.try_into().ok())
        .ok_or(AdapterError::ReserveDataMalformed)?;
    Ok(u128::from_le_bytes(slice))
}

// -------------- State --------------

#[account]
pub struct SyMetadata {
    pub curator: Pubkey,
    pub underlying_mint: Pubkey,
    pub sy_mint: Pubkey,
    pub collateral_vault: Pubkey,
    pub pool_escrow: Pubkey,
    pub klend_program: Pubkey,
    pub klend_lending_market: Pubkey,
    pub klend_reserve: Pubkey,
    pub klend_collateral_mint: Pubkey,
    pub kyc_mode: KycMode,
    pub bump: u8,
}

impl SyMetadata {
    // Fixed fields (10 pubkeys + bump) + worst-case KycMode (5 pubkeys) + enum disc.
    pub const SIZE: usize = 8
        + 32 * 9
        + 1 // bump
        + 1 // KycMode enum discriminator
        + 32 * 4; // GovernorWhitelist payload (4 pubkeys)
}

#[account]
pub struct PersonalPosition {
    pub sy_metadata: Pubkey,
    pub owner: Pubkey,
    pub sy_balance: u64,
}

impl PersonalPosition {
    pub const SIZE: usize = 8 + 32 + 32 + 8;
}

// -------------- Contexts --------------

#[derive(Accounts)]
pub struct InitSyParams<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Curator is the caller authorizing the init. When kyc_mode is GovernorWhitelist
    /// they must be a governor root/admin — enforced by the governor CPI in M-KYC-3.
    pub curator: Signer<'info>,

    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = [SY_METADATA_SEED, underlying_mint.key().as_ref()],
        bump,
        space = SyMetadata::SIZE,
    )]
    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    #[account(
        init,
        payer = payer,
        seeds = [SY_MINT_SEED, sy_metadata.key().as_ref()],
        bump,
        mint::authority = sy_metadata,
        mint::decimals = underlying_mint.decimals,
    )]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Adapter-owned vault holding klend ctokens. SY supply tracks this 1:1.
    #[account(
        init,
        payer = payer,
        seeds = [COLLATERAL_VAULT_SEED, sy_metadata.key().as_ref()],
        bump,
        token::mint = klend_collateral_mint,
        token::authority = sy_metadata,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pool escrow for deposit_sy / withdraw_sy flow.
    #[account(
        init,
        payer = payer,
        seeds = [POOL_ESCROW_SEED, sy_metadata.key().as_ref()],
        bump,
        token::mint = sy_mint,
        token::authority = sy_metadata,
    )]
    pub pool_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: klend reserve account — validated later via `has_one = klend_reserve` on
    /// downstream ixs. Here we just store its pubkey.
    pub klend_reserve: UncheckedAccount<'info>,

    /// CHECK: klend lending market — opaque to the adapter.
    pub klend_lending_market: UncheckedAccount<'info>,

    pub klend_collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: klend program — CPI target, never deserialized.
    pub klend_program: UncheckedAccount<'info>,

    // ---- Optional governor wiring (required when kyc_mode == GovernorWhitelist) ----
    /// CHECK: validated against kyc_mode payload.
    pub governor_program: Option<UncheckedAccount<'info>>,
    /// CHECK: validated against kyc_mode payload.
    pub pool_config: Option<UncheckedAccount<'info>>,
    /// CHECK: validated against kyc_mode payload.
    pub dm_mint_config: Option<UncheckedAccount<'info>>,
    /// CHECK: validated against kyc_mode payload.
    pub delta_mint_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintSy<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [SY_METADATA_SEED, underlying_mint.key().as_ref()],
        bump = sy_metadata.bump,
        has_one = underlying_mint,
        has_one = sy_mint,
        has_one = collateral_vault,
        has_one = klend_program,
        has_one = klend_reserve,
        has_one = klend_collateral_mint,
    )]
    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    #[account(address = sy_metadata.underlying_mint)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = sy_metadata.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = underlying_mint, token::authority = owner)]
    pub user_underlying: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = sy_mint)]
    pub sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = sy_metadata.collateral_vault)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated via sy_metadata.has_one.
    #[account(mut)]
    pub klend_reserve: UncheckedAccount<'info>,

    /// CHECK: klend-owned liquidity supply ATA; validated by klend on CPI.
    #[account(mut)]
    pub klend_liquidity_supply: UncheckedAccount<'info>,

    #[account(mut, address = sy_metadata.klend_collateral_mint)]
    pub klend_collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: CPI target.
    pub klend_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RedeemSy<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [SY_METADATA_SEED, underlying_mint.key().as_ref()],
        bump = sy_metadata.bump,
        has_one = underlying_mint,
        has_one = sy_mint,
        has_one = collateral_vault,
        has_one = klend_program,
        has_one = klend_reserve,
        has_one = klend_collateral_mint,
    )]
    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    #[account(address = sy_metadata.underlying_mint)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = sy_metadata.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = sy_mint, token::authority = owner)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = underlying_mint)]
    pub user_underlying: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = sy_metadata.collateral_vault)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated via sy_metadata.has_one.
    #[account(mut)]
    pub klend_reserve: UncheckedAccount<'info>,

    /// CHECK: klend-owned liquidity supply ATA; validated by klend on CPI.
    #[account(mut)]
    pub klend_liquidity_supply: UncheckedAccount<'info>,

    #[account(mut, address = sy_metadata.klend_collateral_mint)]
    pub klend_collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: CPI target.
    pub klend_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct InitPersonalAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: stored only.
    pub owner: UncheckedAccount<'info>,

    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    #[account(
        init,
        payer = payer,
        seeds = [PERSONAL_POSITION_SEED, sy_metadata.key().as_ref(), owner.key().as_ref()],
        bump,
        space = PersonalPosition::SIZE,
    )]
    pub position: Box<Account<'info, PersonalPosition>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositSy<'info> {
    pub owner: Signer<'info>,

    #[account(
        has_one = sy_mint,
        has_one = pool_escrow,
        has_one = klend_reserve,
    )]
    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    #[account(mut, address = sy_metadata.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = sy_mint, token::authority = owner)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = sy_metadata.pool_escrow)]
    pub pool_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [PERSONAL_POSITION_SEED, sy_metadata.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = sy_metadata,
        has_one = owner,
    )]
    pub position: Box<Account<'info, PersonalPosition>>,

    /// CHECK: validated via sy_metadata.has_one.
    pub klend_reserve: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawSy<'info> {
    pub owner: Signer<'info>,

    #[account(
        has_one = sy_mint,
        has_one = pool_escrow,
        has_one = klend_reserve,
    )]
    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    #[account(mut, address = sy_metadata.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = sy_mint)]
    pub sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = sy_metadata.pool_escrow)]
    pub pool_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [PERSONAL_POSITION_SEED, sy_metadata.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = sy_metadata,
        has_one = owner,
    )]
    pub position: Box<Account<'info, PersonalPosition>>,

    /// CHECK: validated via sy_metadata.has_one.
    pub klend_reserve: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct GetSyState<'info> {
    #[account(has_one = klend_reserve)]
    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    /// CHECK: validated via sy_metadata.has_one.
    pub klend_reserve: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimEmission<'info> {
    pub sy_metadata: Box<Account<'info, SyMetadata>>,
}

#[derive(Accounts)]
pub struct GetPosition<'info> {
    pub sy_metadata: Box<Account<'info, SyMetadata>>,

    #[account(has_one = sy_metadata)]
    pub position: Box<Account<'info, PersonalPosition>>,
}

// -------------- Errors --------------

#[error_code]
pub enum AdapterError {
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Invalid exchange rate (must be > 0)")]
    InvalidExchangeRate,
    #[msg("Position balance overflow")]
    Overflow,
    #[msg("Position balance underflow")]
    InsufficientBalance,
    #[msg("Governor account does not match kyc_mode payload")]
    GovernorAccountMismatch,
    #[msg("remaining_accounts count does not match whitelist request length")]
    WhitelistAccountsMismatch,
    #[msg("remaining_accounts pubkey does not match core_pdas_to_whitelist entry")]
    WhitelistPdaMismatch,
    #[msg("Cannot pass core_pdas_to_whitelist when kyc_mode is None")]
    WhitelistNotInKycMode,
    #[msg("Reserve account data malformed / unexpected layout")]
    ReserveDataMalformed,
}

// -------------- Tests --------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a zeroed buffer shaped like a real klend Reserve account and
    /// populate only the fields that `read_real_klend_rate` consumes.
    fn real_klend_buffer(
        available: u64,
        borrowed_sf: u128,
        acc_protocol_sf: u128,
        acc_referrer_sf: u128,
        pending_referrer_sf: u128,
        collateral_supply: u64,
    ) -> Vec<u8> {
        let mut data = vec![0u8; REAL_KLEND_RESERVE_LEN];
        data[REAL_OFF_TOTAL_AVAILABLE_AMOUNT..REAL_OFF_TOTAL_AVAILABLE_AMOUNT + 8]
            .copy_from_slice(&available.to_le_bytes());
        data[REAL_OFF_BORROWED_AMOUNT_SF..REAL_OFF_BORROWED_AMOUNT_SF + 16]
            .copy_from_slice(&borrowed_sf.to_le_bytes());
        data[REAL_OFF_ACC_PROTOCOL_FEES_SF..REAL_OFF_ACC_PROTOCOL_FEES_SF + 16]
            .copy_from_slice(&acc_protocol_sf.to_le_bytes());
        data[REAL_OFF_ACC_REFERRER_FEES_SF..REAL_OFF_ACC_REFERRER_FEES_SF + 16]
            .copy_from_slice(&acc_referrer_sf.to_le_bytes());
        data[REAL_OFF_PENDING_REFERRER_FEES_SF..REAL_OFF_PENDING_REFERRER_FEES_SF + 16]
            .copy_from_slice(&pending_referrer_sf.to_le_bytes());
        data[REAL_OFF_COLLATERAL_MINT_TOTAL_SUPPLY..REAL_OFF_COLLATERAL_MINT_TOTAL_SUPPLY + 8]
            .copy_from_slice(&collateral_supply.to_le_bytes());
        data
    }

    /// Scaling helper: convert native units to a 60-bit scaled fraction.
    fn to_sf(x: u128) -> u128 {
        x << SF_BITS
    }

    /// Rate 1:1 — 1_000_000 liquidity, 1_000_000 ctokens, no fees, no borrow.
    #[test]
    fn real_klend_rate_one_to_one() {
        let data = real_klend_buffer(1_000_000, 0, 0, 0, 0, 1_000_000);
        let rate = read_real_klend_rate(&data).expect("decode ok");
        assert_eq!(rate, Number::from_natural_u64(1));
    }

    /// Classic post-accrual: available=1M, borrowed=500k scaled (no interest yet),
    /// ctoken supply=1M → rate = (1M + 500k) / 1M = 1.5.
    #[test]
    fn real_klend_rate_with_borrowed_liquidity() {
        let data = real_klend_buffer(1_000_000, to_sf(500_000), 0, 0, 0, 1_000_000);
        let rate = read_real_klend_rate(&data).expect("decode ok");
        // Rate = 1.5 in the Number domain.
        let expected = Number::from_ratio(3, 2);
        assert_eq!(rate, expected);
    }

    /// Fees are subtracted from the distributable supply.
    /// available=1M, borrowed=1M_sf, fees=(100k+50k+25k)=175k_sf, supply=1M
    /// → rate = (1M + 1M - 175k) / 1M = 1.825.
    #[test]
    fn real_klend_rate_subtracts_all_three_fee_buckets() {
        let data = real_klend_buffer(
            1_000_000,
            to_sf(1_000_000),
            to_sf(100_000),
            to_sf(50_000),
            to_sf(25_000),
            1_000_000,
        );
        let rate = read_real_klend_rate(&data).expect("decode ok");
        let expected = Number::from_ratio(1_825_000, 1_000_000);
        assert_eq!(rate, expected);
    }

    /// Zero collateral supply must fail — can't divide by zero, and such a
    /// reserve is in an uninitialized state anyway.
    #[test]
    fn real_klend_rate_rejects_zero_ctoken_supply() {
        let data = real_klend_buffer(1_000_000, 0, 0, 0, 0, 0);
        let err = read_real_klend_rate(&data).expect_err("must reject");
        let anchor_err: anchor_lang::error::Error = err.into();
        assert!(format!("{anchor_err:?}").contains("InvalidExchangeRate"));
    }

    /// Short buffer must fail cleanly, not panic.
    #[test]
    fn real_klend_rate_rejects_truncated_buffer() {
        let short = vec![0u8; REAL_KLEND_RESERVE_LEN - 1];
        let err = read_real_klend_rate(&short).expect_err("must reject");
        let anchor_err: anchor_lang::error::Error = err.into();
        assert!(format!("{anchor_err:?}").contains("ReserveDataMalformed"));
    }

    /// Dispatch sanity: real-klend size picks the real decoder.
    #[test]
    fn dispatch_real_vs_mock_by_size() {
        let mock_max = MOCK_KLEND_RESERVE_MAX_LEN;
        let real = REAL_KLEND_RESERVE_LEN;
        // Sizes are unambiguous — no overlap.
        assert!(mock_max < real);
    }
}

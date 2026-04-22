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

// -------------- Whitelist wiring (M-KYC-3 swap-point) --------------

/// Single-function swap-point for M-KYC-3.
///
/// **Current behavior (stand-in).** Validates the remaining-accounts layout
/// passed by the caller and emits one `WhitelistRequestedEvent` per PDA so
/// off-chain tooling can observe the intent and, if needed, drive the real
/// governor CPIs in a sibling transaction.
///
/// **M-KYC-3 swap.** Once the external clearstone-finance repo ships
/// `ParticipantRole::Escrow` (see GOVERNOR_ESCROW_ROLE.md / .patch), replace
/// the `emit!` loop below with a CPI:
///
/// ```ignore
/// use governor::cpi as governor_cpi;
/// use governor::cpi::accounts as governor_accounts;
/// use governor::ParticipantRole;
///
/// for (i, pda) in core_pdas_to_whitelist.iter().enumerate() {
///     let wallet_info    = &rem[i * 2];
///     let whitelist_info = &rem[i * 2 + 1];
///     require!(wallet_info.key() == *pda, AdapterError::WhitelistPdaMismatch);
///
///     governor_cpi::add_participant_via_pool(
///         CpiContext::new(
///             accounts.governor_program.as_ref().unwrap().to_account_info(),
///             governor_accounts::AddParticipantViaPool {
///                 authority: /* curator signer */,
///                 pool_config: accounts.pool_config.as_ref().unwrap().to_account_info(),
///                 admin_entry: None,                       // caller = root authority
///                 dm_mint_config: accounts.dm_mint_config.as_ref().unwrap().to_account_info(),
///                 wallet: wallet_info.clone(),
///                 whitelist_entry: whitelist_info.clone(),
///                 delta_mint_program: accounts.delta_mint_program.as_ref().unwrap().to_account_info(),
///                 system_program: /* pass through */,
///             },
///         ),
///         ParticipantRole::Escrow,
///     )?;
/// }
/// ```
///
/// Cargo.toml additions for the swap:
/// ```ignore
/// governor   = { git = "https://github.com/1delta-DAO/clearstone-finance", tag = "vX.Y.Z-escrow-role", features = ["cpi", "no-entrypoint"] }
/// delta_mint = { git = "https://github.com/1delta-DAO/clearstone-finance", tag = "vX.Y.Z-escrow-role", features = ["cpi", "no-entrypoint"] }
/// ```
///
/// Also update [tests/clearstone-kyc-pass-through.ts]: the
/// "GovernorWhitelist — emits WhitelistRequestedEvent" test should then
/// assert the `WhitelistEntry` PDAs exist on delta-mint state instead of
/// observing the event.
fn whitelist_pdas_via_governor<'info>(
    sy_metadata_key: &Pubkey,
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
        // Caller already dispatched on this variant — reached only if logic upstream
        // regresses. Fail closed.
        return err!(AdapterError::WhitelistNotInKycMode);
    };

    // Address sanity check on the optional account slots.
    require!(
        accounts.governor_program.as_ref().map(|a| a.key()) == Some(*governor_program),
        AdapterError::GovernorAccountMismatch
    );
    require!(
        accounts.pool_config.as_ref().map(|a| a.key()) == Some(*pool_config),
        AdapterError::GovernorAccountMismatch
    );
    require!(
        accounts.dm_mint_config.as_ref().map(|a| a.key()) == Some(*dm_mint_config),
        AdapterError::GovernorAccountMismatch
    );
    require!(
        accounts.delta_mint_program.as_ref().map(|a| a.key()) == Some(*delta_mint_program),
        AdapterError::GovernorAccountMismatch
    );

    // remaining_accounts layout, per PDA:
    //   [ wallet_pubkey_to_whitelist, whitelist_entry_pda ]
    require!(
        remaining.len() == core_pdas_to_whitelist.len() * 2,
        AdapterError::WhitelistAccountsMismatch
    );

    for (i, pda) in core_pdas_to_whitelist.iter().enumerate() {
        let wallet_info = &remaining[i * 2];
        require!(wallet_info.key() == *pda, AdapterError::WhitelistPdaMismatch);

        // === M-KYC-3 SWAP POINT ===
        // Replace this event-emit with a governor::cpi::add_participant_via_pool
        // call (see function docstring above for the full snippet).
        emit!(WhitelistRequestedEvent {
            sy_metadata: *sy_metadata_key,
            pool_config: *pool_config,
            pda_to_whitelist: *pda,
            whitelist_entry: remaining[i * 2 + 1].key(),
        });
    }

    Ok(())
}

// -------------- Reserve-rate decoder --------------

/// Read `collateral_exchange_rate` from the klend Reserve account.
///
/// The mock_klend Reserve layout is stable (this crate depends on it). For the real klend,
/// this helper must be swapped to the production reserve layout — a one-function change.
fn read_exchange_rate(klend_reserve: &AccountInfo) -> Result<Number> {
    let data = klend_reserve.try_borrow_data()?;
    // mock_klend::state::Reserve layout (after the 8-byte discriminator):
    //   lending_market: Pubkey      (32)
    //   liquidity_mint: Pubkey      (32)
    //   liquidity_supply: Pubkey    (32)
    //   collateral_mint: Pubkey     (32)
    //   collateral_exchange_rate: Number (32)
    //   bump: u8                    (1)
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

// -------------- Events --------------

#[event]
pub struct WhitelistRequestedEvent {
    pub sy_metadata: Pubkey,
    pub pool_config: Pubkey,
    pub pda_to_whitelist: Pubkey,
    pub whitelist_entry: Pubkey,
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

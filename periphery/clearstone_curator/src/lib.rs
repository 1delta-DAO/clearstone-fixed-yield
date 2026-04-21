// Clearstone Curator — MetaMorpho analog. A curator stands up a
// `CuratorVault` over a base asset mint; depositors hand over base and
// get vault shares; the curator's rebalancer spreads the held base across
// a whitelist of Clearstone core markets (each with its own cap).
//
// Trust model: depositors trust the `curator` key to pick safe markets
// and to rebalance sensibly. They do NOT trust the underlying SY programs
// individually — that risk is absorbed by picking a diversified set.
//
// This is a scaffold. Share accounting, rebalance CPIs, and cap
// enforcement compile but haven't been exercised. See FOLLOWUPS.md for
// what's missing before this is usable.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use clearstone_core::program::ClearstoneCore;
use clearstone_core::state::MarketTwo;
use generic_exchange_rate_sy::program::GenericExchangeRateSy;
use precise_number::Number;

declare_id!("831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm");

pub const CURATOR_VAULT_SEED: &[u8] = b"curator_vault";
pub const BASE_ESCROW_SEED: &[u8] = b"base_escrow";
pub const USER_POS_SEED: &[u8] = b"user_pos";

#[program]
pub mod clearstone_curator {
    use super::*;

    /// Stand up a new CuratorVault over `base_mint`. Anyone can call this;
    /// `curator` is the key that can later modify the market whitelist and
    /// trigger rebalances.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        fee_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= 2_000, CuratorError::FeeTooHigh); // 20% max

        let v = &mut ctx.accounts.vault;
        v.curator = ctx.accounts.curator.key();
        v.base_mint = ctx.accounts.base_mint.key();
        v.base_escrow = ctx.accounts.base_escrow.key();
        v.total_shares = 0;
        v.total_assets = 0;
        v.fee_bps = fee_bps;
        v.last_harvest_total_assets = 0;
        v.allocations = vec![];
        v.bump = ctx.bumps.vault;

        emit!(VaultInitialized {
            vault: v.key(),
            curator: v.curator,
            base_mint: v.base_mint,
            fee_bps,
        });
        Ok(())
    }

    /// User deposits `amount_base`, receives shares. Pro-rata against
    /// (total_assets + VIRTUAL_ASSETS, total_shares + VIRTUAL_SHARES) to
    /// preserve the Blue-style anti-inflation property on shares too.
    ///
    /// TODO(deploys-a-share-mint): this scaffold stores share balances on
    /// a `UserPosition` PDA. A cleaner future version mints an SPL share
    /// token so positions are composable with other protocols.
    pub fn deposit(ctx: Context<Deposit>, amount_base: u64) -> Result<()> {
        require!(amount_base > 0, CuratorError::ZeroAmount);

        let v = &mut ctx.accounts.vault;

        // Blue-style virtualization — constants must match the core's or
        // be audit-chosen. 10^6 matches core.
        const VIRTUAL_ASSETS: u128 = 1_000_000;
        const VIRTUAL_SHARES: u128 = 1_000_000;

        let shares_out = ((amount_base as u128)
            * (v.total_shares as u128 + VIRTUAL_SHARES)
            / (v.total_assets as u128 + VIRTUAL_ASSETS)) as u64;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.base_src.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                    to: ctx.accounts.base_escrow.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount_base,
            ctx.accounts.base_mint.decimals,
        )?;

        v.total_assets = v.total_assets.checked_add(amount_base).ok_or(CuratorError::Overflow)?;
        v.total_shares = v.total_shares.checked_add(shares_out).ok_or(CuratorError::Overflow)?;

        let pos = &mut ctx.accounts.position;
        pos.vault = v.key();
        pos.owner = ctx.accounts.owner.key();
        pos.shares = pos.shares.checked_add(shares_out).ok_or(CuratorError::Overflow)?;

        emit!(Deposited {
            vault: v.key(),
            owner: pos.owner,
            amount_base,
            shares_out,
            total_assets: v.total_assets,
            total_shares: v.total_shares,
        });
        Ok(())
    }

    /// User burns `shares` and receives pro-rata base from escrow.
    ///
    /// Fast path only — pays out exclusively from `base_escrow`. If the
    /// escrow is short because most base is deployed into core markets
    /// (via `rebalance` — TODO), this will fail and the user must wait
    /// for the curator to rebalance liquidity back in, or a future
    /// `withdraw_with_pull` path has to land.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, CuratorError::ZeroAmount);

        let v = &mut ctx.accounts.vault;
        let pos = &mut ctx.accounts.position;

        // Same virtualization as deposit. Must be kept in sync if deposit
        // ever gets its own helper — for now the constants are local to
        // both handlers and identical.
        const VIRTUAL_ASSETS: u128 = 1_000_000;
        const VIRTUAL_SHARES: u128 = 1_000_000;

        // assets_out = shares * (total_assets + VA) / (total_shares + VS)
        // Floor toward the vault so the last share-holder never gets a
        // larger slice than arithmetic warrants.
        let assets_out = ((shares as u128)
            * (v.total_assets as u128 + VIRTUAL_ASSETS)
            / (v.total_shares as u128 + VIRTUAL_SHARES)) as u64;

        // Position and global-state updates happen *before* the SPL
        // transfer so a failed transfer reverts to pre-withdraw accounting.
        pos.shares = pos
            .shares
            .checked_sub(shares)
            .ok_or(CuratorError::InsufficientShares)?;
        v.total_shares = v
            .total_shares
            .checked_sub(shares)
            .ok_or(CuratorError::InsufficientShares)?;
        v.total_assets = v
            .total_assets
            .checked_sub(assets_out)
            .ok_or(CuratorError::InsufficientAssets)?;

        // Transfer base from escrow PDA to user.
        let vault_key = v.key();
        let bump = [ctx.bumps.base_escrow];
        let seeds: &[&[&[u8]]] = &[&[BASE_ESCROW_SEED, vault_key.as_ref(), &bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.base_escrow.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                    to: ctx.accounts.base_dst.to_account_info(),
                    authority: ctx.accounts.base_escrow.to_account_info(),
                },
                seeds,
            ),
            assets_out,
            ctx.accounts.base_mint.decimals,
        )?;

        emit!(Withdrawn {
            vault: v.key(),
            owner: pos.owner,
            shares_in: shares,
            assets_out,
            total_assets: v.total_assets,
            total_shares: v.total_shares,
        });
        Ok(())
    }

    /// Curator updates the target allocation weights. Does NOT move funds
    /// immediately — a separate `rebalance` (also TODO) actually moves
    /// base between the core markets' vaults.
    pub fn set_allocations(
        ctx: Context<SetAllocations>,
        allocations: Vec<Allocation>,
    ) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        // has_one on the Accounts struct already enforces curator, but
        // we keep the explicit check for a clearer error message.
        require_keys_eq!(
            v.curator,
            ctx.accounts.curator.key(),
            CuratorError::Unauthorized
        );

        let total_bps: u32 = allocations.iter().map(|a| a.weight_bps as u32).sum();
        require!(total_bps <= 10_000, CuratorError::WeightsExceedFull);

        let n = allocations.len() as u16;
        v.allocations = allocations;

        emit!(AllocationsSet {
            vault: v.key(),
            curator: v.curator,
            n_allocations: n,
            total_weight_bps: total_bps as u16,
        });
        Ok(())
    }

    /// Deploy idle base into one allocation's market as LP.
    ///
    /// Three inner CPIs: (1) adapter.mint_sy pulls base from base_escrow
    /// and mints SY to the vault's SY ATA; (2) core.trade_pt spends part
    /// of that SY on PT (landing in vault's PT ATA); (3) core.deposit_liquidity
    /// pairs (PT + SY) into LP. The vault PDA is the signer for all three
    /// via its cached bump; the curator authorizes the outer ix.
    ///
    /// `deployed_base` tracks the base the vault committed — not
    /// mark-to-market. Use `harvest_fees` (with a curator-attested total)
    /// to fold appreciation back into `total_assets`. See FOLLOWUPS.md for
    /// the full mark-to-market reconciliation story.
    pub fn reallocate_to_market<'info>(
        ctx: Context<'_, '_, '_, 'info, ReallocateToMarket<'info>>,
        allocation_index: u16,
        base_in: u64,
        pt_buy_amount: u64,
        max_sy_in: i64,
        pt_intent: u64,
        sy_intent: u64,
        min_lp_out: u64,
    ) -> Result<()> {
        require!(base_in > 0, CuratorError::ZeroAmount);
        let idx = allocation_index as usize;
        let v = &mut ctx.accounts.vault;
        require!(idx < v.allocations.len(), CuratorError::AllocationIndexOutOfRange);
        require_keys_eq!(
            v.allocations[idx].market,
            ctx.accounts.market.key(),
            CuratorError::AllocationMarketMismatch
        );
        let new_deployed = v.allocations[idx]
            .deployed_base
            .checked_add(base_in)
            .ok_or(CuratorError::Overflow)?;
        require!(
            new_deployed <= v.allocations[idx].cap_base,
            CuratorError::AllocationCapExceeded
        );

        let curator = v.curator;
        let base_mint = v.base_mint;
        let bump = [v.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            CURATOR_VAULT_SEED,
            curator.as_ref(),
            base_mint.as_ref(),
            &bump,
        ]];

        // (1) mint_sy: base_escrow (vault PDA auth) → vault_sy_ata
        generic_exchange_rate_sy::cpi::mint_sy(
            CpiContext::new_with_signer(
                ctx.accounts.sy_program.to_account_info(),
                generic_exchange_rate_sy::cpi::accounts::MintSy {
                    owner: v.to_account_info(),
                    sy_market: ctx.accounts.sy_market.to_account_info(),
                    base_mint: ctx.accounts.base_mint.to_account_info(),
                    sy_mint: ctx.accounts.sy_mint.to_account_info(),
                    base_src: ctx.accounts.base_escrow.to_account_info(),
                    base_vault: ctx.accounts.adapter_base_vault.to_account_info(),
                    sy_dst: ctx.accounts.vault_sy_ata.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            base_in,
        )?;

        // (2) trade_pt buy: vault_sy_ata → vault_pt_ata. Vault PDA signs.
        clearstone_core::cpi::trade_pt(
            CpiContext::new_with_signer(
                ctx.accounts.core_program.to_account_info(),
                clearstone_core::cpi::accounts::TradePt {
                    trader: v.to_account_info(),
                    market: ctx.accounts.market.to_account_info(),
                    token_sy_trader: ctx.accounts.vault_sy_ata.to_account_info(),
                    token_pt_trader: ctx.accounts.vault_pt_ata.to_account_info(),
                    token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
                    token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
                    address_lookup_table: ctx.accounts.market_alt.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    sy_program: ctx.accounts.sy_program.to_account_info(),
                    token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
                    event_authority: ctx.accounts.core_event_authority.to_account_info(),
                    program: ctx.accounts.core_program.to_account_info(),
                },
                signer_seeds,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            pt_buy_amount as i64,
            max_sy_in,
        )?;

        // (3) deposit_liquidity: (vault_pt_ata, vault_sy_ata) → vault_lp_ata.
        clearstone_core::cpi::market_two_deposit_liquidity(
            CpiContext::new_with_signer(
                ctx.accounts.core_program.to_account_info(),
                clearstone_core::cpi::accounts::DepositLiquidity {
                    depositor: v.to_account_info(),
                    market: ctx.accounts.market.to_account_info(),
                    token_pt_src: ctx.accounts.vault_pt_ata.to_account_info(),
                    token_sy_src: ctx.accounts.vault_sy_ata.to_account_info(),
                    token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
                    token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
                    token_lp_dst: ctx.accounts.vault_lp_ata.to_account_info(),
                    mint_lp: ctx.accounts.mint_lp.to_account_info(),
                    address_lookup_table: ctx.accounts.market_alt.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    sy_program: ctx.accounts.sy_program.to_account_info(),
                    event_authority: ctx.accounts.core_event_authority.to_account_info(),
                    program: ctx.accounts.core_program.to_account_info(),
                },
                signer_seeds,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            pt_intent,
            sy_intent,
            min_lp_out,
        )?;

        v.allocations[idx].deployed_base = new_deployed;

        emit!(ReallocatedToMarket {
            vault: v.key(),
            market: ctx.accounts.market.key(),
            allocation_index,
            base_in,
            deployed_base: new_deployed,
        });
        Ok(())
    }

    /// Pull one allocation back out of its market into idle base.
    /// Three inner CPIs symmetric to `reallocate_to_market`:
    /// (1) withdraw_liquidity (LP → PT + SY), (2) trade_pt sell (PT → SY),
    /// (3) adapter.redeem_sy (SY → base_escrow). Vault PDA signs.
    ///
    /// `base_out_expected` is the curator's accounting of how much base
    /// comes back. We use it to decrement `deployed_base` and
    /// `total_assets` — the caller should set it from the actual
    /// post-CPI balance delta on `base_escrow` (curator reads off-chain
    /// and passes the value in). A stricter reconciliation would read
    /// `base_escrow.amount` before and after; we skip that to keep the
    /// CU budget manageable.
    pub fn reallocate_from_market<'info>(
        ctx: Context<'_, '_, '_, 'info, ReallocateFromMarket<'info>>,
        allocation_index: u16,
        lp_in: u64,
        min_pt_out: u64,
        min_sy_out: u64,
        pt_sell_amount: u64,
        min_sy_for_pt: i64,
        sy_redeem_amount: u64,
        base_out_expected: u64,
    ) -> Result<()> {
        let idx = allocation_index as usize;
        let v = &mut ctx.accounts.vault;
        require!(idx < v.allocations.len(), CuratorError::AllocationIndexOutOfRange);
        require_keys_eq!(
            v.allocations[idx].market,
            ctx.accounts.market.key(),
            CuratorError::AllocationMarketMismatch
        );

        let curator = v.curator;
        let base_mint = v.base_mint;
        let bump = [v.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            CURATOR_VAULT_SEED,
            curator.as_ref(),
            base_mint.as_ref(),
            &bump,
        ]];

        // (1) withdraw_liquidity: vault_lp_ata → (vault_pt_ata, vault_sy_ata).
        clearstone_core::cpi::market_two_withdraw_liquidity(
            CpiContext::new_with_signer(
                ctx.accounts.core_program.to_account_info(),
                clearstone_core::cpi::accounts::WithdrawLiquidity {
                    withdrawer: v.to_account_info(),
                    market: ctx.accounts.market.to_account_info(),
                    token_pt_dst: ctx.accounts.vault_pt_ata.to_account_info(),
                    token_sy_dst: ctx.accounts.vault_sy_ata.to_account_info(),
                    token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
                    token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
                    token_lp_src: ctx.accounts.vault_lp_ata.to_account_info(),
                    mint_lp: ctx.accounts.mint_lp.to_account_info(),
                    address_lookup_table: ctx.accounts.market_alt.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    sy_program: ctx.accounts.sy_program.to_account_info(),
                    event_authority: ctx.accounts.core_event_authority.to_account_info(),
                    program: ctx.accounts.core_program.to_account_info(),
                },
                signer_seeds,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            lp_in,
            min_pt_out,
            min_sy_out,
        )?;

        // (2) trade_pt sell: vault_pt_ata → vault_sy_ata. Negative net = selling.
        clearstone_core::cpi::trade_pt(
            CpiContext::new_with_signer(
                ctx.accounts.core_program.to_account_info(),
                clearstone_core::cpi::accounts::TradePt {
                    trader: v.to_account_info(),
                    market: ctx.accounts.market.to_account_info(),
                    token_sy_trader: ctx.accounts.vault_sy_ata.to_account_info(),
                    token_pt_trader: ctx.accounts.vault_pt_ata.to_account_info(),
                    token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
                    token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
                    address_lookup_table: ctx.accounts.market_alt.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    sy_program: ctx.accounts.sy_program.to_account_info(),
                    token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
                    event_authority: ctx.accounts.core_event_authority.to_account_info(),
                    program: ctx.accounts.core_program.to_account_info(),
                },
                signer_seeds,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            -(pt_sell_amount as i64),
            min_sy_for_pt,
        )?;

        // (3) redeem_sy: vault_sy_ata → base_escrow.
        generic_exchange_rate_sy::cpi::redeem_sy(
            CpiContext::new_with_signer(
                ctx.accounts.sy_program.to_account_info(),
                generic_exchange_rate_sy::cpi::accounts::RedeemSy {
                    owner: v.to_account_info(),
                    sy_market: ctx.accounts.sy_market.to_account_info(),
                    base_mint: ctx.accounts.base_mint.to_account_info(),
                    sy_mint: ctx.accounts.sy_mint.to_account_info(),
                    sy_src: ctx.accounts.vault_sy_ata.to_account_info(),
                    base_vault: ctx.accounts.adapter_base_vault.to_account_info(),
                    base_dst: ctx.accounts.base_escrow.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            sy_redeem_amount,
        )?;

        v.allocations[idx].deployed_base = v.allocations[idx]
            .deployed_base
            .saturating_sub(base_out_expected);

        emit!(ReallocatedFromMarket {
            vault: v.key(),
            market: ctx.accounts.market.key(),
            allocation_index,
            base_out: base_out_expected,
            deployed_base: v.allocations[idx].deployed_base,
        });
        Ok(())
    }

    /// Mint performance-fee shares to the curator's UserPosition.
    ///
    /// `current_total_assets` is the curator's attested mark-to-market
    /// value of (idle_base + Σ deployed allocations). The ix:
    ///   1. Updates `vault.total_assets = current_total_assets`.
    ///   2. Computes `gain = max(0, current - last_harvest_total_assets)`.
    ///   3. Fee in asset terms = `gain * fee_bps / 10_000`.
    ///   4. Converts to shares via the Blue-standard formula
    ///      `X = S * fee / (A - fee)` — mints X shares to the curator's
    ///      UserPosition, bumping `total_shares` by X but not
    ///      `total_assets` (other holders' real claim is diluted by
    ///      exactly `fee`).
    ///   5. Snapshots `last_harvest_total_assets = current_total_assets`.
    ///
    /// Trust: curator vouches for `current_total_assets`. Mark-to-market
    /// reconciliation from on-chain market state is tracked separately
    /// in FOLLOWUPS.md.
    pub fn harvest_fees(
        ctx: Context<HarvestFees>,
        current_total_assets: u64,
    ) -> Result<()> {
        let v = &mut ctx.accounts.vault;

        v.total_assets = current_total_assets;

        let last = v.last_harvest_total_assets;
        let gain = current_total_assets.saturating_sub(last);

        let fee_in_assets = ((gain as u128) * (v.fee_bps as u128) / 10_000u128) as u64;

        let mut shares_minted: u64 = 0;
        if fee_in_assets > 0 && current_total_assets > fee_in_assets && v.total_shares > 0 {
            // S * fee / (A - fee)
            let denom = (current_total_assets - fee_in_assets) as u128;
            shares_minted = ((v.total_shares as u128) * (fee_in_assets as u128) / denom) as u64;
            v.total_shares = v
                .total_shares
                .checked_add(shares_minted)
                .ok_or(CuratorError::Overflow)?;
            let pos = &mut ctx.accounts.curator_position;
            pos.vault = v.key();
            pos.owner = ctx.accounts.curator.key();
            pos.shares = pos
                .shares
                .checked_add(shares_minted)
                .ok_or(CuratorError::Overflow)?;
        } else if fee_in_assets > 0 && v.total_shares == 0 {
            // Bootstrapping case: no prior holders, curator takes the
            // entire gain as shares 1:1. Blue math reduces to this when
            // S = 0.
            shares_minted = fee_in_assets;
            v.total_shares = shares_minted;
            let pos = &mut ctx.accounts.curator_position;
            pos.vault = v.key();
            pos.owner = ctx.accounts.curator.key();
            pos.shares = shares_minted;
        }

        v.last_harvest_total_assets = current_total_assets;

        emit!(FeesHarvested {
            vault: v.key(),
            curator: ctx.accounts.curator.key(),
            gain,
            fee_in_assets,
            shares_minted,
            total_assets: v.total_assets,
            total_shares: v.total_shares,
        });
        Ok(())
    }
}

// -------------- State --------------

#[account]
pub struct CuratorVault {
    pub curator: Pubkey,
    pub base_mint: Pubkey,
    pub base_escrow: Pubkey,
    /// Accounting totals. `total_assets` tracks base tokens held across
    /// `base_escrow` (idle) + each allocation's `deployed_base` (deployed
    /// into core markets). Updated by deposit/withdraw/reallocate_* and
    /// — when PT/LP valuations change — by `harvest_fees` (curator-
    /// supplied mark-to-market; see FOLLOWUPS.md total_assets
    /// reconciliation caveat).
    pub total_assets: u64,
    pub total_shares: u64,
    /// Performance fee (bps), on realized yield. 2000 bps (20%) max.
    pub fee_bps: u16,
    /// Snapshot of `total_assets` at the last `harvest_fees`. Gain since
    /// this snapshot is what the fee applies to.
    pub last_harvest_total_assets: u64,
    pub allocations: Vec<Allocation>,
    /// Bump cache — needed because vault PDA signs every inner CPI in
    /// reallocate_to_market / reallocate_from_market.
    pub bump: u8,
}

impl CuratorVault {
    pub fn space(n_allocations: usize) -> usize {
        8                                    // disc
        + 32 * 3                             // 3 pubkeys
        + 8                                  // total_assets
        + 8                                  // total_shares
        + 2                                  // fee_bps
        + 8                                  // last_harvest_total_assets
        + 4 + n_allocations * Allocation::SIZE
        + 1                                  // bump
    }

    pub fn signer_seeds<'a>(&'a self, bump: &'a [u8]) -> [&'a [u8]; 4] {
        [
            CURATOR_VAULT_SEED,
            self.curator.as_ref(),
            self.base_mint.as_ref(),
            bump,
        ]
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Allocation {
    /// Target market in clearstone_core.
    pub market: Pubkey,
    /// Target weight in bps of total_assets. Sum of all weights <= 10_000.
    pub weight_bps: u16,
    /// Hard cap on how much base this allocation will ever hold (risk limit).
    pub cap_base: u64,
    /// Tracking: how much of total_assets is currently deployed here.
    pub deployed_base: u64,
}

impl Allocation {
    pub const SIZE: usize = 32 + 2 + 8 + 8;
}

#[account]
pub struct UserPosition {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
}

impl UserPosition {
    pub const SIZE: usize = 8 + 32 + 32 + 8;
}

// -------------- Events --------------

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub curator: Pubkey,
    pub base_mint: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount_base: u64,
    pub shares_out: u64,
    pub total_assets: u64,
    pub total_shares: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub shares_in: u64,
    pub assets_out: u64,
    pub total_assets: u64,
    pub total_shares: u64,
}

#[event]
pub struct AllocationsSet {
    pub vault: Pubkey,
    pub curator: Pubkey,
    pub n_allocations: u16,
    pub total_weight_bps: u16,
}

#[event]
pub struct ReallocatedToMarket {
    pub vault: Pubkey,
    pub market: Pubkey,
    pub allocation_index: u16,
    pub base_in: u64,
    pub deployed_base: u64,
}

#[event]
pub struct ReallocatedFromMarket {
    pub vault: Pubkey,
    pub market: Pubkey,
    pub allocation_index: u16,
    pub base_out: u64,
    pub deployed_base: u64,
}

#[event]
pub struct FeesHarvested {
    pub vault: Pubkey,
    pub curator: Pubkey,
    pub gain: u64,
    pub fee_in_assets: u64,
    pub shares_minted: u64,
    pub total_assets: u64,
    pub total_shares: u64,
}

// -------------- Accounts --------------

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: stored as curator; not a signer here.
    pub curator: UncheckedAccount<'info>,

    pub base_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        seeds = [CURATOR_VAULT_SEED, curator.key().as_ref(), base_mint.key().as_ref()],
        bump,
        space = CuratorVault::space(0),
    )]
    pub vault: Box<Account<'info, CuratorVault>>,

    #[account(
        init,
        payer = payer,
        seeds = [BASE_ESCROW_SEED, vault.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = base_escrow,
    )]
    pub base_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub vault: Box<Account<'info, CuratorVault>>,

    #[account(mut)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = base_mint, token::authority = owner)]
    pub base_src: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = vault.base_escrow)]
    pub base_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = owner,
        seeds = [b"user_pos", vault.key().as_ref(), owner.key().as_ref()],
        bump,
        space = UserPosition::SIZE,
    )]
    pub position: Box<Account<'info, UserPosition>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(mut)]
    pub vault: Box<Account<'info, CuratorVault>>,

    #[account(mut)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = base_mint)]
    pub base_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [BASE_ESCROW_SEED, vault.key().as_ref()],
        bump,
    )]
    pub base_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"user_pos", vault.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
    )]
    pub position: Box<Account<'info, UserPosition>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(allocations: Vec<Allocation>)]
pub struct SetAllocations<'info> {
    #[account(mut)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        has_one = curator,
        realloc = CuratorVault::space(allocations.len()),
        realloc::payer = curator,
        realloc::zero = false,
    )]
    pub vault: Box<Account<'info, CuratorVault>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReallocateToMarket<'info> {
    #[account(mut)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        has_one = curator,
        has_one = base_mint,
        has_one = base_escrow,
    )]
    pub vault: Box<Account<'info, CuratorVault>>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Vault's base escrow — mint_sy pulls base from here.
    #[account(mut)]
    pub base_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    // Adapter (mint_sy + redeem_sy share the first 3).
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,

    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Adapter's base pool for the SY market.
    #[account(mut)]
    pub adapter_base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Vault-PDA-owned SY ATA.
    #[account(
        init_if_needed,
        payer = curator,
        associated_token::mint = sy_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_sy_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // core.trade_pt + core.deposit_liquidity
    /// CHECK: the market we're reallocating into — matched against the
    /// allocation entry by pubkey in the handler.
    #[account(mut)]
    pub market: Box<Account<'info, MarketTwo>>,

    #[account(mut, address = market.token_pt_escrow)]
    pub market_escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = market.token_sy_escrow)]
    pub market_escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: constrained by market.
    #[account(address = market.token_fee_treasury_sy)]
    #[account(mut)]
    pub token_fee_treasury_sy: UncheckedAccount<'info>,

    /// CHECK: constrained by market.
    #[account(address = market.address_lookup_table)]
    pub market_alt: UncheckedAccount<'info>,

    /// CHECK: PT mint for this market.
    #[account(address = market.mint_pt)]
    pub mint_pt: UncheckedAccount<'info>,

    #[account(mut, address = market.mint_lp)]
    pub mint_lp: Box<InterfaceAccount<'info, Mint>>,

    /// Vault-PDA-owned PT ATA.
    #[account(
        init_if_needed,
        payer = curator,
        associated_token::mint = mint_pt,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_pt_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Vault-PDA-owned LP ATA.
    #[account(
        init_if_needed,
        payer = curator,
        associated_token::mint = mint_lp,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_lp_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReallocateFromMarket<'info> {
    #[account(mut)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        has_one = curator,
        has_one = base_mint,
        has_one = base_escrow,
    )]
    pub vault: Box<Account<'info, CuratorVault>>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub base_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub adapter_base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = sy_mint, associated_token::authority = vault)]
    pub vault_sy_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub market: Box<Account<'info, MarketTwo>>,

    #[account(mut, address = market.token_pt_escrow)]
    pub market_escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = market.token_sy_escrow)]
    pub market_escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: constrained by market.
    #[account(mut, address = market.token_fee_treasury_sy)]
    pub token_fee_treasury_sy: UncheckedAccount<'info>,

    /// CHECK: constrained by market.
    #[account(address = market.address_lookup_table)]
    pub market_alt: UncheckedAccount<'info>,

    /// CHECK: PT mint for this market.
    #[account(address = market.mint_pt)]
    pub mint_pt: UncheckedAccount<'info>,

    #[account(mut, address = market.mint_lp)]
    pub mint_lp: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, associated_token::mint = mint_pt, associated_token::authority = vault)]
    pub vault_pt_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = mint_lp, associated_token::authority = vault)]
    pub vault_lp_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct HarvestFees<'info> {
    #[account(mut)]
    pub curator: Signer<'info>,

    #[account(mut, has_one = curator)]
    pub vault: Box<Account<'info, CuratorVault>>,

    /// Curator's UserPosition, init_if_needed so the first harvest on a
    /// fresh vault doesn't require an out-of-band init. Shares from the
    /// fee land here.
    #[account(
        init_if_needed,
        payer = curator,
        seeds = [USER_POS_SEED, vault.key().as_ref(), curator.key().as_ref()],
        bump,
        space = UserPosition::SIZE,
    )]
    pub curator_position: Box<Account<'info, UserPosition>>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -------------- Errors --------------

#[error_code]
pub enum CuratorError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Performance fee exceeds 20% cap")]
    FeeTooHigh,
    #[msg("Allocation weights exceed 100%")]
    WeightsExceedFull,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Not yet implemented")]
    NotYetImplemented,
    #[msg("Position has fewer shares than requested")]
    InsufficientShares,
    #[msg("Vault escrow has insufficient base liquid; curator must rebalance")]
    InsufficientAssets,
    #[msg("Allocation index out of range for this vault")]
    AllocationIndexOutOfRange,
    #[msg("Market passed does not match the allocation entry")]
    AllocationMarketMismatch,
    #[msg("Allocation cap would be exceeded")]
    AllocationCapExceeded,
}

// Keep precise_number in use so the crate doesn't warn about unused import.
// Share-price math grows out of `Number` once TODO(withdraw) lands.
#[allow(dead_code)]
fn _reserve_math_placeholder(v: &CuratorVault) -> Number {
    if v.total_shares == 0 {
        Number::ZERO
    } else {
        Number::from_ratio(v.total_assets as u128, v.total_shares as u128)
    }
}

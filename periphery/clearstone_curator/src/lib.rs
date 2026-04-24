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
use clearstone_core::state::{MarketTwo, Vault as CoreVault};
use generic_exchange_rate_sy::program::GenericExchangeRateSy;
use precise_number::Number;

pub mod roll_delegation;
pub use roll_delegation::{
    DelegatedRollCompleted, RollDelegation, RollDelegationError, ROLL_DELEGATION_SEED,
};

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

        // Clone the AccountInfo handle BEFORE taking &mut on ctx.accounts.vault
        // so the transfer CPI further down can still pass `vault` as authority
        // without re-borrowing while `v` is live.
        let vault_ai = ctx.accounts.vault.to_account_info();
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

        // Transfer base from escrow (owned by vault PDA) to user — vault
        // signs. Must match `base_escrow`'s authority pinned at init.
        let curator_key = v.curator;
        let base_mint_key = v.base_mint;
        let bump = [v.bump];
        let seeds: &[&[&[u8]]] = &[&[
            CURATOR_VAULT_SEED,
            curator_key.as_ref(),
            base_mint_key.as_ref(),
            &bump,
        ]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.base_escrow.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                    to: ctx.accounts.base_dst.to_account_info(),
                    authority: vault_ai,
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
                    mint_sy: ctx.accounts.sy_mint.to_account_info(),
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
                    mint_sy: ctx.accounts.sy_mint.to_account_info(),
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
                    mint_sy: ctx.accounts.sy_mint.to_account_info(),
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
                    mint_sy: ctx.accounts.sy_mint.to_account_info(),
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

    /// Re-read one allocation's market + the vault's holdings and
    /// recompute `allocations[i].deployed_base` + `total_assets` from
    /// on-chain state. Permissionless — anyone can call this to refresh
    /// the stored mark before `harvest_fees` reads it.
    ///
    /// Base-equivalent formula, per allocation:
    ///   vault_pt      * pt_redemption * sy_rate
    /// + vault_sy      * sy_rate
    /// + lp_share      * (pool_pt * pt_redemption + pool_sy) * sy_rate
    /// where
    ///   pt_redemption = core_vault.pt_redemption_rate()       // SY per PT
    ///   sy_rate       = core_vault.last_seen_sy_exchange_rate  // base per SY
    ///   lp_share      = vault_lp / market_lp_supply
    ///
    /// Stale inputs: `last_seen_sy_exchange_rate` only refreshes on a
    /// vault-touching ix (strip/merge/stage_yt_yield/collect_interest).
    /// Callers who need a current mark should run `stage_yt_yield` on
    /// the vault before mark_to_market.
    pub fn mark_to_market(
        ctx: Context<MarkToMarket>,
        allocation_index: u16,
    ) -> Result<()> {
        let idx = allocation_index as usize;
        let v = &mut ctx.accounts.vault;
        require!(idx < v.allocations.len(), CuratorError::AllocationIndexOutOfRange);
        require_keys_eq!(
            v.allocations[idx].market,
            ctx.accounts.market.key(),
            CuratorError::AllocationMarketMismatch
        );

        let core_vault = &ctx.accounts.core_vault;
        require_keys_eq!(
            ctx.accounts.market.vault,
            core_vault.key(),
            CuratorError::AllocationMarketMismatch
        );

        let sy_rate = core_vault.last_seen_sy_exchange_rate;
        let pt_redemption = core_vault.pt_redemption_rate();

        let pt_held = ctx.accounts.vault_pt_ata.amount;
        let sy_held = ctx.accounts.vault_sy_ata.amount;
        let lp_held = ctx.accounts.vault_lp_ata.amount;
        let lp_supply = ctx.accounts.mint_lp.supply;
        let pool_pt = ctx.accounts.market_escrow_pt.amount;
        let pool_sy = ctx.accounts.market_escrow_sy.amount;

        // Direct PT + SY holdings → SY-equivalent.
        let mut sy_eq = Number::from_natural_u64(pt_held) * pt_redemption
            + Number::from_natural_u64(sy_held);

        if lp_held > 0 && lp_supply > 0 {
            let pool_sy_eq = Number::from_natural_u64(pool_pt) * pt_redemption
                + Number::from_natural_u64(pool_sy);
            let lp_share = Number::from_ratio(lp_held as u128, lp_supply as u128);
            sy_eq += lp_share * pool_sy_eq;
        }

        let base_eq = (sy_eq * sy_rate).floor_u64();
        v.allocations[idx].deployed_base = base_eq;

        // Refresh total_assets = idle + Σ deployed.
        let idle = ctx.accounts.base_escrow.amount;
        let sum_deployed: u64 = v
            .allocations
            .iter()
            .map(|a| a.deployed_base)
            .fold(0u64, |acc, x| acc.saturating_add(x));
        v.total_assets = idle.saturating_add(sum_deployed);

        emit!(MarkedToMarket {
            vault: v.key(),
            market: ctx.accounts.market.key(),
            allocation_index,
            deployed_base: base_eq,
            total_assets: v.total_assets,
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

    // ---------- Roll delegations (v2 permissioning) ----------
    //
    // User-signed delegations let any keeper crank rolls — the
    // on-chain handlers enforce slippage + allocation-set bounds the
    // user signed off on. See roll_delegation.rs + the design spec at
    // clearstone-finance/CURATOR_ROLL_DELEGATION.md.

    pub fn create_delegation(
        ctx: Context<CreateDelegation>,
        max_slippage_bps: u16,
        ttl_slots: u64,
    ) -> Result<()> {
        roll_delegation::create_delegation(ctx, max_slippage_bps, ttl_slots)
    }

    pub fn close_delegation(ctx: Context<CloseDelegation>) -> Result<()> {
        roll_delegation::close_delegation(ctx)
    }

    /// Permissionless keeper crank — performs matured → next rebalance
    /// under a user-signed RollDelegation. Keeper signs the outer tx;
    /// vault PDA signs the inner CPIs.
    ///
    /// Invariants enforced (see CURATOR_ROLL_DELEGATION.md §4):
    ///   I-D4 allocation hash matches delegation
    ///   I-D5 from_market past expiration
    ///   I-D6 min_base_out ≥ delegation's slippage floor
    ///   I-D7 atomic — single instruction = single failure domain
    ///
    /// NOTE: CPI composition duplicates the three-step pattern from
    /// `reallocate_from_market` (withdraw_liquidity → trade_pt sell →
    /// redeem_sy) and `reallocate_to_market` (mint_sy → trade_pt buy →
    /// deposit_liquidity). Extracting shared `_inner` fns is tracked in
    /// FOLLOWUPS.md under `CURATOR_REALLOCATE_DEDUP`; the refactor is
    /// deferred so this ticket ships without touching the audited
    /// curator-signed path.
    pub fn crank_roll_delegated<'info>(
        ctx: Context<'_, '_, '_, 'info, CrankRollDelegated<'info>>,
        from_index: u16,
        to_index: u16,
        min_base_out: u64,
    ) -> Result<()> {
        // ---------- Invariant checks (immutable borrows only) ----------
        let clock = Clock::get()?;
        let from_idx = from_index as usize;
        let to_idx = to_index as usize;

        let (delegation_user, deployed, curator, base_mint_key, bump);
        {
            let d = &ctx.accounts.delegation;
            let v = &ctx.accounts.vault;

            roll_delegation::validate_delegation(
                d,
                v.key(),
                &v.allocations,
                clock.slot,
            )?;

            require!(
                from_idx < v.allocations.len(),
                RollDelegationError::IndexOOR
            );
            require!(
                to_idx < v.allocations.len(),
                RollDelegationError::IndexOOR
            );
            require_keys_eq!(
                v.allocations[from_idx].market,
                ctx.accounts.from_market.key(),
                RollDelegationError::MarketMismatch
            );
            require_keys_eq!(
                v.allocations[to_idx].market,
                ctx.accounts.to_market.key(),
                RollDelegationError::MarketMismatch
            );

            // I-D5: from_market must be past its expiration.
            let expiry = ctx.accounts.from_market.financials.expiration_ts as i64;
            require!(
                clock.unix_timestamp >= expiry,
                RollDelegationError::FromMarketNotMatured
            );

            // Gotcha #5: reject idempotent re-cranks.
            deployed = v.allocations[from_idx].deployed_base;
            require!(deployed > 0, RollDelegationError::NothingToRoll);

            // Gotcha #4: vault's LP balance must back the claimed deployed.
            require!(
                ctx.accounts.from_vault_lp_ata.amount >= deployed,
                RollDelegationError::DeployedBaseDrift
            );

            // I-D6: keeper's slippage floor meets delegation's cap.
            let delegation_floor =
                roll_delegation::slippage_floor(deployed, d.max_slippage_bps);
            require!(
                min_base_out >= delegation_floor,
                RollDelegationError::SlippageBelowDelegationFloor
            );

            delegation_user = d.user;
            curator = v.curator;
            base_mint_key = v.base_mint;
            bump = [v.bump];
        } // immutable borrows released

        // Cache for event emission (cheap copies, outside any borrow).
        let from_market_key = ctx.accounts.from_market.key();
        let to_market_key = ctx.accounts.to_market.key();
        let keeper_key = ctx.accounts.keeper.key();
        let vault_key = ctx.accounts.vault.key();

        let signer_seeds: &[&[&[u8]]] = &[&[
            CURATOR_VAULT_SEED,
            curator.as_ref(),
            base_mint_key.as_ref(),
            &bump,
        ]];

        let base_escrow_before = ctx.accounts.base_escrow.amount;

        // ---------- FROM-leg (each CPI in its own frame via #[inline(never)]) ----------
        crank_cpi::do_withdraw_liquidity(
            ctx.accounts,
            signer_seeds,
            ctx.remaining_accounts,
            deployed,
        )?;

        ctx.accounts.from_vault_pt_ata.reload()?;
        let pt_to_sell = ctx.accounts.from_vault_pt_ata.amount;
        if pt_to_sell > 0 {
            crank_cpi::do_trade_pt_sell(
                ctx.accounts,
                signer_seeds,
                ctx.remaining_accounts,
                pt_to_sell,
            )?;
        }

        ctx.accounts.vault_sy_ata.reload()?;
        let sy_to_redeem = ctx.accounts.vault_sy_ata.amount;
        if sy_to_redeem > 0 {
            crank_cpi::do_redeem_sy(ctx.accounts, signer_seeds, sy_to_redeem)?;
        }

        // ---------- base_out post-check (I-D6) ----------
        ctx.accounts.base_escrow.reload()?;
        let base_out = ctx
            .accounts
            .base_escrow
            .amount
            .checked_sub(base_escrow_before)
            .ok_or(RollDelegationError::SlippageBelowDelegationFloor)?;
        require!(
            base_out >= min_base_out,
            RollDelegationError::SlippageBelowDelegationFloor
        );

        // ---------- Vault state: decrement from, pre-check to ----------
        let new_deployed = {
            let v_mut = &mut ctx.accounts.vault;
            v_mut.allocations[from_idx].deployed_base = v_mut.allocations
                [from_idx]
                .deployed_base
                .saturating_sub(deployed);
            let nd = v_mut.allocations[to_idx]
                .deployed_base
                .checked_add(base_out)
                .ok_or(CuratorError::Overflow)?;
            require!(
                nd <= v_mut.allocations[to_idx].cap_base,
                CuratorError::AllocationCapExceeded
            );
            nd
        }; // mut borrow released before TO-leg CPIs

        // ---------- TO-leg ----------
        crank_cpi::do_mint_sy(ctx.accounts, signer_seeds, base_out)?;

        ctx.accounts.vault_sy_ata.reload()?;
        let sy_for_deposit = ctx.accounts.vault_sy_ata.amount;
        crank_cpi::do_deposit_liquidity(
            ctx.accounts,
            signer_seeds,
            ctx.remaining_accounts,
            sy_for_deposit,
        )?;

        // Commit to-side state.
        ctx.accounts.vault.allocations[to_idx].deployed_base = new_deployed;

        emit!(DelegatedRollCompleted {
            vault: vault_key,
            user: delegation_user,
            keeper: keeper_key,
            from_market: from_market_key,
            to_market: to_market_key,
            from_index,
            to_index,
            base_rolled: base_out,
            min_base_out,
        });

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// crank_cpi — #[inline(never)] helpers so each CPI composition lives in its
// own frame. See FOLLOWUPS :: CURATOR_CRANK_HANDLER_FRAME for the
// motivation: keeping the crank_roll_delegated handler body under the
// 4 KB SBF stack-offset cap requires boundaries the linker can respect.
// ---------------------------------------------------------------------------

mod crank_cpi {
    use super::*;

    #[inline(never)]
    pub(super) fn do_withdraw_liquidity<'info>(
        accts: &CrankRollDelegated<'info>,
        signer_seeds: &[&[&[u8]]],
        remaining_accounts: &[AccountInfo<'info>],
        lp_in: u64,
    ) -> Result<()> {
        clearstone_core::cpi::market_two_withdraw_liquidity(
            CpiContext::new_with_signer(
                accts.core_program.to_account_info(),
                clearstone_core::cpi::accounts::WithdrawLiquidity {
                    withdrawer: accts.vault.to_account_info(),
                    market: accts.from_market.to_account_info(),
                    token_pt_dst: accts.from_vault_pt_ata.to_account_info(),
                    token_sy_dst: accts.vault_sy_ata.to_account_info(),
                    token_pt_escrow: accts.from_market_escrow_pt.to_account_info(),
                    token_sy_escrow: accts.from_market_escrow_sy.to_account_info(),
                    token_lp_src: accts.from_vault_lp_ata.to_account_info(),
                    mint_lp: accts.from_mint_lp.to_account_info(),
                    mint_sy: accts.sy_mint.to_account_info(),
                    address_lookup_table: accts.from_market_alt.to_account_info(),
                    token_program: accts.token_program.to_account_info(),
                    sy_program: accts.sy_program.to_account_info(),
                    event_authority: accts.core_event_authority.to_account_info(),
                    program: accts.core_program.to_account_info(),
                },
                signer_seeds,
            )
            .with_remaining_accounts(remaining_accounts.to_vec()),
            lp_in,
            0, // min_pt_out — slippage enforced at the base_escrow delta
            0, // min_sy_out
        )?;
        Ok(())
    }

    #[inline(never)]
    pub(super) fn do_trade_pt_sell<'info>(
        accts: &CrankRollDelegated<'info>,
        signer_seeds: &[&[&[u8]]],
        remaining_accounts: &[AccountInfo<'info>],
        pt_to_sell: u64,
    ) -> Result<()> {
        clearstone_core::cpi::trade_pt(
            CpiContext::new_with_signer(
                accts.core_program.to_account_info(),
                clearstone_core::cpi::accounts::TradePt {
                    trader: accts.vault.to_account_info(),
                    market: accts.from_market.to_account_info(),
                    token_sy_trader: accts.vault_sy_ata.to_account_info(),
                    token_pt_trader: accts.from_vault_pt_ata.to_account_info(),
                    token_sy_escrow: accts.from_market_escrow_sy.to_account_info(),
                    token_pt_escrow: accts.from_market_escrow_pt.to_account_info(),
                    address_lookup_table: accts.from_market_alt.to_account_info(),
                    token_program: accts.token_program.to_account_info(),
                    sy_program: accts.sy_program.to_account_info(),
                    token_fee_treasury_sy: accts.from_token_fee_treasury_sy.to_account_info(),
                    mint_sy: accts.sy_mint.to_account_info(),
                    event_authority: accts.core_event_authority.to_account_info(),
                    program: accts.core_program.to_account_info(),
                },
                signer_seeds,
            )
            .with_remaining_accounts(remaining_accounts.to_vec()),
            -(pt_to_sell as i64),
            i64::MIN, // bound enforced via base_escrow delta post-CPI
        )?;
        Ok(())
    }

    #[inline(never)]
    pub(super) fn do_redeem_sy<'info>(
        accts: &CrankRollDelegated<'info>,
        signer_seeds: &[&[&[u8]]],
        sy_to_redeem: u64,
    ) -> Result<()> {
        generic_exchange_rate_sy::cpi::redeem_sy(
            CpiContext::new_with_signer(
                accts.sy_program.to_account_info(),
                generic_exchange_rate_sy::cpi::accounts::RedeemSy {
                    owner: accts.vault.to_account_info(),
                    sy_market: accts.sy_market.to_account_info(),
                    base_mint: accts.base_mint.to_account_info(),
                    sy_mint: accts.sy_mint.to_account_info(),
                    sy_src: accts.vault_sy_ata.to_account_info(),
                    base_vault: accts.adapter_base_vault.to_account_info(),
                    base_dst: accts.base_escrow.to_account_info(),
                    token_program: accts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            sy_to_redeem,
        )?;
        Ok(())
    }

    #[inline(never)]
    pub(super) fn do_mint_sy<'info>(
        accts: &CrankRollDelegated<'info>,
        signer_seeds: &[&[&[u8]]],
        base_in: u64,
    ) -> Result<()> {
        generic_exchange_rate_sy::cpi::mint_sy(
            CpiContext::new_with_signer(
                accts.sy_program.to_account_info(),
                generic_exchange_rate_sy::cpi::accounts::MintSy {
                    owner: accts.vault.to_account_info(),
                    sy_market: accts.sy_market.to_account_info(),
                    base_mint: accts.base_mint.to_account_info(),
                    sy_mint: accts.sy_mint.to_account_info(),
                    base_src: accts.base_escrow.to_account_info(),
                    base_vault: accts.adapter_base_vault.to_account_info(),
                    sy_dst: accts.vault_sy_ata.to_account_info(),
                    token_program: accts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            base_in,
        )?;
        Ok(())
    }

    #[inline(never)]
    pub(super) fn do_deposit_liquidity<'info>(
        accts: &CrankRollDelegated<'info>,
        signer_seeds: &[&[&[u8]]],
        remaining_accounts: &[AccountInfo<'info>],
        sy_for_deposit: u64,
    ) -> Result<()> {
        clearstone_core::cpi::market_two_deposit_liquidity(
            CpiContext::new_with_signer(
                accts.core_program.to_account_info(),
                clearstone_core::cpi::accounts::DepositLiquidity {
                    depositor: accts.vault.to_account_info(),
                    market: accts.to_market.to_account_info(),
                    token_pt_src: accts.to_vault_pt_ata.to_account_info(),
                    token_sy_src: accts.vault_sy_ata.to_account_info(),
                    token_pt_escrow: accts.to_market_escrow_pt.to_account_info(),
                    token_sy_escrow: accts.to_market_escrow_sy.to_account_info(),
                    token_lp_dst: accts.to_vault_lp_ata.to_account_info(),
                    mint_lp: accts.to_mint_lp.to_account_info(),
                    mint_sy: accts.sy_mint.to_account_info(),
                    address_lookup_table: accts.to_market_alt.to_account_info(),
                    token_program: accts.token_program.to_account_info(),
                    sy_program: accts.sy_program.to_account_info(),
                    event_authority: accts.core_event_authority.to_account_info(),
                    program: accts.core_program.to_account_info(),
                },
                signer_seeds,
            )
            .with_remaining_accounts(remaining_accounts.to_vec()),
            0,               // pt_intent — park base as SY-sided liquidity (v1.1 tunes this)
            sy_for_deposit,  // sy_intent
            0,               // min_lp_out — curator refreshes via mark_to_market
        )?;
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
pub struct MarkedToMarket {
    pub vault: Pubkey,
    pub market: Pubkey,
    pub allocation_index: u16,
    pub deployed_base: u64,
    pub total_assets: u64,
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
        // Owner = the vault PDA so the vault can sign `transfer` from
        // base_escrow in both the user-withdraw path AND the
        // reallocate_to_market adapter CPI (mint_sy requires
        // `base_src.owner == owner`). Using `= base_escrow` here
        // self-authors the escrow and breaks the reallocate path.
        token::authority = vault,
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
pub struct MarkToMarket<'info> {
    #[account(
        mut,
        has_one = base_escrow,
    )]
    pub vault: Box<Account<'info, CuratorVault>>,

    #[account(address = vault.base_escrow)]
    pub base_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    pub market: Box<Account<'info, MarketTwo>>,

    /// Core vault backing this market — source of the SY exchange rate
    /// and PT redemption rate used in the mark.
    #[account(address = market.vault)]
    pub core_vault: Box<Account<'info, CoreVault>>,

    #[account(address = market.token_pt_escrow)]
    pub market_escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = market.token_sy_escrow)]
    pub market_escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = market.mint_lp)]
    pub mint_lp: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: PT mint for this market.
    #[account(address = market.mint_pt)]
    pub mint_pt: UncheckedAccount<'info>,

    #[account(associated_token::mint = mint_pt, associated_token::authority = vault)]
    pub vault_pt_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SY mint for this market — used to derive the vault's SY ATA.
    #[account(address = market.mint_sy)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(associated_token::mint = sy_mint, associated_token::authority = vault)]
    pub vault_sy_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(associated_token::mint = mint_lp, associated_token::authority = vault)]
    pub vault_lp_ata: Box<InterfaceAccount<'info, TokenAccount>>,
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

// ---------------------------------------------------------------------------
// Roll-delegation account contexts.
// Kept in this file so Anchor's `#[program]` macro can resolve the
// generated `__client_accounts_*` modules. The handler bodies + state
// struct live in roll_delegation.rs.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CreateDelegation<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// The vault this delegation authorizes rolls for. Read-only — the
    /// handler just reads `allocations` for the commitment.
    #[account(
        seeds = [CURATOR_VAULT_SEED, vault.curator.as_ref(), vault.base_mint.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CuratorVault>>,

    #[account(
        init_if_needed,
        payer = user,
        space = RollDelegation::SIZE,
        seeds = [ROLL_DELEGATION_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub delegation: Box<Account<'info, RollDelegation>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseDelegation<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        close = user,
        has_one = user @ RollDelegationError::VaultMismatch,
        seeds = [ROLL_DELEGATION_SEED, delegation.vault.as_ref(), user.key().as_ref()],
        bump = delegation.bump,
    )]
    pub delegation: Box<Account<'info, RollDelegation>>,
}

/// Account set for `crank_roll_delegated`.
///
/// Merged super-set of `ReallocateFromMarket` + `ReallocateToMarket`
/// with the curator signer swapped for a permissionless `keeper`. All
/// authority validation happens via the `delegation` account — see
/// CURATOR_ROLL_DELEGATION.md §3.5.
#[derive(Accounts)]
pub struct CrankRollDelegated<'info> {
    /// Pays gas. Zero privilege; the handler never reads `keeper.key()`
    /// for authorization.
    #[account(mut)]
    pub keeper: Signer<'info>,

    /// User-signed delegation authorizing this roll. Constraint binds
    /// it to the vault; handler re-checks hash + expiry + slippage.
    #[account(
        seeds = [ROLL_DELEGATION_SEED, vault.key().as_ref(), delegation.user.as_ref()],
        bump = delegation.bump,
        constraint = delegation.vault == vault.key() @ RollDelegationError::VaultMismatch,
    )]
    pub delegation: Box<Account<'info, RollDelegation>>,

    // ---- Shared vault + base ----
    //
    // NOTE on typed vs unchecked: every field below that needs
    // `.amount` (balance reads) or `.financials` (maturity) stays
    // typed. Every CPI-passthrough is UncheckedAccount with address
    // constraints — dropping the Anchor-level deserialization is what
    // keeps `try_accounts` below the 4 KB SBF frame cap (see
    // FOLLOWUPS :: CURATOR_CRANK_STACK_OVERFLOW).
    #[account(mut, has_one = base_mint, has_one = base_escrow)]
    pub vault: Box<Account<'info, CuratorVault>>,

    /// CHECK: address-constrained to vault.base_mint (via has_one above).
    pub base_mint: UncheckedAccount<'info>,

    /// base_escrow: typed because the handler reloads + reads .amount
    /// to compute the min_base_out post-check.
    #[account(mut)]
    pub base_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    // ---- Adapter (shared across both legs) ----
    /// CHECK: validated by adapter CPIs.
    pub sy_market: UncheckedAccount<'info>,
    /// CHECK: mint used only as CPI account; adapter validates.
    #[account(mut)]
    pub sy_mint: UncheckedAccount<'info>,
    /// CHECK: adapter-owned base pool; CPI-only.
    #[account(mut)]
    pub adapter_base_vault: UncheckedAccount<'info>,

    /// vault_sy_ata: typed because we reload + read .amount between
    /// redeem/mint CPIs.
    #[account(mut)]
    pub vault_sy_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // ---- FROM market (matured) ----
    /// from_market: typed because handler reads `.financials.expiration_ts`
    /// for the maturity gate (I-D5).
    #[account(mut)]
    pub from_market: Box<Account<'info, MarketTwo>>,
    /// CHECK: address-constrained to the market's escrow.
    #[account(mut, address = from_market.token_pt_escrow)]
    pub from_market_escrow_pt: UncheckedAccount<'info>,
    /// CHECK: address-constrained.
    #[account(mut, address = from_market.token_sy_escrow)]
    pub from_market_escrow_sy: UncheckedAccount<'info>,
    /// CHECK: address-constrained.
    #[account(mut, address = from_market.token_fee_treasury_sy)]
    pub from_token_fee_treasury_sy: UncheckedAccount<'info>,
    /// CHECK: address-constrained.
    #[account(address = from_market.address_lookup_table)]
    pub from_market_alt: UncheckedAccount<'info>,
    /// CHECK: PT mint for from_market.
    #[account(address = from_market.mint_pt)]
    pub from_mint_pt: UncheckedAccount<'info>,
    /// CHECK: LP mint for from_market.
    #[account(mut, address = from_market.mint_lp)]
    pub from_mint_lp: UncheckedAccount<'info>,

    /// from_vault_pt_ata: typed; handler reloads + reads .amount after
    /// `withdraw_liquidity` to size the subsequent trade_pt sell.
    #[account(
        mut,
        associated_token::mint = from_mint_pt,
        associated_token::authority = vault,
    )]
    pub from_vault_pt_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// from_vault_lp_ata: typed; handler reads .amount to enforce
    /// `DeployedBaseDrift` (vault_lp_ata.amount >= deployed_base).
    #[account(
        mut,
        associated_token::mint = from_mint_lp,
        associated_token::authority = vault,
    )]
    pub from_vault_lp_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // ---- TO market (next) ----
    //
    // to_* accounts are CPI-only: handler never reads any of their
    // fields. All UncheckedAccount. Keeper MUST prepend idempotent
    // ATA-init ixs for to_vault_pt_ata and to_vault_lp_ata before
    // invoking this instruction (previously done via `init_if_needed`,
    // which blew the stack frame).
    /// CHECK: market account; handler validates via allocation index lookup.
    #[account(mut)]
    pub to_market: UncheckedAccount<'info>,
    /// CHECK: CPI-only.
    #[account(mut)]
    pub to_market_escrow_pt: UncheckedAccount<'info>,
    /// CHECK: CPI-only.
    #[account(mut)]
    pub to_market_escrow_sy: UncheckedAccount<'info>,
    /// CHECK: CPI-only.
    #[account(mut)]
    pub to_token_fee_treasury_sy: UncheckedAccount<'info>,
    /// CHECK: CPI-only.
    pub to_market_alt: UncheckedAccount<'info>,
    /// CHECK: CPI-only.
    pub to_mint_pt: UncheckedAccount<'info>,
    /// CHECK: CPI-only.
    #[account(mut)]
    pub to_mint_lp: UncheckedAccount<'info>,
    /// CHECK: vault-PDA-owned PT ATA for to_market. Caller MUST create
    /// via SPL associated-token-program idempotent init before the crank.
    #[account(mut)]
    pub to_vault_pt_ata: UncheckedAccount<'info>,
    /// CHECK: vault-PDA-owned LP ATA for to_market. Same pre-init
    /// requirement as to_vault_pt_ata.
    #[account(mut)]
    pub to_vault_lp_ata: UncheckedAccount<'info>,

    // ---- Programs + sysvars ----
    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core event authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

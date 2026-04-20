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
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use precise_number::Number;

declare_id!("831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm");

pub const CURATOR_VAULT_SEED: &[u8] = b"curator_vault";
pub const BASE_ESCROW_SEED: &[u8] = b"base_escrow";

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
        v.allocations = vec![];
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
        require_keys_eq!(
            v.curator,
            ctx.accounts.curator.key(),
            CuratorError::Unauthorized
        );

        let total_bps: u32 = allocations.iter().map(|a| a.weight_bps as u32).sum();
        require!(total_bps <= 10_000, CuratorError::WeightsExceedFull);

        v.allocations = allocations;
        Ok(())
    }

    // TODO(rebalance): iterate allocations, compute target base amount per
    // market, CPI into clearstone_core to deposit_liquidity / withdraw_liquidity
    // as needed to hit those targets. Also needs to handle PT held in each
    // market (which the core withdraws as part of withdraw_liquidity).
    // This is the heart of MetaMorpho and requires a full CPI plumbing
    // layer; out of scope for the scaffold.
    pub fn rebalance(_ctx: Context<Rebalance>) -> Result<()> {
        Err(CuratorError::NotYetImplemented.into())
    }
}

// -------------- State --------------

#[account]
pub struct CuratorVault {
    pub curator: Pubkey,
    pub base_mint: Pubkey,
    pub base_escrow: Pubkey,
    /// Accounting totals. These track base tokens held by the curator —
    /// which may be split between `base_escrow` (idle) and the underlying
    /// core markets (deployed). `rebalance` keeps them reconciled.
    pub total_assets: u64,
    pub total_shares: u64,
    /// Performance fee (bps), on realized yield. 2000 bps (20%) max.
    pub fee_bps: u16,
    pub allocations: Vec<Allocation>,
}

impl CuratorVault {
    pub fn space(n_allocations: usize) -> usize {
        8 + 32 * 3 + 8 + 8 + 2 + 4 + n_allocations * Allocation::SIZE
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
pub struct SetAllocations<'info> {
    pub curator: Signer<'info>,

    #[account(
        mut,
        has_one = curator,
        // Realloc upward on large allocation lists. Shrinking is OK — realloc
        // with `realloc::zero = false` leaves tail bytes but Anchor truncates
        // via the explicit size arg.
    )]
    pub vault: Box<Account<'info, CuratorVault>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Rebalance<'info> {
    pub curator: Signer<'info>,

    #[account(mut, has_one = curator)]
    pub vault: Box<Account<'info, CuratorVault>>,
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

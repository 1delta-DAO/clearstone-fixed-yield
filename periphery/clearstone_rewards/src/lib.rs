// Clearstone Rewards — the farm-emissions half of what got cut out of core
// in M4. Users stake LP tokens here, the program accrues emissions of
// arbitrary reward mints pro-rata to staked LP, and the market's curator
// tops up the emission buckets.
//
// Design: single-index accrual à la MasterChef. Each `FarmState` tracks one
// market; each farm emission within is keyed by its reward mint. User
// stakes are `StakePosition` accounts, indexed per (farm_state, owner).
//
// This is a scaffold. The stake/unstake/claim flows compile but have NOT
// been runtime-tested. Known gaps are called out in FOLLOWUPS.md.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
    },
};
use precise_number::Number;

declare_id!("7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g");

pub const FARM_STATE_SEED: &[u8] = b"farm_state";
pub const LP_ESCROW_SEED: &[u8] = b"lp_escrow";
pub const STAKE_POSITION_SEED: &[u8] = b"stake_position";

#[program]
pub mod clearstone_rewards {
    use super::*;

    /// Create a FarmState for a specific market's LP mint. Permissionless —
    /// anyone can spin up a rewards surface for any market. `curator` is
    /// who may later call `add_farm` / `refill_farm`.
    pub fn initialize_farm_state(ctx: Context<InitializeFarmState>) -> Result<()> {
        let f = &mut ctx.accounts.farm_state;
        f.curator = ctx.accounts.curator.key();
        f.market = ctx.accounts.market.key();
        f.lp_mint = ctx.accounts.lp_mint.key();
        f.lp_escrow = ctx.accounts.lp_escrow.key();
        f.total_staked = 0;
        f.farms = vec![];
        f.last_update_ts = Clock::get()?.unix_timestamp as u32;

        emit!(FarmStateInitialized {
            farm_state: f.key(),
            curator: f.curator,
            market: f.market,
            lp_mint: f.lp_mint,
        });
        Ok(())
    }

    /// Curator adds a new emission bucket: (reward_mint, rate per second,
    /// expiry timestamp). Seed tokens must be transferred separately into
    /// the program-owned emission escrow (see refill_farm).
    pub fn add_farm(
        ctx: Context<AddFarm>,
        token_rate: u64,
        expiry_timestamp: u32,
    ) -> Result<()> {
        let f = &mut ctx.accounts.farm_state;
        require_keys_eq!(
            f.curator,
            ctx.accounts.curator.key(),
            RewardsError::Unauthorized
        );

        if f.farms.iter().any(|x| x.reward_mint == ctx.accounts.reward_mint.key()) {
            return Err(RewardsError::FarmAlreadyExists.into());
        }

        f.farms.push(Farm {
            reward_mint: ctx.accounts.reward_mint.key(),
            reward_escrow: ctx.accounts.reward_escrow.key(),
            token_rate,
            expiry_timestamp,
            accrued_index: Number::ZERO,
        });

        emit!(FarmAdded {
            farm_state: f.key(),
            reward_mint: ctx.accounts.reward_mint.key(),
            reward_escrow: ctx.accounts.reward_escrow.key(),
            token_rate,
            expiry_timestamp,
        });
        Ok(())
    }

    /// Transfer LP into the program's escrow and bump the staker's balance.
    /// Before the balance changes, update_indexes brings each farm's
    /// `accrued_index` up to now.
    pub fn stake_lp(ctx: Context<StakeLp>, amount: u64) -> Result<()> {
        require!(amount > 0, RewardsError::ZeroAmount);
        require_position_fits(&ctx.accounts.position, &ctx.accounts.farm_state)?;

        update_indexes(
            &mut ctx.accounts.farm_state,
            Clock::get()?.unix_timestamp as u32,
        );

        // Snapshot user's per-farm index before stake changes.
        settle_user(
            &ctx.accounts.farm_state,
            &mut ctx.accounts.position,
        );

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.lp_src.to_account_info(),
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.lp_escrow.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.lp_mint.decimals,
        )?;

        let f = &mut ctx.accounts.farm_state;
        let pos = &mut ctx.accounts.position;
        f.total_staked = f
            .total_staked
            .checked_add(amount)
            .ok_or(RewardsError::Overflow)?;
        pos.staked_amount = pos
            .staked_amount
            .checked_add(amount)
            .ok_or(RewardsError::Overflow)?;

        emit!(Staked {
            farm_state: f.key(),
            owner: ctx.accounts.owner.key(),
            amount,
            user_staked: pos.staked_amount,
            total_staked: f.total_staked,
        });
        Ok(())
    }

    /// Reverse of stake_lp. Unstake forces an index update and settle so
    /// the user's claimable buckets are credited before their share drops.
    pub fn unstake_lp(ctx: Context<UnstakeLp>, amount: u64) -> Result<()> {
        require!(amount > 0, RewardsError::ZeroAmount);
        require_position_fits(&ctx.accounts.position, &ctx.accounts.farm_state)?;

        update_indexes(
            &mut ctx.accounts.farm_state,
            Clock::get()?.unix_timestamp as u32,
        );
        settle_user(&ctx.accounts.farm_state, &mut ctx.accounts.position);

        let f = &mut ctx.accounts.farm_state;
        let pos = &mut ctx.accounts.position;

        pos.staked_amount = pos
            .staked_amount
            .checked_sub(amount)
            .ok_or(RewardsError::InsufficientStake)?;
        f.total_staked = f.total_staked.saturating_sub(amount);

        let market_key = f.market;
        let bump = [ctx.bumps.lp_escrow];
        let seeds: &[&[&[u8]]] = &[&[LP_ESCROW_SEED, market_key.as_ref(), &bump]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.lp_escrow.to_account_info(),
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.lp_dst.to_account_info(),
                    authority: ctx.accounts.lp_escrow.to_account_info(),
                },
                seeds,
            ),
            amount,
            ctx.accounts.lp_mint.decimals,
        )?;

        emit!(Unstaked {
            farm_state: f.key(),
            owner: ctx.accounts.owner.key(),
            amount,
            user_staked: pos.staked_amount,
            total_staked: f.total_staked,
        });
        Ok(())
    }

    /// Move accrued rewards for the given reward mint from the
    /// farm_state-owned ATA to the user's destination account.
    ///
    /// Semantics:
    /// - Runs update_indexes + settle_user so all buckets are current.
    /// - Finds the matching farm entry by mint.
    /// - Pays out `per_farm.claimable` for that farm.
    /// - Zeros the claimable slot.
    ///
    /// Reward escrow authority is `farm_state` (set at add_farm via an
    /// ATA constraint) so the transfer is program-signed with farm_state
    /// seeds. If the escrow is short (i.e., nobody refilled), the
    /// transfer fails; accrual state remains untouched because the
    /// mutation happens before the transfer.
    pub fn claim_farm_emission(ctx: Context<ClaimFarmEmission>) -> Result<()> {
        require_position_fits(&ctx.accounts.position, &ctx.accounts.farm_state)?;
        update_indexes(
            &mut ctx.accounts.farm_state,
            Clock::get()?.unix_timestamp as u32,
        );
        settle_user(&ctx.accounts.farm_state, &mut ctx.accounts.position);

        let f = &ctx.accounts.farm_state;
        let farm_index = f
            .farms
            .iter()
            .position(|farm| farm.reward_mint == ctx.accounts.reward_mint.key())
            .ok_or(RewardsError::FarmNotFound)?;

        let pos = &mut ctx.accounts.position;
        let claimable = pos
            .per_farm
            .get(farm_index)
            .map(|t| t.claimable)
            .unwrap_or(0);
        require!(claimable > 0, RewardsError::ZeroAmount);

        // Zero the bucket before the transfer to prevent double-claim
        // via a reentrant CPI.
        pos.per_farm[farm_index].claimable = 0;

        let market_key = f.market;
        let bump = [ctx.bumps.farm_state];
        let seeds: &[&[&[u8]]] = &[&[FARM_STATE_SEED, market_key.as_ref(), &bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reward_escrow.to_account_info(),
                    mint: ctx.accounts.reward_mint.to_account_info(),
                    to: ctx.accounts.reward_dst.to_account_info(),
                    authority: ctx.accounts.farm_state.to_account_info(),
                },
                seeds,
            ),
            claimable,
            ctx.accounts.reward_mint.decimals,
        )?;

        emit!(EmissionClaimed {
            farm_state: ctx.accounts.farm_state.key(),
            owner: ctx.accounts.owner.key(),
            reward_mint: ctx.accounts.reward_mint.key(),
            amount: claimable,
        });
        Ok(())
    }

    /// Curator tops up the reward escrow for an existing farm. Pure SPL
    /// transfer from the curator's token account to the farm_state-owned
    /// ATA; no accrual state is touched.
    ///
    /// We intentionally don't bump `token_rate` here — rate changes are a
    /// separate concern. refill_farm only adds liquidity for claims; if
    /// the curator wants to extend/shorten the stream they'd need a
    /// dedicated `set_farm_rate` ix (not in scope).
    pub fn refill_farm(ctx: Context<RefillFarm>, amount: u64) -> Result<()> {
        require!(amount > 0, RewardsError::ZeroAmount);
        require!(
            ctx.accounts
                .farm_state
                .farms
                .iter()
                .any(|f| f.reward_mint == ctx.accounts.reward_mint.key()),
            RewardsError::FarmNotFound
        );

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reward_src.to_account_info(),
                    mint: ctx.accounts.reward_mint.to_account_info(),
                    to: ctx.accounts.reward_escrow.to_account_info(),
                    authority: ctx.accounts.curator.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.reward_mint.decimals,
        )?;

        emit!(FarmRefilled {
            farm_state: ctx.accounts.farm_state.key(),
            reward_mint: ctx.accounts.reward_mint.key(),
            amount,
        });
        Ok(())
    }

    /// Grow a stake position to fit the current farm count.
    ///
    /// Stake positions are sized at first-stake for whatever `farms.len()`
    /// is at that moment. When the curator adds new farms afterwards the
    /// position is too small to hold the extra per-farm trackers, and
    /// stake_lp / unstake_lp / claim_farm_emission would panic on
    /// serialization. This ix lets the owner re-size first; the handler
    /// body is empty because Anchor's `realloc` attribute does the work
    /// (and tops up rent from `owner`).
    /// Curator-only: remove a fully-expired farm entry.
    ///
    /// Only callable when `now >= expiry_timestamp` — prevents the
    /// curator from yanking a live emission stream out from under
    /// stakers. Any leftover tokens in the reward_escrow ATA are
    /// swept back to `reward_drain` (curator's destination) before
    /// the Farm slot is removed from the vec. Shrinks `FarmState` by
    /// one `Farm` entry — Anchor realloc keeps the account size tight.
    ///
    /// Stakers whose `per_farm` vec is longer than the new farm count
    /// keep their trailing claimable buckets untouched but they're now
    /// orphaned (no Farm to resolve). The existing `realloc_stake_position`
    /// ix doesn't shrink; that's a deliberate choice — don't wipe
    /// user-visible data in a curator-triggered flow.
    pub fn decommission_farm(ctx: Context<DecommissionFarm>) -> Result<()> {
        update_indexes(
            &mut ctx.accounts.farm_state,
            Clock::get()?.unix_timestamp as u32,
        );

        let now = Clock::get()?.unix_timestamp as u32;

        let f = &mut ctx.accounts.farm_state;
        let farm_idx = f
            .farms
            .iter()
            .position(|fr| fr.reward_mint == ctx.accounts.reward_mint.key())
            .ok_or(RewardsError::FarmNotFound)?;

        require!(
            now >= f.farms[farm_idx].expiry_timestamp,
            RewardsError::FarmStillLive
        );

        // Sweep any remaining escrow to the curator's drain account.
        let escrow_balance = ctx.accounts.reward_escrow.amount;
        if escrow_balance > 0 {
            let state_key = f.key();
            let market_key = f.market;
            let bump = [ctx.bumps.farm_state];
            let _ = state_key;
            let seeds: &[&[&[u8]]] = &[&[FARM_STATE_SEED, market_key.as_ref(), &bump]];
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.reward_escrow.to_account_info(),
                        mint: ctx.accounts.reward_mint.to_account_info(),
                        to: ctx.accounts.reward_drain.to_account_info(),
                        authority: ctx.accounts.farm_state.to_account_info(),
                    },
                    seeds,
                ),
                escrow_balance,
                ctx.accounts.reward_mint.decimals,
            )?;
        }

        let removed_mint = ctx.accounts.reward_mint.key();
        ctx.accounts.farm_state.farms.remove(farm_idx);

        emit!(FarmDecommissioned {
            farm_state: ctx.accounts.farm_state.key(),
            reward_mint: removed_mint,
            swept_amount: escrow_balance,
        });
        Ok(())
    }

    pub fn realloc_stake_position(ctx: Context<ReallocStakePosition>) -> Result<()> {
        emit!(StakePositionReallocated {
            farm_state: ctx.accounts.farm_state.key(),
            owner: ctx.accounts.owner.key(),
            n_farms: ctx.accounts.farm_state.farms.len() as u16,
        });
        Ok(())
    }
}

// -------------- Helpers --------------

/// Gate every accrual-touching ix on the position being large enough
/// for `farm_state.farms.len()` trackers. Prevents serialize panics
/// from settle_user's push path when the position is stale, and points
/// the user at `realloc_stake_position`.
fn require_position_fits(
    position: &Account<StakePosition>,
    farm_state: &Account<FarmState>,
) -> Result<()> {
    let required = StakePosition::space(farm_state.farms.len());
    require!(
        position.to_account_info().data_len() >= required,
        RewardsError::StalePosition
    );
    Ok(())
}

// -------------- Accrual math --------------

/// Advance each farm's `accrued_index` forward to `now`.
/// Index units: reward tokens per 1 staked LP (scaled via precise_number).
fn update_indexes(f: &mut FarmState, now: u32) {
    if f.total_staked == 0 {
        f.last_update_ts = now;
        return;
    }

    for farm in f.farms.iter_mut() {
        let active_end = farm.expiry_timestamp.min(now);
        if f.last_update_ts >= active_end {
            continue;
        }
        let dt = (active_end - f.last_update_ts) as u64;
        let tokens_emitted = (farm.token_rate as u128) * (dt as u128);
        let delta = Number::from_ratio(tokens_emitted, f.total_staked as u128);
        farm.accrued_index += delta;
    }

    f.last_update_ts = now;
}

/// Credit the user's claimable buckets for emissions accrued since their
/// last touch. Assumes update_indexes was called first in this tx.
fn settle_user(f: &FarmState, pos: &mut StakePosition) {
    // Ensure the position has one tracker per current farm. Positions
    // carry their own vec because farms can be added after a stake lands.
    while pos.per_farm.len() < f.farms.len() {
        pos.per_farm.push(PerFarmTracker {
            last_seen_index: Number::ZERO,
            claimable: 0,
        });
    }

    let staked = pos.staked_amount;
    for (i, farm) in f.farms.iter().enumerate() {
        let tracker = &mut pos.per_farm[i];
        let delta_index = farm.accrued_index.checked_sub(&tracker.last_seen_index);
        if let Some(delta) = delta_index {
            let earned = delta * Number::from_natural_u64(staked);
            tracker.claimable = tracker.claimable.saturating_add(earned.floor_u64());
        }
        tracker.last_seen_index = farm.accrued_index;
    }
}

// -------------- State --------------

#[account]
pub struct FarmState {
    pub curator: Pubkey,
    pub market: Pubkey,
    pub lp_mint: Pubkey,
    pub lp_escrow: Pubkey,
    pub total_staked: u64,
    pub last_update_ts: u32,
    pub farms: Vec<Farm>,
}

impl FarmState {
    pub fn space(n_farms: usize) -> usize {
        8                                 // discriminator
        + 32 * 4                          // 4 pubkeys
        + 8                               // total_staked
        + 4                               // last_update_ts
        + 4                               // vec len
        + n_farms * Farm::SIZE
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Farm {
    pub reward_mint: Pubkey,
    pub reward_escrow: Pubkey,
    pub token_rate: u64,
    pub expiry_timestamp: u32,
    pub accrued_index: Number,
}

impl Farm {
    pub const SIZE: usize = 32 + 32 + 8 + 4 + Number::SIZEOF;
}

#[account]
pub struct StakePosition {
    pub farm_state: Pubkey,
    pub owner: Pubkey,
    pub staked_amount: u64,
    pub per_farm: Vec<PerFarmTracker>,
}

impl StakePosition {
    pub fn space(n_farms: usize) -> usize {
        8 + 32 + 32 + 8 + 4 + n_farms * PerFarmTracker::SIZE
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct PerFarmTracker {
    pub last_seen_index: Number,
    pub claimable: u64,
}

impl PerFarmTracker {
    pub const SIZE: usize = Number::SIZEOF + 8;
}

// -------------- Events --------------

#[event]
pub struct FarmStateInitialized {
    pub farm_state: Pubkey,
    pub curator: Pubkey,
    pub market: Pubkey,
    pub lp_mint: Pubkey,
}

#[event]
pub struct FarmAdded {
    pub farm_state: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_escrow: Pubkey,
    pub token_rate: u64,
    pub expiry_timestamp: u32,
}

#[event]
pub struct Staked {
    pub farm_state: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub user_staked: u64,
    pub total_staked: u64,
}

#[event]
pub struct Unstaked {
    pub farm_state: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub user_staked: u64,
    pub total_staked: u64,
}

#[event]
pub struct EmissionClaimed {
    pub farm_state: Pubkey,
    pub owner: Pubkey,
    pub reward_mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FarmRefilled {
    pub farm_state: Pubkey,
    pub reward_mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct StakePositionReallocated {
    pub farm_state: Pubkey,
    pub owner: Pubkey,
    pub n_farms: u16,
}

#[event]
pub struct FarmDecommissioned {
    pub farm_state: Pubkey,
    pub reward_mint: Pubkey,
    pub swept_amount: u64,
}

// -------------- Accounts --------------

#[derive(Accounts)]
pub struct InitializeFarmState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: stored as the curator key; not a signer here.
    pub curator: UncheckedAccount<'info>,

    /// CHECK: opaque to the rewards program — only stored for bookkeeping
    /// so the market<->farm mapping is queryable on-chain.
    pub market: UncheckedAccount<'info>,

    pub lp_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        seeds = [FARM_STATE_SEED, market.key().as_ref()],
        bump,
        space = FarmState::space(0),
    )]
    pub farm_state: Box<Account<'info, FarmState>>,

    #[account(
        init,
        payer = payer,
        seeds = [LP_ESCROW_SEED, market.key().as_ref()],
        bump,
        token::mint = lp_mint,
        token::authority = lp_escrow,
    )]
    pub lp_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddFarm<'info> {
    #[account(mut)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        has_one = curator,
        realloc = FarmState::space(farm_state.farms.len() + 1),
        realloc::payer = curator,
        realloc::zero = false,
    )]
    pub farm_state: Box<Account<'info, FarmState>>,

    pub reward_mint: InterfaceAccount<'info, Mint>,

    /// Reward escrow — ATA owned by farm_state PDA for this reward mint.
    /// Init_if_needed so curators can rewire a previously-existing ATA.
    /// The claim ixn signs transfers out of this with the farm_state seed.
    #[account(
        init_if_needed,
        payer = curator,
        associated_token::mint = reward_mint,
        associated_token::authority = farm_state,
        associated_token::token_program = token_program,
    )]
    pub reward_escrow: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeLp<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub farm_state: Box<Account<'info, FarmState>>,

    #[account(mut)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = lp_mint, token::authority = owner)]
    pub lp_src: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [LP_ESCROW_SEED, farm_state.market.as_ref()],
        bump,
    )]
    pub lp_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = owner,
        seeds = [STAKE_POSITION_SEED, farm_state.key().as_ref(), owner.key().as_ref()],
        bump,
        space = StakePosition::space(farm_state.farms.len()),
    )]
    pub position: Box<Account<'info, StakePosition>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UnstakeLp<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub farm_state: Box<Account<'info, FarmState>>,

    #[account(mut)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = lp_mint)]
    pub lp_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [LP_ESCROW_SEED, farm_state.market.as_ref()],
        bump,
    )]
    pub lp_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [STAKE_POSITION_SEED, farm_state.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
    )]
    pub position: Box<Account<'info, StakePosition>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimFarmEmission<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [FARM_STATE_SEED, farm_state.market.as_ref()],
        bump,
    )]
    pub farm_state: Box<Account<'info, FarmState>>,

    #[account(
        mut,
        seeds = [STAKE_POSITION_SEED, farm_state.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
    )]
    pub position: Box<Account<'info, StakePosition>>,

    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Must be the ATA of farm_state for reward_mint — the same account
    /// that `add_farm` wrote into the matching `Farm` entry.
    #[account(
        mut,
        associated_token::mint = reward_mint,
        associated_token::authority = farm_state,
        associated_token::token_program = token_program,
    )]
    pub reward_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = reward_mint)]
    pub reward_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RefillFarm<'info> {
    pub curator: Signer<'info>,

    #[account(has_one = curator)]
    pub farm_state: Box<Account<'info, FarmState>>,

    pub reward_mint: InterfaceAccount<'info, Mint>,

    /// Curator's source of reward tokens.
    #[account(mut, token::mint = reward_mint, token::authority = curator)]
    pub reward_src: InterfaceAccount<'info, TokenAccount>,

    /// Farm-state-owned ATA for this reward mint. Must be the one
    /// wired up in `add_farm` (same ATA constraint).
    #[account(
        mut,
        associated_token::mint = reward_mint,
        associated_token::authority = farm_state,
        associated_token::token_program = token_program,
    )]
    pub reward_escrow: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct DecommissionFarm<'info> {
    #[account(mut)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        has_one = curator,
        seeds = [FARM_STATE_SEED, farm_state.market.as_ref()],
        bump,
        realloc = FarmState::space(farm_state.farms.len().saturating_sub(1)),
        realloc::payer = curator,
        realloc::zero = false,
    )]
    pub farm_state: Box<Account<'info, FarmState>>,

    pub reward_mint: InterfaceAccount<'info, Mint>,

    /// Farm-state-owned ATA for the reward mint (same as `add_farm`).
    #[account(
        mut,
        associated_token::mint = reward_mint,
        associated_token::authority = farm_state,
        associated_token::token_program = token_program,
    )]
    pub reward_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Destination for any remaining reward tokens in the escrow.
    #[account(mut, token::mint = reward_mint)]
    pub reward_drain: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReallocStakePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub farm_state: Box<Account<'info, FarmState>>,

    #[account(
        mut,
        seeds = [STAKE_POSITION_SEED, farm_state.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
        realloc = StakePosition::space(farm_state.farms.len()),
        realloc::payer = owner,
        realloc::zero = false,
    )]
    pub position: Box<Account<'info, StakePosition>>,

    pub system_program: Program<'info, System>,
}

// -------------- Errors --------------

#[error_code]
pub enum RewardsError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Farm already exists for this reward mint")]
    FarmAlreadyExists,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient stake")]
    InsufficientStake,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Not yet implemented")]
    NotYetImplemented,
    #[msg("Farm not found for the given reward mint")]
    FarmNotFound,
    #[msg("Stake position is too small for current farm count; call realloc_stake_position")]
    StalePosition,
    #[msg("Farm is still live; wait until expiry_timestamp before decommissioning")]
    FarmStillLive,
}

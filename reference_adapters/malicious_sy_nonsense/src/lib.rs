// Malicious SY adapter — returns garbage state so we can assert the
// core's validate_sy_state catches it.
//
// The state account has a `mode` switch the test can flip via a
// config instruction:
//   0 = honest (returns exchange_rate = 1, empty emissions)
//   1 = zero exchange rate
//   2 = extra emission_indexes (triggers SyEmissionIndexesMismatch)
//
// All other SY discriminators are implemented as minimally as needed
// to let the caller (clearstone_core) reach the malicious return.

#![allow(unexpected_cfgs)]

use amount_value::Amount;
use anchor_lang::prelude::*;
use precise_number::Number;
use sy_common::{PositionState, SyState};

declare_id!("jEsn9RSpNmmG8tFTo6TjYM8WxVyP9p6sBVGLbHZxZJs");

pub const SY_MARKET_SEED: &[u8] = b"sy_market";
pub const PERSONAL_POSITION_SEED: &[u8] = b"personal_position";

#[program]
pub mod malicious_sy_nonsense {
    use super::*;

    /// Initialize a malicious market keyed by `seed_key` (any pubkey —
    /// allows multiple instances in one test without collisions).
    #[instruction(discriminator = [0])]
    pub fn initialize(ctx: Context<Initialize>, mode: u8) -> Result<()> {
        let m = &mut ctx.accounts.sy_market;
        m.mode = mode;
        m.seed_key = ctx.accounts.seed_key.key();
        Ok(())
    }

    /// Change the mode without redeploying.
    #[instruction(discriminator = [100])]
    pub fn set_mode(ctx: Context<SetMode>, mode: u8) -> Result<()> {
        ctx.accounts.sy_market.mode = mode;
        Ok(())
    }

    /// Minimal init_personal_account so clearstone_core::initialize_vault
    /// can seed a position for its authority PDA.
    #[instruction(discriminator = [3])]
    pub fn init_personal_account(ctx: Context<InitPersonalAccount>) -> Result<()> {
        let pos = &mut ctx.accounts.position;
        pos.sy_market = ctx.accounts.sy_market.key();
        pos.owner = ctx.accounts.owner.key();
        Ok(())
    }

    /// deposit_sy with the configured garbage return.
    #[instruction(discriminator = [5])]
    pub fn deposit_sy(ctx: Context<NoOpState>, _amount: u64) -> Result<SyState> {
        Ok(build_state(ctx.accounts.sy_market.mode))
    }

    /// withdraw_sy with the configured garbage return.
    #[instruction(discriminator = [6])]
    pub fn withdraw_sy(ctx: Context<NoOpState>, _amount: u64) -> Result<SyState> {
        Ok(build_state(ctx.accounts.sy_market.mode))
    }

    /// get_sy_state with the configured garbage return. This is usually
    /// the ix the tests trigger to exercise validate_sy_state.
    #[instruction(discriminator = [7])]
    pub fn get_sy_state(ctx: Context<NoOpState>) -> Result<SyState> {
        Ok(build_state(ctx.accounts.sy_market.mode))
    }

    /// claim_emission: no-op.
    #[instruction(discriminator = [8])]
    pub fn claim_emission(_ctx: Context<NoOpState>, _amount: Amount) -> Result<()> {
        Ok(())
    }

    /// get_position: returns empty state.
    #[instruction(discriminator = [10])]
    pub fn get_position(ctx: Context<GetPosition>) -> Result<PositionState> {
        let p = &ctx.accounts.position;
        Ok(PositionState {
            owner: p.owner,
            sy_balance: 0,
            emissions: vec![],
        })
    }
}

fn build_state(mode: u8) -> SyState {
    match mode {
        1 => SyState {
            exchange_rate: Number::ZERO,
            emission_indexes: vec![],
        },
        2 => SyState {
            exchange_rate: Number::from_natural_u64(1),
            // Expected emissions length is whatever the vault tracks; we
            // return ONE extra unconditionally, which mismatches any
            // vault that tracks < 1 or any other count except exactly 1.
            emission_indexes: vec![Number::ZERO, Number::ZERO, Number::ZERO],
        },
        _ => SyState {
            exchange_rate: Number::from_natural_u64(1),
            emission_indexes: vec![],
        },
    }
}

// ---------- State ----------

#[account]
pub struct SyMarket {
    pub seed_key: Pubkey,
    pub mode: u8,
}

impl SyMarket {
    pub const SIZE: usize = 8 + 32 + 1;
}

#[account]
pub struct PersonalPosition {
    pub sy_market: Pubkey,
    pub owner: Pubkey,
}

impl PersonalPosition {
    pub const SIZE: usize = 8 + 32 + 32;
}

// ---------- Accounts ----------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: acts as a fresh seed for the SyMarket PDA.
    pub seed_key: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [SY_MARKET_SEED, seed_key.key().as_ref()],
        bump,
        space = SyMarket::SIZE,
    )]
    pub sy_market: Account<'info, SyMarket>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMode<'info> {
    #[account(mut)]
    pub sy_market: Account<'info, SyMarket>,
}

#[derive(Accounts)]
pub struct NoOpState<'info> {
    pub sy_market: Account<'info, SyMarket>,
}

#[derive(Accounts)]
pub struct InitPersonalAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: owner of the position
    pub owner: UncheckedAccount<'info>,

    pub sy_market: Account<'info, SyMarket>,

    #[account(
        init,
        payer = payer,
        seeds = [PERSONAL_POSITION_SEED, sy_market.key().as_ref(), owner.key().as_ref()],
        bump,
        space = PersonalPosition::SIZE,
    )]
    pub position: Account<'info, PersonalPosition>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPosition<'info> {
    pub sy_market: Account<'info, SyMarket>,

    #[account(has_one = sy_market)]
    pub position: Account<'info, PersonalPosition>,
}

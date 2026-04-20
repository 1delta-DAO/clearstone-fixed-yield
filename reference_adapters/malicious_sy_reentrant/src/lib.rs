// Malicious SY adapter that CPIs back into clearstone_core during its
// own deposit_sy / withdraw_sy handlers. Used by the M6 runtime
// reentrancy tests to prove the vault's reentrancy_guard actually
// blocks recursive entry at runtime (not just in Rust unit tests).
//
// Attack model:
//   The vault creator is the adversary. They wire up the vault's
//   CpiAccounts.deposit_sy + the Address Lookup Table so that when
//   clearstone_core invokes this adapter, the adapter receives *all*
//   the accounts needed to re-invoke core.strip / core.merge on the
//   same vault — including the vault account, the core program ID,
//   the depositor's signer AccountInfo, etc.
//
// The expected outcome: when the adapter tries to re-invoke core, the
// second call eventually hits `latch(&vault)` inside the SY CPI helper.
// The vault's guard byte is already set by the *outer* call, so
// `latch` fails with ReentrancyLocked and the attack aborts.
//
// Discriminators match clearstone_core/src/utils/sy_cpi.rs + the
// reference adapter:
//   [0]   initialize        (adapter-only: one SyMarket per seed_key)
//   [3]   init_personal_account (vault authority's position PDA)
//   [5]   deposit_sy        (reenters core.strip when mode=1)
//   [6]   withdraw_sy       (reenters core.merge when mode=2)
//   [7]   get_sy_state      (honest)
//   [8]   claim_emission    (no-op)
//   [10]  get_position      (empty)
//   [100] set_mode          (test helper)

#![allow(unexpected_cfgs)]

use amount_value::Amount;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use precise_number::Number;
use sy_common::{PositionState, SyState};

declare_id!("FNh2bhq9exxygNfJTd2ZCmUubB5Tdk51D5od2NLKCsv8");

pub const SY_MARKET_SEED: &[u8] = b"sy_market";
pub const PERSONAL_POSITION_SEED: &[u8] = b"personal_position";

/// Attack modes. The outer core ix determines which hook fires:
///   MODE_BENIGN             — behaves honestly; used to prove guard clears.
///   MODE_REENTER_ON_DEPOSIT — deposit_sy re-invokes core.strip.
///   MODE_REENTER_ON_WITHDRAW — withdraw_sy re-invokes core.merge.
pub const MODE_BENIGN: u8 = 0;
pub const MODE_REENTER_ON_DEPOSIT: u8 = 1;
pub const MODE_REENTER_ON_WITHDRAW: u8 = 2;

// Core instruction discriminators (see clearstone_core/src/lib.rs).
const STRIP_DISC: u8 = 4;
const MERGE_DISC: u8 = 5;

#[program]
pub mod malicious_sy_reentrant {
    use super::*;

    #[instruction(discriminator = [0])]
    pub fn initialize(ctx: Context<Initialize>, mode: u8) -> Result<()> {
        let m = &mut ctx.accounts.sy_market;
        m.seed_key = ctx.accounts.seed_key.key();
        m.mode = mode;
        Ok(())
    }

    #[instruction(discriminator = [100])]
    pub fn set_mode(ctx: Context<SetMode>, mode: u8) -> Result<()> {
        ctx.accounts.sy_market.mode = mode;
        Ok(())
    }

    #[instruction(discriminator = [3])]
    pub fn init_personal_account(ctx: Context<InitPersonalAccount>) -> Result<()> {
        let pos = &mut ctx.accounts.position;
        pos.sy_market = ctx.accounts.sy_market.key();
        pos.owner = ctx.accounts.owner.key();
        Ok(())
    }

    /// If mode = MODE_REENTER_ON_DEPOSIT, re-invoke clearstone_core.strip
    /// with the accounts the attacker wired through CpiAccounts.deposit_sy.
    /// The second call's `do_deposit_sy` will call `latch(&vault)`, which
    /// errors because the outer call already set the guard byte.
    #[instruction(discriminator = [5])]
    pub fn deposit_sy<'info>(
        ctx: Context<'_, '_, '_, 'info, ReentrantSy<'info>>,
        amount: u64,
    ) -> Result<SyState> {
        if ctx.accounts.sy_market.mode == MODE_REENTER_ON_DEPOSIT {
            reinvoke_u64(ctx.remaining_accounts, STRIP_DISC, amount)?;
        }
        Ok(honest_state())
    }

    /// If mode = MODE_REENTER_ON_WITHDRAW, re-invoke clearstone_core.merge.
    #[instruction(discriminator = [6])]
    pub fn withdraw_sy<'info>(
        ctx: Context<'_, '_, '_, 'info, ReentrantSy<'info>>,
        amount: u64,
    ) -> Result<SyState> {
        if ctx.accounts.sy_market.mode == MODE_REENTER_ON_WITHDRAW {
            reinvoke_u64(ctx.remaining_accounts, MERGE_DISC, amount)?;
        }
        Ok(honest_state())
    }

    #[instruction(discriminator = [7])]
    pub fn get_sy_state(_ctx: Context<NoOpSyMarket>) -> Result<SyState> {
        Ok(honest_state())
    }

    #[instruction(discriminator = [8])]
    pub fn claim_emission(_ctx: Context<NoOpSyMarket>, _amount: Amount) -> Result<()> {
        Ok(())
    }

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

fn honest_state() -> SyState {
    SyState {
        exchange_rate: Number::from_natural_u64(1),
        emission_indexes: vec![],
    }
}

/// Rebuild an instruction from `accounts[0]` (= target program) and
/// `accounts[1..]` (= target's account list, in invocation order), then
/// invoke it. Discriminator + one u64 argument matches both core.strip
/// and core.merge.
///
/// Account flags (is_signer / is_writable) are copied from the AccountInfos
/// the caller received — this preserves the outer transaction's signer
/// status through the re-invocation.
fn reinvoke_u64(accounts: &[AccountInfo], disc: u8, amount: u64) -> Result<()> {
    require!(accounts.len() >= 2, ReentrantError::NotEnoughAccounts);
    let target_program = &accounts[0];
    let target_accounts = &accounts[1..];

    let mut data: Vec<u8> = vec![disc];
    data.extend_from_slice(&amount.to_le_bytes());

    let metas: Vec<AccountMeta> = target_accounts
        .iter()
        .map(|a| AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer,
            is_writable: a.is_writable,
        })
        .collect();

    invoke(
        &Instruction {
            program_id: *target_program.key,
            accounts: metas,
            data,
        },
        target_accounts,
    )?;

    Ok(())
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

// ---------- Errors ----------

#[error_code]
pub enum ReentrantError {
    #[msg("remaining_accounts must contain [target_program, ...target_accounts]")]
    NotEnoughAccounts,
}

// ---------- Accounts ----------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: fresh seed, only stored.
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
pub struct InitPersonalAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: only stored.
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

/// deposit_sy / withdraw_sy share this shape: a single typed SyMarket slot
/// (required so we can read `mode`), with everything the attacker needs
/// for the re-invocation passed through `remaining_accounts`.
#[derive(Accounts)]
pub struct ReentrantSy<'info> {
    pub sy_market: Account<'info, SyMarket>,
}

#[derive(Accounts)]
pub struct NoOpSyMarket<'info> {
    pub sy_market: Account<'info, SyMarket>,
}

#[derive(Accounts)]
pub struct GetPosition<'info> {
    pub sy_market: Account<'info, SyMarket>,

    #[account(has_one = sy_market)]
    pub position: Account<'info, PersonalPosition>,
}

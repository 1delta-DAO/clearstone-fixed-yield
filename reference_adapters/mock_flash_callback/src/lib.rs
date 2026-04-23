// Mock callback for clearstone_core.flash_swap_pt — TEST ONLY.
//
// Mode byte (first byte of `data`) selects behavior:
//   0 = NoOp        — don't repay anything (core must revert with FlashRepayInsufficient)
//   1 = Ok          — transfer `sy_required` SY from solver's src ATA to market escrow
//   2 = ShortRepay  — transfer `sy_required - 1` (triggers FlashRepayInsufficient)
//   3 = TryNestedFlash — CPI core.flash_swap_pt recursively (triggers NestedFlashBlocked)
//
// For mode 1/2/3 the test harness pre-funds the solver's src ATA so the
// transfer has something to pull. Mode 3 additionally needs valid flash-ix
// account passthrough to test the NestedFlashBlocked guard end-to-end.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("9AduMJSRv79G5UBrj3WZCK1KzpzmZ4zAKV4Mud4Z4hvF");

pub const MODE_NOOP: u8 = 0;
pub const MODE_OK: u8 = 1;
pub const MODE_SHORT_REPAY: u8 = 2;
pub const MODE_TRY_NESTED_FLASH: u8 = 3;

#[program]
pub mod mock_flash_callback {
    use super::*;

    pub fn on_flash_pt_received(
        ctx: Context<OnFlashPtReceived>,
        _pt_received: u64,
        sy_required: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        require!(!data.is_empty(), MockError::MissingModeByte);
        let mode = data[0];

        match mode {
            MODE_NOOP => Ok(()),
            MODE_OK => repay(&ctx, sy_required),
            MODE_SHORT_REPAY => {
                let short = sy_required
                    .checked_sub(1)
                    .ok_or(MockError::MissingModeByte)?;
                repay(&ctx, short)
            }
            MODE_TRY_NESTED_FLASH => {
                // CPI back into core.flash_swap_pt on the same market. Core's
                // `flash_pt_debt != 0` check must reject this before any
                // balance movement. We don't care what accounts we pass as
                // long as the ix dispatch fires — core will either reject on
                // the nested-flash guard (ideal) or on an earlier account
                // validation (still a revert, which is the test assertion).
                let ix = clearstone_core::cpi::accounts::FlashSwapPt {
                    caller: ctx.accounts.solver.to_account_info(),
                    market: ctx.accounts.market.to_account_info(),
                    caller_pt_dst: ctx.accounts.caller_pt_dst.to_account_info(),
                    token_sy_escrow: ctx.accounts.token_sy_escrow.to_account_info(),
                    token_pt_escrow: ctx.accounts.token_pt_escrow.to_account_info(),
                    token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
                    mint_sy: ctx.accounts.mint_sy.to_account_info(),
                    callback_program: ctx.accounts.self_program.to_account_info(),
                    address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
                    sy_program: ctx.accounts.sy_program.to_account_info(),
                    token_program: ctx.accounts.core_token_program.to_account_info(),
                    event_authority: ctx.accounts.core_event_authority.to_account_info(),
                    program: ctx.accounts.core_program.to_account_info(),
                };
                clearstone_core::cpi::flash_swap_pt(
                    CpiContext::new(ctx.accounts.core_program.to_account_info(), ix),
                    1,
                    vec![MODE_NOOP],
                )
                .map(|_| ())
            }
            _ => err!(MockError::UnknownMode),
        }
    }
}

fn repay<'info>(ctx: &Context<OnFlashPtReceived<'info>>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer_checked(
        CpiContext::new(
            ctx.accounts.core_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.solver_sy_src.to_account_info(),
                mint: ctx.accounts.mint_sy.to_account_info(),
                to: ctx.accounts.token_sy_escrow.to_account_info(),
                authority: ctx.accounts.solver.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint_sy.decimals,
    )
}

#[derive(Accounts)]
pub struct OnFlashPtReceived<'info> {
    // -- Fixed 6-account prefix core injects --
    /// CHECK: market account (readonly here).
    pub market: UncheckedAccount<'info>,

    #[account(mut)]
    pub caller_pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub token_sy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    pub solver: Signer<'info>,

    pub core_token_program: Interface<'info, TokenInterface>,

    // -- Remaining accounts the test harness passes through --
    /// Solver's own SY ATA — pre-funded by the test harness to cover the repay.
    #[account(mut)]
    pub solver_sy_src: Box<InterfaceAccount<'info, TokenAccount>>,

    // Accounts only used by the TryNestedFlash branch. Always present in the
    // harness; unused bytes are harmless for other modes.
    /// CHECK: passed to the nested flash_swap_pt CPI.
    #[account(mut)]
    pub token_pt_escrow: UncheckedAccount<'info>,
    /// CHECK: passed to the nested flash_swap_pt CPI.
    #[account(mut)]
    pub token_fee_treasury_sy: UncheckedAccount<'info>,
    /// CHECK: passed to the nested flash_swap_pt CPI (ALT).
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: passed to the nested flash_swap_pt CPI (SY adapter).
    pub sy_program: UncheckedAccount<'info>,
    /// CHECK: self program id — serves as nested callback_program.
    pub self_program: UncheckedAccount<'info>,
    /// CHECK: core program id for the nested CPI target.
    pub core_program: UncheckedAccount<'info>,
    /// CHECK: core event_authority.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[error_code]
pub enum MockError {
    #[msg("callback_data must start with a mode byte (0..=3)")]
    MissingModeByte,
    #[msg("Mode byte out of range")]
    UnknownMode,
}

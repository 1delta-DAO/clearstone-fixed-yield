// Reference callback program for `clearstone_core.flash_swap_pt`.
//
// Settles a clearstone-fusion order atomically against a PT flash loan:
//
//   core.flash_swap_pt  ──┐  sends `pt_out` PT to solver's PT ATA
//                        │
//                        └─► this.on_flash_pt_received(pt_out, sy_required, data)
//                              │
//                              ├─► CPI clearstone_fusion.fill(order_config, amount)
//                              │     pulls maker.src_ata  → solver.src_ata
//                              │     transfers solver.pt_ata → maker.pt_ata
//                              │
//                              └─► transfer_checked solver.src_ata → market.sy_escrow
//                                    (closes the flash; core verifies the delta)
//
// SCOPE NOTE: this reference handles ONLY the case where the fusion order's
// `src_mint == market.mint_sy`. That's the common shape for "sell SY for PT"
// orders. For `src_mint = underlying-asset` we'd need an additional wrap step
// (governor.wrap → adapter.mint_sy) inserted between fusion.fill and the
// escrow repay — see INTENT_FLASH_PLAN.md §7.1 "Convert pulled src to SY".
// A production callback extends this handler with that branch.
//
// Spec: INTENT_FLASH_PLAN.md §7.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use clearstone_fusion::cpi as fusion_cpi;
use clearstone_fusion::cpi::accounts::Fill as FusionFill;
use clearstone_fusion::program::ClearstoneFusion;
use clearstone_fusion::OrderConfig;

declare_id!("27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP");

#[program]
pub mod clearstone_solver_callback {
    use super::*;

    /// Invoked by `clearstone_core.flash_swap_pt` after it has sent `pt_out` PT
    /// to the solver's PT ATA. Handler must ensure `token_sy_escrow.amount`
    /// grows by at least `sy_required` before returning — core enforces this
    /// on its side via I-F2.
    ///
    /// `data` is a borsh-encoded `CallbackPayload` (see below).
    pub fn on_flash_pt_received(
        ctx: Context<OnFlashPtReceived>,
        pt_received: u64,
        sy_required: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        let payload = CallbackPayload::try_from_slice(&data)
            .map_err(|_| error!(CallbackError::MalformedPayload))?;

        // The reference supports src == mint_sy only. The fusion order
        // pulls maker's SY to solver; we then transfer that SY straight into
        // the market's escrow to close the flash.
        require!(
            ctx.accounts.src_mint.key() == ctx.accounts.mint_sy.key(),
            CallbackError::UnsupportedSrcMint
        );

        // --- Step 1: fusion.fill — atomic pull-and-deliver ---
        //
        // Delivers `pt_received` PT from solver.pt_ata → maker.pt_ata AND
        // pulls fusion_fill_amount of maker.src → solver.src_ata. The
        // Ed25519 verify must be the immediate-preceding ix at the OUTER tx
        // level (fusion reads the instructions sysvar); the caller is
        // responsible for inserting it.
        let cpi_accounts = FusionFill {
            taker: ctx.accounts.caller.to_account_info(),
            maker: ctx.accounts.maker.to_account_info(),
            maker_receiver: ctx.accounts.maker_receiver.to_account_info(),
            src_mint: ctx.accounts.src_mint.to_account_info(),
            dst_mint: ctx.accounts.dst_mint.to_account_info(),
            maker_src_ata: ctx.accounts.maker_src_ata.to_account_info(),
            taker_src_ata: ctx.accounts.taker_src_ata.to_account_info(),
            // Anchor-CPI builds these as Option<AccountInfo>; wrap ours as Some.
            maker_dst_ata: Some(ctx.accounts.maker_dst_ata.to_account_info()),
            taker_dst_ata: Some(ctx.accounts.caller_pt_dst.to_account_info()),
            protocol_dst_acc: ctx
                .accounts
                .protocol_dst_acc
                .as_ref()
                .map(|a| a.to_account_info()),
            integrator_dst_acc: ctx
                .accounts
                .integrator_dst_acc
                .as_ref()
                .map(|a| a.to_account_info()),
            order_state: ctx.accounts.order_state.to_account_info(),
            delegate_authority: ctx.accounts.delegate_authority.to_account_info(),
            src_token_program: ctx.accounts.src_token_program.to_account_info(),
            dst_token_program: ctx.accounts.dst_token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            instructions_sysvar: ctx.accounts.instructions_sysvar.to_account_info(),
        };
        fusion_cpi::fill(
            CpiContext::new(ctx.accounts.fusion_program.to_account_info(), cpi_accounts),
            payload.fusion_order,
            payload.fusion_fill_amount,
            None, // merkle_proof: allowlist policy only for this reference
        )?;

        // Pro-forma assertion: solver received at least what we owe. fusion.fill
        // pulls up to `amount` from maker; in a Dutch-auction partial fill the
        // solver can receive MORE than sy_required, and the surplus is profit.
        ctx.accounts.taker_src_ata.reload()?;
        require!(
            ctx.accounts.taker_src_ata.amount >= sy_required,
            CallbackError::InsufficientPulledSrc
        );

        // --- Step 2: repay the flash by moving SY → market escrow ---
        transfer_checked(
            CpiContext::new(
                ctx.accounts.core_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.taker_src_ata.to_account_info(),
                    mint: ctx.accounts.mint_sy.to_account_info(),
                    to: ctx.accounts.token_sy_escrow.to_account_info(),
                    authority: ctx.accounts.caller.to_account_info(),
                },
            ),
            sy_required,
            ctx.accounts.mint_sy.decimals,
        )?;

        // Silence unused for now; consumed by future extensions (e.g. logging).
        let _ = pt_received;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// Account layout MUST match `core::flash_swap_pt`'s callback invocation:
///   index 0..6 — fixed prefix injected by core.
///   index 6..N — the `remaining_accounts` the solver passed to core;
///                here they surface as named fields via Anchor's positional
///                deserialization (fusion.fill needs 14 of them).
#[derive(Accounts)]
pub struct OnFlashPtReceived<'info> {
    // ---- Fixed prefix from core ----
    /// CHECK: market account — callback doesn't mutate it; core uses it.
    pub market: UncheckedAccount<'info>,

    /// Solver's PT ATA. Core just deposited `pt_received` PT here.
    /// Fusion.fill will move it to maker's PT ATA.
    #[account(mut)]
    pub caller_pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Market's SY escrow. Callback must top it up by `sy_required`.
    #[account(mut)]
    pub token_sy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SY mint — used for `transfer_checked`.
    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    /// Solver signs the outer tx; their signature is propagated here via CPI.
    pub caller: Signer<'info>,

    /// Token program for the SY-escrow repay leg.
    pub core_token_program: Interface<'info, TokenInterface>,

    // ---- fusion.fill passthrough (from solver's remaining_accounts) ----
    pub fusion_program: Program<'info, ClearstoneFusion>,

    /// CHECK: maker pubkey; validated inside fusion.fill against its OrderConfig.
    pub maker: UncheckedAccount<'info>,

    /// CHECK: maker_receiver (wallet receiving dst). Validated by fusion.
    #[account(mut)]
    pub maker_receiver: UncheckedAccount<'info>,

    #[account(mut)]
    pub maker_src_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solver's src ATA. Fusion will credit it by the pulled amount.
    /// This is where we pull our SY repayment from at the end.
    #[account(mut)]
    pub taker_src_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: maker's dst ATA (where PT lands after fusion.fill delivery).
    #[account(mut)]
    pub maker_dst_ata: UncheckedAccount<'info>,

    pub src_mint: Box<InterfaceAccount<'info, Mint>>,
    pub dst_mint: Box<InterfaceAccount<'info, Mint>>,

    pub src_token_program: Interface<'info, TokenInterface>,
    pub dst_token_program: Interface<'info, TokenInterface>,

    /// CHECK: fusion delegate authority PDA.
    pub delegate_authority: UncheckedAccount<'info>,

    /// CHECK: fusion per-order state PDA.
    #[account(mut)]
    pub order_state: UncheckedAccount<'info>,

    /// CHECK: fusion protocol fee recipient (optional).
    #[account(mut)]
    pub protocol_dst_acc: Option<UncheckedAccount<'info>>,

    /// CHECK: fusion integrator fee recipient (optional).
    #[account(mut)]
    pub integrator_dst_acc: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: instructions sysvar — fusion reads this to verify the Ed25519 verify ix.
    pub instructions_sysvar: UncheckedAccount<'info>,
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/// Borsh shape the solver packs into `core.flash_swap_pt`'s `callback_data`.
/// The OrderConfig is the fusion maker's signed order; the callback forwards
/// it verbatim to fusion.fill.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CallbackPayload {
    pub fusion_order: OrderConfig,
    pub fusion_fill_amount: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum CallbackError {
    #[msg("callback_data could not be borsh-decoded as CallbackPayload")]
    MalformedPayload,
    #[msg("Reference callback only supports orders where src_mint == market.mint_sy")]
    UnsupportedSrcMint,
    #[msg("fusion.fill pulled less src than sy_required — order underfills the flash")]
    InsufficientPulledSrc,
}

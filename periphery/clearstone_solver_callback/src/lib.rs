// Reference callback program for `clearstone_core.flash_swap_pt` and
// `clearstone_core.flash_swap_sy`.
//
// Two directions, mirror flows:
//
//   buy-PT (`on_flash_pt_received`):
//     core.flash_swap_pt  ──┐  sends `pt_out` PT to solver's PT ATA
//                          │
//                          └─► CPI clearstone_fusion.fill(order, amount)
//                                pulls maker.SY → solver.SY
//                                delivers solver.PT → maker.PT
//                          ──► transfer_checked solver.SY → market.sy_escrow
//                                (closes the flash; core verifies the delta)
//
//   sell-PT (`on_flash_sy_received`):
//     core.flash_swap_sy  ──┐  sends `sy_out` SY to solver's SY ATA
//                          │
//                          └─► CPI clearstone_fusion.fill(order, amount)
//                                pulls maker.PT → solver.PT
//                                delivers solver.SY → maker.SY
//                          ──► transfer_checked solver.PT → market.pt_escrow
//                                (closes the flash; core verifies the delta)
//
// SCOPE NOTE (buy-PT): handler requires `src_mint == market.mint_sy`. For
// `src_mint = underlying-asset` we'd need an additional wrap step
// (governor.wrap → adapter.mint_sy) inserted between fusion.fill and the
// escrow repay — see INTENT_FLASH_PLAN.md §7.1 "Convert pulled src to SY".
// SCOPE NOTE (sell-PT): symmetric — handler requires `dst_mint == market.mint_sy`.
// A production callback extends both branches with the underlying-asset path.
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

    /// Sell-PT mirror: invoked by `clearstone_core.flash_swap_sy` after it has
    /// sent `sy_received` SY to the solver's SY ATA. Handler must ensure
    /// `token_pt_escrow.amount` grows by at least `pt_required` before
    /// returning — core enforces this via I-F2 on the PT side.
    ///
    /// `data` is the same `CallbackPayload` shape as the buy-side; the
    /// fusion order this time has `src_mint = mint_pt`, `dst_mint = mint_sy`.
    pub fn on_flash_sy_received(
        ctx: Context<OnFlashSyReceived>,
        sy_received: u64,
        pt_required: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        let payload = CallbackPayload::try_from_slice(&data)
            .map_err(|_| error!(CallbackError::MalformedPayload))?;

        // The reference supports dst == mint_sy only. The fusion order
        // delivers SY to maker (paid from solver's flash-borrowed pool); we
        // then transfer the maker's pulled PT into market.pt_escrow to
        // close the flash.
        require!(
            ctx.accounts.dst_mint.key() == ctx.accounts.mint_sy.key(),
            CallbackError::UnsupportedDstMint
        );

        // --- Step 1: fusion.fill — atomic pull-and-deliver ---
        //
        // Mirrors the buy-side, but with src/dst flipped:
        //   maker.src (PT) → solver.taker_src_ata (PT)
        //   solver.taker_dst_ata (SY = caller_sy_dst, pre-funded by the flash)
        //                        → maker.maker_dst_ata (SY)
        // Ed25519 verify must precede this ix in the outer tx.
        let cpi_accounts = FusionFill {
            taker: ctx.accounts.caller.to_account_info(),
            maker: ctx.accounts.maker.to_account_info(),
            maker_receiver: ctx.accounts.maker_receiver.to_account_info(),
            src_mint: ctx.accounts.src_mint.to_account_info(),
            dst_mint: ctx.accounts.dst_mint.to_account_info(),
            maker_src_ata: ctx.accounts.maker_src_ata.to_account_info(),
            taker_src_ata: ctx.accounts.taker_src_ata.to_account_info(),
            maker_dst_ata: Some(ctx.accounts.maker_dst_ata.to_account_info()),
            // Solver's SY ATA (where the flash deposited the borrowed SY).
            // fusion.fill debits this to deliver SY to the maker.
            taker_dst_ata: Some(ctx.accounts.caller_sy_dst.to_account_info()),
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
            None,
        )?;

        // Pro-forma: after fusion.fill the solver should hold ≥ pt_required
        // PT in their PT ATA. Surplus (Dutch-auction overshoot etc.) stays
        // with the solver as profit.
        ctx.accounts.taker_src_ata.reload()?;
        require!(
            ctx.accounts.taker_src_ata.amount >= pt_required,
            CallbackError::InsufficientPulledSrc
        );

        // --- Step 2: repay the flash by moving PT → market.pt_escrow ---
        // src_mint == market.mint_pt by the AMM's accounting (token_pt_escrow
        // is created with that mint at market init). We use src_mint here
        // rather than re-passing mint_pt because fusion.fill already
        // validated `taker_src_ata.mint == src_mint`.
        transfer_checked(
            CpiContext::new(
                ctx.accounts.core_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.taker_src_ata.to_account_info(),
                    mint: ctx.accounts.src_mint.to_account_info(),
                    to: ctx.accounts.token_pt_escrow.to_account_info(),
                    authority: ctx.accounts.caller.to_account_info(),
                },
            ),
            pt_required,
            ctx.accounts.src_mint.decimals,
        )?;

        let _ = sy_received;
        Ok(())
    }

    /// Sell-YT mirror: invoked by `clearstone_core.flash_sell_yt` after
    /// it has pre-advanced `sy_received` SY to the solver's SY ATA.
    /// Handler must populate `caller_yt_dst` with at least `yt_required`
    /// YT before returning (core verifies via I-F-YT2). Production flow:
    /// run fusion.fill which pulls maker.YT → solver and delivers
    /// solver.SY → maker. Core's inline sell_yt cascade (after the
    /// callback returns) burns the YT and repays the SY advance.
    ///
    /// `data` borsh-decodes to `CallbackPayload` — same shape as the
    /// other directions; the order's `src_mint = mint_yt`,
    /// `dst_mint = mint_sy` for this branch.
    pub fn on_flash_sell_yt_received(
        ctx: Context<OnFlashSellYtReceived>,
        sy_received: u64,
        yt_required: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        let payload = CallbackPayload::try_from_slice(&data)
            .map_err(|_| error!(CallbackError::MalformedPayload))?;

        // Reference scope: dst == mint_sy (solver delivers SY to maker).
        // src == mint_yt is implied by the order; fusion.fill will
        // reject if maker.src_ata.mint != src_mint.
        require!(
            ctx.accounts.dst_mint.key() == ctx.accounts.mint_sy.key(),
            CallbackError::UnsupportedDstMint
        );

        // --- Step 1: fusion.fill — atomic pull-and-deliver ---
        // Maker.YT → solver (taker_src_ata).
        // Solver.SY (caller_sy_dst, pre-loaded by the flash) → maker (maker_dst_ata).
        let cpi_accounts = FusionFill {
            taker: ctx.accounts.caller.to_account_info(),
            maker: ctx.accounts.maker.to_account_info(),
            maker_receiver: ctx.accounts.maker_receiver.to_account_info(),
            src_mint: ctx.accounts.src_mint.to_account_info(),
            dst_mint: ctx.accounts.dst_mint.to_account_info(),
            maker_src_ata: ctx.accounts.maker_src_ata.to_account_info(),
            taker_src_ata: ctx.accounts.taker_src_ata.to_account_info(),
            maker_dst_ata: Some(ctx.accounts.maker_dst_ata.to_account_info()),
            // taker_dst_ata is the solver's SY ATA — flash_sell_yt's
            // caller_sy_dst — pre-funded by the SY advance at step 3 of
            // the outer ix.
            taker_dst_ata: Some(ctx.accounts.caller_sy_dst.to_account_info()),
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
            None,
        )?;

        // After fusion.fill, taker_src_ata holds the maker's pulled YT.
        // Pro-forma: confirm we received ≥ yt_required (core's outer
        // delta check enforces the same invariant on caller_yt_dst, but
        // checking here surfaces problems before the flash unwinds).
        ctx.accounts.taker_src_ata.reload()?;
        require!(
            ctx.accounts.taker_src_ata.amount >= yt_required,
            CallbackError::InsufficientPulledSrc
        );

        // No explicit repay leg — core's `flash_sell_yt` handler will
        // do the inline sell_yt cascade (borrow_pt / merge / trade_pt /
        // repay_pt) and the SY-deposit-back to the adapter pool after
        // this callback returns. The callback's job is solely to land
        // YT into caller_yt_dst.
        let _ = sy_received;
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

/// Account layout MUST match `core::flash_swap_sy`'s callback invocation:
///   index 0..6 — fixed prefix injected by core (with caller_sy_dst in slot 1
///                and token_pt_escrow in slot 2 — the borrow / repay legs
///                swap places vs. the buy-side prefix).
///   index 6..N — the `remaining_accounts` the solver passed to core.
#[derive(Accounts)]
pub struct OnFlashSyReceived<'info> {
    // ---- Fixed prefix from core ----
    /// CHECK: market account — readonly here.
    pub market: UncheckedAccount<'info>,

    /// Solver's SY ATA. Core just deposited `sy_received` SY here.
    /// Fusion.fill will debit it to deliver SY to the maker.
    #[account(mut)]
    pub caller_sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Market's PT escrow. Callback must top it up by `pt_required`.
    #[account(mut)]
    pub token_pt_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SY mint — used by the dst_mint guardrail check.
    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    /// Solver signs the outer tx; their signature is propagated here via CPI.
    pub caller: Signer<'info>,

    /// Token program for the PT-escrow repay leg.
    pub core_token_program: Interface<'info, TokenInterface>,

    // ---- fusion.fill passthrough (from solver's remaining_accounts) ----
    pub fusion_program: Program<'info, ClearstoneFusion>,

    /// CHECK: maker pubkey; validated inside fusion.fill against its OrderConfig.
    pub maker: UncheckedAccount<'info>,

    /// CHECK: maker_receiver (wallet receiving dst SY).
    #[account(mut)]
    pub maker_receiver: UncheckedAccount<'info>,

    /// Maker's PT ATA — fusion.fill pulls PT from here.
    #[account(mut)]
    pub maker_src_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solver's PT ATA — fusion.fill credits PT here, and the repay leg
    /// debits it.
    #[account(mut)]
    pub taker_src_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: maker's SY ATA (where SY lands after fusion.fill delivery).
    #[account(mut)]
    pub maker_dst_ata: UncheckedAccount<'info>,

    /// PT mint (= market.mint_pt for this direction). Used for transfer_checked.
    pub src_mint: Box<InterfaceAccount<'info, Mint>>,

    /// SY mint (= market.mint_sy). Validated against `mint_sy` by the
    /// `UnsupportedDstMint` check.
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

/// Account layout for the sell-YT callback. Mirrors core's
/// `flash_sell_yt` invocation prefix: market, caller_sy_dst (=
/// taker_dst_ata for fusion), caller_yt_dst (= taker_src_ata for
/// fusion), mint_sy, caller, core_token_program. Note this struct does
/// NOT carry a separate `taker_src_ata` — both legs of fusion.fill
/// reuse the named slots from the core prefix.
#[derive(Accounts)]
pub struct OnFlashSellYtReceived<'info> {
    // ---- Fixed prefix from core ----
    /// CHECK: market account — readonly here.
    pub market: UncheckedAccount<'info>,

    /// Solver's SY ATA. Core pre-advanced `sy_received` SY here at
    /// step 3 of `flash_sell_yt`. fusion.fill drains it to deliver SY
    /// to the maker (taker_dst_ata role).
    #[account(mut)]
    pub caller_sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solver's YT ATA. fusion.fill credits it from maker.YT_ata
    /// (taker_src_ata role). Core's outer ix verifies this account's
    /// balance grew by ≥ `yt_required` after the callback returns.
    #[account(mut)]
    pub caller_yt_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SY mint — used by the dst_mint guardrail check.
    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    /// Solver signs the outer tx; their signature is propagated here via CPI.
    pub caller: Signer<'info>,

    /// Token program — required by Anchor's account decode for
    /// `caller_sy_dst` / `caller_yt_dst` even though the callback
    /// itself doesn't issue token CPIs (core's inline cascade owns the
    /// merge / trade_pt / repay legs).
    pub core_token_program: Interface<'info, TokenInterface>,

    // ---- fusion.fill passthrough (from solver's remaining_accounts) ----
    pub fusion_program: Program<'info, ClearstoneFusion>,

    /// CHECK: maker pubkey; validated inside fusion.fill against its OrderConfig.
    pub maker: UncheckedAccount<'info>,

    /// CHECK: maker_receiver (wallet receiving dst SY).
    #[account(mut)]
    pub maker_receiver: UncheckedAccount<'info>,

    /// Maker's YT ATA — fusion.fill pulls YT from here.
    #[account(mut)]
    pub maker_src_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solver's YT ATA mirror for fusion.fill's `taker_src_ata` role.
    /// MUST point to the same pubkey as `caller_yt_dst` above —
    /// duplicating the slot here would split the writability flag and
    /// trip the runtime, so we let fusion.fill see the same AccountInfo
    /// twice (once via this prefix-named slot, once via the
    /// remaining_accounts forwarding).
    /// CHECK: equality with caller_yt_dst is enforced by core's outer
    /// ix's writability check on caller_yt_dst's delta.
    #[account(mut)]
    pub taker_src_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: maker's SY ATA (where SY lands after fusion.fill delivery).
    #[account(mut)]
    pub maker_dst_ata: UncheckedAccount<'info>,

    /// YT mint (= market.mint_yt for this direction). Used internally
    /// by fusion.fill for transfer_checked decimals.
    pub src_mint: Box<InterfaceAccount<'info, Mint>>,

    /// SY mint (= market.mint_sy). Validated against `mint_sy` by
    /// `UnsupportedDstMint`.
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
    #[msg("Reference callback (sell-PT) only supports orders where dst_mint == market.mint_sy")]
    UnsupportedDstMint,
    #[msg("fusion.fill pulled less src than sy_required — order underfills the flash")]
    InsufficientPulledSrc,
}

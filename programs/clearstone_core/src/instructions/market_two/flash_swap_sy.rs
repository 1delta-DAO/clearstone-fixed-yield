// Flash-swap SY — sell-PT direction (mirror of flash_swap_pt).
//
// Sends the AMM-quoted `sy_out` of SY from the market's escrow to the caller,
// CPIs into a caller-supplied callback program, then requires the callback to
// top up the market's PT escrow by `pt_in` before the ix returns.
//
// Use case: maker holds PT and wants SY. Solver flash-borrows the AMM-quoted
// SY, runs fusion.fill (which pulls the maker's PT and delivers SY to the
// maker), and repays the market's PT escrow with the PT pulled from the
// maker. Flow mirrors flash_swap_pt with sign-flipped AMM quote.
//
// Spec: INTENT_FLASH_PLAN.md §5 (sell-PT branch).
// Invariants: I-F1 (atomicity, shared with flash_swap_pt via flash_pt_debt),
// I-F2 (repayment in PT this time), I-F3 (rate freshness), I-F4 (the temporary
// I-M1 violation is on the PT side instead of the SY side), I-F5 (size cap).
//
// Audit touchpoints:
//   - `pt_in` is the AMM input (trader's PT leg, sign-flipped). The borrow is
//     the AMM-quoted SY output. Solvers that need to size the borrow off a
//     desired SY-out quote a forward `quote_trade_pt` client-side.
//   - `flash_pt_debt` is reused as the open-flash marker. Other market-
//     mutating entrypoints already gate on `flash_pt_debt == 0` for I-F1; the
//     same gate works here without a second field.

use crate::{
    constants::FLASH_MAX_PT_BPS,
    error::ExponentCoreError,
    state::MarketTwo,
    util::sy_transfer_checked,
    utils::{do_get_sy_state, do_withdraw_sy},
    STATUS_CAN_SELL_PT,
};
use anchor_lang::{
    prelude::*,
    solana_program::{
        hash::hashv,
        instruction::{AccountMeta, Instruction},
        program::invoke,
    },
};
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount, TransferChecked},
};
use precise_number::Number;

const CALLBACK_IX_NAME: &str = "on_flash_sy_received";

fn callback_discriminator() -> [u8; 8] {
    let preimage = format!("global:{}", CALLBACK_IX_NAME);
    let h = hashv(&[preimage.as_bytes()]);
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&h.to_bytes()[..8]);
    disc
}

#[event_cpi]
#[derive(Accounts)]
pub struct FlashSwapSy<'info> {
    /// Marked `mut` for the same reason as `flash_swap_pt::FlashSwapPt::caller`:
    /// callbacks may re-pass `caller` as a writable slot in nested fusion CPIs;
    /// without `mut` here Solana would reject the tx with "Cross-program
    /// invocation with unauthorized signer or writable account".
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        has_one = address_lookup_table,
        has_one = sy_program,
        has_one = token_sy_escrow,
        has_one = token_pt_escrow,
        has_one = token_fee_treasury_sy,
        has_one = mint_sy,
        has_one = mint_pt,
    )]
    pub market: Box<Account<'info, MarketTwo>>,

    /// SY destination for the flash borrow. Must be caller-controlled and
    /// of the right mint — same defense-in-depth pattern as flash_swap_pt's
    /// `caller_pt_dst`.
    #[account(mut, token::authority = caller, token::mint = mint_sy)]
    pub caller_sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Market-owned SY escrow the flash is borrowed from. Mint pinned to
    /// `mint_sy`.
    #[account(mut, token::mint = mint_sy)]
    pub token_sy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Market-owned PT escrow; callback must top this up to close the flash.
    /// Mint pinned to `mint_pt` (matches market.has_one) so a curator-supplied
    /// bogus market with mismatched escrow.mint cannot route a transfer to
    /// the caller's PT ATA.
    #[account(mut, token::mint = mint_pt)]
    pub token_pt_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SY fee destination — same fee leg as flash_swap_pt (treasury_fee paid
    /// in SY out of escrow_sy at commit time).
    #[account(mut, token::mint = mint_sy)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    /// PT mint — pinned via `market.has_one = mint_pt`. Used for nothing on
    /// the SY-borrow side directly, but its presence constrains
    /// `token_pt_escrow.mint` and gives callbacks a typed handle to the same
    /// Mint struct without re-deserialising.
    pub mint_pt: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: CPI target for the flash callback. Untrusted to the caller's
    /// own satisfaction — they sign the tx that selects this program.
    /// `executable=true` short-circuits an obvious typo (a non-program
    /// pubkey) before `invoke` produces a less-clear runtime error.
    #[account(executable)]
    pub callback_program: UncheckedAccount<'info>,

    /// CHECK: constrained by market.
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: constrained by market.
    pub sy_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

impl<'i> FlashSwapSy<'i> {
    fn transfer_sy_out_accounts(&self) -> TransferChecked<'i> {
        TransferChecked {
            from: self.token_sy_escrow.to_account_info(),
            mint: self.mint_sy.to_account_info(),
            to: self.caller_sy_dst.to_account_info(),
            authority: self.market.to_account_info(),
        }
    }

    fn transfer_fee_accounts(&self) -> TransferChecked<'i> {
        TransferChecked {
            from: self.token_sy_escrow.to_account_info(),
            mint: self.mint_sy.to_account_info(),
            to: self.token_fee_treasury_sy.to_account_info(),
            authority: self.market.to_account_info(),
        }
    }

    fn validate(&self, pt_in: u64) -> Result<()> {
        // I-F1 nested-flash gate (shared field with flash_swap_pt).
        require!(
            self.market.flash_pt_debt == 0,
            ExponentCoreError::NestedFlashBlocked
        );

        require!(
            self.market.check_status_flags(STATUS_CAN_SELL_PT),
            ExponentCoreError::SellingPtDisabled
        );

        require!(pt_in > 0, ExponentCoreError::OperationAmountTooSmall);

        // I-F5: cap based on pool PT side, mirroring flash_swap_pt.
        // Same rationale: keep the snapshot quote inside its near-linear
        // regime so the AMM commit at step 7 is fair.
        let cap = (self.market.financials.pt_balance as u128)
            .checked_mul(FLASH_MAX_PT_BPS as u128)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ExponentCoreError::MathOverflow)?;
        require!(
            (pt_in as u128) <= cap,
            ExponentCoreError::FlashSizeExceedsCap
        );

        Ok(())
    }
}

#[access_control(ctx.accounts.validate(pt_in))]
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, FlashSwapSy<'info>>,
    pt_in: u64,
    callback_data: Vec<u8>,
) -> Result<FlashSwapSyEvent> {
    let now = Clock::get()?.unix_timestamp as u64;
    require!(
        ctx.accounts.market.is_active(now),
        ExponentCoreError::VaultIsNotActive
    );

    // --- Step 2: rate snapshot (I-F3, reentrancy guard engaged + cleared) ---
    let sy_state = do_get_sy_state(
        &ctx.accounts.market.to_account_info(),
        &ctx.accounts.address_lookup_table,
        &ctx.accounts.market.cpi_accounts,
        ctx.remaining_accounts,
        ctx.accounts.sy_program.key(),
    )?;
    ctx.accounts.market.reload()?;
    require!(
        sy_state.exchange_rate > Number::ZERO,
        ExponentCoreError::SyInvalidExchangeRate
    );
    let sy_exchange_rate = sy_state.exchange_rate;

    // --- Step 3: quote the AMM with sign-flipped net_trader_pt ---
    // Sell-PT direction: trader (= solver acting on maker's behalf) sends PT
    // to the market and receives SY. From the AMM's perspective:
    //     net_trader_pt = -pt_in,
    //     net_trader_sy = +sy_out (positive: trader receives SY from pool).
    // The curve math is identical to `trade_pt`'s sell-PT branch.
    let fee_treasury_sy_bps = ctx.accounts.market.fee_treasury_sy_bps;
    let net_trader_pt: i64 = -(pt_in as i64);
    let quote = ctx.accounts.market.financials.quote_trade_pt(
        sy_exchange_rate,
        net_trader_pt,
        now,
        /* is_current_flash_swap = */ false,
        fee_treasury_sy_bps,
    );
    // Trader's SY leg when selling PT must be positive (SY flows from market
    // to trader). A non-positive quote means the curve is in a degenerate
    // regime (e.g. extreme rate) and the trade can't be priced cleanly.
    require!(quote.net_trader_sy > 0, ExponentCoreError::MathOverflow);
    let sy_out: u64 = quote.net_trader_sy as u64;

    // --- Step 4: open the flash — withdraw from adapter, transfer SY out,
    //                                mark debt, snapshot PT ---
    //
    // The market's `token_sy_escrow` is a pass-through, not a reserve: at
    // rest it sits at zero because all liquidity lives inside the SY
    // adapter's pool (post-init `do_deposit_sy` plus every `trade_pt`
    // buy redepositing). To send the borrowed SY to the caller we must
    // first withdraw `sy_out + treasury_fee_amount` from the adapter into
    // escrow_sy, then split: `sy_out` to caller now, `treasury_fee_amount`
    // to fee treasury after the callback. This matches `trade_pt`'s
    // sell-PT branch (see `transfer_sy_for_trade_pt` in trade_pt.rs).
    ctx.accounts.token_pt_escrow.reload()?;
    let escrow_pt_before = ctx.accounts.token_pt_escrow.amount;

    let withdraw_amount = sy_out
        .checked_add(quote.treasury_fee_amount)
        .ok_or(ExponentCoreError::MathOverflow)?;
    {
        let market_seeds = ctx.accounts.market.signer_seeds();
        let signer_seeds: &[&[&[u8]]] = &[&market_seeds];
        do_withdraw_sy(
            &ctx.accounts.market.to_account_info(),
            withdraw_amount,
            &ctx.accounts.address_lookup_table,
            &ctx.accounts.market.cpi_accounts,
            &ctx.accounts.to_account_infos(),
            ctx.remaining_accounts,
            ctx.accounts.sy_program.key(),
            signer_seeds,
        )?;
    }
    ctx.accounts.market.reload()?;

    let market_seeds = ctx.accounts.market.signer_seeds();
    let signer_seeds: &[&[&[u8]]] = &[&market_seeds];
    sy_transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.transfer_sy_out_accounts(),
        )
        .with_signer(signer_seeds),
        sy_out,
        ctx.accounts.mint_sy.decimals,
    )?;

    // Reuse `flash_pt_debt` as the open-flash marker. The amount stored is the
    // EXPECTED PT repayment (pt_in); other handlers only check `== 0`, so the
    // overloaded semantic doesn't break I-F1 callers.
    ctx.accounts.market.flash_pt_debt = pt_in;

    // Flush flash_pt_debt to disk before the CPI so a re-entrant attempt
    // actually sees the non-zero latch.
    {
        let info = ctx.accounts.market.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let mut writer: &mut [u8] = &mut data;
        ctx.accounts.market.try_serialize(&mut writer)?;
    }

    // --- Step 5: invoke the callback ---
    //
    // Accounts passed to the callback program, in order:
    //   0. market                 (readonly)
    //   1. caller_sy_dst          (writable — the just-flashed SY is here)
    //   2. token_pt_escrow        (writable — callback tops this up)
    //   3. mint_sy                (readonly)
    //   4. caller                 (signer pass-through)
    //   5. token_program          (readonly)
    //   6..N. remaining_accounts from the outer tx — callback-defined
    // Mirror flash_swap_pt's CPI shape: `caller` is forwarded as
    // writable+signer, not readonly, because callbacks routinely re-pass
    // `caller` as the `taker` slot in a fusion.fill (or other) CPI where
    // the inner ix declares it writable. A readonly forward here would
    // make any such inner CPI revert with "writable privilege escalated".
    let mut callback_accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.market.key(), false),
        AccountMeta::new(ctx.accounts.caller_sy_dst.key(), false),
        AccountMeta::new(ctx.accounts.token_pt_escrow.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint_sy.key(), false),
        AccountMeta::new(ctx.accounts.caller.key(), true),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
    ];
    let mut callback_infos = vec![
        ctx.accounts.market.to_account_info(),
        ctx.accounts.caller_sy_dst.to_account_info(),
        ctx.accounts.token_pt_escrow.to_account_info(),
        ctx.accounts.mint_sy.to_account_info(),
        ctx.accounts.caller.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    ];
    for meta_info in ctx.remaining_accounts.iter() {
        callback_accounts.push(AccountMeta {
            pubkey: meta_info.key(),
            is_signer: meta_info.is_signer,
            is_writable: meta_info.is_writable,
        });
        callback_infos.push(meta_info.clone());
    }

    // Callback args: (sy_received: u64, pt_required: u64, data: Vec<u8>).
    // Borsh encoding = disc(8) + u64 + u64 + vec_len_u32 + vec_bytes.
    let mut ix_data = Vec::with_capacity(8 + 8 + 8 + 4 + callback_data.len());
    ix_data.extend_from_slice(&callback_discriminator());
    ix_data.extend_from_slice(&sy_out.to_le_bytes());
    ix_data.extend_from_slice(&pt_in.to_le_bytes());
    ix_data.extend_from_slice(&(callback_data.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&callback_data);

    let ix = Instruction {
        program_id: ctx.accounts.callback_program.key(),
        accounts: callback_accounts,
        data: ix_data,
    };
    invoke(&ix, &callback_infos)?;

    // --- Step 6: verify the callback repaid PT ---
    ctx.accounts.token_pt_escrow.reload()?;
    let escrow_pt_after = ctx.accounts.token_pt_escrow.amount;
    let delta = escrow_pt_after
        .checked_sub(escrow_pt_before)
        .ok_or(ExponentCoreError::FlashRepayInsufficient)?;
    require!(delta >= pt_in, ExponentCoreError::FlashRepayInsufficient);

    // --- Step 6.5: forward treasury fee from escrow_sy → fee_treasury_sy ---
    // Fees on this side are still paid in SY out of escrow_sy (treasury fee
    // is denominated in SY by treasury_sy_bps), same accounting as the buy
    // direction. The market signer (PDA) authorizes the transfer.
    if quote.treasury_fee_amount > 0 {
        let fee_seeds = ctx.accounts.market.signer_seeds();
        let fee_signer_seeds: &[&[&[u8]]] = &[&fee_seeds];
        sy_transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.transfer_fee_accounts(),
            )
            .with_signer(fee_signer_seeds),
            quote.treasury_fee_amount,
            ctx.accounts.mint_sy.decimals,
        )?;
    }

    // --- Step 7: commit using the SAME snapshot (I-F3) ---
    ctx.accounts
        .market
        .financials
        .apply_trade_pt(sy_exchange_rate, now, &quote);

    // --- Step 8: close the flash ---
    ctx.accounts.market.flash_pt_debt = 0;

    let event = FlashSwapSyEvent {
        caller: ctx.accounts.caller.key(),
        market: ctx.accounts.market.key(),
        callback_program: ctx.accounts.callback_program.key(),
        pt_in,
        sy_out,
        sy_fee: quote.sy_fee,
        sy_exchange_rate,
        timestamp: Clock::get()?.unix_timestamp,
    };
    emit_cpi!(event);
    Ok(event)
}

#[event]
pub struct FlashSwapSyEvent {
    pub caller: Pubkey,
    pub market: Pubkey,
    pub callback_program: Pubkey,
    pub pt_in: u64,
    pub sy_out: u64,
    pub sy_fee: u64,
    pub sy_exchange_rate: Number,
    pub timestamp: i64,
}

// Flash-swap PT — user-callable entrypoint (M-FLASH-1).
//
// Sends `pt_out` of PT from the market's escrow to the caller, CPIs into a
// caller-supplied callback program, then requires the callback to top up the
// market's SY escrow by the AMM-quoted repayment before the ix returns.
//
// Spec: INTENT_FLASH_PLAN.md §5.
// Invariants enforced: I-F1 (flash atomicity), I-F2 (repayment), I-F3 (rate
// freshness), I-F4 (PT conservation). See INVARIANTS.md.
//
// Audit touchpoints:
//   - Rate snapshot at step 2 is used by BOTH the quote (step 3) and the
//     commit (step 7). Never re-read after the callback.
//   - `market.flash_pt_debt` gates re-entry into flash_swap_pt (nested flash
//     blocked) and is checked by every other market-mutating entrypoint.
//   - Reentrancy guard engaged at step 2 via do_get_sy_state stays engaged
//     through the callback window — the callback cannot CPI the SY program.

use crate::{
    error::ExponentCoreError,
    state::MarketTwo,
    util::sy_transfer_checked,
    utils::do_get_sy_state,
    STATUS_CAN_BUY_PT,
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
    token_2022,
    token_interface::{Mint, TokenAccount, TransferChecked},
};
use precise_number::Number;

/// Anchor global-instruction discriminator preimage. Anchor hashes
/// `"global:<ix_name>"` with sha256 and takes the first 8 bytes.
///
/// Callback programs MUST define an instruction with exactly this name so the
/// discriminator matches — this is a naming convention, not a validated
/// constraint. A mismatched callback reverts with the callback's own
/// "invalid instruction discriminator" error, which reverts the whole flash.
const CALLBACK_IX_NAME: &str = "on_flash_pt_received";

fn callback_discriminator() -> [u8; 8] {
    let preimage = format!("global:{}", CALLBACK_IX_NAME);
    let h = hashv(&[preimage.as_bytes()]);
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&h.to_bytes()[..8]);
    disc
}

#[event_cpi]
#[derive(Accounts)]
pub struct FlashSwapPt<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        has_one = address_lookup_table,
        has_one = sy_program,
        has_one = token_sy_escrow,
        has_one = token_pt_escrow,
        has_one = token_fee_treasury_sy,
        has_one = mint_sy,
    )]
    pub market: Account<'info, MarketTwo>,

    /// PT destination for the flash borrow. Must be caller-controlled.
    #[account(mut, token::authority = caller)]
    pub caller_pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Market-owned SY escrow; callback must top this up to close the flash.
    #[account(mut, token::mint = mint_sy)]
    pub token_sy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Market-owned PT escrow the flash is borrowed from.
    #[account(mut)]
    pub token_pt_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SY fee destination.
    #[account(mut, token::mint = mint_sy)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: CPI target for the flash callback. Untrusted to the caller's
    /// own satisfaction — they sign the tx that selects this program.
    pub callback_program: UncheckedAccount<'info>,

    /// CHECK: constrained by market.
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: constrained by market.
    pub sy_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

impl<'i> FlashSwapPt<'i> {
    fn transfer_pt_out_accounts(&self) -> token_2022::Transfer<'i> {
        token_2022::Transfer {
            from: self.token_pt_escrow.to_account_info(),
            to: self.caller_pt_dst.to_account_info(),
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

    fn validate(&self, pt_out: u64) -> Result<()> {
        // I-F1 nested-flash gate — must always be zero on entry.
        require!(
            self.market.flash_pt_debt == 0,
            ExponentCoreError::NestedFlashBlocked
        );

        require!(
            self.market.check_status_flags(STATUS_CAN_BUY_PT),
            ExponentCoreError::BuyingPtDisabled
        );

        require!(pt_out > 0, ExponentCoreError::OperationAmountTooSmall);

        require!(
            self.market.financials.pt_balance >= pt_out,
            ExponentCoreError::InsufficientPtLiquidity
        );

        Ok(())
    }
}

#[access_control(ctx.accounts.validate(pt_out))]
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, FlashSwapPt<'info>>,
    pt_out: u64,
    callback_data: Vec<u8>,
) -> Result<FlashSwapPtEvent> {
    let now = Clock::get()?.unix_timestamp as u64;
    require!(ctx.accounts.market.is_active(now), ExponentCoreError::VaultIsNotActive);

    // --- Step 2: rate snapshot (reentrancy guard engaged + cleared inside) ---
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

    // --- Step 3: quote the repayment (borrow means negative net_trader_pt) ---
    let fee_treasury_sy_bps = ctx.accounts.market.fee_treasury_sy_bps;
    let net_trader_pt: i64 = -(pt_out as i64);
    let quote = ctx.accounts.market.financials.quote_trade_pt(
        sy_exchange_rate,
        net_trader_pt,
        now,
        /* is_current_flash_swap = */ false,
        fee_treasury_sy_bps,
    );
    // Trader's SY leg when buying PT is negative (SY flowing from trader to market).
    // Required SY deposit into escrow = abs(net_trader_sy) + treasury_fee_amount.
    // Treasury fee is also deducted from the escrow (market → fee_treasury_sy) at
    // commit time, so the gross escrow top-up must cover both legs.
    require!(quote.net_trader_sy < 0, ExponentCoreError::MathOverflow);
    let sy_in_required: u64 = (quote.net_trader_sy.unsigned_abs() as u64)
        .checked_add(quote.treasury_fee_amount)
        .ok_or(ExponentCoreError::MathOverflow)?;

    // --- Step 4: open the flash — transfer PT out, mark debt, snapshot SY ---
    ctx.accounts.token_sy_escrow.reload()?;
    let escrow_sy_before = ctx.accounts.token_sy_escrow.amount;

    let market_seeds = ctx.accounts.market.signer_seeds();
    let signer_seeds: &[&[&[u8]]] = &[&market_seeds];
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.transfer_pt_out_accounts(),
    )
    .with_signer(signer_seeds);
    #[allow(deprecated)]
    token_2022::transfer(cpi_ctx, pt_out)?;

    ctx.accounts.market.flash_pt_debt = pt_out;

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
    //   0. market                 (readonly — callback inspects pt_balance, etc.)
    //   1. caller_pt_dst          (writable — the just-flashed PT is here)
    //   2. token_sy_escrow        (writable — callback tops this up)
    //   3. mint_sy                (readonly — for transfer_checked math)
    //   4. caller                 (signer pass-through — callback may need it to sign CPIs)
    //   5. token_program          (readonly)
    //   6..N. remaining_accounts from the outer tx — callback-defined
    //
    // Note: `market` is passed readonly. A well-written callback does not
    // attempt to modify it. Even if it did, the `flash_pt_debt != 0` gate
    // in every other mutating entrypoint would reject any nested flash; and
    // no other entrypoint takes `market` by writable handle without that
    // gate.
    let mut callback_accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.market.key(), false),
        AccountMeta::new(ctx.accounts.caller_pt_dst.key(), false),
        AccountMeta::new(ctx.accounts.token_sy_escrow.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint_sy.key(), false),
        AccountMeta::new_readonly(ctx.accounts.caller.key(), true),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
    ];
    let mut callback_infos = vec![
        ctx.accounts.market.to_account_info(),
        ctx.accounts.caller_pt_dst.to_account_info(),
        ctx.accounts.token_sy_escrow.to_account_info(),
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

    // Callback args: (pt_received: u64, sy_required: u64, data: Vec<u8>).
    // Borsh encoding = disc(8) + u64 + u64 + vec_len_u32 + vec_bytes.
    let mut ix_data = Vec::with_capacity(8 + 8 + 8 + 4 + callback_data.len());
    ix_data.extend_from_slice(&callback_discriminator());
    ix_data.extend_from_slice(&pt_out.to_le_bytes());
    ix_data.extend_from_slice(&sy_in_required.to_le_bytes());
    ix_data.extend_from_slice(&(callback_data.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&callback_data);

    let ix = Instruction {
        program_id: ctx.accounts.callback_program.key(),
        accounts: callback_accounts,
        data: ix_data,
    };
    invoke(&ix, &callback_infos)?;

    // --- Step 6: verify the callback repaid ---
    ctx.accounts.token_sy_escrow.reload()?;
    let escrow_sy_after = ctx.accounts.token_sy_escrow.amount;
    let delta = escrow_sy_after
        .checked_sub(escrow_sy_before)
        .ok_or(ExponentCoreError::FlashRepayInsufficient)?;
    require!(
        delta >= sy_in_required,
        ExponentCoreError::FlashRepayInsufficient
    );

    // Forward treasury fee from escrow → fee treasury, same as trade_pt.
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

    let event = FlashSwapPtEvent {
        caller: ctx.accounts.caller.key(),
        market: ctx.accounts.market.key(),
        callback_program: ctx.accounts.callback_program.key(),
        pt_out,
        sy_in: sy_in_required,
        sy_fee: quote.sy_fee,
        sy_exchange_rate,
        timestamp: Clock::get()?.unix_timestamp,
    };
    emit_cpi!(event);
    Ok(event)
}

#[event]
pub struct FlashSwapPtEvent {
    pub caller: Pubkey,
    pub market: Pubkey,
    pub callback_program: Pubkey,
    pub pt_out: u64,
    pub sy_in: u64,
    pub sy_fee: u64,
    pub sy_exchange_rate: Number,
    pub timestamp: i64,
}

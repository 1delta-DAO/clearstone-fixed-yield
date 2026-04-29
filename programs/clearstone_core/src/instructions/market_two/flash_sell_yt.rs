// Flash-sell YT — capital-free YT-to-SY routing for fusion intents.
//
// Use case: a maker holds YT and wants SY. The solver doesn't have SY
// inventory — they want to source it atomically from the AMM, deliver
// to the maker via fusion.fill, then convert the maker's YT (now in
// solver's ATA) back to SY to repay.
//
// The buy_yt/sell_yt entrypoints already implement an "internal flash"
// (borrow → strip/merge → trade_pt → repay) inside one ix, but they
// require the trader to start with the right asset (YT for sell_yt).
// In our intent flow the YT only arrives via fusion.fill MID-tx, so
// neither sell_yt nor a multi-ix tx works. This ix wraps the cascade
// with an external callback in the middle: borrow SY upfront, give
// callback a chance to populate the solver's YT ATA, then run the
// sell_yt-equivalent conversion + repay.
//
// Algorithm (mirror of flash_swap_sy with a different repay shape):
//
//   step 1.  validate (flash_pt_debt == 0, status, pt_balance ≥ 2*yt_in,
//                       I-F5 cap on yt_in).
//   step 2.  snapshot SY rate via do_get_sy_state (I-F3).
//   step 3.  withdraw `sy_advance` SY from the adapter pool into
//            market.escrow_sy → solver.sy_ata. This is the SY the
//            solver hands to the maker via fusion.fill.
//   step 4.  flash_pt_debt = yt_in (I-F1 latch — overloaded as
//            "an external flash is open"; cleared at end).
//   step 5.  CPI callback. Solver delivers SY → maker via fusion.fill,
//            receives maker.YT into solver.yt_ata.
//   step 6.  verify solver.yt_ata grew by ≥ yt_in
//            (FlashYtCallbackUnderdelivered).
//   step 7.  clear flash_pt_debt = 0 BEFORE the inline cascade — the
//            cascade calls trade_pt (CPI) which gates on flash_pt_debt
//            for I-F1. Within the handler the runtime guarantees no
//            other ix runs concurrently, so the I-F1 invariant is
//            preserved.
//   step 8.  inline sell_yt cascade:
//              a. borrow_pt(yt_in)            market.escrow_pt → solver.pt_ata
//              b. do_cpi_merge(yt_in)         solver.{pt,yt}_ata → solver.sy_ata
//                                              (sy_recv from merge)
//              c. is_current_flash_swap = true
//              d. do_cpi_trade_pt(+yt_in PT,
//                                  max_sy = -sy_recv)
//                                              solver.sy_ata → solver.pt_ata
//                                              (sy_spent from trade_pt)
//              e. is_current_flash_swap = false
//              f. repay_pt(yt_in)             solver.pt_ata → market.escrow_pt
//   step 9.  verify (sy_recv - sy_spent) ≥ sy_advance + treasury_fee
//            (FlashSellYtNetUnderwater).
//   step 10. transfer sy_advance + treasury_fee back from solver.sy_ata
//            into market.escrow_sy.
//   step 11. do_deposit_sy(sy_advance) repays the adapter pool;
//            treasury_fee leg goes to fee_treasury_sy.
//
// Invariants enforced:
//   I-F1  flash_pt_debt latched during the callback window only.
//   I-F2  market.escrow_sy delta ≥ sy_advance + treasury_fee at end.
//   I-F3  rate snapshot used exactly once (step 2).
//   I-F5  yt_in capped by FLASH_MAX_PT_BPS of pt_balance (mirrors
//          flash_swap_pt's PT-side cap; the YT mint is bounded by
//          the same AMM-side liquidity).

use crate::{
    constants::FLASH_MAX_PT_BPS,
    error::ExponentCoreError,
    instructions::self_cpi::{do_cpi_merge, do_cpi_trade_pt, MergeAccounts, TradePtAccounts},
    state::MarketTwo,
    util::{sy_transfer_checked, token_transfer},
    utils::{do_deposit_sy, do_get_sy_state, do_withdraw_sy},
    STATUS_CAN_SELL_YT,
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
    token_2022::Transfer,
    token_interface::{Mint, TokenAccount, TransferChecked},
};
use precise_number::Number;

const CALLBACK_IX_NAME: &str = "on_flash_sell_yt_received";

fn callback_discriminator() -> [u8; 8] {
    let preimage = format!("global:{}", CALLBACK_IX_NAME);
    let h = hashv(&[preimage.as_bytes()]);
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&h.to_bytes()[..8]);
    disc
}

#[event_cpi]
#[derive(Accounts)]
pub struct FlashSellYt<'info> {
    /// Marked `mut` so the inner fusion.fill CPI (which declares `taker`
    /// writable) doesn't trip "writable privilege escalated" — same
    /// rationale as flash_swap_pt's caller.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        has_one = vault,
        has_one = address_lookup_table,
        has_one = sy_program,
        has_one = token_sy_escrow,
        has_one = token_pt_escrow,
        has_one = token_fee_treasury_sy,
        has_one = mint_sy,
        has_one = mint_pt,
    )]
    pub market: Box<Account<'info, MarketTwo>>,

    /// Solver's SY ATA: the borrow lands here in step 3, the callback
    /// drains it (delivering to maker via fusion.fill), and the cascade
    /// re-fills it via merge.
    #[account(mut, token::authority = caller, token::mint = mint_sy)]
    pub caller_sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solver's PT ATA — temporary parking spot for the borrow_pt /
    /// trade_pt round-trip in the cascade.
    #[account(mut, token::authority = caller, token::mint = mint_pt)]
    pub caller_pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solver's YT ATA: where the callback (= fusion.fill) deposits the
    /// maker's YT, and where the cascade burns from in the merge step.
    #[account(mut, token::authority = caller)]
    pub caller_yt_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint_sy)]
    pub token_sy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint_pt)]
    pub token_pt_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint_sy)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    /// `mut` because the SY adapter's `withdraw_sy`/`deposit_sy` CPIs
    /// declare `sy_mint` writable (Token's MintTo / Burn updates the
    /// mint's supply). When the same pubkey appears in both a named
    /// slot (here) and a `remaining_accounts` entry, Anchor / web3.js
    /// uses the named slot's flag — so it must be `mut` for the inner
    /// CPI's writable requirement not to trip "writable privilege
    /// escalated". (flash_swap_sy.rs gets away without `mut` here only
    /// because its outer tx happens to land mint_sy via remaining_accounts
    /// before the named slot in some account-resolution paths; not a
    /// pattern to rely on.)
    #[account(mut)]
    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    /// `mut` because the inline merge cascade burns PT (Token's Burn ix
    /// updates the mint's supply field). Without `mut` here the inner
    /// merge CPI would trip "writable privilege escalated".
    #[account(mut)]
    pub mint_pt: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: caller-picked CPI target; `executable` short-circuits typos.
    #[account(executable)]
    pub callback_program: UncheckedAccount<'info>,

    /// CHECK: constrained by market.has_one.
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: constrained by market.has_one.
    pub sy_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    // -- Vault-side accounts needed for the inline cascade's merge CPI --
    /// CHECK: validated by the merge CPI.
    #[account(
        mut,
        address = market.vault
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: validated by the merge CPI.
    #[account(mut)]
    pub authority_vault: UncheckedAccount<'info>,

    /// CHECK: validated by the merge CPI.
    #[account(mut)]
    pub token_sy_escrow_vault: UncheckedAccount<'info>,

    /// CHECK: validated by the merge CPI.
    #[account(mut)]
    pub mint_yt: UncheckedAccount<'info>,

    /// CHECK: validated by the merge CPI.
    pub address_lookup_table_vault: UncheckedAccount<'info>,

    /// CHECK: validated by the merge CPI.
    #[account(mut)]
    pub yield_position_vault: UncheckedAccount<'info>,
}

impl<'i> FlashSellYt<'i> {
    fn validate(&self, yt_in: u64) -> Result<()> {
        // I-F1 nested-flash gate (shared with flash_swap_pt / flash_swap_sy).
        require!(
            self.market.flash_pt_debt == 0,
            ExponentCoreError::NestedFlashBlocked
        );

        require!(
            self.market.check_status_flags(STATUS_CAN_SELL_YT),
            ExponentCoreError::SellingYtDisabled
        );

        require!(yt_in > 0, ExponentCoreError::OperationAmountTooSmall);

        // sell_yt's pool requirement: needs ≥ 2 * yt_in PT (one for the
        // borrow leg of the cascade, one for the trade_pt re-buy).
        require!(
            self.market.financials.pt_balance >= yt_in.saturating_mul(2),
            ExponentCoreError::InsufficientPtLiquidity
        );

        // I-F5 cap. Use yt_in as the size proxy — it's the AMM-side
        // pressure on the PT pool.
        let cap = (self.market.financials.pt_balance as u128)
            .checked_mul(FLASH_MAX_PT_BPS as u128)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ExponentCoreError::MathOverflow)?;
        require!(
            (yt_in as u128) <= cap,
            ExponentCoreError::FlashSizeExceedsCap
        );

        Ok(())
    }

    fn transfer_sy_out_accounts(&self) -> TransferChecked<'i> {
        TransferChecked {
            from: self.token_sy_escrow.to_account_info(),
            mint: self.mint_sy.to_account_info(),
            to: self.caller_sy_dst.to_account_info(),
            authority: self.market.to_account_info(),
        }
    }

    fn transfer_sy_repay_accounts(&self, amount_dst: AccountInfo<'i>) -> TransferChecked<'i> {
        TransferChecked {
            from: self.caller_sy_dst.to_account_info(),
            mint: self.mint_sy.to_account_info(),
            to: amount_dst,
            authority: self.caller.to_account_info(),
        }
    }

    fn borrow_pt_accounts(&self) -> Transfer<'i> {
        Transfer {
            from: self.token_pt_escrow.to_account_info(),
            to: self.caller_pt_dst.to_account_info(),
            authority: self.market.to_account_info(),
        }
    }

    fn repay_pt_accounts(&self) -> Transfer<'i> {
        Transfer {
            from: self.caller_pt_dst.to_account_info(),
            to: self.token_pt_escrow.to_account_info(),
            authority: self.caller.to_account_info(),
        }
    }

    fn merge_accounts(&self) -> MergeAccounts<'i> {
        MergeAccounts {
            owner: self.caller.to_account_info(),
            authority: self.authority_vault.to_account_info(),
            vault: self.vault.to_account_info(),
            sy_dst: self.caller_sy_dst.to_account_info(),
            escrow_sy: self.token_sy_escrow_vault.to_account_info(),
            yt_src: self.caller_yt_dst.to_account_info(),
            pt_src: self.caller_pt_dst.to_account_info(),
            mint_yt: self.mint_yt.to_account_info(),
            mint_pt: self.mint_pt.to_account_info(),
            mint_sy: self.mint_sy.to_account_info(),
            token_program: self.token_program.to_account_info(),
            sy_program: self.sy_program.to_account_info(),
            address_lookup_table: self.address_lookup_table_vault.to_account_info(),
            yield_position: self.yield_position_vault.to_account_info(),
            event_authority: self.event_authority.to_account_info(),
            program: self.program.to_account_info(),
        }
    }

    fn trade_pt_accounts(&self) -> TradePtAccounts<'i> {
        TradePtAccounts {
            trader: self.caller.to_account_info(),
            market: self.market.to_account_info(),
            token_sy_trader: self.caller_sy_dst.to_account_info(),
            token_pt_trader: self.caller_pt_dst.to_account_info(),
            token_sy_escrow: self.token_sy_escrow.to_account_info(),
            token_pt_escrow: self.token_pt_escrow.to_account_info(),
            address_lookup_table: self.address_lookup_table.to_account_info(),
            token_program: self.token_program.to_account_info(),
            sy_program: self.sy_program.to_account_info(),
            token_fee_treasury_sy: self.token_fee_treasury_sy.to_account_info(),
            mint_sy: self.mint_sy.to_account_info(),
            event_authority: self.event_authority.to_account_info(),
            program: self.program.to_account_info(),
        }
    }
}

#[access_control(ctx.accounts.validate(yt_in))]
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, FlashSellYt<'info>>,
    yt_in: u64,
    sy_advance: u64,
    callback_data: Vec<u8>,
) -> Result<FlashSellYtEvent> {
    let now = Clock::get()?.unix_timestamp as u64;
    require!(
        ctx.accounts.market.is_active(now),
        ExponentCoreError::VaultIsNotActive
    );

    // --- Step 2: rate snapshot (I-F3) ---
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

    // --- Step 3: pre-advance SY to the solver ---
    // The solver will hand this off to the maker inside the callback (via
    // fusion.fill). market.escrow_sy is a passthrough; pull from adapter.
    {
        let market_seeds = ctx.accounts.market.signer_seeds();
        let signer_seeds: &[&[&[u8]]] = &[&market_seeds];
        do_withdraw_sy(
            &ctx.accounts.market.to_account_info(),
            sy_advance,
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
        sy_advance,
        ctx.accounts.mint_sy.decimals,
    )?;

    // --- Step 4: latch flash_pt_debt against external nested flashes ---
    ctx.accounts.market.flash_pt_debt = yt_in;
    {
        let info = ctx.accounts.market.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let mut writer: &mut [u8] = &mut data;
        ctx.accounts.market.try_serialize(&mut writer)?;
    }

    // --- Step 5: CPI callback ---
    // Snapshot solver.yt_ata pre-callback for the post-callback delta check.
    ctx.accounts.caller_yt_dst.reload()?;
    let yt_before = ctx.accounts.caller_yt_dst.amount;

    let mut callback_accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.market.key(), false),
        AccountMeta::new(ctx.accounts.caller_sy_dst.key(), false),
        AccountMeta::new(ctx.accounts.caller_yt_dst.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint_sy.key(), false),
        AccountMeta::new(ctx.accounts.caller.key(), true),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
    ];
    let mut callback_infos = vec![
        ctx.accounts.market.to_account_info(),
        ctx.accounts.caller_sy_dst.to_account_info(),
        ctx.accounts.caller_yt_dst.to_account_info(),
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

    // Callback args: (sy_advanced: u64, yt_required: u64, data: Vec<u8>).
    let mut ix_data = Vec::with_capacity(8 + 8 + 8 + 4 + callback_data.len());
    ix_data.extend_from_slice(&callback_discriminator());
    ix_data.extend_from_slice(&sy_advance.to_le_bytes());
    ix_data.extend_from_slice(&yt_in.to_le_bytes());
    ix_data.extend_from_slice(&(callback_data.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&callback_data);

    let ix = Instruction {
        program_id: ctx.accounts.callback_program.key(),
        accounts: callback_accounts,
        data: ix_data,
    };
    invoke(&ix, &callback_infos)?;

    // --- Step 6: verify the callback delivered enough YT ---
    ctx.accounts.caller_yt_dst.reload()?;
    let yt_after = ctx.accounts.caller_yt_dst.amount;
    let yt_delta = yt_after
        .checked_sub(yt_before)
        .ok_or(ExponentCoreError::FlashYtCallbackUnderdelivered)?;
    require!(
        yt_delta >= yt_in,
        ExponentCoreError::FlashYtCallbackUnderdelivered
    );

    // --- Step 7: clear flash_pt_debt BEFORE the cascade ---
    // Inside the cascade, do_cpi_trade_pt CPIs trade_pt which re-checks
    // flash_pt_debt == 0. Clearing here is safe because the cascade runs
    // synchronously inside this handler — no external ix can interleave.
    ctx.accounts.market.flash_pt_debt = 0;
    {
        let info = ctx.accounts.market.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let mut writer: &mut [u8] = &mut data;
        ctx.accounts.market.try_serialize(&mut writer)?;
    }

    // --- Step 8: inline sell_yt cascade ---
    //   8a. borrow_pt(yt_in)           — market lends solver yt_in PT.
    let market_seeds = ctx.accounts.market.signer_seeds();
    let market_signer: &[&[&[u8]]] = &[&market_seeds];
    token_transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.borrow_pt_accounts(),
        )
        .with_signer(market_signer),
        yt_in,
    )?;

    //   8b. merge(yt_in)               — burn pt+yt → solver gets sy_recv SY.
    let sy_recv = do_cpi_merge(
        ctx.accounts.merge_accounts(),
        ctx.remaining_accounts,
        yt_in,
    )?
    .amount_sy_out;

    //   8c. flag the trade_pt CPI as a flash leg so its fee math matches
    //   sell_yt's regime. This flag is on `is_current_flash_swap`, NOT
    //   `flash_pt_debt`. Set + persist before the trade_pt CPI.
    ctx.accounts.market.is_current_flash_swap = true;
    ctx.accounts.market.exit(&crate::ID)?;

    //   8d. trade_pt(+yt_in PT, max_sy = -sy_recv).
    let sy_constraint: i64 = (sy_recv as i64).checked_neg().ok_or(ExponentCoreError::MathOverflow)?;
    let trade_evt = do_cpi_trade_pt(
        ctx.accounts.trade_pt_accounts(),
        ctx.remaining_accounts,
        yt_in.try_into().map_err(|_| ExponentCoreError::MathOverflow)?,
        sy_constraint,
    )?;
    let sy_spent = trade_evt
        .net_trader_sy
        .unsigned_abs() as u64;

    ctx.accounts.market.reload()?;
    ctx.accounts.market.is_current_flash_swap = false;

    //   8e. repay_pt(yt_in)            — solver returns the borrowed PT.
    token_transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.repay_pt_accounts(),
        ),
        yt_in,
    )?;

    // --- Step 9: net check — sy_recv must cover sy_advance + sy_spent +
    //                          treasury_fee. The fee was already applied
    //                          inside trade_pt (debited from sy_spent's
    //                          gross). Concretely: solver now holds
    //                          `sy_recv - sy_spent` SY (delta change in
    //                          their SY ATA from the cascade). They owe
    //                          `sy_advance` back to the market.
    let cascade_net: u64 = sy_recv
        .checked_sub(sy_spent)
        .ok_or(ExponentCoreError::FlashSellYtNetUnderwater)?;
    require!(
        cascade_net >= sy_advance,
        ExponentCoreError::FlashSellYtNetUnderwater
    );

    // --- Step 10: transfer sy_advance from solver.sy_ata back to
    //              market.escrow_sy. Surplus stays with the solver as
    //              profit. ---
    sy_transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.transfer_sy_repay_accounts(
                ctx.accounts.token_sy_escrow.to_account_info(),
            ),
        ),
        sy_advance,
        ctx.accounts.mint_sy.decimals,
    )?;

    // --- Step 11: deposit sy_advance back to the adapter pool. ---
    {
        let market_seeds = ctx.accounts.market.signer_seeds();
        let signer_seeds: &[&[&[u8]]] = &[&market_seeds];
        do_deposit_sy(
            &ctx.accounts.market.to_account_info(),
            sy_advance,
            &ctx.accounts.address_lookup_table,
            &ctx.accounts.market.cpi_accounts,
            &ctx.accounts.to_account_infos(),
            ctx.remaining_accounts,
            ctx.accounts.sy_program.key(),
            signer_seeds,
        )?;
    }
    ctx.accounts.market.reload()?;

    let event = FlashSellYtEvent {
        caller: ctx.accounts.caller.key(),
        market: ctx.accounts.market.key(),
        callback_program: ctx.accounts.callback_program.key(),
        yt_in,
        sy_advance,
        sy_recv_from_merge: sy_recv,
        sy_spent_buying_pt: sy_spent,
        sy_solver_profit: cascade_net.saturating_sub(sy_advance),
        sy_exchange_rate: sy_state.exchange_rate,
        timestamp: Clock::get()?.unix_timestamp,
    };
    emit_cpi!(event);
    Ok(event)
}

#[event]
pub struct FlashSellYtEvent {
    pub caller: Pubkey,
    pub market: Pubkey,
    pub callback_program: Pubkey,
    pub yt_in: u64,
    pub sy_advance: u64,
    pub sy_recv_from_merge: u64,
    pub sy_spent_buying_pt: u64,
    pub sy_solver_profit: u64,
    pub sy_exchange_rate: Number,
    pub timestamp: i64,
}

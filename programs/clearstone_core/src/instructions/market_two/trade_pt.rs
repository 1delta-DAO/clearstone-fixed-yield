use crate::{
    cpi_common::CpiAccounts,
    error::ExponentCoreError,
    state::MarketTwo,
    util::sy_transfer_checked,
    utils::{do_deposit_sy, do_get_sy_state, do_withdraw_sy},
    STATUS_CAN_BUY_PT, STATUS_CAN_SELL_PT,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount, TransferChecked},
};
use precise_number::Number;

#[event_cpi]
#[derive(Accounts)]
pub struct TradePt<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    // Every InterfaceAccount on this struct is `Box<>`ed — otherwise
    // Anchor's auto-generated `try_accounts` (which decodes + validates
    // every field in a single stack frame) lands at offset 4104 and
    // trips BPF's 4096-byte cap under nested-CPI call sites (see
    // curator::reallocate_to_market and router::wrapper_buy_pt).
    #[account(
        mut,
        has_one = address_lookup_table,
        has_one = sy_program,
        has_one = token_sy_escrow,
        has_one = token_pt_escrow,
        has_one = token_fee_treasury_sy,
        has_one = mint_sy,
    )]
    pub market: Box<Account<'info, MarketTwo>>,

    /// Trader's SY token account
    /// Mint is constrained by TokenProgram
    #[account(mut, token::mint = mint_sy)]
    pub token_sy_trader: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Receiving PT token account
    /// Mint is constrained by TokenProgram
    #[account(mut)]
    pub token_pt_trader: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Account owned by market
    /// This is a temporary account that receives SY tokens from the user, after which it transfers them to the SY program
    #[account(mut, token::mint = mint_sy)]
    pub token_sy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// PT liquidity account
    #[account(mut)]
    pub token_pt_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: constrained by market
    pub address_lookup_table: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    /// CHECK: constrain by market
    pub sy_program: UncheckedAccount<'info>,

    #[account(mut, token::mint = mint_sy)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SY mint — required for transfer_checked. Constrained via market.has_one.
    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,
}

impl<'i> TradePt<'i> {
    fn transfer_sy_accounts(&self, is_buy_pt: bool) -> TransferChecked<'i> {
        // If buying PT, the trader sends in SY
        // If selling PT, the market sends out SY
        if is_buy_pt {
            TransferChecked {
                from: self.token_sy_trader.to_account_info(),
                mint: self.mint_sy.to_account_info(),
                to: self.token_sy_escrow.to_account_info(),
                authority: self.trader.to_account_info(),
            }
        } else {
            TransferChecked {
                from: self.token_sy_escrow.to_account_info(),
                mint: self.mint_sy.to_account_info(),
                to: self.token_sy_trader.to_account_info(),
                authority: self.market.to_account_info(),
            }
        }
    }

    fn transfer_sy_fee_accounts(&self, is_buy_pt: bool) -> TransferChecked<'i> {
        if is_buy_pt {
            TransferChecked {
                from: self.token_sy_trader.to_account_info(),
                mint: self.mint_sy.to_account_info(),
                to: self.token_fee_treasury_sy.to_account_info(),
                authority: self.trader.to_account_info(),
            }
        } else {
            TransferChecked {
                from: self.token_sy_escrow.to_account_info(),
                mint: self.mint_sy.to_account_info(),
                to: self.token_fee_treasury_sy.to_account_info(),
                authority: self.market.to_account_info(),
            }
        }
    }

    fn transfer_sy_fee_context(
        &self,
        is_buy_pt: bool,
    ) -> CpiContext<'_, '_, '_, 'i, TransferChecked<'i>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            self.transfer_sy_fee_accounts(is_buy_pt),
        )
    }

    fn transfer_pt_accounts(&self, is_buy_pt: bool) -> anchor_spl::token_2022::Transfer<'i> {
        // if buying PT, the market sends out PT to trader
        // if selling PT, the trader sends in PT
        if is_buy_pt {
            anchor_spl::token_2022::Transfer {
                from: self.token_pt_escrow.to_account_info(),
                to: self.token_pt_trader.to_account_info(),
                authority: self.market.to_account_info(),
            }
        } else {
            anchor_spl::token_2022::Transfer {
                from: self.token_pt_trader.to_account_info(),
                to: self.token_pt_escrow.to_account_info(),
                authority: self.trader.to_account_info(),
            }
        }
    }

    fn transfer_sy_context(
        &self,
        is_buy_pt: bool,
    ) -> CpiContext<'_, '_, '_, 'i, TransferChecked<'i>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            self.transfer_sy_accounts(is_buy_pt),
        )
    }

    fn transfer_pt_context(
        &self,
        is_buy_pt: bool,
    ) -> CpiContext<'_, '_, '_, 'i, anchor_spl::token_2022::Transfer<'i>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            self.transfer_pt_accounts(is_buy_pt),
        )
    }

    fn do_transfer_pt(&self, amount: u64, is_buy_pt: bool) -> Result<()> {
        let ctx = self.transfer_pt_context(is_buy_pt);

        if is_buy_pt {
            // if buying PT, transfer from PT escrow to trader
            // sign with market
            crate::util::token_transfer(ctx.with_signer(&[&self.market.signer_seeds()]), amount)
        } else {
            crate::util::token_transfer(ctx, amount)
        }
    }

    pub fn validate(&self, net_trader_pt: i64) -> Result<()> {
        // I-F1: no market-mutating entrypoint may fire while a flash is open.
        require!(
            self.market.flash_pt_debt == 0,
            ExponentCoreError::NestedFlashBlocked
        );

        if net_trader_pt > 0 {
            require!(
                self.market.check_status_flags(STATUS_CAN_BUY_PT),
                ExponentCoreError::BuyingPtDisabled
            );
        } else {
            require!(
                self.market.check_status_flags(STATUS_CAN_SELL_PT),
                ExponentCoreError::SellingPtDisabled
            );
        };

        Ok(())
    }
}

#[access_control(ctx.accounts.validate(net_trader_pt))]
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, TradePt<'info>>,
    net_trader_pt: i64,
    sy_constraint: i64,
) -> Result<TradePtEvent> {
    let now = Clock::get()?.unix_timestamp as u64;
    assert!(ctx.accounts.market.is_active(now), "market is expired");

    let sy_state = do_get_sy_state(
        &ctx.accounts.market.to_account_info(),
        &ctx.accounts.address_lookup_table.to_account_info(),
        &ctx.accounts.market.cpi_accounts,
        ctx.remaining_accounts,
        ctx.accounts.sy_program.key(),
    )?;
    ctx.accounts.market.reload()?;
    // Markets don't track emissions after M4, so only validate exchange_rate here.
    require!(
        sy_state.exchange_rate > Number::ZERO,
        ExponentCoreError::SyInvalidExchangeRate
    );
    let sy_exchange_rate = sy_state.exchange_rate;

    let is_current_flash_swap = ctx.accounts.market.is_current_flash_swap;

    let treasury_fee_sy_bps = ctx.accounts.market.fee_treasury_sy_bps;
    let trade_result = ctx.accounts.market.financials.trade_pt(
        sy_exchange_rate,
        net_trader_pt,
        now,
        is_current_flash_swap,
        treasury_fee_sy_bps,
    );

    // sanity check
    // net_trader_sy and net_trader_pt must have opposite signs
    assert!(
        (net_trader_pt > 0 && trade_result.net_trader_sy < 0)
            || (net_trader_pt < 0 && trade_result.net_trader_sy > 0),
        "Invalid trade result -- SY change and PT change must have opposite signs"
    );

    // Slippage tolerance check -- handles both buying and selling PT
    // - If buying PT, then net_trader_sy is negative (SY goes from trader into the pool)
    //   The `sy_constraint` is a negative number, and represents the maximum amount of SY that can be spent in the trade.
    //   ie, the amount of SY leaving the trader must be greater than the constraint
    //
    // - If selling PT, then net_trader_sy is positive (SY goes out of the pool to the trader)
    //   The `sy_constraint` is a positive number, and represents the minimum amount of SY that can be received in the trade.
    assert!(
        trade_result.net_trader_sy >= sy_constraint,
        "Slippage exceeded for buying PT"
    );

    // if the trader is receiving PT, then the net PT is positive
    let is_buy_pt = net_trader_pt > 0;

    // Transfer PT between trader & market
    ctx.accounts
        .do_transfer_pt(trade_result.net_trader_pt.abs() as u64, is_buy_pt)?;

    // Flush post-trade market state before the next SY CPI so the guard
    // latch sees the up-to-date balances.
    {
        let market_info = ctx.accounts.market.to_account_info();
        let mut data = market_info.try_borrow_mut_data()?;
        let mut writer: &mut [u8] = &mut data;
        ctx.accounts.market.try_serialize(&mut writer)?;
    }

    // Transfer SY between trader & market & sy program (guarded).
    transfer_sy(
        is_buy_pt,
        trade_result.net_trader_sy.abs() as u64,
        &ctx.accounts.market.to_account_info(),
        &ctx.accounts.address_lookup_table,
        &ctx.accounts.market.cpi_accounts,
        &ctx.accounts.to_account_infos(),
        ctx.remaining_accounts,
        ctx.accounts.sy_program.key(),
        &[&ctx.accounts.market.signer_seeds()],
        ctx.accounts.transfer_sy_context(is_buy_pt),
        ctx.accounts.transfer_sy_fee_context(is_buy_pt),
        trade_result.treasury_fee_amount,
        ctx.accounts.mint_sy.decimals,
    )?;
    ctx.accounts.market.reload()?;

    let event = TradePtEvent {
        trader: ctx.accounts.trader.key(),
        market: ctx.accounts.market.key(),
        token_sy_trader: ctx.accounts.token_sy_trader.key(),
        token_pt_trader: ctx.accounts.token_pt_trader.key(),
        token_sy_escrow: ctx.accounts.token_sy_escrow.key(),
        token_pt_escrow: ctx.accounts.token_pt_escrow.key(),
        net_trader_pt: trade_result.net_trader_pt,
        net_trader_sy: trade_result.net_trader_sy,
        fee_sy: trade_result.sy_fee,
        sy_exchange_rate,
        timestamp: Clock::get()?.unix_timestamp,
    };

    emit_cpi!(event);

    Ok(event)
}

#[event]
pub struct TradePtEvent {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub token_sy_trader: Pubkey,
    pub token_pt_trader: Pubkey,
    pub token_sy_escrow: Pubkey,
    pub token_pt_escrow: Pubkey,
    pub net_trader_pt: i64,
    pub net_trader_sy: i64,
    pub fee_sy: u64,
    pub sy_exchange_rate: Number,
    pub timestamp: i64,
}

/// Transfer SY between SY Program & Market escrow & Trader
fn transfer_sy<'info>(
    is_buy_pt: bool,
    amount: u64,
    guard: &AccountInfo<'info>,
    alt: &AccountInfo<'info>,
    cpi_accounts: &CpiAccounts,
    regular_accounts: &[AccountInfo<'info>],
    rem_accounts: &[AccountInfo<'info>],
    sy_program: Pubkey,
    seeds: &[&[&[u8]]],
    token_transfer_ctx: CpiContext<'_, '_, '_, 'info, TransferChecked<'info>>,
    transfer_sy_fee_ctx: CpiContext<'_, '_, '_, 'info, TransferChecked<'info>>,
    treasury_fee_amount: u64,
    decimals: u8,
) -> Result<()> {
    if is_buy_pt {
        let amount_to_deposit = amount.checked_sub(treasury_fee_amount).unwrap();
        // First transfer SY from trader to escrow
        sy_transfer_checked(token_transfer_ctx, amount_to_deposit, decimals)?;
        // Then transfer SY from escrow to SY program
        do_deposit_sy(
            guard,
            amount_to_deposit,
            alt,
            cpi_accounts,
            regular_accounts,
            rem_accounts,
            sy_program,
            seeds,
        )?;

        // Transfer portion of the sy fee to the treasury
        sy_transfer_checked(transfer_sy_fee_ctx, treasury_fee_amount, decimals)?;
    } else {
        // First withdraw SY from SY program to escrow
        do_withdraw_sy(
            guard,
            amount.checked_add(treasury_fee_amount).unwrap(),
            alt,
            cpi_accounts,
            regular_accounts,
            rem_accounts,
            sy_program,
            seeds,
        )?;

        // Then transfer SY from escrow to trader
        sy_transfer_checked(token_transfer_ctx.with_signer(seeds), amount, decimals)?;

        // Transfer portion of the sy fee to the treasury
        sy_transfer_checked(
            transfer_sy_fee_ctx.with_signer(seeds),
            treasury_fee_amount,
            decimals,
        )?;
    };

    Ok(())
}


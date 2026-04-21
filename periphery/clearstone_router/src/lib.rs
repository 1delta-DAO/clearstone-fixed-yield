// Clearstone Router — base-asset UX over clearstone_core.
//
// Each wrapper composes adapter.mint_sy → core.X or core.X → adapter.redeem_sy
// so end users never have to hold the SY mint directly. All 12 wrappers
// land here; see the #[program] block below for the dispatch table.
//
// Template (shared by every wrapper):
//   1. outer Accounts struct = union of inner-ix accounts, dedup'd on
//      shared pubkeys (user, token_program, sy_program, core_program,
//      sy_mint, base_mint, core_event_authority).
//   2. handler stitches CPIs in order; any account extras the inner SY CPI
//      needs (the adapter's sy_market etc.) are forwarded through
//      `ctx.remaining_accounts` — the caller bakes them in per their
//      vault/market's CpiAccounts vector.
//
// Return-data note: when two CPIs in the same tx both set program return
// data, only the last one's is visible to the caller. Wrappers that need
// intermediate values (like `wrapper_strip` reading mint_sy's sy_out)
// capture the return data between CPIs.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::get_return_data;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount};
use clearstone_core::program::ClearstoneCore;
use clearstone_core::state::Vault;
use generic_exchange_rate_sy::program::GenericExchangeRateSy;

declare_id!("DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW");

#[program]
pub mod clearstone_router {
    use super::*;

    /// Base → PT + YT via (adapter.mint_sy → core.strip).
    pub fn wrapper_strip<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperStrip<'info>>,
        amount_base: u64,
    ) -> Result<()> {
        // Step 1: mint SY on the adapter.
        let mint_accounts = generic_exchange_rate_sy::cpi::accounts::MintSy {
            owner: ctx.accounts.user.to_account_info(),
            sy_market: ctx.accounts.sy_market.to_account_info(),
            base_mint: ctx.accounts.base_mint.to_account_info(),
            sy_mint: ctx.accounts.sy_mint.to_account_info(),
            base_src: ctx.accounts.base_src.to_account_info(),
            base_vault: ctx.accounts.base_vault.to_account_info(),
            sy_dst: ctx.accounts.sy_src.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        generic_exchange_rate_sy::cpi::mint_sy(
            CpiContext::new(
                ctx.accounts.sy_program.to_account_info(),
                mint_accounts,
            ),
            amount_base,
        )?;

        // Read sy_out from mint_sy's return data. This is the amount to strip.
        let sy_amount = {
            let (_prog, data) =
                get_return_data().ok_or(RouterError::MissingReturnData)?;
            // Borsh-decode a MintSyReturnData: { sy_out_amount: u64, exchange_rate: Number }
            // We only need the first 8 bytes (u64 little-endian).
            if data.len() < 8 {
                return Err(RouterError::MissingReturnData.into());
            }
            u64::from_le_bytes(data[..8].try_into().unwrap())
        };

        // Step 2: strip on core — SY → PT + YT.
        let strip_accounts = clearstone_core::cpi::accounts::Strip {
            depositor: ctx.accounts.user.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            sy_src: ctx.accounts.sy_src.to_account_info(),
            escrow_sy: ctx.accounts.escrow_sy.to_account_info(),
            yt_dst: ctx.accounts.yt_dst.to_account_info(),
            pt_dst: ctx.accounts.pt_dst.to_account_info(),
            mint_yt: ctx.accounts.mint_yt.to_account_info(),
            mint_pt: ctx.accounts.mint_pt.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            yield_position: ctx.accounts.yield_position.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::strip(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                strip_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            sy_amount,
        )?;

        Ok(())
    }

    /// PT + YT → base via (core.merge → adapter.redeem_sy).
    pub fn wrapper_merge<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperMerge<'info>>,
        amount_py: u64,
    ) -> Result<()> {
        // Step 1: merge on core — PT + YT → SY (lands in sy_dst which is
        // the user's SY ATA we'll then redeem).
        let merge_accounts = clearstone_core::cpi::accounts::Merge {
            owner: ctx.accounts.user.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            sy_dst: ctx.accounts.sy_src.to_account_info(),
            escrow_sy: ctx.accounts.escrow_sy.to_account_info(),
            yt_src: ctx.accounts.yt_src.to_account_info(),
            pt_src: ctx.accounts.pt_src.to_account_info(),
            mint_yt: ctx.accounts.mint_yt.to_account_info(),
            mint_pt: ctx.accounts.mint_pt.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
            yield_position: ctx.accounts.yield_position.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::merge(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                merge_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            amount_py,
        )?;

        // Step 2: redeem SY to base. We redeem everything the user's
        // sy_src currently holds — simpler UX than tracking the exact
        // SY output of merge (which depends on post-maturity math).
        //
        // Caller can bypass this path (e.g. for partial redeems) by
        // calling core.merge directly.
        ctx.accounts.sy_src.reload()?;
        let sy_bal = ctx.accounts.sy_src.amount;

        let redeem_accounts = generic_exchange_rate_sy::cpi::accounts::RedeemSy {
            owner: ctx.accounts.user.to_account_info(),
            sy_market: ctx.accounts.sy_market.to_account_info(),
            base_mint: ctx.accounts.base_mint.to_account_info(),
            sy_mint: ctx.accounts.sy_mint.to_account_info(),
            sy_src: ctx.accounts.sy_src.to_account_info(),
            base_vault: ctx.accounts.base_vault.to_account_info(),
            base_dst: ctx.accounts.base_dst.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        generic_exchange_rate_sy::cpi::redeem_sy(
            CpiContext::new(
                ctx.accounts.sy_program.to_account_info(),
                redeem_accounts,
            ),
            sy_bal,
        )?;

        Ok(())
    }

    /// Base → PT via (adapter.mint_sy → core.trade_pt buy).
    ///
    /// Caller specifies the exact PT out they want (`pt_amount`) and
    /// their maximum base spend. The wrapper mints enough SY to cover
    /// and trades SY → PT. Leftover SY stays in the user's SY ATA.
    pub fn wrapper_buy_pt<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperBuyPt<'info>>,
        pt_amount: u64,
        max_base: u64,
        max_sy_in: i64,
    ) -> Result<()> {
        // Step 1: mint SY with the full max_base — overestimates, leftover
        // is returned by the trade path (SY stays in user's sy ata).
        let mint_accounts = generic_exchange_rate_sy::cpi::accounts::MintSy {
            owner: ctx.accounts.user.to_account_info(),
            sy_market: ctx.accounts.sy_market.to_account_info(),
            base_mint: ctx.accounts.base_mint.to_account_info(),
            sy_mint: ctx.accounts.sy_mint.to_account_info(),
            base_src: ctx.accounts.base_src.to_account_info(),
            base_vault: ctx.accounts.base_vault.to_account_info(),
            sy_dst: ctx.accounts.sy_src.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        generic_exchange_rate_sy::cpi::mint_sy(
            CpiContext::new(
                ctx.accounts.sy_program.to_account_info(),
                mint_accounts,
            ),
            max_base,
        )?;

        // Step 2: trade_pt — positive net_trader_pt = buying PT,
        // consuming SY. The slippage bound `max_sy_in` is negative
        // (SY leaves the user when buying PT).
        let trade_accounts = clearstone_core::cpi::accounts::TradePt {
            trader: ctx.accounts.user.to_account_info(),
            market: ctx.accounts.market.to_account_info(),
            token_sy_trader: ctx.accounts.sy_src.to_account_info(),
            token_pt_trader: ctx.accounts.pt_dst.to_account_info(),
            token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
            token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
            address_lookup_table: ctx.accounts.market_alt.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::trade_pt(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                trade_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            pt_amount as i64,
            max_sy_in,
        )?;

        Ok(())
    }

    /// PT → base via (core.trade_pt sell → adapter.redeem_sy).
    /// `pt_amount` is the PT the trader is selling (positive). The
    /// resulting SY lands in the user's SY ATA and is immediately
    /// redeemed to base. `min_sy_out` gates the trade_pt slippage (SY
    /// enters the user, so it's positive).
    pub fn wrapper_sell_pt<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperSellPt<'info>>,
        pt_amount: u64,
        min_sy_out: i64,
    ) -> Result<()> {
        let trade_accounts = clearstone_core::cpi::accounts::TradePt {
            trader: ctx.accounts.user.to_account_info(),
            market: ctx.accounts.market.to_account_info(),
            token_sy_trader: ctx.accounts.sy_src.to_account_info(),
            token_pt_trader: ctx.accounts.pt_src.to_account_info(),
            token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
            token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
            address_lookup_table: ctx.accounts.market_alt.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::trade_pt(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                trade_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            -(pt_amount as i64),
            min_sy_out,
        )?;

        ctx.accounts.sy_src.reload()?;
        let sy_bal = ctx.accounts.sy_src.amount;
        redeem_sy_cpi(
            ctx.accounts.sy_program.to_account_info(),
            ctx.accounts.sy_market.to_account_info(),
            ctx.accounts.base_mint.to_account_info(),
            ctx.accounts.sy_mint.to_account_info(),
            ctx.accounts.sy_src.to_account_info(),
            ctx.accounts.base_vault.to_account_info(),
            ctx.accounts.base_dst.to_account_info(),
            ctx.accounts.user.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            sy_bal,
        )?;
        Ok(())
    }

    /// Base → YT via (adapter.mint_sy → core.buy_yt).
    /// `sy_in` is how much SY to spend on YT; `yt_out` is the exact YT
    /// the trader expects. core.buy_yt is a self-CPI cascade so the outer
    /// accounts must include every account `strip` + `trade_pt` touch.
    pub fn wrapper_buy_yt<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperBuyYt<'info>>,
        base_in: u64,
        sy_in: u64,
        yt_out: u64,
    ) -> Result<()> {
        let mint_accounts = generic_exchange_rate_sy::cpi::accounts::MintSy {
            owner: ctx.accounts.user.to_account_info(),
            sy_market: ctx.accounts.sy_market.to_account_info(),
            base_mint: ctx.accounts.base_mint.to_account_info(),
            sy_mint: ctx.accounts.sy_mint.to_account_info(),
            base_src: ctx.accounts.base_src.to_account_info(),
            base_vault: ctx.accounts.base_vault.to_account_info(),
            sy_dst: ctx.accounts.sy_src.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        generic_exchange_rate_sy::cpi::mint_sy(
            CpiContext::new(
                ctx.accounts.sy_program.to_account_info(),
                mint_accounts,
            ),
            base_in,
        )?;

        let buy_yt_accounts = clearstone_core::cpi::accounts::BuyYt {
            trader: ctx.accounts.user.to_account_info(),
            market: ctx.accounts.market.to_account_info(),
            token_sy_trader: ctx.accounts.sy_src.to_account_info(),
            token_yt_trader: ctx.accounts.yt_dst.to_account_info(),
            token_pt_trader: ctx.accounts.pt_dst.to_account_info(),
            token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
            token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
            token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            address_lookup_table: ctx.accounts.market_alt.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            vault_authority: ctx.accounts.vault_authority.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            token_sy_escrow_vault: ctx.accounts.escrow_sy_vault.to_account_info(),
            mint_yt: ctx.accounts.mint_yt.to_account_info(),
            mint_pt: ctx.accounts.mint_pt.to_account_info(),
            address_lookup_table_vault: ctx.accounts.vault_alt.to_account_info(),
            yield_position: ctx.accounts.yield_position.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::buy_yt(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                buy_yt_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            sy_in,
            yt_out,
        )?;

        Ok(())
    }

    /// YT → base via (core.sell_yt → adapter.redeem_sy). `yt_in` is what
    /// the user is selling; `min_sy_out` is the slippage floor.
    pub fn wrapper_sell_yt<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperSellYt<'info>>,
        yt_in: u64,
        min_sy_out: u64,
    ) -> Result<()> {
        let sell_yt_accounts = clearstone_core::cpi::accounts::SellYt {
            trader: ctx.accounts.user.to_account_info(),
            market: ctx.accounts.market.to_account_info(),
            token_yt_trader: ctx.accounts.yt_src.to_account_info(),
            token_pt_trader: ctx.accounts.pt_src.to_account_info(),
            token_sy_trader: ctx.accounts.sy_src.to_account_info(),
            token_sy_escrow: ctx.accounts.market_escrow_sy.to_account_info(),
            token_pt_escrow: ctx.accounts.market_escrow_pt.to_account_info(),
            address_lookup_table: ctx.accounts.market_alt.to_account_info(),
            token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            authority_vault: ctx.accounts.vault_authority.to_account_info(),
            token_sy_escrow_vault: ctx.accounts.escrow_sy_vault.to_account_info(),
            mint_yt: ctx.accounts.mint_yt.to_account_info(),
            mint_pt: ctx.accounts.mint_pt.to_account_info(),
            address_lookup_table_vault: ctx.accounts.vault_alt.to_account_info(),
            yield_position_vault: ctx.accounts.yield_position.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::sell_yt(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                sell_yt_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            yt_in,
            min_sy_out,
        )?;

        ctx.accounts.sy_src.reload()?;
        let sy_bal = ctx.accounts.sy_src.amount;
        redeem_sy_cpi(
            ctx.accounts.sy_program.to_account_info(),
            ctx.accounts.sy_market.to_account_info(),
            ctx.accounts.base_mint.to_account_info(),
            ctx.accounts.sy_mint.to_account_info(),
            ctx.accounts.sy_src.to_account_info(),
            ctx.accounts.base_vault.to_account_info(),
            ctx.accounts.base_dst.to_account_info(),
            ctx.accounts.user.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            sy_bal,
        )?;
        Ok(())
    }

    /// collect_interest on vault → adapter.redeem_sy. The interest ix
    /// drops SY into `token_sy_dst`; we then redeem whatever lands there
    /// to base.
    pub fn wrapper_collect_interest<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperCollectInterest<'info>>,
        amount: amount_value::Amount,
    ) -> Result<()> {
        let collect_accounts = clearstone_core::cpi::accounts::CollectInterest {
            owner: ctx.accounts.user.to_account_info(),
            yield_position: ctx.accounts.yield_position.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            token_sy_dst: ctx.accounts.sy_src.to_account_info(),
            escrow_sy: ctx.accounts.escrow_sy.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            treasury_sy_token_account: ctx.accounts.treasury_sy_token_account.to_account_info(),
            address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::collect_interest(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                collect_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            amount,
        )?;

        ctx.accounts.sy_src.reload()?;
        let sy_bal = ctx.accounts.sy_src.amount;
        redeem_sy_cpi(
            ctx.accounts.sy_program.to_account_info(),
            ctx.accounts.sy_market.to_account_info(),
            ctx.accounts.base_mint.to_account_info(),
            ctx.accounts.sy_mint.to_account_info(),
            ctx.accounts.sy_src.to_account_info(),
            ctx.accounts.base_vault.to_account_info(),
            ctx.accounts.base_dst.to_account_info(),
            ctx.accounts.user.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            sy_bal,
        )?;
        Ok(())
    }

    /// Base + PT → LP via (adapter.mint_sy → core.market_two_deposit_liquidity).
    /// User supplies base (converted to SY inside) + pre-held PT; the two
    /// are deposited pro-rata for LP.
    pub fn wrapper_provide_liquidity<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperProvideLiquidity<'info>>,
        base_in: u64,
        pt_intent: u64,
        sy_intent: u64,
        min_lp_out: u64,
    ) -> Result<()> {
        let mint_accounts = generic_exchange_rate_sy::cpi::accounts::MintSy {
            owner: ctx.accounts.user.to_account_info(),
            sy_market: ctx.accounts.sy_market.to_account_info(),
            base_mint: ctx.accounts.base_mint.to_account_info(),
            sy_mint: ctx.accounts.sy_mint.to_account_info(),
            base_src: ctx.accounts.base_src.to_account_info(),
            base_vault: ctx.accounts.base_vault.to_account_info(),
            sy_dst: ctx.accounts.sy_src.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        generic_exchange_rate_sy::cpi::mint_sy(
            CpiContext::new(
                ctx.accounts.sy_program.to_account_info(),
                mint_accounts,
            ),
            base_in,
        )?;

        deposit_liquidity_cpi(&ctx, pt_intent, sy_intent, min_lp_out)
    }

    /// PT + SY → LP passthrough. Spares the caller the Anchor-IDL gymnastics
    /// of building the DepositLiquidity accounts list when they're already
    /// holding SY directly.
    pub fn wrapper_provide_liquidity_classic<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperProvideLiquidity<'info>>,
        pt_intent: u64,
        sy_intent: u64,
        min_lp_out: u64,
    ) -> Result<()> {
        deposit_liquidity_cpi(&ctx, pt_intent, sy_intent, min_lp_out)
    }

    /// Base → LP via (adapter.mint_sy → core.trade_pt buy → deposit_liquidity).
    /// Exchanges all base for SY, trades `pt_intent` worth of SY for PT,
    /// deposits the resulting PT + remaining SY.  Caller supplies a
    /// slippage bound on the SY-in leg (`max_sy_in` is negative).
    pub fn wrapper_provide_liquidity_base<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperProvideLiquidityBase<'info>>,
        base_in: u64,
        pt_intent: u64,
        max_sy_in: i64,
        sy_intent: u64,
        min_lp_out: u64,
    ) -> Result<()> {
        let mint_accounts = generic_exchange_rate_sy::cpi::accounts::MintSy {
            owner: ctx.accounts.user.to_account_info(),
            sy_market: ctx.accounts.sy_market.to_account_info(),
            base_mint: ctx.accounts.base_mint.to_account_info(),
            sy_mint: ctx.accounts.sy_mint.to_account_info(),
            base_src: ctx.accounts.base_src.to_account_info(),
            base_vault: ctx.accounts.base_vault.to_account_info(),
            sy_dst: ctx.accounts.sy_src.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        generic_exchange_rate_sy::cpi::mint_sy(
            CpiContext::new(
                ctx.accounts.sy_program.to_account_info(),
                mint_accounts,
            ),
            base_in,
        )?;

        let trade_accounts = clearstone_core::cpi::accounts::TradePt {
            trader: ctx.accounts.user.to_account_info(),
            market: ctx.accounts.market.to_account_info(),
            token_sy_trader: ctx.accounts.sy_src.to_account_info(),
            token_pt_trader: ctx.accounts.pt_src.to_account_info(),
            token_sy_escrow: ctx.accounts.escrow_sy.to_account_info(),
            token_pt_escrow: ctx.accounts.escrow_pt.to_account_info(),
            address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            token_fee_treasury_sy: ctx.accounts.token_fee_treasury_sy.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::trade_pt(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                trade_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            pt_intent as i64,
            max_sy_in,
        )?;

        let deposit_accounts = clearstone_core::cpi::accounts::DepositLiquidity {
            depositor: ctx.accounts.user.to_account_info(),
            market: ctx.accounts.market.to_account_info(),
            token_pt_src: ctx.accounts.pt_src.to_account_info(),
            token_sy_src: ctx.accounts.sy_src.to_account_info(),
            token_pt_escrow: ctx.accounts.escrow_pt.to_account_info(),
            token_sy_escrow: ctx.accounts.escrow_sy.to_account_info(),
            token_lp_dst: ctx.accounts.lp_dst.to_account_info(),
            mint_lp: ctx.accounts.mint_lp.to_account_info(),
            address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            sy_program: ctx.accounts.sy_program.to_account_info(),
            event_authority: ctx.accounts.core_event_authority.to_account_info(),
            program: ctx.accounts.core_program.to_account_info(),
        };
        clearstone_core::cpi::market_two_deposit_liquidity(
            CpiContext::new(
                ctx.accounts.core_program.to_account_info(),
                deposit_accounts,
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            pt_intent,
            sy_intent,
            min_lp_out,
        )?;

        Ok(())
    }

    /// LP → base + PT. Withdraws liquidity, then redeems the SY leg
    /// to base. PT is returned to the user.
    pub fn wrapper_withdraw_liquidity<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperWithdrawLiquidity<'info>>,
        lp_in: u64,
        min_pt_out: u64,
        min_sy_out: u64,
    ) -> Result<()> {
        withdraw_liquidity_cpi(&ctx, lp_in, min_pt_out, min_sy_out)?;
        ctx.accounts.sy_src.reload()?;
        let sy_bal = ctx.accounts.sy_src.amount;
        redeem_sy_cpi(
            ctx.accounts.sy_program.to_account_info(),
            ctx.accounts.sy_market.to_account_info(),
            ctx.accounts.base_mint.to_account_info(),
            ctx.accounts.sy_mint.to_account_info(),
            ctx.accounts.sy_src.to_account_info(),
            ctx.accounts.base_vault.to_account_info(),
            ctx.accounts.base_dst.to_account_info(),
            ctx.accounts.user.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            sy_bal,
        )?;
        Ok(())
    }

    /// LP → PT + SY passthrough. Same call as core.market_two_withdraw_liquidity
    /// but signed through the router (useful when paired with other
    /// router-only ops in a batch).
    pub fn wrapper_withdraw_liquidity_classic<'info>(
        ctx: Context<'_, '_, '_, 'info, WrapperWithdrawLiquidity<'info>>,
        lp_in: u64,
        min_pt_out: u64,
        min_sy_out: u64,
    ) -> Result<()> {
        withdraw_liquidity_cpi(&ctx, lp_in, min_pt_out, min_sy_out)
    }
}

// ---------- CPI helpers ----------

/// Redeem `amount_sy` from the user's sy_src to base_dst. Every wrapper
/// that ends with a SY → base leg calls into this; callers supply the
/// AccountInfos directly so we don't have to thread a carrier struct.
fn redeem_sy_cpi<'info>(
    sy_program: AccountInfo<'info>,
    sy_market: AccountInfo<'info>,
    base_mint: AccountInfo<'info>,
    sy_mint: AccountInfo<'info>,
    sy_src: AccountInfo<'info>,
    base_vault: AccountInfo<'info>,
    base_dst: AccountInfo<'info>,
    user: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    amount_sy: u64,
) -> Result<()> {
    let redeem_accounts = generic_exchange_rate_sy::cpi::accounts::RedeemSy {
        owner: user,
        sy_market,
        base_mint,
        sy_mint,
        sy_src,
        base_vault,
        base_dst,
        token_program,
    };
    generic_exchange_rate_sy::cpi::redeem_sy(
        CpiContext::new(sy_program, redeem_accounts),
        amount_sy,
    )?;
    Ok(())
}

fn deposit_liquidity_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, WrapperProvideLiquidity<'info>>,
    pt_intent: u64,
    sy_intent: u64,
    min_lp_out: u64,
) -> Result<()> {
    let deposit_accounts = clearstone_core::cpi::accounts::DepositLiquidity {
        depositor: ctx.accounts.user.to_account_info(),
        market: ctx.accounts.market.to_account_info(),
        token_pt_src: ctx.accounts.pt_src.to_account_info(),
        token_sy_src: ctx.accounts.sy_src.to_account_info(),
        token_pt_escrow: ctx.accounts.escrow_pt.to_account_info(),
        token_sy_escrow: ctx.accounts.escrow_sy.to_account_info(),
        token_lp_dst: ctx.accounts.lp_dst.to_account_info(),
        mint_lp: ctx.accounts.mint_lp.to_account_info(),
        address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        sy_program: ctx.accounts.sy_program.to_account_info(),
        event_authority: ctx.accounts.core_event_authority.to_account_info(),
        program: ctx.accounts.core_program.to_account_info(),
    };
    clearstone_core::cpi::market_two_deposit_liquidity(
        CpiContext::new(
            ctx.accounts.core_program.to_account_info(),
            deposit_accounts,
        )
        .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
        pt_intent,
        sy_intent,
        min_lp_out,
    )?;
    Ok(())
}

fn withdraw_liquidity_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, WrapperWithdrawLiquidity<'info>>,
    lp_in: u64,
    min_pt_out: u64,
    min_sy_out: u64,
) -> Result<()> {
    let withdraw_accounts = clearstone_core::cpi::accounts::WithdrawLiquidity {
        withdrawer: ctx.accounts.user.to_account_info(),
        market: ctx.accounts.market.to_account_info(),
        token_pt_dst: ctx.accounts.pt_dst.to_account_info(),
        token_sy_dst: ctx.accounts.sy_src.to_account_info(),
        token_pt_escrow: ctx.accounts.escrow_pt.to_account_info(),
        token_sy_escrow: ctx.accounts.escrow_sy.to_account_info(),
        token_lp_src: ctx.accounts.lp_src.to_account_info(),
        mint_lp: ctx.accounts.mint_lp.to_account_info(),
        address_lookup_table: ctx.accounts.address_lookup_table.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        sy_program: ctx.accounts.sy_program.to_account_info(),
        event_authority: ctx.accounts.core_event_authority.to_account_info(),
        program: ctx.accounts.core_program.to_account_info(),
    };
    clearstone_core::cpi::market_two_withdraw_liquidity(
        CpiContext::new(
            ctx.accounts.core_program.to_account_info(),
            withdraw_accounts,
        )
        .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
        lp_in,
        min_pt_out,
        min_sy_out,
    )?;
    Ok(())
}

// ---------- Accounts ----------

#[derive(Accounts)]
pub struct WrapperStrip<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // adapter accounts (mint_sy)
    /// CHECK: validated by the adapter CPI.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = user)]
    pub base_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // core.strip accounts
    /// CHECK: validated by core via vault.has_one.
    #[account(mut)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, token::mint = sy_mint)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub yt_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub mint_yt: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub mint_pt: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    /// CHECK: constrained by vault.
    pub address_lookup_table: UncheckedAccount<'info>,

    // program accounts
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,

    /// CHECK: constrained by core.vault via has_one.
    #[account(mut)]
    pub yield_position: UncheckedAccount<'info>,

    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WrapperMerge<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // adapter (redeem_sy)
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint)]
    pub base_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // core.merge
    /// CHECK: validated by core.
    #[account(mut)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, token::mint = sy_mint, token::authority = user)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub yt_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pt_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub mint_yt: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub mint_pt: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    /// CHECK: constrained by vault.
    pub address_lookup_table: UncheckedAccount<'info>,

    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,

    /// CHECK: constrained by core.vault via has_one.
    #[account(mut)]
    pub yield_position: UncheckedAccount<'info>,

    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WrapperBuyPt<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // adapter (mint_sy)
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = user)]
    pub base_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // core.trade_pt
    /// CHECK: validated by core.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(mut, token::mint = sy_mint, token::authority = user)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: constrained by market.
    pub market_alt: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,

    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WrapperSellPt<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // core.trade_pt
    /// CHECK: validated by core.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(mut, token::mint = sy_mint, token::authority = user)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::authority = user)]
    pub pt_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: constrained by market.
    pub market_alt: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    // adapter.redeem_sy
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint)]
    pub base_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,

    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WrapperBuyYt<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // adapter.mint_sy
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = user)]
    pub base_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // core.buy_yt (including its internal self-CPI to strip)
    /// CHECK: validated by core.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(mut, token::mint = sy_mint)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub yt_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: constrained by market.
    pub market_alt: UncheckedAccount<'info>,

    // strip-cascade accounts
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: constrained by core.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub escrow_sy_vault: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub mint_yt: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub mint_pt: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    pub vault_alt: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub yield_position: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WrapperSellYt<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // core.sell_yt (self-CPIs to merge)
    /// CHECK: validated by core.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(mut, token::authority = user)]
    pub yt_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::authority = user)]
    pub pt_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = sy_mint)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub market_escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: constrained by market.
    pub market_alt: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    // merge-cascade accounts
    /// CHECK: constrained by core.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub escrow_sy_vault: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub mint_yt: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub mint_pt: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    pub vault_alt: UncheckedAccount<'info>,
    /// CHECK: constrained by vault.
    #[account(mut)]
    pub yield_position: UncheckedAccount<'info>,

    // adapter.redeem_sy
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint)]
    pub base_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WrapperCollectInterest<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // core.collect_interest
    /// CHECK: constrained by core.
    #[account(mut)]
    pub yield_position: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, token::mint = sy_mint, token::authority = user)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: vault-authority PDA.
    #[account(mut)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub treasury_sy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: constrained by vault.
    pub address_lookup_table: UncheckedAccount<'info>,

    // adapter.redeem_sy
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint)]
    pub base_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

/// Shared accounts for both `wrapper_provide_liquidity` (has mint_sy)
/// and `wrapper_provide_liquidity_classic` (pure passthrough). The
/// adapter fields are unused for the classic path but must remain on
/// the struct so the IDL stays stable and both dispatch targets share
/// one account layout.
#[derive(Accounts)]
pub struct WrapperProvideLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // adapter.mint_sy (unused for classic)
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = user)]
    pub base_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // core.deposit_liquidity
    /// CHECK: validated by core.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(mut, token::authority = user)]
    pub pt_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = sy_mint)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub lp_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub mint_lp: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: constrained by market.
    pub address_lookup_table: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

/// Base-only provide-liquidity: user holds no PT, router mints SY,
/// trades some for PT, deposits. Requires all accounts from
/// WrapperProvideLiquidity plus the fee treasury for the trade leg.
#[derive(Accounts)]
pub struct WrapperProvideLiquidityBase<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = user)]
    pub base_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by core.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(mut)]
    pub pt_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = sy_mint)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub lp_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub mint_lp: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: constrained by market.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_fee_treasury_sy: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

/// Shared accounts for `wrapper_withdraw_liquidity` and
/// `wrapper_withdraw_liquidity_classic`. The classic variant skips the
/// redeem_sy leg but the account set stays identical for IDL stability.
#[derive(Accounts)]
pub struct WrapperWithdrawLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // core.withdraw_liquidity
    /// CHECK: validated by core.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(mut)]
    pub pt_dst: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = sy_mint)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>, // sy_dst for withdraw
    #[account(mut)]
    pub escrow_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub escrow_sy: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::authority = user)]
    pub lp_src: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub mint_lp: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: constrained by market.
    pub address_lookup_table: UncheckedAccount<'info>,

    // adapter.redeem_sy (unused for classic)
    /// CHECK: validated by adapter.
    pub sy_market: UncheckedAccount<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint)]
    pub base_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub sy_program: Program<'info, GenericExchangeRateSy>,
    pub core_program: Program<'info, ClearstoneCore>,
    /// CHECK: core_program's event_authority PDA.
    pub core_event_authority: UncheckedAccount<'info>,
}

// ---------- Errors ----------

#[error_code]
pub enum RouterError {
    #[msg("Missing return data from inner CPI")]
    MissingReturnData,
}

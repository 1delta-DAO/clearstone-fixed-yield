// Clearstone Router — base-asset UX over clearstone_core.
//
// Each wrapper here composes: adapter.mint_sy → core.{strip, trade_pt}
// or core.{merge, trade_pt} → adapter.redeem_sy, so end users never
// have to hold the SY mint directly.
//
// This scaffold lands three representative wrappers that exercise both
// directions (base → PT, PT → base, base → PT via trade). The other 9
// wrappers from upstream Exponent follow the same pattern:
//
//   wrapper_provide_liquidity           — base → SY → deposit_liquidity
//   wrapper_sell_pt                     — PT → trade_pt → redeem_sy
//   wrapper_buy_yt                      — base → mint_sy → buy_yt
//   wrapper_sell_yt                     — YT → sell_yt → redeem_sy
//   wrapper_collect_interest            — collect_interest → redeem_sy
//   wrapper_withdraw_liquidity          — withdraw_liquidity → redeem_sy
//   wrapper_withdraw_liquidity_classic  — as above, PT kept separately
//   wrapper_provide_liquidity_base      — buy_pt + deposit_liquidity
//   wrapper_provide_liquidity_classic   — as above, deposit PT + SY separately
//
// Each follows: outer Accounts struct = union of inner-ix accounts;
// handler stitches CPIs with `with_remaining_accounts`. See the three
// below for the template.

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

// ---------- Errors ----------

#[error_code]
pub enum RouterError {
    #[msg("Missing return data from inner CPI")]
    MissingReturnData,
}

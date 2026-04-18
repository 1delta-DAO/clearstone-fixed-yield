use anchor_lang::prelude::*;
pub mod constants;
pub mod error;
mod instructions;
pub mod reentrancy;
pub mod seeds;
pub mod state;
pub mod utils;
use amount_value::Amount;
use cpi_common::CpiAccounts;
use instructions::*;
use precise_number::Number;
#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;
pub use state::*;

#[cfg(all(not(feature = "idl-build"), not(test)))]
mod allocator;

declare_id!("EKpLcVc6rky1ah28NMZFoT2oSXkAKWcEsr6nbZziTWbC");

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Clearstone Fixed Yield (Exponent Core fork)",
    project_url: "https://github.com/1delta-DAO/clearstone-fixed-yield",
    contacts: "email:security@1delta.io",
    policy: "https://github.com/1delta-DAO/clearstone-fixed-yield/blob/main/SECURITY.md",
    preferred_languages: "en",
    auditors: "Not yet audited",
    acknowledgements: "Derived from Exponent Core (BUSL-1.1). Upstream audits do not transfer."
}

#[program]
pub mod clearstone_core {

    use super::*;

    /// Permissionless vault init. Creator supplies the curator pubkey —
    /// that pubkey controls all future modify_* instructions for this vault.
    /// `creator_fee_bps` is the permanent upper bound on `interest_bps_fee`
    /// (capped by `PROTOCOL_FEE_MAX_BPS` — see I-E1 / I-E2).
    #[instruction(discriminator = [2])]
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        start_timestamp: u32,
        duration: u32,
        interest_bps_fee: u16,
        cpi_accounts: CpiAccounts,
        min_op_size_strip: u64,
        min_op_size_merge: u64,
        pt_metadata_name: String,
        pt_metadata_symbol: String,
        pt_metadata_uri: String,
        curator: Pubkey,
        creator_fee_bps: u16,
        max_py_supply: u64,
    ) -> Result<()> {
        initialize_vault::handler(
            ctx,
            start_timestamp,
            duration,
            interest_bps_fee,
            cpi_accounts,
            min_op_size_strip,
            min_op_size_merge,
            pt_metadata_name,
            pt_metadata_symbol,
            pt_metadata_uri,
            curator,
            creator_fee_bps,
            max_py_supply,
        )
    }

    #[instruction(discriminator = [3])]
    pub fn initialize_yield_position(
        ctx: Context<InitializeYieldPosition>,
    ) -> Result<InitializeYieldPositionEvent> {
        initialize_yield_position::handler(ctx)
    }

    /// Strip SY into PT + YT
    #[instruction(discriminator = [4])]
    pub fn strip<'info>(
        ctx: Context<'_, '_, '_, 'info, Strip<'info>>,
        amount: u64,
    ) -> Result<StripEvent> {
        strip::handler(ctx, amount)
    }

    /// Merge PT + YT into SY
    /// Redeems & burns them, in exchange for SY
    #[instruction(discriminator = [5])]
    pub fn merge<'info>(
        ctx: Context<'_, '_, '_, 'info, Merge<'info>>,
        amount: u64,
    ) -> Result<MergeEvent> {
        merge::handler(ctx, amount)
    }

    #[instruction(discriminator = [6])]
    pub fn collect_interest<'info>(
        ctx: Context<'_, '_, '_, 'info, CollectInterest<'info>>,
        amount: Amount,
    ) -> Result<CollectInterestEventV2> {
        collect_interest::handler(ctx, amount)
    }

    /// Deposit YT into escrow in order to earn rewards & SY interest
    #[instruction(discriminator = [7])]
    pub fn deposit_yt(ctx: Context<DepositYt>, amount: u64) -> Result<DepositYtEventV2> {
        deposit_yt::handler(ctx, amount)
    }

    #[instruction(discriminator = [8])]
    pub fn withdraw_yt(ctx: Context<WithdrawYt>, amount: u64) -> Result<WithdrawYtEventV2> {
        withdraw_yt::handler(ctx, amount)
    }

    #[instruction(discriminator = [9])]
    pub fn stage_yt_yield(ctx: Context<StageYield>) -> Result<StageYieldEventV2> {
        stage_yield::handler(ctx)
    }

    #[instruction(discriminator = [10])]
    pub fn init_market_two<'info>(
        ctx: Context<'_, '_, '_, 'info, MarketTwoInit<'info>>,
        ln_fee_rate_root: f64,
        rate_scalar_root: f64,
        init_rate_anchor: f64,
        sy_exchange_rate: Number,
        pt_init: u64,
        sy_init: u64,
        fee_treasury_sy_bps: u16,
        cpi_accounts: CpiAccounts,
        seed_id: u8,
        curator: Pubkey,
        creator_fee_bps: u16,
    ) -> Result<()> {
        market_two_init::handler(
            ctx,
            ln_fee_rate_root,
            rate_scalar_root,
            init_rate_anchor,
            sy_exchange_rate,
            pt_init,
            sy_init,
            fee_treasury_sy_bps,
            cpi_accounts,
            seed_id,
            curator,
            creator_fee_bps,
        )
    }

    #[instruction(discriminator = [11])]
    pub fn market_two_deposit_liquidity<'info>(
        ctx: Context<'_, '_, '_, 'info, DepositLiquidity<'info>>,
        pt_intent: u64,
        sy_intent: u64,
        min_lp_out: u64,
    ) -> Result<DepositLiquidityEvent> {
        instructions::market_two::deposit_liquidity::handler(ctx, pt_intent, sy_intent, min_lp_out)
    }

    #[instruction(discriminator = [12])]
    pub fn market_two_withdraw_liquidity<'info>(
        ctx: Context<'_, '_, '_, 'info, WithdrawLiquidity<'info>>,
        lp_in: u64,
        min_pt_out: u64,
        min_sy_out: u64,
    ) -> Result<WithdrawLiquidityEvent> {
        instructions::market_two::withdraw_liquidity::handler(ctx, lp_in, min_pt_out, min_sy_out)
    }

    #[instruction(discriminator = [17])]
    pub fn trade_pt<'info>(
        ctx: Context<'_, '_, '_, 'info, TradePt<'info>>,
        net_trader_pt: i64,
        sy_constraint: i64,
    ) -> Result<TradePtEvent> {
        instructions::market_two::trade_pt::handler(ctx, net_trader_pt, sy_constraint)
    }

    /// Sell YT for SY
    #[instruction(discriminator = [1])]
    pub fn sell_yt<'i>(
        ctx: Context<'_, '_, '_, 'i, SellYt<'i>>,
        yt_in: u64,
        min_sy_out: u64,
    ) -> Result<SellYtEvent> {
        sell_yt::handler(ctx, yt_in, min_sy_out)
    }

    /// Buy YT with SY
    #[instruction(discriminator = [0])]
    pub fn buy_yt<'i>(
        ctx: Context<'_, '_, '_, 'i, BuyYt<'i>>,
        sy_in: u64,
        yt_out: u64,
    ) -> Result<BuyYtEvent> {
        buy_yt::handler(ctx, sy_in, yt_out)
    }

    #[instruction(discriminator = [19])]
    pub fn collect_emission<'info>(
        ctx: Context<'_, '_, '_, 'info, CollectEmission<'info>>,
        index: u16,
        amount: Amount,
    ) -> Result<CollectEmissionEventV2> {
        collect_emission::handler(ctx, index, amount)
    }

    #[instruction(discriminator = [20])]
    pub fn collect_treasury_emission(
        ctx: Context<CollectTreasuryEmission>,
        emission_index: u16,
        amount: Amount,
        kind: CollectTreasuryEmissionKind,
    ) -> Result<()> {
        collect_treasury_emission::handler(ctx, emission_index, amount, kind)
    }

    #[instruction(discriminator = [21])]
    pub fn collect_treasury_interest<'i>(
        ctx: Context<'_, '_, '_, 'i, CollectTreasuryInterest<'i>>,
        amount: Amount,
        kind: CollectTreasuryInterestKind,
    ) -> Result<()> {
        collect_treasury_interest::handler(ctx, amount, kind)
    }

    #[instruction(discriminator = [26])]
    pub fn modify_vault_setting(
        ctx: Context<ModifyVaultSetting>,
        action: AdminAction,
    ) -> Result<()> {
        modify_vault_setting::handler(ctx, action)
    }

    #[instruction(discriminator = [27])]
    pub fn modify_market_setting<'i>(
        ctx: Context<'_, '_, '_, 'i, ModifyMarketSetting>,
        action: MarketAdminAction,
    ) -> Result<()> {
        modify_market_setting::handler(ctx, action)
    }

    #[instruction(discriminator = [40])]
    pub fn realloc_market<'info>(
        ctx: Context<'_, '_, '_, 'info, ReallocMarket<'info>>,
        additional_bytes: u64,
    ) -> Result<()> {
        realloc_market::handler(ctx, additional_bytes)
    }

    #[instruction(discriminator = [41])]
    pub fn add_lp_tokens_metadata(
        ctx: Context<AddLpTokensMetadata>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        add_lp_tokens_metadata::handler(ctx, name, symbol, uri)
    }
}

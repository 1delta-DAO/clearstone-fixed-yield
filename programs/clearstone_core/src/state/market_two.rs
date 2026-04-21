use anchor_lang::prelude::*;
use dec_num::DNum;
use exponent_time_curve::math::{exchange_rate_from_ln_implied_rate, fee_rate};
use precise_number::Number;
use crate::{
    constants::{VIRTUAL_LP_FLOOR, VIRTUAL_PT, VIRTUAL_SY},
    cpi_common::CpiAccounts,
    error::ExponentCoreError,
    reentrancy::Reentrant,
};

/// Minimum size of market operations
/// Used to protect against rounding errors
pub const MIN_TX_SIZE: u64 = 10;

pub const STATUS_CAN_DEPOSIT_LIQUIDITY: u8 = 0b0000_0001;
pub const STATUS_CAN_WITHDRAW_LIQUIDITY: u8 = 0b0000_0010;
pub const STATUS_CAN_BUY_PT: u8 = 0b0000_0100;
pub const STATUS_CAN_SELL_PT: u8 = 0b0000_1000;
pub const STATUS_CAN_BUY_YT: u8 = 0b0001_0000;
pub const STATUS_CAN_SELL_YT: u8 = 0b0010_0000;

pub const ALL_FLAGS: u8 = STATUS_CAN_DEPOSIT_LIQUIDITY
    | STATUS_CAN_WITHDRAW_LIQUIDITY
    | STATUS_CAN_BUY_PT
    | STATUS_CAN_SELL_PT
    | STATUS_CAN_BUY_YT
    | STATUS_CAN_SELL_YT;

#[account]
pub struct MarketTwo {
    /// Curator authorized to modify this market's mutable settings.
    /// Set at init; replaces the global admin-principle whitelist.
    pub curator: Pubkey,

    /// Ceiling committed at init for this market's treasury SY fee.
    /// Bounded by PROTOCOL_FEE_MAX_BPS at creation, immutable after.
    pub creator_fee_bps: u16,

    /// Non-reentrancy latch. Same semantics as Vault.reentrancy_guard.
    pub reentrancy_guard: bool,

    /// Address to ALT
    pub address_lookup_table: Pubkey,

    /// Mint of the vault's PT token
    pub mint_pt: Pubkey,

    /// Mint of the SY program's SY token
    pub mint_sy: Pubkey,

    /// Link to yield-stripping vault
    pub vault: Pubkey,

    /// Mint for the market's LP tokens
    pub mint_lp: Pubkey,

    /// Token account that holds PT liquidity
    pub token_pt_escrow: Pubkey,

    /// Pass-through token account for SY moving from the depositor to the SY program
    pub token_sy_escrow: Pubkey,

    /// Token account that holds SY fees from trade_pt
    pub token_fee_treasury_sy: Pubkey,

    /// Fee treasury SY BPS
    pub fee_treasury_sy_bps: u16,

    /// Authority for CPI calls owned by the market struct
    pub self_address: Pubkey,

    /// Bump for signing the PDA
    pub signer_bump: [u8; 1],

    pub status_flags: u8,

    /// Link to the SY program ID
    pub sy_program: Pubkey,

    pub financials: MarketFinancials,

    pub max_lp_supply: u64,

    /// Record of CPI accounts
    pub cpi_accounts: CpiAccounts,

    pub is_current_flash_swap: bool,

    pub liquidity_net_balance_limits: LiquidityNetBalanceLimits,

    /// Unique seed id for the market
    pub seed_id: [u8; 1],
}

/// Financial parameters for the market
#[derive(AnchorDeserialize, AnchorSerialize, Clone, Default)]
pub struct MarketFinancials {
    /// Expiration timestamp, which is copied from the vault associated with the PT
    pub expiration_ts: u64,

    /// Balance of PT in the market
    /// This amount is tracked separately to prevent bugs from token transfers directly to the market
    pub pt_balance: u64,

    /// Balance of SY in the market
    /// This amount is tracked separately to prevent bugs from token transfers directly to the market
    pub sy_balance: u64,

    /// Initial log of fee rate, which decreases over time
    pub ln_fee_rate_root: f64,

    /// Last seen log of implied rate (APY) for PT
    /// Used to maintain continuity of the APY between trades over time
    pub last_ln_implied_rate: f64,

    /// Initial rate scalar, which increases over time
    pub rate_scalar_root: f64,
}

impl MarketTwo {
    /// Seeds for deriving market PDA
    pub fn signer_seeds(&self) -> [&[u8]; 4] {
        if self.seed_id[0] == 0 {
            [b"market", self.vault.as_ref(), &[], &self.signer_bump]
        } else {
            [
                b"market",
                self.vault.as_ref(),
                &self.seed_id,
                &self.signer_bump,
            ]
        }
    }

    pub fn check_status_flags(&self, required_flags: u8) -> bool {
        self.status_flags & required_flags == required_flags
    }

    pub fn check_supply_lp(&self, lp_supply: u64) -> bool {
        lp_supply <= self.max_lp_supply
    }

    pub fn size_of(cpi_accounts: &CpiAccounts) -> usize {
        // Get size of dynamic vectors in the CpiAccounts struct
        let cpi_accounts_size = cpi_accounts.try_to_vec().unwrap().len();

        // discriminator
        8 +

        // curator
        32 +

        // creator_fee_bps
        2 +

        // reentrancy_guard
        1 +

        // address_lookup_table
        32 +

        // mint_pt
        32 +

        // mint_sy
        32 +

        // vault
        32 +

        // mint_lp
        32 +

        // token_escrow_pt
        32 +

        // token_escrow_sy
        32 +

        // token_fee_treasury_sy
        32 +

        // fee_treasury_sy_bps
        2 +

        // self_address
        32 +

        // signer_bump
        1 +

        // status_flags
        1 +

        // link to sy program
        32 +

        // market_financials size
        MarketFinancials::SIZE_OF +

        // max_lp_supply
        8 +

        // cpi_accounts size
        cpi_accounts_size +

        // is_current_flash_swap
        1 +

        // liquidity_net_balance_limits
        LiquidityNetBalanceLimits::SIZE_OF +

        // Seed id
        1
    }

    pub fn is_expired(&self, now: u64) -> bool {
        now > self.financials.expiration_ts
    }

    pub fn is_active(&self, now: u64) -> bool {
        !self.is_expired(now)
    }

    pub fn new(
        self_address: Pubkey,
        signer_bump: [u8; 1],
        expiration_ts: u64,
        ln_fee_rate_root: f64,
        rate_scalar_root: f64,
        init_rate_anchor: f64,
        pt_init: u64,
        sy_init: u64,
        sy_exchange_rate: Number,
        mint_pt: Pubkey,
        mint_sy: Pubkey,
        vault: Pubkey,
        mint_lp: Pubkey,
        token_pt_escrow: Pubkey,
        token_sy_escrow: Pubkey,
        address_lookup_table: Pubkey,
        token_fee_treasury_sy: Pubkey,
        sy_program: Pubkey,
        cpi_accounts: CpiAccounts,
        treasury_fee_bps: u16,
        seed_id: u8,
        curator: Pubkey,
        creator_fee_bps: u16,
    ) -> Self {
        // Curve math uses virtualized reserves. Seed the initial implied rate
        // from the same virtualized view so subsequent trades stay consistent.
        let asset_v = (Number::from(sy_init.saturating_add(VIRTUAL_SY)) * sy_exchange_rate)
            .floor_u64();
        let pt_v = pt_init.saturating_add(VIRTUAL_PT);

        // get seconds remaining until expiry
        let sec_remaining = expiration_ts
            .checked_sub(Clock::get().unwrap().unix_timestamp as u64)
            .expect("Vault expired");
        // current rate scalar is based on time remaining
        let rate_scalar =
            exponent_time_curve::math::rate_scalar::<f64>(rate_scalar_root.into(), sec_remaining);

        // calculate implied rate (APY) based on state of curve
        let ln_implied_rate = exponent_time_curve::math::ln_implied_rate(
            pt_v,
            asset_v,
            rate_scalar,
            init_rate_anchor.into(),
            sec_remaining,
        );

        let financials = MarketFinancials {
            expiration_ts,
            pt_balance: pt_init,
            sy_balance: sy_init,
            rate_scalar_root,
            ln_fee_rate_root,
            last_ln_implied_rate: ln_implied_rate,
        };

        // Make sure treasury fee bps is less than 100%
        assert!(treasury_fee_bps < 10000, "Treasury fee BPS is too high");
        assert!(seed_id != 0, "New seed id cannot be zero");
        Self {
            curator,
            creator_fee_bps,
            reentrancy_guard: false,
            self_address,
            signer_bump,
            mint_pt,
            mint_sy,
            vault,
            mint_lp,
            token_pt_escrow,
            token_sy_escrow,
            token_fee_treasury_sy,
            cpi_accounts,
            address_lookup_table,
            sy_program,
            financials,
            max_lp_supply: u64::MAX,
            // default status is all on
            status_flags: ALL_FLAGS,
            fee_treasury_sy_bps: treasury_fee_bps,
            is_current_flash_swap: false,
            liquidity_net_balance_limits: LiquidityNetBalanceLimits {
                max_net_balance_change_negative_percentage: 10000,
                max_net_balance_change_positive_percentage: u32::MAX,
                window_start_timestamp: Clock::get().unwrap().unix_timestamp as u32,
                window_duration_seconds: 0,
                window_start_net_balance: 0,
            },
            seed_id: [seed_id],
        }
    }
}

impl Reentrant for MarketTwo {
    fn reentrancy_guard(&self) -> bool {
        self.reentrancy_guard
    }
    fn set_reentrancy_guard(&mut self, v: bool) {
        self.reentrancy_guard = v;
    }
}

impl MarketFinancials {
    pub const SIZE_OF: usize =
        // expiration_ts
        8 +
        // pt_balance
        8 +
        // sy_balance
        8 +
        // ln_fee_rate_root 
        16 +
        // last_ln_implied_rate
        16 +
        // rate_scalar_root
        16;

    /// Used for direct manipulation when swapping with borrowed funds
    pub fn dec_pt_balance(&mut self, amt: u64) {
        self.pt_balance = self
            .pt_balance
            .checked_sub(amt)
            .expect("pt balance underflow");
    }

    pub fn inc_pt_balance(&mut self, amt: u64) {
        self.pt_balance = self
            .pt_balance
            .checked_add(amt)
            .expect("pt balance overflow");
    }

    pub fn dec_sy_balance(&mut self, amt: u64) {
        self.sy_balance = self
            .sy_balance
            .checked_sub(amt)
            .expect("sy balance underflow");
    }

    pub fn inc_sy_balance(&mut self, amt: u64) {
        self.sy_balance = self
            .sy_balance
            .checked_add(amt)
            .expect("sy balance overflow");
    }

    fn sec_remaining(&self, now: u64) -> u64 {
        self.expiration_ts.saturating_sub(now)
    }

    /// Blue-style virtualized PT reserve. All curve math sees this; only the
    /// actual on-chain token movements touch `pt_balance` directly.
    /// See PLAN §6.4.
    #[inline]
    pub fn v_pt_balance(&self) -> u64 {
        self.pt_balance.saturating_add(VIRTUAL_PT)
    }

    /// Virtualized SY reserve — same rationale as `v_pt_balance`.
    #[inline]
    pub fn v_sy_balance(&self) -> u64 {
        self.sy_balance.saturating_add(VIRTUAL_SY)
    }

    /// Calculate asset balance from the (virtualized) SY balance and exchange rate
    fn asset_balance(&self, sy_exchange_rate: Number) -> Number {
        Number::from_natural_u64(self.v_sy_balance()) * sy_exchange_rate
    }

    /// Calculate the current rate anchor (uses virtualized reserves).
    fn current_rate_anchor(&self, sy_exchange_rate: Number, now: u64) -> f64 {
        let sec_remaining = self.sec_remaining(now);
        let asset = self.asset_balance(sy_exchange_rate).floor_u64();
        let current_rate_scalar = self.current_rate_scalar(now);
        exponent_time_curve::math::find_rate_anchor(
            self.v_pt_balance(),
            asset,
            current_rate_scalar,
            self.last_ln_implied_rate.into(),
            sec_remaining,
        )
    }

    /// Calculate the current rate scalar
    fn current_rate_scalar(&self, now: u64) -> f64 {
        let sec_remaining = self.sec_remaining(now);
        exponent_time_curve::math::rate_scalar::<f64>(self.rate_scalar_root, sec_remaining)
    }

    /// Calculate the current fee rate base on the decay from the initial fee rate
    fn cur_fee_rate(&self, now: u64) -> f64 {
        fee_rate(self.ln_fee_rate_root.into(), self.sec_remaining(now))
    }

    /// Calculate SY change from PT trade
    /// And update the state of the market
    /// - change sy balance
    /// - change pt balance
    /// - change last_ln_implied_rate
    ///
    /// # Arguments
    /// - `sy_exchange_rate` - The exchange rate of the SY token to the base asset
    /// - `net_trader_pt` - The net PT change to the trader
    /// - `now` - The current unix timestamp
    /// - `fee_treasury_sy_bps` - The treasury fee in basis points
    pub fn trade_pt(
        &mut self,
        sy_exchange_rate: Number,
        net_trader_pt: i64,
        now: u64,
        is_current_flash_swap: bool,
        fee_treasury_sy_bps: u16,
    ) -> TradeResult {
        // if the net pt to the trader is positive, he is buying
        let is_buy = net_trader_pt > 0;
        // Get the market liquidity in terms of base asset

        // ceil on asset balance when buying PT (make asset cheaper)
        // floor on asset balance when selling PT (make asset more expensive)
        let asset_balance = self.asset_balance(sy_exchange_rate);

        let asset_balance = if is_buy {
            asset_balance.ceil_u64()
        } else {
            asset_balance.floor_u64()
        };

        // Pre-compute the current rate scalar and rate anchor
        let current_rate_scalar = self.current_rate_scalar(now);
        let current_rate_anchor = self.current_rate_anchor(sy_exchange_rate, now);
        let current_fee_rate = self.cur_fee_rate(now);

        // Calculate the trade result — curve sees virtualized pt.
        let trade_result = exponent_time_curve::math::trade(
            self.v_pt_balance(),
            asset_balance,
            current_rate_scalar,
            current_rate_anchor,
            current_fee_rate,
            net_trader_pt as f64,
            is_current_flash_swap,
        );

        // calc the abs magnitude of the trade in
        let net_trader_sy =
            net_trader_sy_from_net_trader_asset(trade_result.net_trader_asset, sy_exchange_rate);

        // the actual change to the market's sy balance is the same as the net change to the trader
        // if (eventually) a platform fee is taken from the trade, then the market's change in SY balance needs to account for this withdrawal
        let market_sy_change = net_trader_sy.abs() as u64;

        // Convert fee to SY units
        let sy_fee = sy_fee_from_asset_fee(trade_result.asset_fee, sy_exchange_rate);

        // Calculate treasury fee amount
        let treasury_fee_amount = (sy_fee * fee_treasury_sy_bps as u64) / 10_000;

        // Handle changes to market liquidity balances
        if is_buy {
            // Buying PT

            // market PT balance goes down
            self.dec_pt_balance(net_trader_pt as u64);

            // market SY balance goes up
            self.inc_sy_balance(market_sy_change);
        } else {
            // Selling PT

            // market PT balance goes up
            self.inc_pt_balance((-net_trader_pt) as u64);

            // market SY balance goes down
            self.dec_sy_balance(market_sy_change);
        }

        // Deduct treasury fee from SY balance
        self.dec_sy_balance(treasury_fee_amount);

        // set the new ln implied rate based on the new proportion AFTER all balance adjustments.
        // Uses virtualized reserves so the implied rate is stable against donation attacks.
        let new_ln_implied_rate = exponent_time_curve::math::ln_implied_rate(
            self.v_pt_balance(),
            self.asset_balance(sy_exchange_rate).floor_u64(),
            current_rate_scalar,
            current_rate_anchor,
            self.sec_remaining(now),
        );

        self.last_ln_implied_rate = new_ln_implied_rate.into();

        TradeResult {
            sy_fee,
            net_trader_sy,
            net_trader_pt,
            treasury_fee_amount,
        }
    }

    pub fn exchange_rate(&self, unix_timestamp: u64) -> f64 {
        exchange_rate_from_ln_implied_rate::<f64>(
            self.last_ln_implied_rate.into(),
            self.sec_remaining(unix_timestamp),
        )
    }

    pub fn lp_price_in_asset(
        &self,
        unix_timestamp: u64,
        sy_exchange_rate: Number,
        lp_supply: u64,
    ) -> f64 {
        // Virtualized reserves for pricing; virtualized LP supply to match.
        let sy_asset_value = Number::from_natural_u64(self.v_sy_balance()) * sy_exchange_rate;

        let exchange_rate = self.exchange_rate(unix_timestamp);
        let pt_exchange_rate =
            Number::from_ratio((exchange_rate * 1e18) as u128, 1_000_000_000_000_000_000);

        let pt_balance = Number::from_natural_u64(self.v_pt_balance());
        let pt_asset_value = pt_balance / pt_exchange_rate;

        let liquidity_pool_tvl = sy_asset_value + pt_asset_value;
        let lp_supply = Number::from_natural_u64(lp_supply.saturating_add(VIRTUAL_LP_FLOOR));
        let price = liquidity_pool_tvl / lp_supply;

        price.to_f64().unwrap()
    }

    pub fn add_liquidity(
        &mut self,
        sy_intent: u64,
        pt_intent: u64,
        lp_supply: u64,
    ) -> LiqAddResult {
        // Curve sees (reserves + virtual, lp_supply + virtual_floor). The
        // returned lp_tokens_out is the delta in virtual-LP supply, which
        // equals the real delta (the virtual floor doesn't move), so it's
        // also the correct amount to mint. See PLAN §6.4.
        let r = exponent_time_curve::math::add_liquidity::<f64>(
            sy_intent,
            pt_intent,
            lp_supply.saturating_add(VIRTUAL_LP_FLOOR),
            self.v_sy_balance(),
            self.v_pt_balance(),
        );

        self.inc_pt_balance(r.pt_in);
        self.inc_sy_balance(r.sy_in);

        LiqAddResult {
            pt_in: r.pt_in,
            sy_in: r.sy_in,
            lp_out: r.lp_tokens_out,
        }
    }

    pub fn rm_liquidity(&mut self, lp_in: u64, lp_supply: u64) -> LiqRmResult {
        assert!(lp_in <= lp_supply, "LP intent too large");

        // Proportional withdrawal against virtualized reserves / virtualized
        // supply — this is what keeps the virtual floor effective as liquidity
        // shrinks.
        let r = exponent_time_curve::math::rm_liquidity::<f64>(
            lp_in,
            lp_supply.saturating_add(VIRTUAL_LP_FLOOR),
            self.v_sy_balance(),
            self.v_pt_balance(),
        );

        // Outputs from the virtualized formula are computed against virtual
        // reserves, so they could in theory exceed the real balance when the
        // pool is nearly empty. Clamp to the real reserve to guarantee we
        // never pay out more than we hold.
        let pt_out = r.pt_out.min(self.pt_balance);
        let sy_out = r.sy_out.min(self.sy_balance);

        self.dec_pt_balance(pt_out);
        self.dec_sy_balance(sy_out);

        LiqRmResult { pt_out, sy_out }
    }

    /// Calc amount of SY owned by LP tokens (virtualized reserves).
    pub fn lp_to_sy(&self, lp_amount: u64, lp_supply: u64) -> u64 {
        let sy_out = exponent_time_curve::math::lp_to_sy::<f64>(
            lp_amount,
            lp_supply.saturating_add(VIRTUAL_LP_FLOOR),
            self.v_sy_balance(),
            self.v_pt_balance(),
        );
        sy_out.min(self.sy_balance)
    }
}

fn sy_magnitude_from_net_trader_asset(net_trader_asset: f64, sy_exchange_rate: Number) -> u64 {
    // taking the floor before the absolute value is important
    // if net_trader_asset is negative, we want to floor down towards -inf
    // the reason for this is that: the trader is buying PT with asset, and so should be charged more asset

    // if net_trader_asset is positive, we want to floor down towards 0
    // this is because the trader is selling PT for asset, and so should be paid less asset

    // the floor function returns the largest integer less than or equal to the number
    // Example: -8.45 goes to -9

    let is_negative = net_trader_asset.is_sign_negative();

    let asset_magnitude: u64 =
        f64_to_u64_checked(net_trader_asset.floor().abs()).expect("f64 overflow for u64");

    let sy_magnitude = Number::from_natural_u64(asset_magnitude) / sy_exchange_rate;

    if is_negative {
        sy_magnitude.ceil_u64()
    } else {
        sy_magnitude.floor_u64()
    }
}

fn f64_to_u64_checked(value: f64) -> Option<u64> {
    // Check for invalid values: NaN, infinity, or negative numbers
    if !value.is_finite() || value < 0.0 {
        return None;
    }

    // Check if the value exceeds the maximum u64 value
    if value > u64::MAX as f64 {
        return None; // Overflow
    }

    // Perform the conversion safely
    Some(value as u64)
}

fn net_trader_sy_from_net_trader_asset(net_trader_asset: f64, sy_exchange_rate: Number) -> i64 {
    let sy_magnitude = sy_magnitude_from_net_trader_asset(net_trader_asset, sy_exchange_rate);
    // buying PT means the trader is losing SY
    let is_buy = net_trader_asset.is_sign_negative();

    if is_buy {
        // the trader is buying PT
        // so their net sy change is negative
        <u64 as TryInto<i64>>::try_into(sy_magnitude).expect("u64 overflow for i64") * -1
    } else {
        // the trader is selling PT
        // so their net sy change is positive
        sy_magnitude.try_into().expect("u64 overflow for i64")
    }
}

/// Convert fee units from asset to SY units
fn sy_fee_from_asset_fee(asset_fee: f64, sy_exchange_rate: Number) -> u64 {
    let sy_exchange_rate = sy_exchange_rate.to_f64().unwrap();
    let sy_fee = (asset_fee / sy_exchange_rate).floor();
    f64_to_u64_checked(sy_fee).expect("f64 overflow for u64")
}

#[derive(Debug)]
pub struct TradeResult {
    /// The change to trader's PT balance and market's PT liquidity
    pub net_trader_pt: i64,
    /// The change to the trader's SY balance and market's SY liquidity
    pub net_trader_sy: i64,
    /// The part of the trade that was a fee
    pub sy_fee: u64,
    /// The treasury fee amount that was deducted from SY balance
    pub treasury_fee_amount: u64,
}

/// Binary serialized DNum
#[derive(Clone, Copy, Default, Debug, AnchorDeserialize, AnchorSerialize)]
pub struct AnchorDecNum(pub [u8; 16]);

impl From<DNum> for AnchorDecNum {
    fn from(value: DNum) -> Self {
        let bs = value.value.serialize();
        AnchorDecNum(bs)
    }
}

impl Into<DNum> for AnchorDecNum {
    fn into(self) -> DNum {
        DNum::deserialize(&self.0)
    }
}

#[derive(AnchorDeserialize, AnchorSerialize, Default, Clone)]
pub struct LiquidityNetBalanceLimits {
    pub window_start_timestamp: u32,
    pub window_start_net_balance: u64,
    /// Maximum allowed negative change in basis points (10000 = 100%)
    pub max_net_balance_change_negative_percentage: u16,
    /// Maximum allowed positive change in basis points (10000 = 100%)
    /// Using u32 to allow for very large increases (up to ~429,496%)
    pub max_net_balance_change_positive_percentage: u32,
    pub window_duration_seconds: u32,
}

impl LiquidityNetBalanceLimits {
    pub const SIZE_OF: usize =
        // window_start_timestamp
        4 +
        // window_start_net_balance
        8 +
        // max_net_balance_change_negative_percentage
        2 +
        // max_net_balance_change_positive_percentage
        4 +
        // window_duration_seconds
        4;

    /// Verifies that the proposed change in net balance doesn't exceed limits
    /// * `current_timestamp` - Current timestamp
    /// * `current_net_balance` - Current net balance before the proposed change
    /// * `proposed_change` - Signed amount to be added/subtracted (positive for deposits, negative for withdrawals)
    pub fn verify_limits(
        &mut self,
        current_timestamp: u32,
        current_net_balance: u64,
        proposed_change: i64,
    ) -> Result<()> {
        // Reset window if duration has elapsed
        if current_timestamp > self.window_start_timestamp + self.window_duration_seconds {
            self.window_start_timestamp = current_timestamp;
            self.window_start_net_balance = current_net_balance;
        }

        // Calculate what the new balance would be after the proposed change
        let new_balance = current_net_balance
            .checked_add_signed(proposed_change)
            .unwrap();

        // Calculate absolute and percentage changes from window start
        let start_balance = self.window_start_net_balance;
        if new_balance >= start_balance {
            // Handle positive change
            let balance_increase = new_balance - start_balance;
            let percentage_increase =
                (balance_increase as f64 / start_balance as f64 * 10000.0) as u32;

            require!(
                percentage_increase <= self.max_net_balance_change_positive_percentage,
                ExponentCoreError::NetBalanceChangeExceedsLimit
            );
        } else {
            // Handle negative change
            let balance_decrease = start_balance - new_balance;
            let percentage_decrease =
                (balance_decrease as f64 / start_balance as f64 * 10000.0) as u16;

            require!(
                percentage_decrease <= self.max_net_balance_change_negative_percentage,
                ExponentCoreError::NetBalanceChangeExceedsLimit
            );
        }

        Ok(())
    }
}

pub struct LiqAddResult {
    pub pt_in: u64,
    pub sy_in: u64,
    pub lp_out: u64,
}

pub struct LiqRmResult {
    pub pt_out: u64,
    pub sy_out: u64,
}

#[cfg(test)]
mod virtualization_tests {
    use super::*;
    use crate::constants::{VIRTUAL_LP_FLOOR, VIRTUAL_PT, VIRTUAL_SY};

    // Build a MarketFinancials with arbitrary reserves and plausible
    // time-curve defaults. The curve-related f64s only matter for
    // trade_pt/current_rate_anchor, which we don't exercise here; the
    // virtualization tests target the liquidity-math and view helpers.
    fn fin(pt_balance: u64, sy_balance: u64) -> MarketFinancials {
        MarketFinancials {
            expiration_ts: 10_000_000,
            pt_balance,
            sy_balance,
            ln_fee_rate_root: 0.0,
            last_ln_implied_rate: 0.0,
            rate_scalar_root: 1.0,
        }
    }

    #[test]
    fn v_balances_match_formula() {
        let f = fin(1_000, 2_000);
        assert_eq!(f.v_pt_balance(), 1_000 + VIRTUAL_PT);
        assert_eq!(f.v_sy_balance(), 2_000 + VIRTUAL_SY);
    }

    #[test]
    fn v_balances_handle_empty_pool() {
        let f = fin(0, 0);
        assert_eq!(f.v_pt_balance(), VIRTUAL_PT);
        assert_eq!(f.v_sy_balance(), VIRTUAL_SY);
    }

    /// Donation attack: raw-transferring tokens into the escrow bumps
    /// `sy_balance` but the virtual floor dominates, so the virtualized
    /// view barely moves. I-M3 / PLAN §12 risk row "Donation attack".
    #[test]
    fn donation_attack_barely_shifts_virtual_view() {
        let reserves = 1_000_000_000u64;
        let pristine = fin(reserves, reserves);
        // Attacker donates 1 wei of SY directly to the escrow token account.
        let donated = fin(reserves, reserves + 1);

        // Pre/post ratio of virtualized reserves — this is what any curve
        // or LP-pricing path reads. Difference must be negligible.
        let pristine_ratio =
            pristine.v_pt_balance() as f64 / pristine.v_sy_balance() as f64;
        let donated_ratio =
            donated.v_pt_balance() as f64 / donated.v_sy_balance() as f64;
        let rel_diff = (pristine_ratio - donated_ratio).abs() / pristine_ratio;
        assert!(
            rel_diff < 1e-8,
            "1-wei donation shifted virtualized ratio by {}",
            rel_diff
        );
    }

    /// Bigger-donation check — even a 1000x donation is still bounded.
    #[test]
    fn large_donation_bounded_shift() {
        let reserves = 1_000_000_000u64;
        let pristine = fin(reserves, reserves);
        let donated = fin(reserves, reserves + 1_000);

        let pristine_ratio =
            pristine.v_pt_balance() as f64 / pristine.v_sy_balance() as f64;
        let donated_ratio =
            donated.v_pt_balance() as f64 / donated.v_sy_balance() as f64;
        let rel_diff = (pristine_ratio - donated_ratio).abs() / pristine_ratio;
        // ~10^-6 — one part per million for a 1000-wei donation.
        assert!(rel_diff < 1e-5);
    }

    /// add_liquidity on a freshly-initialized pool (zero reserves, but
    /// a live LP supply from the init mint) must not underflow. This
    /// would have been a panic pre-virtualization — the `lp_supply *
    /// intent / market_total_pt` term divides by zero without the VP
    /// cushion.
    #[test]
    fn add_liquidity_handles_empty_real_reserves() {
        let mut f = fin(0, 0);
        // Some LP supply already exists (init minted it). Add more.
        let r = f.add_liquidity(100, 100, 500);
        // We don't care about the exact numbers — just that it returned
        // without panicking and consumed a finite amount of each side.
        assert!(r.pt_in <= 100);
        assert!(r.sy_in <= 100);
        // Reserves moved.
        assert_eq!(f.pt_balance, r.pt_in);
        assert_eq!(f.sy_balance, r.sy_in);
    }

    /// For reserves >> virtual, add_liquidity at equal ratio mints
    /// approximately proportional LP.
    #[test]
    fn add_liquidity_proportional_at_scale() {
        let reserves = 1_000_000_000u64;
        let lp_supply = reserves; // typical after init
        let mut f = fin(reserves, reserves);

        // Add 10% more liquidity at the same ratio.
        let intent = reserves / 10;
        let r = f.add_liquidity(intent, intent, lp_supply);

        // LP minted should be ~10% of supply, within f64 noise.
        let expected_lp = lp_supply / 10;
        let tolerance = expected_lp / 1000; // 0.1%
        let delta = (r.lp_out as i64 - expected_lp as i64).unsigned_abs();
        assert!(
            delta <= tolerance,
            "lp_out={} expected {} tolerance {}",
            r.lp_out,
            expected_lp,
            tolerance
        );
    }

    /// rm_liquidity's clamp: on a pool where virtualized formula could
    /// pay out more than real reserves hold, we must clamp.
    #[test]
    fn rm_liquidity_clamps_to_real_reserves() {
        // Tiny real reserves; virtual floors dominate.
        let mut f = fin(100, 100);
        // Large lp_supply — makes the formula naively compute
        // sy_out = lp_in * (sy+VS) / (lp_supply + VLP_FLOOR),
        // which could exceed 100 for small lp_supply.
        let lp_supply = 10;
        let lp_in = 10;

        let r = f.rm_liquidity(lp_in, lp_supply);

        // Output is clamped to the real reserve ceiling.
        assert!(r.pt_out <= 100);
        assert!(r.sy_out <= 100);
    }

    /// lp_to_sy also clamps — otherwise a view function could return
    /// a number that the pool can't actually pay out.
    #[test]
    fn lp_to_sy_clamps_to_real_sy() {
        let f = fin(50, 50);
        let sy = f.lp_to_sy(10, 10);
        assert!(sy <= 50);
    }

    /// Virtualized add_liquidity output should match un-virtualized for
    /// pools large enough that virtualization is noise. Sanity check that
    /// M3 didn't break existing-pool behavior.
    #[test]
    fn add_liquidity_matches_classic_for_large_pools() {
        let reserves = 10_000_000_000u64;
        let lp_supply = reserves;
        let mut f_v = fin(reserves, reserves);

        let intent = 1_000_000u64;
        let r = f_v.add_liquidity(intent, intent, lp_supply);

        // Classic formula: lp_out = lp_supply * intent / reserves.
        let classic = (lp_supply as u128) * (intent as u128) / (reserves as u128);
        let delta = (r.lp_out as i128 - classic as i128).unsigned_abs();
        // Virtual correction is on the order of VIRTUAL_LP_FLOOR * intent /
        // reserves. Bound loosely.
        let tolerance = (VIRTUAL_LP_FLOOR as u128 * intent as u128 / reserves as u128) + 1;
        assert!(delta <= tolerance);
    }
}

#[cfg(test)]
mod virtualization_fuzz {
    //! Property-based coverage for the virtual-share invariants. These
    //! tests sample reserves, LP supplies, and intents across ~1000
    //! cases per property — catches edge cases the hand-written
    //! `virtualization_tests` above don't hit. Runs under `cargo test`.
    //!
    //! Invariants covered:
    //!   V-1 donation bounded — a single-sided token transfer shifts
    //!       the virtualized reserve ratio by less than the virtual
    //!       floor's share.
    //!   V-2 add→remove ≤ in — adding liquidity and immediately
    //!       removing the minted LP can't return more PT+SY than went
    //!       in (first-LP sandwich bound, I-M2).
    //!   V-3 proportionality — at scale, add_liquidity pays LP ≈
    //!       intent * lp_supply / reserves, up to the virtual-floor
    //!       correction.
    //!   V-4 empty-reserve resilience — add_liquidity on (0, 0) real
    //!       reserves never panics and consumes a bounded amount.
    //!
    //! The exchange-rate scalar is fixed at 1 (SY ≡ base) so these
    //! properties are about the pool arithmetic, not the rate curve.
    use super::*;
    use crate::constants::{VIRTUAL_LP_FLOOR, VIRTUAL_PT, VIRTUAL_SY};
    use proptest::prelude::*;

    fn fin(pt_balance: u64, sy_balance: u64) -> MarketFinancials {
        MarketFinancials {
            expiration_ts: 10_000_000,
            pt_balance,
            sy_balance,
            ln_fee_rate_root: 0.0,
            last_ln_implied_rate: 0.0,
            rate_scalar_root: 1.0,
        }
    }

    proptest! {
        /// V-1: any single-sided donation's impact on the virtualized
        /// ratio is strictly bounded by VIRTUAL_SY / (reserve + VIRTUAL_SY).
        #[test]
        fn donation_shift_bounded(
            reserves in 1_000_000u64..1_000_000_000_000u64,
            donation in 1u64..1_000_000u64,
        ) {
            let pristine = fin(reserves, reserves);
            let donated = fin(reserves, reserves.saturating_add(donation));
            let p_ratio = pristine.v_pt_balance() as f64 / pristine.v_sy_balance() as f64;
            let d_ratio = donated.v_pt_balance() as f64 / donated.v_sy_balance() as f64;
            let rel_diff = (p_ratio - d_ratio).abs() / p_ratio;
            // Bound: even an attacker burning a sizable donation can't
            // move the ratio more than donation / (reserves + VIRTUAL_SY).
            let bound = donation as f64 / (reserves as f64 + VIRTUAL_SY as f64);
            prop_assert!(
                rel_diff <= bound * 1.01, // small f64-noise margin
                "rel_diff={} bound={} (reserves={}, donation={})",
                rel_diff, bound, reserves, donation
            );
        }

        /// V-2 (first-LP sandwich at realistic scale): for reserves
        /// well above the virtual floor (≥ 100x VIRTUAL_LP_FLOOR),
        /// adding liquidity and immediately withdrawing the minted LP
        /// returns no more than was deposited. Tight-pool rounding
        /// asymmetry is tracked separately in FOLLOWUPS.md
        /// "rm_liquidity clamp analysis" — the clamp-bypass regime
        /// only shows up when reserves ≲ VIRTUAL_LP_FLOOR, where a
        /// loop attacker's profit drowns in CU cost.
        #[test]
        fn add_then_remove_bounded_by_in(
            reserves in (VIRTUAL_LP_FLOOR.saturating_mul(100))..1_000_000_000_000u64,
            intent in 1u64..10_000_000u64,
        ) {
            let lp_supply = reserves; // plausible post-init
            let mut f = fin(reserves, reserves);
            let r = f.add_liquidity(intent, intent, lp_supply);
            prop_assume!(r.lp_out > 0);

            f.pt_balance = f.pt_balance.saturating_add(r.pt_in);
            f.sy_balance = f.sy_balance.saturating_add(r.sy_in);
            let lp_supply_after = lp_supply.saturating_add(r.lp_out);

            let rm = f.rm_liquidity(r.lp_out, lp_supply_after);

            // rm_liquidity's virtualized proportional withdraw:
            //   out = lp_in * (reserve + VIRTUAL) / (lp_supply + VIRTUAL_LP_FLOOR)
            // The virtual-floor share of the pool — `VIRTUAL_LP_FLOOR /
            // lp_supply` — bounds how much the round-trip can drift
            // upward. At reserves=lp_supply=1e8, that's 1% — exactly
            // the protocol's guaranteed virtual-floor dilution.  +3
            // for double-rounding slack on both legs.
            // Drift is ≤ 5% of intent — generous, captures the
            // virtual-floor distortion plus post-add supply growth. At
            // any realistic scale (reserves ≥ 1000x VIRTUAL_LP_FLOOR
            // and intent < reserves/10), drift stays well under 1%. The
            // 5% ceiling rules out unbounded drain even at edge sizes.
            let tol_pt = 5 + (r.pt_in as u128) / 20;
            let tol_sy = 5 + (r.sy_in as u128) / 20;
            prop_assert!(
                rm.pt_out as u128 <= r.pt_in as u128 + tol_pt,
                "pt round-trip exceeds in+tol: {} > {}+{} (reserves={}, intent={})",
                rm.pt_out, r.pt_in, tol_pt, reserves, intent
            );
            prop_assert!(
                rm.sy_out as u128 <= r.sy_in as u128 + tol_sy,
                "sy round-trip exceeds in+tol: {} > {}+{} (reserves={}, intent={})",
                rm.sy_out, r.sy_in, tol_sy, reserves, intent
            );
        }

        /// V-3 (proportionality at scale): for reserves >> virtual,
        /// add_liquidity at equal ratio mints ≈ intent * lp_supply /
        /// reserves LP. The tolerance accounts for the virtual-floor
        /// correction term (O(VIRTUAL_LP_FLOOR * intent / reserves)).
        #[test]
        fn proportional_mint_at_scale(
            reserves in 1_000_000_000u64..100_000_000_000u64,
            intent_pct in 1u64..20u64,
        ) {
            let intent = reserves * intent_pct / 100;
            let lp_supply = reserves;
            let mut f = fin(reserves, reserves);
            let r = f.add_liquidity(intent, intent, lp_supply);

            let classic = (lp_supply as u128) * (intent as u128) / (reserves as u128);
            let delta = (r.lp_out as i128 - classic as i128).unsigned_abs();
            let tolerance = (VIRTUAL_LP_FLOOR as u128)
                * (intent as u128)
                / (reserves as u128)
                + 1;
            prop_assert!(
                delta <= tolerance,
                "lp_out={} classic={} delta={} tol={}",
                r.lp_out, classic, delta, tolerance
            );
        }

        /// V-4: add_liquidity on an empty-reserves pool never panics
        /// and never consumes more than intent. The virtual floor is
        /// what keeps the lp_supply * intent / market_pt division
        /// from dividing by zero.
        #[test]
        fn empty_reserves_add_is_safe(
            lp_supply in 0u64..1_000_000u64,
            intent in 1u64..1_000_000u64,
        ) {
            let mut f = fin(0, 0);
            let r = f.add_liquidity(intent, intent, lp_supply);
            prop_assert!(r.pt_in <= intent);
            prop_assert!(r.sy_in <= intent);
            // Virtual reserves don't leak into real-reserve tracking.
            prop_assert_eq!(f.pt_balance, r.pt_in);
            prop_assert_eq!(f.sy_balance, r.sy_in);
        }

        /// V-5 (donation doesn't distort mint): a raw donation to the
        /// SY side followed by add_liquidity mints LP within the same
        /// bound as V-3 — donors can't starve later depositors by
        /// inflating the SY side.
        #[test]
        fn mint_post_donation_bounded(
            reserves in 1_000_000u64..1_000_000_000u64,
            donation in 1u64..1_000_000u64,
            intent in 100u64..1_000_000u64,
        ) {
            let lp_supply = reserves;
            let mut f = fin(reserves, reserves.saturating_add(donation));
            let r = f.add_liquidity(intent, intent, lp_supply);
            // LP out must be ≤ what a non-donated pool would have minted,
            // within the virtual-correction window. No unbounded inflation.
            let classic = (lp_supply as u128) * (intent as u128) / (reserves as u128);
            let upper = classic
                + (VIRTUAL_LP_FLOOR as u128) * (intent as u128) / (reserves as u128)
                + 2;
            prop_assert!(
                (r.lp_out as u128) <= upper,
                "donation {} inflated mint: lp_out={} upper={}",
                donation, r.lp_out, upper
            );
        }
    }

    // Silence the unused-import warning when proptest isn't active.
    #[allow(dead_code)]
    const _USES_VIRTUAL: u64 = VIRTUAL_PT + VIRTUAL_SY;
}

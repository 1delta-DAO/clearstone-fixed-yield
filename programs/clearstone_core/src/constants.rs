// Compile-time invariants. These cannot change without a program upgrade,
// which is exactly the property the permissionless core depends on.

/// Maximum creator fee, in basis points. 2500 = 25%. Mirrors Morpho Blue.
/// See invariant I-E1 in PLAN.md §3.
pub const PROTOCOL_FEE_MAX_BPS: u16 = 2500;

/// Vault/market lifetime must be at least this many seconds. Shorter durations
/// run into numerical edge cases in the time curve (e.g. sec_remaining rounding)
/// and don't match any real fixed-yield use case.
pub const MIN_DURATION_SECONDS: u32 = 24 * 3600; // 1 day

/// Vault/market lifetime may not exceed this. Bounded to keep rate_scalar /
/// fee_rate math stable across the full life of the market.
pub const MAX_DURATION_SECONDS: u32 = 5 * 365 * 24 * 3600; // 5 years

/// Blue-style virtual-reserve floors. Used by the AMM to prevent first-LP
/// sandwich attacks and dust-inflation exploits.
///
/// The AMM math operates on (pt_balance + VIRTUAL_PT, sy_balance + VIRTUAL_SY)
/// so that:
///   - A 1-wei donation to the reserve accounts cannot meaningfully shift
///     the exchange rate (the virtual term dominates).
///   - The first LP sees a fixed `VIRTUAL_LP_FLOOR` "burned" into the mint
///     supply, closing the classic zero-supply sandwich hole.
///
/// Chosen at 1_000_000: large enough that dust donations are insignificant,
/// small enough that real liquidity quickly dominates for any realistic pool.
pub const VIRTUAL_PT: u64 = 1_000_000;
pub const VIRTUAL_SY: u64 = 1_000_000;

/// sqrt(VIRTUAL_PT * VIRTUAL_SY) — the initial LP floor that never appears
/// in user-held LP but participates in every proportional calculation. With
/// VP = VS = 1_000_000, this is exactly 1_000_000 (integer sqrt).
pub const VIRTUAL_LP_FLOOR: u64 = 1_000_000;

/// Maximum fraction of `market.financials.pt_balance` a single `flash_swap_pt`
/// may borrow, in basis points. 2500 = 25 % of pool PT per flash.
///
/// **Why this exists:** the AMM quote inside `flash_swap_pt` is computed once
/// against the pool reserves at flash-open. A solver who flashes the entire
/// pool can pair it with a tiny `min_dst_amount` on the fusion side, satisfy
/// the maker, and pocket the residual SY/PT spread at LP expense. Capping
/// `pt_out / pt_balance` at a small fraction keeps a single flash from
/// moving the curve so far that the snapshot quote becomes exploitable;
/// callers needing more notional must split across multiple flashes (which
/// each repay-and-resnap before the next opens, by I-F1).
///
/// 25 % is the same fraction Aave's V3 picks for its `MAX_LIQUIDATABLE_BPS`
/// — close enough to the AMM curve's "still roughly linear" regime that
/// `quote_trade_pt`'s snapshot remains a fair-ish price within rounding.
pub const FLASH_MAX_PT_BPS: u16 = 2500;

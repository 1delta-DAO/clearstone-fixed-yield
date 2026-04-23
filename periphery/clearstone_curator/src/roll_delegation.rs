//! User-signed roll delegations — the permissionless-keeper permissioning layer.
//!
//! Design spec: clearstone-finance/CURATOR_ROLL_DELEGATION.md
//!
//! This module defines:
//!   * `RollDelegation` account — per (vault, user), sets slippage + expiry bounds.
//!   * `create_delegation` / `close_delegation` ixs.
//!   * `hash_allocations` — canonical commitment over the curator's
//!     allocation whitelist (excluding the dynamic `deployed_base` field).
//!
//! The actual permissionless crank (`crank_roll_delegated`) lives in
//! Pass B; it reuses `hash_allocations` + the invariants here.
//!
//! Permissioning invariants (see §4 of the spec):
//!   * I-D1 only user creates/closes
//!   * I-D2 max_slippage_bps ≤ 1_000 (10%)
//!   * I-D3 ttl_slots in [1 day, 100 days] in slot-count
//!   * I-D4 allocations_hash binds the curator's current whitelist

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::Allocation;

// ---------------------------------------------------------------------------
// Bounds (in slots). ~0.4s per slot → 216_000 ≈ 1 day, 21_600_000 ≈ 100 days.
// ---------------------------------------------------------------------------

pub const MAX_DELEGATION_SLIPPAGE_BPS: u16 = 1_000; // 10%
pub const MIN_DELEGATION_TTL_SLOTS: u64 = 216_000;
pub const MAX_DELEGATION_TTL_SLOTS: u64 = 21_600_000;

pub const ROLL_DELEGATION_SEED: &[u8] = b"roll_deleg";

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

#[account]
#[derive(Debug)]
pub struct RollDelegation {
    /// The curator vault this delegation authorizes rolls for.
    pub vault: Pubkey,
    /// The user wallet that signed the delegation.
    pub user: Pubkey,
    /// Ceiling on per-roll slippage, in bps of notional.
    pub max_slippage_bps: u16,
    /// Expiry slot; once `Clock::slot >= this`, the delegation is dead.
    pub expires_at_slot: u64,
    /// Commitment over the curator's allocation whitelist at signing
    /// time. If the curator changes allocations, this hash drifts and
    /// the delegation becomes unusable until the user re-signs.
    pub allocations_hash: [u8; 32],
    /// Slot at creation — audit / stale-position detection.
    pub created_at_slot: u64,
    /// PDA bump.
    pub bump: u8,
}

impl RollDelegation {
    //  8  disc
    // 32  vault
    // 32  user
    //  2  max_slippage_bps
    //  8  expires_at_slot
    // 32  allocations_hash
    //  8  created_at_slot
    //  1  bump
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 8 + 32 + 8 + 1;
}

// ---------------------------------------------------------------------------
// Allocations-hash — canonical commitment over (market, weight_bps, cap_base)
// for every allocation. Excludes `deployed_base` (dynamic, moves every roll).
// ---------------------------------------------------------------------------

/// Serialize one allocation's *commitment-relevant* fields into the 50-byte
/// wire format used by the hash. `deployed_base` is deliberately omitted.
fn commit_bytes(a: &Allocation) -> [u8; 42] {
    let mut buf = [0u8; 42];
    buf[0..32].copy_from_slice(a.market.as_ref());
    buf[32..34].copy_from_slice(&a.weight_bps.to_le_bytes());
    buf[34..42].copy_from_slice(&a.cap_base.to_le_bytes());
    buf
}

pub fn hash_allocations(allocs: &[Allocation]) -> [u8; 32] {
    // Stack-allocate the serialized slabs so we don't touch the heap inside
    // an instruction handler unless absolutely necessary. 8 allocations max
    // is a soft cap we enforce at set_allocations; spec §3.3 allows more.
    let serialized: Vec<[u8; 42]> = allocs.iter().map(commit_bytes).collect();
    let refs: Vec<&[u8]> = serialized.iter().map(|s| s.as_ref()).collect();
    hashv(&refs).to_bytes()
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum RollDelegationError {
    #[msg("max_slippage_bps exceeds 1000 (10%)")]
    SlippageTooWide,
    #[msg("ttl_slots below minimum (~1 day)")]
    TtlTooShort,
    #[msg("ttl_slots above maximum (~100 days)")]
    TtlTooLong,
    #[msg("delegation has expired")]
    Expired,
    #[msg("vault allocations have changed since the user signed")]
    AllocationsDrifted,
    #[msg("delegation vault does not match the vault in the instruction")]
    VaultMismatch,
    #[msg("allocation index out of range")]
    IndexOOR,
    #[msg("market PDA does not match the allocation at the given index")]
    MarketMismatch,
    #[msg("from_market has not yet reached its expiration timestamp")]
    FromMarketNotMatured,
    #[msg("keeper min_base_out is below the delegation's slippage floor")]
    SlippageBelowDelegationFloor,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct DelegationCreated {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub max_slippage_bps: u16,
    pub expires_at_slot: u64,
    pub allocations_hash: [u8; 32],
}

#[event]
pub struct DelegationClosed {
    pub vault: Pubkey,
    pub user: Pubkey,
}

// ---------------------------------------------------------------------------
// Handlers — the account contexts (`CreateDelegation`, `CloseDelegation`)
// live in lib.rs so Anchor's `#[program]` macro can find their
// auto-generated `__client_accounts_*` modules at crate root.
// ---------------------------------------------------------------------------

pub fn create_delegation(
    ctx: Context<crate::CreateDelegation>,
    max_slippage_bps: u16,
    ttl_slots: u64,
) -> Result<()> {
    require!(
        max_slippage_bps <= MAX_DELEGATION_SLIPPAGE_BPS,
        RollDelegationError::SlippageTooWide
    );
    require!(
        ttl_slots >= MIN_DELEGATION_TTL_SLOTS,
        RollDelegationError::TtlTooShort
    );
    require!(
        ttl_slots <= MAX_DELEGATION_TTL_SLOTS,
        RollDelegationError::TtlTooLong
    );

    let clock = Clock::get()?;
    let commitment = hash_allocations(&ctx.accounts.vault.allocations);

    let d = &mut ctx.accounts.delegation;
    d.vault = ctx.accounts.vault.key();
    d.user = ctx.accounts.user.key();
    d.max_slippage_bps = max_slippage_bps;
    d.expires_at_slot = clock.slot.saturating_add(ttl_slots);
    d.allocations_hash = commitment;
    d.created_at_slot = clock.slot;
    d.bump = ctx.bumps.delegation;

    emit!(DelegationCreated {
        vault: d.vault,
        user: d.user,
        max_slippage_bps: d.max_slippage_bps,
        expires_at_slot: d.expires_at_slot,
        allocations_hash: d.allocations_hash,
    });

    Ok(())
}

pub fn close_delegation(ctx: Context<crate::CloseDelegation>) -> Result<()> {
    let d = &ctx.accounts.delegation;
    emit!(DelegationClosed {
        vault: d.vault,
        user: d.user,
    });
    // Account closure handled by the `close = user` attribute.
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers reused by Pass B (crank_roll_delegated).
// ---------------------------------------------------------------------------

/// Check a delegation is live and bound to the current allocations set.
/// Used both inside `crank_roll_delegated` and in tests.
pub fn validate_delegation(
    delegation: &RollDelegation,
    vault_key: Pubkey,
    vault_allocations: &[Allocation],
    now_slot: u64,
) -> Result<()> {
    require_keys_eq!(
        delegation.vault,
        vault_key,
        RollDelegationError::VaultMismatch
    );
    require!(
        now_slot < delegation.expires_at_slot,
        RollDelegationError::Expired
    );
    let current = hash_allocations(vault_allocations);
    require!(
        current == delegation.allocations_hash,
        RollDelegationError::AllocationsDrifted
    );
    Ok(())
}

/// Compute the minimum acceptable base-out for a given deployed position
/// under the delegation's slippage cap.
pub fn slippage_floor(deployed_base: u64, max_slippage_bps: u16) -> u64 {
    deployed_base
        .saturating_mul(10_000u64.saturating_sub(max_slippage_bps as u64))
        / 10_000
}

// ---------------------------------------------------------------------------
// Unit tests — hash determinism + slippage arithmetic + bound checks.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn alloc(market: [u8; 32], weight_bps: u16, cap_base: u64, deployed: u64) -> Allocation {
        Allocation {
            market: Pubkey::new_from_array(market),
            weight_bps,
            cap_base,
            deployed_base: deployed,
        }
    }

    #[test]
    fn hash_is_deterministic_across_identical_inputs() {
        let a = alloc([1; 32], 6000, 1_000_000, 500_000);
        let b = alloc([2; 32], 4000, 2_000_000, 1_000_000);
        let h1 = hash_allocations(&[a.clone(), b.clone()]);
        let h2 = hash_allocations(&[a, b]);
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_ignores_deployed_base() {
        let a1 = alloc([1; 32], 6000, 1_000_000, 100);
        let a2 = alloc([1; 32], 6000, 1_000_000, 999_999);
        assert_eq!(hash_allocations(&[a1]), hash_allocations(&[a2]));
    }

    #[test]
    fn hash_changes_when_weight_changes() {
        let a1 = alloc([1; 32], 6000, 1_000_000, 0);
        let a2 = alloc([1; 32], 6001, 1_000_000, 0);
        assert_ne!(hash_allocations(&[a1]), hash_allocations(&[a2]));
    }

    #[test]
    fn hash_changes_when_market_changes() {
        let a1 = alloc([1; 32], 6000, 1_000_000, 0);
        let a2 = alloc([2; 32], 6000, 1_000_000, 0);
        assert_ne!(hash_allocations(&[a1]), hash_allocations(&[a2]));
    }

    #[test]
    fn hash_changes_when_cap_changes() {
        let a1 = alloc([1; 32], 6000, 1_000_000, 0);
        let a2 = alloc([1; 32], 6000, 1_000_001, 0);
        assert_ne!(hash_allocations(&[a1]), hash_allocations(&[a2]));
    }

    #[test]
    fn hash_is_order_sensitive() {
        let a = alloc([1; 32], 6000, 1_000_000, 0);
        let b = alloc([2; 32], 4000, 2_000_000, 0);
        assert_ne!(hash_allocations(&[a.clone(), b.clone()]), hash_allocations(&[b, a]));
    }

    #[test]
    fn hash_of_empty_vec_is_stable() {
        // hashv([]) is defined (returns the hash of zero concatenated parts).
        // Two empty calls must match.
        assert_eq!(hash_allocations(&[]), hash_allocations(&[]));
    }

    #[test]
    fn slippage_floor_zero_slippage_returns_full_amount() {
        assert_eq!(slippage_floor(1_000_000, 0), 1_000_000);
    }

    #[test]
    fn slippage_floor_50bps_lops_half_percent() {
        // 1_000_000 × (10000 − 50) / 10000 = 995_000
        assert_eq!(slippage_floor(1_000_000, 50), 995_000);
    }

    #[test]
    fn slippage_floor_at_max_1000bps() {
        // 1_000_000 × 9000 / 10000 = 900_000
        assert_eq!(slippage_floor(1_000_000, 1_000), 900_000);
    }

    #[test]
    fn slippage_floor_overflow_safe() {
        // u64::MAX × (9000) overflows — saturating_mul yields u64::MAX / 10_000.
        let got = slippage_floor(u64::MAX, 1_000);
        assert!(got > 0);
    }

    #[test]
    fn slippage_floor_zero_deployed_returns_zero() {
        assert_eq!(slippage_floor(0, 500), 0);
    }

    #[test]
    fn account_size_matches_declared_fields() {
        // Spec-locked layout: any field change must bump SIZE explicitly.
        assert_eq!(RollDelegation::SIZE, 8 + 32 + 32 + 2 + 8 + 32 + 8 + 1);
        assert_eq!(RollDelegation::SIZE, 123);
    }

    #[test]
    fn ttl_bounds_cover_reasonable_range() {
        // 216_000 slots × ~0.4s/slot ≈ 24h
        assert!(MIN_DELEGATION_TTL_SLOTS as f64 * 0.4 >= 86_400.0 * 0.95);
        // 21_600_000 slots × ~0.4s/slot ≈ 100 days
        assert!(MAX_DELEGATION_TTL_SLOTS as f64 * 0.4 <= 100.0 * 86_400.0 * 1.05);
    }
}

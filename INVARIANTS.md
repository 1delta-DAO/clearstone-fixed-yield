# Clearstone Core — Invariant Specification

This document formalizes the safety properties of [clearstone_core](programs/clearstone_core/).
It is the entry point for auditors and the checklist for every PR.

For each invariant: **statement**, **why it matters**, **where enforced**,
**what tests prove it**, and **residual risk** (the gap between
enforcement and property).

## Invariant categories

- **I-V\*** — Vault invariants (SY escrow accounting).
- **I-M\*** — Market invariants (AMM reserves and LP supply).
- **I-C\*** — CPI / re-entrancy invariants.
- **I-E\*** — Economic invariants (fees, curation).

---

## Vault invariants

### I-V1 — Backing

**Statement.** At all times,
`sy_for_pt ≤ min(pt_supply / last_seen_sy_exchange_rate, total_sy_in_escrow - treasury_sy - uncollected_sy)`.

**Why.** PT holders must be redeemable. If `sy_for_pt` exceeds either the
exchange-rate-implied or the actual-escrow bound, a PT holder's redeem
can't be paid.

**Where enforced.**
[vault.rs:sy_backing_for_pt](programs/clearstone_core/src/state/vault.rs)
computes the min. Called from `Vault::set_sy_for_pt`, invoked after every
state-mutating SY flow (strip, merge, collect_interest, stage_yield, add_emission).

**Tests.** Covered indirectly by invariants in
[market_two.rs virtualization_tests](programs/clearstone_core/src/state/market_two.rs).
Direct fuzz coverage is a M6 carve-out (see FOLLOWUPS.md).

**Residual risk.** `sy_for_pt` is recomputed per-op. If an op mutates
`total_sy_in_escrow` or `pt_supply` and then returns without calling
`set_sy_for_pt`, the field becomes stale — no test catches this today.
Audit: check every state-mutating handler ends with a `set_sy_for_pt`
call on code paths that touched these fields.

---

### I-V2 — Non-negative balances

**Statement.** `total_sy_in_escrow ≥ treasury_sy + uncollected_sy + sy_for_pt`.

**Why.** The vault must never "owe" more SY than it holds.

**Where enforced.** Implicit via the `sy_for_pt` minimum computation in
I-V1 and the `checked_add` / `checked_sub` mutators on `Vault`
(`inc_treasury_sy`, `dec_treasury_sy`, `inc_uncollected_sy`, etc. —
[vault.rs](programs/clearstone_core/src/state/vault.rs)). Each panics on
under/overflow, which aborts the instruction.

**Tests.** `Vault::sy_balance_invariant` is a `#[cfg(test)]`-only
assertion helper on the vault struct. No active test calls it yet.

**Residual risk.** Enforcement relies on every mutator being the
`inc_/dec_` helpers — a direct `vault.treasury_sy -= n` bypass would skip
the check. Audit: grep for direct writes to these fields.

---

### I-V3 — ATH monotonicity

**Statement.** `vault.all_time_high_sy_exchange_rate` never decreases.

**Why.** SY exchange rate drops trigger "emergency mode" (no new strips
allowed); the ATH is the high-water mark that defines the PT backing
ceiling.

**Where enforced.**
[vault.rs:update_from_sy_state](programs/clearstone_core/src/state/vault.rs) —
`self.all_time_high_sy_exchange_rate = cur_rate.max(self.all_time_high_sy_exchange_rate)`.
The `.max()` is the only write site.

**Tests.** Not directly covered.

**Residual risk.** If a path mutates `all_time_high_sy_exchange_rate`
directly (bypassing `update_from_sy_state`), the invariant breaks.
Also depends on the SY program's return being monotone — if the SY lies,
ATH is still pinned at the previous local max but subsequent
`exchange_rate` values could be lower (triggering emergency mode), which
is the intended defensive behavior.

---

### I-V4 — Maturity freeze

**Statement.** After `start_ts + duration`, `final_sy_exchange_rate` is
frozen.

**Why.** Matured PT settles at `final_sy_exchange_rate`. If it kept
moving post-maturity, PT holders who haven't redeemed yet get reopened
exposure to SY drift.

**Where enforced.**
[vault.rs:update_from_sy_state](programs/clearstone_core/src/state/vault.rs) —
the `if self.is_active(now)` gate around `self.final_sy_exchange_rate = cur_rate`.

**Tests.** Not directly covered.

**Residual risk.** Same write-site gating as I-V3. Grep for direct
writes to `final_sy_exchange_rate`.

---

### I-V5 — No Creator Lambo

**Statement.** The creator has no path to drain SY belonging to PT/YT
holders. Only `treasury_sy` flows are creator-accessible.

**Why.** The permissionless-creation model depends on creator power
being strictly bounded.

**Where enforced.**
[vault/admin/treasury/collect_treasury_interest.rs](programs/clearstone_core/src/instructions/vault/admin/treasury/collect_treasury_interest.rs) —
the only vault-draining handler a curator can call. The
`CollectTreasuryInterestKind::TreasuryInterest` path reads `vault.treasury_sy`
as the ceiling via `amount.to_u64(vault.treasury_sy)`.

**Tests.** Not directly covered at integration level. Curator-auth tests
for `modify_vault_setting` are in the M6 skip-list.

**Residual risk.** The curator can pass `CollectTreasuryInterestKind::YieldPosition`
too, but that only drains the robot's yield position, not PT holders'
backing. The robot's position is itself bounded by the vault's own
accrual rules. Still worth an auditor's eye: verify the two `Kind`
paths together can't exceed `treasury_sy + uncollected_robot_sy`.

---

## Market invariants

### I-M1 — Reserve accounting

**Statement.** `MarketFinancials.pt_balance` and `sy_balance` exactly
match the underlying token-account balances after every instruction.

**Why.** The AMM math reads these tracked values. If they drift from
the real escrow, swap math prices trades against a phantom reserve.

**Where enforced.**
[market_two.rs](programs/clearstone_core/src/state/market_two.rs) —
all reserve mutations go through `inc_pt_balance`/`dec_pt_balance`/
`inc_sy_balance`/`dec_sy_balance`, each tied 1:1 to the matching SPL
transfer in the calling instruction.

**Tests.** Partial — `add_liquidity_handles_empty_real_reserves` and
`add_liquidity_proportional_at_scale` in
[virtualization_tests](programs/clearstone_core/src/state/market_two.rs#virtualization_tests).

**Residual risk.** Direct transfers *to* the market's escrow accounts
(donations) inflate the real balance but not the tracked value. This is
intentional — the tracked value is the AMM's source of truth, and
virtual-share math (I-M3) makes donations ineffective.

---

### I-M2 — LP supply ↔ reserves

**Statement.** LP mint supply is a monotonic function of reserve
additions; no free-mint path exists.

**Why.** If LP could be minted without adding reserves, the pool could
be drained by an outsized withdraw.

**Where enforced.**
- Init mint: [market_two_init.rs:calc_lp_tokens_out](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)
  — `sqrt((pt+VP)(sy+VS)) - VIRTUAL_LP_FLOOR`, burned slice is permanent.
- Subsequent mints: [market_two.rs:add_liquidity](programs/clearstone_core/src/state/market_two.rs)
  — exponent_time_curve's `min(intent_pt/reserves_pt, intent_sy/reserves_sy) * total_lp`.
- Withdraw: [market_two.rs:rm_liquidity](programs/clearstone_core/src/state/market_two.rs)
  — proportional output.

**Tests.**
- [first_lp_sandwich_attempt_is_negligible](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)
- [add_liquidity_matches_classic_for_large_pools](programs/clearstone_core/src/state/market_two.rs)
- [add_liquidity_proportional_at_scale](programs/clearstone_core/src/state/market_two.rs)

**Residual risk.** `rm_liquidity` clamps outputs to real reserves (see
M3 carve-out in FOLLOWUPS.md). On near-empty pools this can produce a
tiny supply/reserve asymmetry. Audit: fuzz near-empty-pool withdrawals.

---

### I-M3 — Virtual shares floor

**Statement.** First LP cannot capture an outsized share of a later
dust deposit. A dust donation to the escrow does not meaningfully shift
the AMM exchange rate.

**Why.** Blocks the Uniswap-v2-first-depositor sandwich class of attacks.

**Where enforced.**
[market_two.rs v_pt_balance / v_sy_balance](programs/clearstone_core/src/state/market_two.rs)
virtualize every curve read. [constants.rs](programs/clearstone_core/src/constants.rs)
defines `VIRTUAL_PT = VIRTUAL_SY = VIRTUAL_LP_FLOOR = 1_000_000`.

**Tests.**
- [donation_attack_barely_shifts_virtual_view](programs/clearstone_core/src/state/market_two.rs)
- [large_donation_bounded_shift](programs/clearstone_core/src/state/market_two.rs)
- [first_lp_sandwich_attempt_is_negligible](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)

**Residual risk.** The virtual constants are the same across all
markets. A market with base-mint decimals vastly smaller than 6 could
see the virtual floor dominate real liquidity for longer than expected.
Audit: verify the chosen constants work for the smallest-decimal mint
ever expected on mainnet.

---

### I-M4 — No cross-market leakage

**Statement.** No instruction takes two different `Vault` or two
different `MarketTwo` accounts simultaneously.

**Why.** Prevents a curator or attacker from routing state between
isolated markets (which would break the per-market trust boundary).

**Where enforced.** By Anchor's `#[derive(Accounts)]` structure: every
mutating instruction has exactly one `Vault` (or one `MarketTwo`) field.
Grep-based audit over
[src/instructions/](programs/clearstone_core/src/instructions/).

**Tests.** Not directly covered; this is a static property of the account
structs.

**Residual risk.** `remaining_accounts` slots are untyped and could
smuggle a second vault. Audit: every use of `ctx.remaining_accounts`
should be documented with what it's expected to contain.

---

### I-M5 — Curve monotonicity

**Statement.** Implied rate updates produce a PT price inside [0, 1] in
base-asset terms.

**Why.** A PT priced above 1 base unit would imply negative yield —
impossible for a principal token.

**Where enforced.** The `exponent_time_curve` math library's
`trade` and `ln_implied_rate` functions. Not re-verified in core.

**Tests.** None in clearstone_core. This is trusted-library behavior.

**Residual risk.** Depends on upstream `exponent_time_curve` correctness.
Treat that library as auditor-in-scope.

---

## CPI / re-entrancy invariants

### I-C1 — Reentrancy lock

**Statement.** A `reentrancy_guard: bool` on Vault/MarketTwo is set to
`true` before any CPI into the SY program and cleared after. Any
reentrant call that itself attempts a second CPI sees the set byte
and fails with `ReentrancyLocked`.

**Why.** A malicious SY program can re-enter during its own CPI. The
guard blocks that.

**Where enforced.**
[reentrancy.rs](programs/clearstone_core/src/reentrancy.rs) — `latch` /
`unlatch` raw-byte helpers at compile-time-known offset
`GUARD_BYTE_OFFSET = 42` (the layout position of `reentrancy_guard` in
both Vault and MarketTwo). Called from inside every SY CPI wrapper in
[utils/sy_cpi.rs](programs/clearstone_core/src/utils/sy_cpi.rs) —
`cpi_deposit_sy`, `cpi_withdraw_sy`, `cpi_get_sy_state`,
`cpi_claim_emission`, `cpi_get_position`. Every call site in core
passes `&ctx.accounts.vault.to_account_info()` (or `.market.`) as the
guard; there are no unguarded SY CPIs in-tree.

**Tests.**
[reentrancy::tests](programs/clearstone_core/src/reentrancy.rs) — unit
tests on the `Reentrant` trait, `latch/unlatch` through the dummy
struct, and `guard_offset_matches_layout` catches any prefix-field
change that would silently move the guard byte. Runtime test via a
malicious SY mock is the M6 carve-out.

**Residual risk.** Guard offset depends on the Vault/MarketTwo layout.
The test above pins it; any prefix-field addition has to update both
`GUARD_BYTE_OFFSET` and the test.

---

### I-C2 — State settled before CPI

**Statement.** All mutable account state relevant to user balances is
written to disk before an untrusted SY CPI.

**Why.** If state is mutated in-memory but not persisted before the CPI,
a reentrant call reads stale on-chain state and can corrupt accounting.

**Where enforced.** Two layers:
- The guard byte itself is flushed by `latch()` inside each CPI helper
  (it writes the byte via `try_borrow_mut_data`, so it hits disk
  immediately).
- For other mutated fields, the relevant handlers do an explicit borsh
  serialize before the CPI — see
  [merge.rs](programs/clearstone_core/src/instructions/vault/merge.rs),
  [collect_interest.rs](programs/clearstone_core/src/instructions/vault/collect_interest.rs),
  [trade_pt.rs](programs/clearstone_core/src/instructions/market_two/trade_pt.rs),
  [deposit_liquidity.rs](programs/clearstone_core/src/instructions/market_two/deposit_liquidity.rs),
  [withdraw_liquidity.rs](programs/clearstone_core/src/instructions/market_two/withdraw_liquidity.rs),
  [market_two_init.rs](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs).

**Tests.** None directly (harder to prove without a runtime harness).

**Residual risk.** Borsh serialization rewrites the whole account — if
the struct gains a derived-only field that doesn't round-trip through
borsh, it'd be lost. Audit: every `Vault` / `MarketTwo` field is
`AnchorSerialize`.

---

### I-C3 — Return-data discipline

**Statement.** `SyState` return values are validated before use.

**Why.** The SY program is untrusted; a malformed or malicious return
value should fail closed.

**Where enforced.**
[utils/sy_cpi.rs validate_sy_state](programs/clearstone_core/src/utils/sy_cpi.rs)
— checks `exchange_rate > 0` and `emission_indexes.len() == expected`.
Called from strip, merge, collect_interest, collect_emission. `trade_pt`
only checks `exchange_rate > 0` (markets don't track emissions post-M4).

**Tests.**
[validation_tests](programs/clearstone_core/src/utils/sy_cpi.rs) —
4 tests on validator edge cases.

**Residual risk.** `cpi_mint_sy` and `cpi_redeem_sy` (wrapper-only,
currently unused by core) don't validate the `MintSyReturnData` /
`RedeemSyReturnData` before use. When the router lands (M4 followup),
wire validation there too.

---

## Economic invariants

### I-E1 — Protocol fee bounded

**Statement.** `PROTOCOL_FEE_MAX_BPS` is a compile-time constant (2500
= 25%). Runtime fee is `min(creator_fee_bps, PROTOCOL_FEE_MAX_BPS)`.

**Why.** Permanent ceiling on creator extraction.

**Where enforced.**
[constants.rs](programs/clearstone_core/src/constants.rs) defines
`PROTOCOL_FEE_MAX_BPS = 2500`. Init handlers for both vault and market
require `creator_fee_bps <= PROTOCOL_FEE_MAX_BPS`
([initialize_vault.rs](programs/clearstone_core/src/instructions/vault/admin/initialize_vault.rs),
[market_two_init.rs](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)).

**Tests.** Not directly covered — integration-test-shaped.

**Residual risk.** The constant is shared by vault and market. If a
future change needs different ceilings, this aggregates them.

---

### I-E2 — Creator fee immutable post-init

**Statement.** `creator_fee_bps` cannot be raised once the vault/market
is live. It can be lowered (one-way ratchet).

**Why.** Users onboarding relied on the creator-declared ceiling when
they decided to deposit.

**Where enforced.** `modify_vault_setting` / `modify_market_setting`
only contain `LowerInterestBpsFee` / `LowerTreasuryTradeSyBpsFee` /
`LowerEmissionBpsFee` variants — no "set" or "raise" variant exists.
Enforced via `require!(new <= current, FeeNotRatchetDown)`.
See [modify_vault_setting.rs](programs/clearstone_core/src/instructions/vault/admin/modify_vault_setting.rs)
and [modify_market_setting.rs](programs/clearstone_core/src/instructions/market_two/admin/modify_market_setting.rs).

Also: `ChangeMaxPySupply`, `SetMaxLpSupply`, `ChangeLnFeeRateRoot`,
`ChangeRateScalarRoot` were removed from the modify enums in M2 — those
parameters are set at init and frozen.

**Tests.** Not directly covered — integration-test-shaped.

**Residual risk.** `creator_fee_bps` itself is also not modifiable
post-init (it's the cap, not the active fee). Stored but never written
after `init`. Audit: grep for writes to `creator_fee_bps` after init
handler.

---

## Invariant-coverage audit checklist

Run before every PR that touches state or CPI:

- [ ] No CPI into an untrusted program without prior state serialization.
- [ ] No state mutation after an untrusted CPI without a `reload()`.
- [ ] Every entrypoint starts with `reentrancy::enter(...)` if it touches
      a Vault/MarketTwo that does SY CPIs (see I-C1 carve-out).
- [ ] Every exit path clears the guard (including error paths — current
      impl relies on tx revert; document if we add partial-success paths).
- [ ] No `ctx.remaining_accounts` use that could swap in alternate
      vault/market accounts.
- [ ] All `has_one` / seed constraints are strict.
- [ ] No arithmetic without `checked_*` / `saturating_*` / wrapping semantics.
- [ ] No `unwrap()` on user-supplied inputs.
- [ ] `Number` / `DNum` ops handle zero / infinity cases.
- [ ] SY state returns are validated before use (I-C3).
- [ ] Creator-gated modify actions cannot violate I-E1 / I-E2.
- [ ] No instruction takes two `Vault` or two `MarketTwo` accounts.
- [ ] All `close` / realloc paths re-check curator signer.

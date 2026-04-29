# Follow-ups

Tracked deviations from PLAN.md. This file is the live punch-list for
work that wasn't finished by the milestone that opened it. Resolved
items have been pruned out; see git history (`git log -- FOLLOWUPS.md`)
for the full record of what shipped and when.

---

## CURATOR_REALLOCATE_DEDUP — Extract reallocate inner helpers

Opened by: roll-delegation Pass B.
Partial progress: `crank_roll_delegated` was refactored under
`mod crank_cpi` (`do_withdraw_liquidity`, `do_trade_pt_sell`,
`do_redeem_sy`, `do_mint_sy`, `do_deposit_liquidity`).
Still inlined: `reallocate_to_market` and `reallocate_from_market`
([periphery/clearstone_curator/src/lib.rs](periphery/clearstone_curator/src/lib.rs))
duplicate the same three-step CPI shape.

To close: route both `reallocate_to_market` and `reallocate_from_market`
through the existing `crank_cpi::*` helpers (or extract a slightly
broader set that takes a `&dyn ReallocateAccts` view). Behavior must
be identical — bit-for-bit same emitted events, same CPI argument
order. Gated on integration tests for both reallocate paths landing
first; refactoring proven curator-signed code without regression
coverage is riskier than the duplication.

---

## CURATOR_ROLL_DELEGATION_V1_1 — Keeper tips + configurable PT/SY intent split

Opened by: roll-delegation Pass B §8.

v1 `crank_roll_delegated` hardcodes the to-leg's `pt_intent = 0`,
which means the roll parks the unwound base entirely as SY-sided
liquidity on the next market's AMM. For a real auto-roll product that
tracks the curator's allocation weights, the ix should accept
`pt_buy_amount` + `pt_intent` + `sy_intent` as additional parameters
bounded by the delegation's slippage cap.

Also opens: keeper tip. Add `tip_bps: u16` to `RollDelegation` (capped
at ~10 bps). At end of handler, transfer `tip_bps × base_out / 10_000`
from `base_escrow` to the keeper's base-ATA. Makes crank runs
self-funding — MEV-tolerant keepers will compete on latency, not
custody.

---

## KAMINO_MODE_REALLOCATE_FROM — Symmetric Kamino path on the from-side

Opened by: kamino real-klend integration (devnet 2026-04-26).

`reallocate_to_market` was upgraded to dispatch on `sy_program` and
build a 20-account real-klend `mint_sy` CPI when targeting
`kamino_sy_adapter`. The symmetric flows still use the legacy
generic-only path:

- `reallocate_from_market` → adapter `redeem_sy` (currently mock-klend
  shape only)
- `crank_roll_delegated` → adapter `redeem_sy` + `mint_sy` (same)

Tractable in the same shape as the to-side fix — extend the kamino
optional-account pattern across both. Tracked in
[deployments/devnet.json](deployments/devnet.json) `kaminoStack._note`.

---

## CURATOR_WITHDRAW_WITH_PULL — Slow-path withdraw that pulls from allocations

Opened by: M7 curator withdraw.

Today's `withdraw` is fast-path only: pays from `base_escrow`. If the
escrow is short because base is deployed into markets, withdraw fails
with `InsufficientAssets` and the user must wait for the curator to
rebalance liquidity in. A `withdraw_with_pull` variant that pulls
from one allocation on demand (curator-signed, slippage-bounded) is
future work. Not blocking for v1.

---

## REWARDS_STAKE_POSITION_INIT_AUDIT — `init_if_needed` re-init review

Opened by: M7 periphery review.

`StakePosition` is `init_if_needed`; re-entry paths are constrained by
`seeds + has_one = owner`, but no proof exists that no craft sequence
wipes `per_farm` data. Auditor task: walk the state machine and
confirm. If a hole is found, gate the re-init branch with a `bump`
or `discriminator-already-set` check.

---

## M8 — Multisig upgrade authority

Opened by: M8 operational prep.

Current devnet upgrade authority is a single cold key
`Hro4y3Xd3g82YzLoKDV3uyJoQCVSqLE8nYDRdutLXhdU` for all six shipped
programs. Pre-mainnet:

1. Stand up a Squads multisig (3-of-5 recommended for bringup) with
   identified human signers from the core team.
2. Transfer upgrade authority via
   `solana program set-upgrade-authority` for each of:
   `clearstone_core`, `generic_exchange_rate_sy`, `kamino_sy_adapter`,
   `clearstone_rewards`, `clearstone_curator`, `clearstone_router`.
3. Document the signer set, rotation policy, and the
   burn-authority cutover criterion (typically: all audit findings
   closed + two weeks of mainnet soak).
4. Commit the multisig address to AUDIT_SCOPE.md, replacing the
   "should be a multisig" placeholder.

Same steps apply to the two test-only mocks
(`malicious_sy_*`) — they don't ship to mainnet.

---

## RESOLVED — see git history

The following items closed since the file was first written. Listed
here as a pointer; full text is in earlier revisions.

- M2 — Reentrancy guard coverage (now via `latch/unlatch` in
  `utils/sy_cpi.rs`; all 17 SY CPI sites covered)
- M3 — Virtual-share fuzz tests + rm_liquidity clamp analysis
- M4 — Periphery: 12 router wrappers + vault-level emissions seeding
- M5 — ATH monotonicity in reference adapter
- M5 — Reference adapter runtime-exercised end-to-end
- M6 — Integration test suite (now 75 passing including KYC pass-through
  and flash_swap_pt/_sy)
- M7 — Curator deposit/withdraw, harvest_fees, reallocate, set_allocations,
  mark_to_market
- M7 — Rewards refill_farm, decommission_farm, realloc_stake_position,
  claim_farm_emission
- M7 — Events on every state-changing periphery ix
- M-KYC-0..6 — KYC pass-through (transfer_checked migration, governor +
  delta_mint integration via `[[test.genesis]]` clones, GovernorWhitelist
  test green)
- KAMINO_REAL_KLEND — to-side adapter rebuild against real-klend's
  12-account layout, devnet-deployed
- CURATOR_CRANK_STACK_OVERFLOW — converted to `UncheckedAccount`s,
  TO-side ATA pre-create on the keeper
- CURATOR_CRANK_HANDLER_FRAME — ambient FnOnce warning identified as
  not from `crank_roll_delegated`; non-blocking
- M8 — IDL freeze (committed under `idl/*.json`) + reproducible-build
  hashes (`scripts/devnet-verify-hashes.sh`)

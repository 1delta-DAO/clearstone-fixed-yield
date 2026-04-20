# Follow-ups

Tracked deviations from PLAN.md. Each entry: which milestone left it, why,
and what it would take to close. Items that have been closed since first
written are struck through.

---

## ✅ M2 — Reentrancy guard coverage (**RESOLVED**)

Initial state: 5 instructions wrapped with `enter/persist/leave`; 7 others
(buy_yt, sell_yt, deposit_liquidity, withdraw_liquidity, stage_yield,
deposit_yt, withdraw_yt) left unguarded because the naive pattern collided
with self-CPI chains.

Resolution: guard pushed down into the CPI helpers themselves
([utils/sy_cpi.rs](programs/clearstone_core/src/utils/sy_cpi.rs)). Every
`cpi_deposit_sy`/`cpi_withdraw_sy`/`cpi_get_sy_state`/`cpi_claim_emission`/
`cpi_get_position` now takes a `guard: &AccountInfo` and wraps its invoke
in [latch/unlatch](programs/clearstone_core/src/reentrancy.rs) at byte
offset 42 — the reentrancy_guard position in both Vault and MarketTwo.

Every SY CPI in the codebase is now guarded — all 17 call sites across 14
handlers. The 5 originally-wrapped handlers had their outer
enter/persist/leave removed; the 7 previously-unguarded handlers got
coverage by passing `&ctx.accounts.vault.to_account_info()` (or
`.market.`) into the helper. Self-CPI chains work because each inner
instruction's SY CPI gets its own latch window — no outer-instruction
guard to collide with.

New test: [guard_offset_matches_layout](programs/clearstone_core/src/reentrancy.rs)
catches any prefix-field addition that would silently move the guard byte.

**Still open:** the runtime mock-SY-reentrancy test (M6).

## ✅ M5 — ATH monotonicity in reference adapter (**RESOLVED**)

[generic_exchange_rate_sy::poke_exchange_rate](reference_adapters/generic_exchange_rate_sy/src/lib.rs)
now requires `new_rate >= current`. Rejects regressions with
`ExchangeRateRegression`. Previously accepted any positive value, which
could have stripped value from PT/YT holders on vaults wired to it.

## ✅ M7 — Curator `withdraw` (**RESOLVED**)

Fast-path withdraw lands: burns shares, pays pro-rata base from
`base_escrow`, uses the same Blue-style virtualization as `deposit`. See
[clearstone_curator::withdraw](periphery/clearstone_curator/src/lib.rs).
If the escrow is short because base is deployed into markets via
`rebalance` (still TODO), withdraw fails with `InsufficientAssets` and
the user must wait for the curator to rebalance liquidity in. A
`withdraw_with_pull` slow path that pulls from allocations on demand is
future work.

## ✅ M7 — Rewards `claim_farm_emission` (**RESOLVED**)

Implemented. Reward escrow is now an ATA of the `farm_state` PDA
(set up via `init_if_needed` in
[add_farm](periphery/clearstone_rewards/src/lib.rs)). The claim ix runs
`update_indexes → settle_user → zero the claimable slot → signed
transfer out of the ATA`. Zeroing before transfer closes the reentrant
double-claim window.

---

## M8 — Operational prep (still open)

### Multisig upgrade authority

Before audit kickoff:

1. Stand up a Squads multisig (3-of-5 recommended for bringup) with
   identified human signers from the core team.
2. Transfer upgrade authority to the multisig via
   `solana program set-upgrade-authority`.
3. Document the signer set, rotation policy, and the burn-authority
   cutover criterion (typically: all audit findings closed + two weeks
   of testnet soak).
4. Either commit the multisig address to the repo as part of
   AUDIT_SCOPE.md, or keep it in a private ops runbook.

Same steps apply to `generic_exchange_rate_sy` and the two periphery
programs.

### Interface freeze bit-for-bit

[INTERFACE.md](INTERFACE.md) is the human-readable freeze. The
machine-readable freeze is the Anchor IDL — committed at the audit tag to
`target/idl/clearstone_core.json` + `target/types/clearstone_core.ts`.
Not generated yet (needs `anchor build`). Pre-audit:

- [ ] `anchor build` green.
- [ ] Copy generated IDL into repo root under `idl/` so it's reviewable
  independent of build artifacts.
- [ ] Tag the commit. Any further IDL change before audit completes
  triggers a re-freeze review.

### Reproducible build verification

AUDIT_SCOPE.md names `solanafoundation/solana-verifiable-build:2.3.8`.
Not yet verified that the current code actually builds reproducibly in
that image. Run `solana-verify build --library-name clearstone_core` once,
publish the hash, pin into the audit tag.

## M7 — Periphery: remaining gaps

### clearstone_rewards

- **`refill_farm`**: curator tops up the reward ATA after initial
  funding. 3-line SPL transfer wrapping — intentionally deferred to the
  first real integration.
- **`StakePosition` realloc**: the `per_farm` vec grows on every
  stake/unstake as new farms are added; account space was allocated for
  `n_farms` at init and isn't realloc'd. Audit blocker if farms are
  added after positions exist.
- **Farm decommissioning**: no path to remove a finished farm. Not
  strictly needed — farms past their `expiry_timestamp` stop accruing
  and can be left in place — but it grows `FarmState` monotonically.
- **`init_if_needed` re-init**: `StakePosition` is init_if_needed;
  re-entry paths are constrained by `seeds + has_one = owner`, but an
  auditor should confirm no craft sequence wipes `per_farm` data.

### clearstone_curator

- **`rebalance`**: still returns `NotYetImplemented`. This is the heart
  of MetaMorpho: walk `allocations`, compare `deployed_base` vs target,
  CPI-deposit or CPI-withdraw against each core market. Needs full CPI
  plumbing to `clearstone_core::market_two_deposit_liquidity` /
  `_withdraw_liquidity`.
- **Performance-fee harvesting**: `fee_bps` stored but not applied.
  Needs a periodic `harvest` ix that measures `total_assets` growth
  since last harvest and mints curator shares equal to the fee.
- **`total_assets` reconciliation**: today `deposit` / `withdraw` track
  1:1 with idle base. Once `rebalance` is in, `total_assets` must track
  base-equivalent of all allocations (read PT valuations from markets).
- **`allocations` realloc**: vec grows without bound; `set_allocations`
  realloc path needed.

### Both

- No events on state-changing ixns.
- No tests. Once the gaps above are filled, add tests parallel to
  core's virtualization_tests.

## M6 — Integration test suite: nearly complete

**All non-reentrancy tests landed as real `it(...)` bodies** against
the generated IDL types. `anchor build` + `tsc --noEmit` green.

Coverage by category:

- **Adapter smoke** (2): init + mintSy roundtrip; pokeExchangeRate ATH
  monotonicity.
- **Happy path** (3): permissionless SY→vault→market, strip↔merge
  roundtrip (I-M2), trade_pt balance deltas.
- **Malicious-SY isolation** (3): zero exchange rate → `SyInvalidExchangeRate`
  via nonsense mock mode 1; length mismatch → `SyEmissionIndexesMismatch`
  via mode 2; honest-market-stays-alive proof (I-V1..5 per-market
  isolation).
- **Curator auth** (5): non-curator rejected on both modify ixns, fee
  ratchet-down + raise-rejection, plus 2 compile-time enum type pins
  for `AdminAction` / `MarketAdminAction`.
- **AMM invariants** (3): 1-wei SY donation doesn't shift trade_pt
  output beyond 1% (I-M3); first-LP sandwich capped at proportional
  share; add → withdraw ≤ original deposit (I-M2).

**Remaining skipped: reentrancy (3).** The guard mechanics are
already proven by Rust unit tests in [reentrancy::tests](programs/clearstone_core/src/reentrancy.rs)
(`guard_offset_matches_layout`, `enter_on_set_latch_fails`,
`enter_leave_enter_roundtrip`, plus 24/24 in `cargo test`). The
runtime mock would add end-to-end assurance but designing a
`malicious_sy_reentrant` that can reconstruct a valid CPI back into
core from inside its own CPI boundary is non-trivial — the attacker
only receives the accounts listed in `CpiAccounts.deposit_sy` (7 for
the generic adapter), which don't include the vault account needed
to construct a second strip. A proper runtime demonstration would
need a custom `malicious_sy_reentrant` adapter whose Accounts struct
includes the vault directly so it can re-invoke. M8 blocker.

## M5 — Reference adapter runtime-untested

Adapter compiles and now enforces ATH monotonicity. Still not exercised
at runtime (blocked by the M6 harness). Known gaps documented inline:

- **Account-order convention for `cpi_accounts`**: core's
  [CpiAccounts](programs/clearstone_core/src/state/cpi_common.rs)
  configures which accounts get passed to each SY CPI. Vault/market
  creators have to wire this up to match the adapter's
  `#[derive(Accounts)]` order. No tooling yet.
- **Separate base_vault and pool_escrow**: mint_sy/redeem_sy use
  `base_vault`; deposit_sy/withdraw_sy use `pool_escrow`. Intentional
  (the two flows hold different assets), but worth spelling out to
  curators.
- **No supply cap / emissions**: out of scope for this reference.

## M4 — Periphery programs: partial

**Router landed** — 3 of 12 wrappers written as template:
[periphery/clearstone_router](periphery/clearstone_router/src/lib.rs).
Covers `wrapper_strip` (base → PT+YT via `adapter.mint_sy` →
`core.strip`), `wrapper_merge` (PT+YT → base via `core.merge` →
`adapter.redeem_sy`), and `wrapper_buy_pt` (base → PT via
`adapter.mint_sy` → `core.trade_pt` buy). Registered in
`Anchor.toml`, builds with the workspace. Program ID
`DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW`.

**Still open:** 9 remaining wrappers
(`wrapper_provide_liquidity`, `wrapper_sell_pt`, `wrapper_buy_yt`,
`wrapper_sell_yt`, `wrapper_collect_interest`,
`wrapper_withdraw_liquidity`, `wrapper_withdraw_liquidity_classic`,
`wrapper_provide_liquidity_base`, `wrapper_provide_liquidity_classic`).
Each follows the pattern: outer Accounts = union of inner-ix accounts;
handler stitches CPIs. Template is proven.

**Vault-level emissions** — kept on `Vault.emissions: Vec<EmissionInfo>`
per §10 Q4. The admin-side `add_emission` was deleted in M4; emissions
now need to be seeded at vault init (pass the list as a handler param)
or via a new `modify_vault_setting` variant. Neither is wired.
Low priority: SY programs that don't emit extra tokens work fine.

## M3 — Fuzz + clamp

- **Virtual-share fuzz tests** — plan calls for parametric first-LP
  sandwich + donation-attack scenarios. Rust unit tests cover specific
  cases; a property-based suite (proptest / quickcheck) would extend
  coverage.
- **rm_liquidity clamp analysis** — the clamp to real reserves can
  produce a tiny supply/reserve asymmetry on near-empty pools. Worth
  checking whether this shows up at realistic liquidity sizes during
  M6 integration runs.

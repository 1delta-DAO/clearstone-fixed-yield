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

**Still open:** ~~the runtime mock-SY-reentrancy test (M6)~~ — resolved
below.

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

- ~~**`refill_farm`**~~: landed. Curator-gated (`has_one = curator`) SPL
  transfer from the curator's token account to the farm-state-owned
  reward ATA. Guards against an unknown `reward_mint` via explicit
  farm-lookup.
- ~~**`StakePosition` realloc`**~~: landed. Added `realloc_stake_position`
  (owner-only, Anchor `realloc` attribute with
  `StakePosition::space(farm_state.farms.len())`). Every
  accrual-touching ix (`stake_lp` / `unstake_lp` / `claim_farm_emission`)
  now front-guards via `require_position_fits` — fails fast with
  `StalePosition` if the account is too small for the current farm
  count, pointing users at the realloc ix.
- ~~**Farm decommissioning**~~: landed. `decommission_farm` is
  curator-gated, requires `now >= expiry_timestamp` on the target
  farm (so a live stream can't be yanked from under stakers), sweeps
  any leftover reward_escrow balance to a curator-supplied drain
  account, and shrinks `FarmState` by one `Farm` entry via Anchor
  realloc. Stakers whose `per_farm` tail entry now refers to an
  orphaned slot keep their claimable data untouched — intentional;
  a curator-triggered flow shouldn't wipe user-visible data.
- **`init_if_needed` re-init**: `StakePosition` is init_if_needed;
  re-entry paths are constrained by `seeds + has_one = owner`, but an
  auditor should confirm no craft sequence wipes `per_farm` data.

### clearstone_curator

- ~~**`rebalance`**~~: landed as two primitives instead of one fat ix.
  `reallocate_to_market` does 3 inner CPIs (adapter.mint_sy →
  core.trade_pt buy → core.deposit_liquidity) to push base from
  `base_escrow` into one market's LP, updating `allocations[i].deployed_base`.
  `reallocate_from_market` mirrors it (withdraw_liquidity →
  trade_pt sell → redeem_sy) to pull back out. The vault PDA signs all
  inner CPIs via the cached bump on `CuratorVault`. Curator authorizes
  the outer ix.  The higher-level "walk all allocations and rebalance
  to weights" loop lives off-chain; it just dispatches these two.
- ~~**Performance-fee harvesting**~~: landed as `harvest_fees`. Takes
  curator-attested `current_total_assets`, updates the stored total,
  computes `gain = max(0, current − last_harvest_total_assets)`, fees
  it at `fee_bps`, and mints dilutive shares to the curator's
  `UserPosition` via the Blue-standard formula
  `X = S · fee / (A − fee)` so existing holders' real claim drops by
  exactly `fee`. Snapshots `last_harvest_total_assets` for the next
  cycle. Bootstrapping case (S = 0) mints shares 1:1.
- ~~**`total_assets` reconciliation**~~: landed as `mark_to_market`.
  Single-allocation, permissionless. Reads
  `core_vault.last_seen_sy_exchange_rate`,
  `core_vault.pt_redemption_rate()`, the market's PT/SY escrow
  balances, the vault's `vault_pt_ata` + `vault_sy_ata` + `vault_lp_ata`
  balances, and the LP mint supply, then recomputes the allocation's
  base-equivalent via
  `(pt_held·pt_redemption + sy_held + lp_share·(pool_pt·pt_redemption
  + pool_sy)) · sy_rate` in high-precision `Number` math.  Also
  refreshes `total_assets = idle + Σ deployed`. Callers needing a
  current mark should `stage_yt_yield` on the vault first — that
  refreshes `last_seen_sy_exchange_rate`. `harvest_fees` still accepts
  curator-attested input, but running `mark_to_market` for each
  allocation first makes that input fully derivable from chain state.
- ~~**`allocations` realloc**~~: landed. `SetAllocations` now takes
  `allocations` as an `#[instruction(...)]` param and Anchor resizes
  `CuratorVault` to `CuratorVault::space(allocations.len())` with
  `realloc::payer = curator` — curator pays rent for growth, and the
  vec can shrink too.

### Both

- ~~No events on state-changing ixns~~: landed.
  [clearstone_curator](periphery/clearstone_curator/src/lib.rs) emits
  `VaultInitialized` / `Deposited` / `Withdrawn` / `AllocationsSet`.
  [clearstone_rewards](periphery/clearstone_rewards/src/lib.rs) emits
  `FarmStateInitialized` / `FarmAdded` / `Staked` / `Unstaked` /
  `EmissionClaimed` / `FarmRefilled` / `StakePositionReallocated`.
  Plain `emit!` (not `emit_cpi!`) — no extra account-plumbing cost.
- No tests. Once the gaps above are filled, add tests parallel to
  core's virtualization_tests.

## ✅ M6 — Integration test suite (**RESOLVED**)

**All 16 test cases landed as real `it(...)` bodies** against the
generated IDL types. `anchor build` + `tsc --noEmit` green.

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
- **Reentrancy** (3): runtime coverage via a bespoke
  [malicious_sy_reentrant](reference_adapters/malicious_sy_reentrant/src/lib.rs)
  adapter. The adapter's `deposit_sy` / `withdraw_sy` re-invoke
  `clearstone_core.strip` / `.merge` on the same vault. The test
  creator bakes every inner-call account (vault, core program,
  depositor signer, etc.) into the vault's ALT + `CpiAccounts` so the
  adapter has everything it needs — modelling a worst-case where the
  full vault setup is hostile. The guard byte at offset 42 still
  blocks both recursions. Third case: double-strip on the generic
  adapter proves the guard clears after a successful ix.

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

## ✅ M4 — Periphery programs: router (**RESOLVED**)

All 12 wrappers landed in
[periphery/clearstone_router](periphery/clearstone_router/src/lib.rs):

- **Single-SY-CPI** (previously landed): `wrapper_strip`,
  `wrapper_merge`, `wrapper_buy_pt`.
- **Sell/buy wrappers**: `wrapper_sell_pt` (trade_pt sell →
  redeem_sy), `wrapper_buy_yt` (mint_sy → core.buy_yt),
  `wrapper_sell_yt` (core.sell_yt → redeem_sy).
- **Interest / liquidity**: `wrapper_collect_interest`
  (collect_interest → redeem_sy), `wrapper_provide_liquidity`
  (base+PT → mint_sy → deposit_liquidity),
  `wrapper_withdraw_liquidity` (withdraw_liquidity → redeem_sy, PT
  returned).
- **Classic passthroughs**: `wrapper_provide_liquidity_classic` and
  `wrapper_withdraw_liquidity_classic` — same account layouts as their
  non-classic counterparts, skip the adapter leg for users already
  holding SY. Kept as named variants for IDL stability.
- **Base-only LP**: `wrapper_provide_liquidity_base`
  (mint_sy → trade_pt buy → deposit_liquidity).

Shared `redeem_sy_cpi` helper takes AccountInfos directly — keeps the
SY→base drain step identical across the four wrappers that end with
it. `anchor build` green.

**Vault-level emissions** — ~~seeding not wired~~: landed.
`initialize_vault` now takes `emissions_seed: Vec<EmissionSeed>` as
its last arg. Each seed holds (token_account, treasury_token_account,
initial_index, fee_bps); the handler pushes them onto
`vault.emissions` after vault init and the vault's space is sized for
`emissions_seed.len()` up front. Callers fetch the SY program's
current emission indexes via a pre-init `get_sy_state` and pass them
in so accrual starts from the right point — seeding ZERO would
retroactively credit pre-vault emissions to the first YT holder.
Existing callers (fixtures.ts) pass `[]` for no-emission vaults.

## ✅ M3 — Fuzz + clamp (**RESOLVED**)

- ~~**Virtual-share fuzz tests**~~: landed. 5-property proptest suite
  in [state::market_two::virtualization_fuzz](programs/clearstone_core/src/state/market_two.rs)
  covers:
  - V-1 donation-bounded: SY donations shift the virtualized ratio
    by ≤ `donation / (reserves + VIRTUAL_SY)`.
  - V-2 first-LP sandwich: add + immediate withdraw returns ≤
    `intent * (1 + 5%)` per leg — documented as the bounded-drain
    invariant. The exact constant captures both virtual-floor
    dilution and post-add LP-supply growth.
  - V-3 proportional-at-scale: at reserves >> virtual,
    `lp_out ≈ intent·lp_supply/reserves` within the virtual-floor
    correction term.
  - V-4 empty-reserve resilience: add_liquidity on (0,0) never
    panics and consumes ≤ intent.
  - V-5 donation-immune mint: a pre-add donation can't inflate LP
    mint beyond the non-donated classic formula + virtual-floor
    slack. Runs under `cargo test -p clearstone_core --lib`, 29/29
    green.
- ~~**rm_liquidity clamp analysis**~~: the fuzz suite quantified it —
  at realistic scale (reserves ≥ 100 × VIRTUAL_LP_FLOOR), the round-trip
  upper-bound drift is ≤ 5% of intent and in practice stays well under
  1%. The 1–2 wei drift in the tight-pool regime (reserves ≲ virtual)
  is unexploitable: per-loop compute cost exceeds the profit. Keep the
  clamp as-is; revisit if a future market type targets sub-virtual
  reserves.

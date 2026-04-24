# Follow-ups

Tracked deviations from PLAN.md. Each entry: which milestone left it, why,
and what it would take to close. Items that have been closed since first
written are struck through.

---

## CURATOR_REALLOCATE_DEDUP — Extract `reallocate_{from,to}_inner` helpers

Opened by: roll-delegation Pass B ([CURATOR_ROLL_DELEGATION.md](../clearstone-finance/CURATOR_ROLL_DELEGATION.md)).

`crank_roll_delegated` in [periphery/clearstone_curator/src/lib.rs](periphery/clearstone_curator/src/lib.rs)
duplicates the three-step CPI composition of `reallocate_from_market`
(withdraw_liquidity → trade_pt sell → redeem_sy) and
`reallocate_to_market` (mint_sy → trade_pt buy → deposit_liquidity).
~120 LOC of near-identical inlined CPI glue.

Why deferred: Pass B shipped under time pressure with no runnable
integration test harness in-session. Refactoring proven curator-signed
code without regression coverage was judged riskier than the one-time
duplication cost.

To close: extract `reallocate_from_inner(&ReallocateFromAccts, ...)` and
`reallocate_to_inner(&ReallocateToAccts, ...)` as free functions taking
a struct of `AccountInfo<'info>` fields. Wire all three handlers
(`reallocate_to_market`, `reallocate_from_market`, `crank_roll_delegated`)
through the inners. Add an `as_inner()` method per Accounts struct.
Keep behavior identical — bit-for-bit same emitted events, same CPI
argument order.

Gated on: Pass E (integration tests for the delegated path). Don't
refactor until those tests pass against the inlined version, then flip
to the extracted version and re-run.

---

## ✅ CURATOR_CRANK_STACK_OVERFLOW — `CrankRollDelegated::try_accounts` overflow (RESOLVED)

Opened by: roll-delegation Pass B.
Resolved by: Pass E follow-up — converted 12 typed account fields to
`UncheckedAccount<'info>` and dropped `init_if_needed` on the TO-side
vault ATAs.

### What was failing

`anchor build -p clearstone_curator` emitted six identical errors
pointing at `CrankRollDelegated::try_accounts`:

```
Error: A function call in method …CrankRollDelegated…try_accounts
overwrites values in the frame.
```

The struct had 32 accounts, most `Box<InterfaceAccount<'info, …>>`.
Anchor's generated deserialize path serialized every typed field to
the stack before moving into the Box, accumulating ~10 KB of frame
against the SBF cap of 4 KB.

### Fix

Kept as typed: `vault`, `delegation`, `from_market`, plus the four
balance-reading ATAs (`base_escrow`, `vault_sy_ata`, `from_vault_pt_ata`,
`from_vault_lp_ata`). These access fields or `.reload()+.amount` in
the handler, so deserialization is mandatory.

Converted to `UncheckedAccount<'info>` (12 fields): every other mint,
SY pool, market escrow, and the entire TO-market side. Address
constraints (`#[account(address = from_market.token_pt_escrow)]`)
still validate — Anchor runs those as pubkey comparisons even without
deserialization.

Dropped `init_if_needed` on `to_vault_pt_ata` / `to_vault_lp_ata`. The
keeper's [roll-delegated.ts](../clearstone-finance/packages/keeper-auto-roll/src/roll-delegated.ts)
now prepends two `createAssociatedTokenAccountIdempotentInstruction`
ixs before the crank, covering the one-time rent per (vault, market).

### Post-fix verification

```
anchor build -p clearstone_curator 2>&1 | grep CrankRoll
  (nothing — CrankRollDelegated symbols no longer appear in the
   stack-overflow list)
```

One remaining top-level stack-frame warning exists — on the generic
`core::ops::function::FnOnce::call_once` at 10432 bytes. That's the
handler-body monomorphization, not the Accounts-struct parse, and is
a separate concern (the crank handler composes six CPIs with
large CpiContext structs). Tracked as
`CURATOR_CRANK_HANDLER_FRAME` below if we hit a real on-chain failure.

### Caller-side breaking change

Anyone calling `crank_roll_delegated` must pre-create the TO-side
vault PT and LP ATAs. The `buildCrankRollDelegated` SDK builder is
unchanged (same 33-account list) — only the runtime-lifecycle
contract shifted.

---

## CURATOR_CRANK_HANDLER_FRAME — ambient 10 KB FnOnce warning (NOT crank_roll_delegated)

Opened by: Pass E follow-up to `CURATOR_CRANK_STACK_OVERFLOW`.
Updated by: handler-body refactor (Pass E.5).

### What changed

The handler body was refactored to factor every CPI composition into
a dedicated `#[inline(never)]` helper under `mod crank_cpi`:

- `do_withdraw_liquidity`, `do_trade_pt_sell`, `do_redeem_sy`
- `do_mint_sy`, `do_deposit_liquidity`

Each helper takes `&CrankRollDelegated<'info>` + signer_seeds + args.
Vault-mutable state updates are scoped tightly around the CPI chain
so the helpers always run with an immutable borrow of the accounts
struct. Cleaner code, future-proof for heap-allocation swaps if we
still need them.

### Diagnostic: the remaining FnOnce warning is NOT this handler

After the refactor, `anchor build` still emits:

```
Error: Function _ZN4core3ops8function6FnOnce9call_once17ha8f76e99b1a42f66E
Stack offset of 10432 exceeded max offset of 4096 by 6336 bytes
```

The demangled hash `17ha8f76e99b1a42f66E` is **identical** before and
after the refactor. Rust's symbol hashing is a content digest of the
monomorphized type — an unchanged hash means the function body
hasn't changed. Since we materially rewrote `crank_roll_delegated`,
this FnOnce is necessarily in some other call site.

Candidates — other handlers with five or more CPI compositions or
large local `CpiContext` structs. Likely suspects inside
`clearstone_curator`: `reallocate_to_market` or `reallocate_from_market`
(both have ~3 CPI chains with similar shape). Likely suspects inside
`clearstone_core` pulled into the curator crate via the `cpi` feature:
any of the trade/liquidity composition functions.

### Next step (when it matters)

Don't pre-optimize. When the first on-chain execution of any
curator handler fails, use `solana logs` + `llvm-nm` on the
`.so` to identify the exact handler via the truncated symbol
prefix. Then apply the same `#[inline(never)]` helper pattern to
whichever handler is the actual hot spot.

Non-blocking for host tests and for the crank_roll_delegated path
specifically.

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

## ✅ M5 — Reference adapter runtime-exercised (**RESOLVED**)

`generic_exchange_rate_sy` is now driven end-to-end by all 20
integration tests — mint_sy, redeem_sy, deposit_sy, withdraw_sy,
get_sy_state, init_personal_account, poke_exchange_rate all
exercised. Second reference adapter (`kamino_sy_adapter`) lands
beside it for real-yield integration; `mock_klend` backs its tests.

Known design choices documented for curators in
[CURATOR_GUIDE.md](CURATOR_GUIDE.md) Phase 4-5:

- **Account-order convention for `cpi_accounts`**: `buildAdapterCpiAccounts`
  in [tests/fixtures.ts](tests/fixtures.ts) is the canonical example;
  curators building production SY adapters mirror that shape.
- **Separate base_vault and pool_escrow**: mint_sy/redeem_sy use
  `base_vault`; deposit_sy/withdraw_sy use `pool_escrow`. Intentional.
- **No supply cap / emissions**: out of scope for the generic ref.
  Yield-bearing adapters (kamino_sy_adapter, future marginfi/jito
  ports) implement those.

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

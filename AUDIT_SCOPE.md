# Clearstone Core — Audit Scope

Reading guide for auditors. If you're picking up the codebase, read in
this order:

1. **[PLAN.md](PLAN.md)** — the design intent. What changed relative to
   upstream Exponent Core, and why.
2. **[INVARIANTS.md](INVARIANTS.md)** — the safety spec. What must hold.
3. **[INTERFACE.md](INTERFACE.md)** — the public surface. What's frozen.
4. **[FOLLOWUPS.md](FOLLOWUPS.md)** — the honest list of known gaps.
5. The code itself.

## Repo at audit tag

Versions / commits at audit kickoff go here when the tag is cut.

- clearstone_core: program ID `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW`
- generic_exchange_rate_sy (reference): program ID `HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3`
- kamino_sy_adapter (reference, KYC pass-through capable): program ID `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd`

## In scope

- **[programs/clearstone_core/](programs/clearstone_core/)** — the entire
  core program. Every instruction, every account, every `src/utils/`
  helper. This is the trusted execution surface.
- **[reference_adapters/generic_exchange_rate_sy/](reference_adapters/generic_exchange_rate_sy/)** —
  the reference SY adapter. Lower criticality (it's an example, not a
  production adapter), but treat it as "what a minimally-safe SY
  integration looks like" and flag patterns that would be problematic
  if copied into a production adapter.
- **[reference_adapters/kamino_sy_adapter/](reference_adapters/kamino_sy_adapter/)** —
  Kamino-Lend-V2-wrapping SY adapter with optional KYC pass-through
  (`KycMode::GovernorWhitelist`). Same "reference, not enforced" trust
  tier as `generic_exchange_rate_sy`, but higher integration surface.
  Note: the kamino reserve-layout decoder
  ([lib.rs:read_exchange_rate](reference_adapters/kamino_sy_adapter/src/lib.rs))
  is hardcoded to `mock_klend`'s Reserve layout. Swapping to real klend
  is a one-function change — flag for any caller planning a production
  deploy against live klend.
- **[periphery/clearstone_solver_callback/](periphery/clearstone_solver_callback/)** —
  Reference callback for `core.flash_swap_pt`. Composes the flash
  primitive with `clearstone-fusion` (external). Scope-scoped to the
  `src_mint == market.mint_sy` case — any extension to handle
  `src_mint == underlying-asset` (wrap + mint_sy chain) is a separate
  audit. Main concern: the discriminator-matched callback ABI must stay
  in lockstep with core's `CALLBACK_IX_NAME`.
- **[libraries/](libraries/)** — inherited from upstream Exponent. The
  math-critical ones (`precise_number`, `time_curve`) sit under every
  reserve calculation. Upstream audits exist (Ottersec, Offside, Certora
  — see upstream repo for reports), but behavior under Clearstone's
  virtualized calls is new.

## Out of scope

- **[reference_adapters/mock_klend/](reference_adapters/mock_klend/)** —
  test-only Kamino Lend V2 stand-in. Never deployed to devnet/mainnet.
  Skip.
- **[reference_adapters/mock_flash_callback/](reference_adapters/mock_flash_callback/)** —
  test-only configurable callback for `flash_swap_pt` integration tests.
  Never deployed to devnet/mainnet. Skip.
- **External [clearstone-fusion](https://github.com/1delta-DAO/clearstone-fusion-protocol)** —
  intent-settlement layer. clearstone-finance ships it separately; it's
  audited on that repo. `clearstone_solver_callback` treats it as a
  trusted CPI target gated by the maker's signed `resolver_policy`.
- **External governor composability** — the KYC pass-through flow
  composes with the external
  [`clearstone-finance` governor + delta-mint](https://github.com/1delta-DAO/clearstone-finance)
  programs. Those live in a separate repo and audit. clearstone_core
  makes no CPI into them (I-KYC2); the only coupling point is
  `kamino_sy_adapter.init_sy_params` under `KycMode::GovernorWhitelist`.
  Audit that surface from the adapter side; treat the external
  governor+delta-mint as a separately-audited dependency.
- **[periphery/clearstone_rewards/](periphery/clearstone_rewards/)** —
  scaffolded, not feature-complete. Not audit-ready. See FOLLOWUPS.md.
- **[periphery/clearstone_curator/](periphery/clearstone_curator/)** —
  same.
- **[tests/clearstone-core.ts](tests/clearstone-core.ts)** — TypeScript
  integration tests are 90% skip-stubs. Skip.
- The Anchor framework itself and the Solana SDK. Treat as trusted.

## Security properties to verify

Grouped by invariant class. See INVARIANTS.md for full definitions.

### Vault (I-V1 through I-V5)

- PT backing is always covered (`sy_for_pt ≤ both-bounds-min`).
- No under/overflow in balance counters.
- ATH monotonicity holds across every `update_from_sy_state` call.
- Post-maturity exchange rate is frozen.
- Curator has no drain path beyond `treasury_sy`.

### Market (I-M1 through I-M5)

- Tracked reserves match escrow balances after every mutation.
- LP mint has no free-mint path.
- Virtual-share floor is effective (first-LP sandwich and dust donations).
- No instruction touches two vaults or two markets.
- Curve math stays in [0, 1] PT price range.

### CPI / reentrancy (I-C1 through I-C3)

- Guard set before every SY CPI, cleared after.
- State persisted to disk before every SY CPI.
- SY return values validated before use.

**Coverage:** complete for in-tree SY CPIs. The guard is applied
inside each `cpi_*` helper in
[utils/sy_cpi.rs](programs/clearstone_core/src/utils/sy_cpi.rs) via
raw-byte latch/unlatch at offset 42 (the reentrancy_guard position in
both Vault and MarketTwo). All 17 SY CPI call sites across 14 handlers
pass the guarded account; no bypasses exist. Self-CPI chains
(`buy_yt → strip`, `buy_yt → trade_pt`, etc.) work because the latch
is scoped to each individual SY CPI rather than the outer handler.

### Economic (I-E1 through I-E2)

- Fee cap is bounded by compile-time constant.
- No modify path raises a fee.

### KYC pass-through (I-KYC1 through I-KYC3)

- Every SY transfer uses `transfer_checked` with the mint + decimals.
  Plain `token_2022::transfer` is only used for PT (core-owned SPL).
- clearstone_core has no build-time or runtime dependency on the external
  governor / delta-mint programs. KYC wiring lives entirely in the
  adapter.
- Every `Accounts` struct carrying `mint_sy` types it as
  `InterfaceAccount<Mint>` so the same core handles SPL, T2022+CT, and
  T2022+TransferHook (future) mints without code changes.

**Auditor guidance.** The clearstone_core surface does not enforce KYC —
it's a pass-through. KYC is enforced at the delta-mint mint layer and
becomes a curator-selected property of whichever SY adapter the vault is
wired to. If the audit covers institutional deployments, also review the
external governor + delta-mint repos separately.

### Flash swap (I-F1 through I-F4)

- `market.flash_pt_debt` is zero at rest and only written by `flash_swap_pt`
  (steps 4 and 8). Every other market-mutating handler gates on this field.
- The flash handler reads `sy_exchange_rate` exactly once and uses that
  same snapshot for both the quote and the final `apply_trade_pt` call —
  no second SY CPI after the callback returns.
- `MarketTwo.pt_balance` is decremented only at commit-time (step 7);
  between steps 4 and 6 the escrow temporarily holds less than
  `pt_balance`, reconciled on success or reverted on failure.
- Repayment is measured as an escrow-balance delta, not a tracked-balance
  check. Callback programs are free to source SY from anywhere — the
  only requirement is that `token_sy_escrow.amount` grows by at least
  the quoted amount before the handler returns.

**Auditor guidance.** The flash primitive is intentionally a temporary
I-M1 violation. The guards in I-F1..I-F4 narrow the violation window to a
single handler's lifetime and close it before return. Three cross-cutting
concerns worth separate attention:
1. **Callback-program trust model.** `callback_program` is caller-picked
   and core does zero validation on it. Safe by default — a malicious
   callback that fails to repay reverts the whole tx — but the caller
   (solver) must not sign a tx whose callback they haven't vetted.
2. **Cross-market flash.** Each market has its own `flash_pt_debt`, so
   a callback CAN legitimately CPI `flash_swap_pt` on a different market
   during a flash on market A. Cross-market isolation (I-M4) is what
   makes this safe — but audit the interaction with vault-level state
   (is any vault-linked state reachable from two markets' flash paths?).
3. **Callback discriminator.** Core CPIs the callback via the Anchor
   discriminator `sha256("global:on_flash_pt_received")[..8]`. If the
   callback defines a different ix name with a colliding 8-byte prefix,
   it'd match — astronomically unlikely but worth noting as a cryptographic
   assumption.

## v2 addition — roll-delegation (permissionless keeper crank)

Shipped alongside the core + adapters; **in scope** for this audit.

### Files in scope

- [periphery/clearstone_curator/src/roll_delegation.rs](periphery/clearstone_curator/src/roll_delegation.rs)
  — state + helpers. 26 unit tests (`cargo test -p clearstone_curator
  roll_delegation`) cover validate_delegation, hash_allocations,
  slippage_floor, and the commit-bytes layout.
- [periphery/clearstone_curator/src/lib.rs](periphery/clearstone_curator/src/lib.rs)
  — `CrankRollDelegated<'info>` + `crank_roll_delegated` handler.
  Spans ~270 LOC of inlined CPI composition. Intentional duplication
  vs. the curator-signed `reallocate_{from,to}_market` paths; extraction
  tracked in `FOLLOWUPS.md :: CURATOR_REALLOCATE_DEDUP`.

### What auditors must verify

1. **I-D1 through I-D7** in [INVARIANTS.md § Roll-delegation](INVARIANTS.md).
   Each lists the enforcement site + test coverage + residual risk.
2. **`validate_delegation` short-circuit ordering** — vault-mismatch
   must fire before hash-mismatch, so a user whose delegation was
   written against vault A and is being cranked against vault B sees
   `VaultMismatch`, not `AllocationsDrifted`. Confirmed in the Rust
   tests at `validate_delegation_rejects_vault_mismatch_before_hash_check`.
3. **`hash_allocations` collision resistance** — the commit-bytes layout
   (32 market + 2 weight_bps + 8 cap_base = 42 bytes) is the only data
   that feeds the hash. Verify no adversarial allocation pair produces
   a collision: the tests assert changing any of the three committed
   fields changes the hash. `deployed_base` is deliberately excluded.
4. **Slippage-floor math parity** — the Rust `slippage_floor` helper
   and the TypeScript SDK's `slippageFloor` must return bit-identical
   values for the same inputs (I-D6 enforcement depends on it). Both
   have dedicated test suites running against shared vectors.
5. **Atomicity** — six CPIs in `crank_roll_delegated`. Verify the
   failure path of each (withdraw_liquidity revert, trade_pt revert,
   etc.) unwinds cleanly. Specific attention to step-by-step
   `reload()` ordering: SY/PT/LP account amounts between CPI hops.
6. **`init_if_needed` rent griefing** — keeper pays for the TO-side
   PT/LP vault ATAs the first time a roll lands in a market. Confirm
   there's no way a malicious curator can griefingly add allocations
   pointing at junk markets and drain keeper rent.

### Threat model (roll-delegation specific)

| Attack | Mitigation | Where tested |
|---|---|---|
| Keeper rolls early for cheap PT | `from_market.expiration_ts <= clock.unix_timestamp` check (I-D5) | integration (deferred) |
| Keeper sandwiches AMM leg | User-signed `max_slippage_bps` bounds keeper `min_base_out`; post-CPI check on `base_escrow` delta (I-D6) | `validate_delegation_happy_path` + `slippage_floor_*` |
| Curator changes allocations after user signed | `validate_delegation` recomputes + compares `allocations_hash` (I-D4) | `validate_delegation_rejects_allocations_drift_{added_entry,removed_entry,weight_change}` |
| User-signed delegation replayed post-revoke | Delegation PDA closed at revoke; subsequent crank fails at account-load | integration (deferred) |
| Keeper abuses idempotent re-crank to drain | `deployed_base == 0` reverts with `NothingToRoll`; `vault_lp_ata.amount >= deployed_base` cross-check reverts with `DeployedBaseDrift` | (integration-deferred; inline requires; live test in Pass E integration) |
| Compromised curator key swaps to hostile allocation | Out of scope — I-D4 invalidates all existing delegations at that moment, so the damage is limited to users who re-sign without noticing. `CURATOR_SPLIT_AUTHORITY` follow-up narrows this further. | n/a |
| Timing attack on ttl bounds (`<` vs `≤`) | `validate_delegation_rejects_at_exact_expiry_slot` asserts strict `<` | Rust tests |

### Known deviations from the locked spec

- **Inline CPI composition** instead of `reallocate_{from,to}_inner`
  extraction (Pass B ship decision). `FOLLOWUPS.md :: CURATOR_REALLOCATE_DEDUP`.
  Audit approach: review the new handler as if it were a separate
  program that happens to share the same CPI shape.
- **`pt_intent = 0` in the to-leg.** Means delegated rolls park base
  entirely as SY-sided liquidity, not matching the curator's
  allocation weights. `CURATOR_ROLL_DELEGATION_V1_1` open.
- **No keeper tip yet.** v1 cranks are gas-neutral or loss-making for
  the keeper. Tip model in v1.1 per spec §8.

## Known open items

Summary — full detail in [FOLLOWUPS.md](FOLLOWUPS.md).

1. **Integration test coverage** (M6) — 24 Rust unit tests land; 17
   TypeScript e2e tests are skip-stubs. Rerun criterion: a malicious-SY
   mock harness + a cross-market isolation test must land before a
   testnet burn.
2. **Periphery programs** (M7) — rewards and curator are functional on
   their core flows (deposit/withdraw/stake/unstake/claim) but the
   curator `rebalance` that glues them into the core's markets is still
   a stub.
3. **Router for base-asset UX** (M4) — the 12 `wrapper_*` instructions
   from upstream Exponent are deleted. A new `clearstone_router` program
   (not yet written) should re-provide base-asset entrypoints via CPI.
4. **Reference adapter** enforces ATH monotonicity (M5); still
   runtime-untested pending M6 harness.

## Deployment expectations at audit time

- Core upgrade authority: **multisig** (3-of-5 or similar) during audit
  window. Specific signer set documented at audit kickoff.
- Upgrade authority burn: planned for post-audit cutover. No burn before
  the full invariant checklist passes review.
- Mainnet deploy blocked on: audit report + fixes + the M6 integration
  test suite going green against a local validator.

## Reproducible build

Intended build:
```
solana-verify build --library-name clearstone_core
```
Using `solanafoundation/solana-verifiable-build:2.3.8` per the upstream
Exponent convention. Hash published with the mainnet deploy.

## Attribution

Clearstone derives from [Exponent Core](https://github.com/exponent-finance)
(BUSL-1.1). Core AMM math (`time_curve`), the SY-CPI interface shape, and
the strip/merge state machine are upstream. Clearstone changes are scoped
to permissioning, isolation, reentrancy hardening, and virtualized AMM
reserves. See [LICENSE](LICENSE).

## Contact

- Security reports: `security@1delta.io` (per `security_txt!` in
  [lib.rs](programs/clearstone_core/src/lib.rs)).
- Pre-audit questions: same.

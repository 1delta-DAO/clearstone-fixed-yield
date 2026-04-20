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

- clearstone_core: program ID `EKpLcVc6rky1ah28NMZFoT2oSXkAKWcEsr6nbZziTWbC`
- generic_exchange_rate_sy (reference): program ID `DZEqpkctMmB1Xq6foy1KnP3VayVFgJfykzi49fpWZ8M6`

## In scope

- **[programs/clearstone_core/](programs/clearstone_core/)** — the entire
  core program. Every instruction, every account, every `src/utils/`
  helper. This is the trusted execution surface.
- **[reference_adapters/generic_exchange_rate_sy/](reference_adapters/generic_exchange_rate_sy/)** —
  the reference SY adapter. Lower criticality (it's an example, not a
  production adapter), but treat it as "what a minimally-safe SY
  integration looks like" and flag patterns that would be problematic
  if copied into a production adapter.
- **[libraries/](libraries/)** — inherited from upstream Exponent. The
  math-critical ones (`precise_number`, `time_curve`) sit under every
  reserve calculation. Upstream audits exist (Ottersec, Offside, Certora
  — see upstream repo for reports), but behavior under Clearstone's
  virtualized calls is new.

## Out of scope

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

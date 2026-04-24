# Clearstone Fixed Yield — Permissionless PT/YT Core

A permissionless fork of [Exponent Core](https://github.com/exponent-finance).
Anyone can create a vault and market for any standardized-yield (SY)
program. The core is deliberately small, frozen, and invariant-driven;
curation, emissions, and wrappers live in periphery programs.

Working title "Exponent Blue" in [PLAN.md](PLAN.md) is superseded —
this repo ships as **Clearstone**.

## Layout

```
programs/
  clearstone_core/         the trusted core. permissionless init,
                           curator-gated modify paths, flash-swap ixn.

reference_adapters/
  generic_exchange_rate_sy/ reference SY adapter — SPL mint + pokable
                            exchange rate with ATH monotonicity enforced.
  kamino_sy_adapter/        Kamino Lend SY wrapper (real yield source).
  malicious_sy_nonsense/    test-only: returns garbage SyState to
                            exercise validate_sy_state.
  malicious_sy_reentrant/   test-only: reentrant deposit_sy to exercise
                            the guard byte.
  mock_klend/               test-only: minimal Kamino Lend mock.
  mock_flash_callback/      test-only: flash-swap callback mock.

periphery/
  clearstone_router/         base-asset UX wrappers (base ↔ SY via
                             adapter CPIs around core primitives).
  clearstone_rewards/        LP staking + farm emissions.
  clearstone_curator/        MetaMorpho-analog super-vault.
  clearstone_solver_callback/ intent-settlement callback for
                              clearstone_fusion flash fills.

libraries/                 math + sy-common types.
tests/                     fixtures + integration suite.
scripts/clearstone_pt_solver/ off-chain PT solver for fusion intents.
```

## Read order

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — system diagram + per-op
  data flows.
- **[CURATOR_GUIDE.md](CURATOR_GUIDE.md)** — step-by-step for
  creating and running a market.
- **[DEPLOY.md](DEPLOY.md)** — cross-repo deployment order + IDs +
  post-deploy verification.
- **[INVARIANTS.md](INVARIANTS.md)** — formal safety properties + code
  mapping.
- **[INTERFACE.md](INTERFACE.md)** — public instruction catalogue with
  discriminators and account shapes.
- **[AUDIT_SCOPE.md](AUDIT_SCOPE.md)** — what auditors need.
- **[FOLLOWUPS.md](FOLLOWUPS.md)** — deviations from the plan with
  closure notes.
- **[PLAN.md](PLAN.md)** — original design doc and milestone plan.

## Program IDs

Pinned IDs for all three repos (clearstone-finance / clearstone-fusion-protocol
/ clearstone-fixed-yield) are documented in [DEPLOY.md](DEPLOY.md). The
clearstone-fixed-yield-owned programs are:

- `clearstone_core`: `EKpLcVc6rky1ah28NMZFoT2oSXkAKWcEsr6nbZziTWbC`
- `generic_exchange_rate_sy`: `DZEqpkctMmB1Xq6foy1KnP3VayVFgJfykzi49fpWZ8M6`
- `kamino_sy_adapter`: `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd`
- `clearstone_router`: `DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW`
- `clearstone_rewards`: `7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g`
- `clearstone_curator`: `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm`
- `clearstone_solver_callback`: `27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP`

No mainnet deployment yet.

## Build & test

```
cargo check --workspace
cargo test --package clearstone_core --lib
```

End-to-end tests require `anchor build` + a local validator; the
TypeScript suite in [tests/](tests/) is a skeleton, not a runnable
suite. See AUDIT_SCOPE.md and FOLLOWUPS.md for the state of that work.

## Security & bug bounty

**Clearstone has not been audited.** Upstream Exponent audits (Ottersec,
Offside Labs, Certora) cover earlier versions of `libraries/time_curve`,
`libraries/precise_number`, and strip/merge state semantics — but the
permissioning, reentrancy hardening, and virtualized reserves introduced
by Clearstone are new code and unaudited.

- Reports: `security@1delta.io` (per `security_txt!` in the program).

## License

BUSL-1.1, inherited from Exponent Core. See [LICENSE](./LICENSE). This
fork carries attribution to upstream Exponent per §14 of [PLAN.md](PLAN.md).
Software distributed "AS IS", without warranty of any kind.

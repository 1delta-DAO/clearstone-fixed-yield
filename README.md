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
                           ~21 instructions, curator-gated modify paths.

reference_adapters/
  generic_exchange_rate_sy/ reference SY adapter — SPL mint + pokable
                            exchange rate with ATH monotonicity enforced.
  malicious_sy_nonsense/    test-only mock that returns garbage SyState
                            so we can exercise validate_sy_state.

periphery/
  clearstone_router/       base-asset UX wrappers (base ↔ SY via
                           adapter CPIs around core primitives).
  clearstone_rewards/      LP staking + farm emissions.
  clearstone_curator/      MetaMorpho-analog super-vault.

libraries/                 inherited from upstream Exponent.
tests/                     fixtures + integration suite.
```

## Read order

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — system diagram + per-op
  data flows.
- **[CURATOR_GUIDE.md](CURATOR_GUIDE.md)** — step-by-step for
  creating and running a market.
- **[INVARIANTS.md](INVARIANTS.md)** — formal safety properties + code
  mapping.
- **[INTERFACE.md](INTERFACE.md)** — public instruction catalogue with
  discriminators and account shapes.
- **[AUDIT_SCOPE.md](AUDIT_SCOPE.md)** — what auditors need.
- **[FOLLOWUPS.md](FOLLOWUPS.md)** — deviations from the plan with
  closure notes.
- **[PLAN.md](PLAN.md)** — original design doc and milestone plan.

## Program IDs (localnet)

- `clearstone_core`: `EKpLcVc6rky1ah28NMZFoT2oSXkAKWcEsr6nbZziTWbC`
- `generic_exchange_rate_sy`: `DZEqpkctMmB1Xq6foy1KnP3VayVFgJfykzi49fpWZ8M6`
- `malicious_sy_nonsense` (tests only): `jEsn9RSpNmmG8tFTo6TjYM8WxVyP9p6sBVGLbHZxZJs`
- `clearstone_rewards`: `7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g`
- `clearstone_curator`: `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm`
- `clearstone_router`: `DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW`

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

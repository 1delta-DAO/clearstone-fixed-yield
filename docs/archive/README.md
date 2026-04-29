# Archived planning docs

Forward-looking blueprints whose work has fully shipped. Kept for the
paper trail (and because they document the decisions taken during the
relevant milestone), not as live state.

| File | What it was | Why archived |
|---|---|---|
| `KYC_PASSTHROUGH_PLAN.md` | M-KYC-0..6 blueprint for the governor + delta-mint + Kamino integration | Every milestone shipped. Live state: `INVARIANTS.md` (I-KYC1..3), `tests/clearstone-kyc-pass-through.ts` (GovernorWhitelist green), `target/deploy/{governor,delta_mint}.so` (vendored from devnet). |
| `FOLLOWUP_KAMINO_REAL_KLEND.md` | Plan to rebuild the kamino adapter against real klend's 12-account layout | Rust + devnet upgrade landed (tx `3xoqgcoK…`). Still-open work — symmetric path on `reallocate_from_market` / `crank_roll_delegated` — is now in `FOLLOWUPS.md` as `KAMINO_MODE_REALLOCATE_FROM`. |

If you find yourself reaching for one of these to understand the
current code, check first whether the live state lives somewhere
machine-readable: `INVARIANTS.md`, `INTERFACE.md`, `AUDIT_SCOPE.md`,
`deployments/devnet.json`, or the test suite.

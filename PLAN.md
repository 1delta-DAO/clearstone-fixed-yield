# Fork Implementation Plan — Permissionless Exponent ("Exponent Blue")

> **This document is the implementation blueprint for a fork of Exponent Core.**
> It is placed inside the upstream repo for convenience; move it to the fork once created.

Working title for the fork: **Exponent Blue** (placeholder — choose before deploying).
Working directory for fork (suggested): `/home/axtar-1/exponent-blue/`.

---

## 1. Mission

Take Exponent Core (current repo) and reshape it into a **Morpho Blue-style permissionless PT/YT protocol**:

- No admin whitelist. Anyone can create a vault + market for any SY program.
- Minimal, frozen, invariant-driven core. ~7–9 instructions.
- Curator logic pushed to peripheral programs (optional MetaMorpho-analog layer).
- Existing SY templates (Marginfi / Kamino / Jito) become *reference implementations*, not enforced.
- Per-market state isolation is the only safety layer.

The core must be **boring and immutable**. Risk curation, emissions, farms, wrapping — all periphery.

---

## 2. Design principles

1. **Every safety property holds per-market, with no global state.** A malicious SY program can only harm its own vault's holders.
2. **Creator, not admin.** The creator of a vault/market is recorded on the account and holds whatever mutability the core offers. No global pubkey has power over anyone else's market.
3. **Immutable parameters wherever possible.** Curve params, fee caps, decay curves — frozen at init. Morpho Blue's core parameters never change after market creation.
4. **Checks-Effects-Interactions, always.** Every CPI into the (untrusted) SY program is surrounded by fully-settled state updates. Re-entrancy is assumed possible.
5. **Minimal trust surface.** The core does not pause, does not freeze, does not upgrade (ideally). Upgrade authority is eventually burned / multisig'd.
6. **Periphery is optional.** Rewards, farms, curators, routers — all live in separate programs. A market works without them.

### What this is NOT

- Not a lending protocol.
- Not a curator layer (that's periphery, later).
- Not a replacement for Exponent Core. Users with existing markets keep using the upstream deployment.
- Not a claim that "permissionless = safe". The whole point is to push risk curation out, not eliminate it.

---

## 3. Non-negotiable invariants

These must hold after every instruction, for every market, regardless of SY program behavior:

### Vault invariants
- **I-V1 (Backing).** `sy_for_pt == min(pt_supply / last_seen_sy_exchange_rate, total_sy_in_escrow - treasury_sy - uncollected_sy)`.
- **I-V2 (Non-Negative Balances).** `total_sy_in_escrow ≥ treasury_sy + uncollected_sy + sy_for_pt`.
- **I-V3 (ATH monotonicity).** `all_time_high_sy_exchange_rate` never decreases.
- **I-V4 (Maturity freeze).** After `start_ts + duration`, `final_sy_exchange_rate` never changes.
- **I-V5 (No Creator Lambo).** The creator has no path to drain SY belonging to PT/YT holders. Only `treasury_sy` flows are creator-accessible.

### Market invariants
- **I-M1 (Reserve accounting).** `pt_balance` and `sy_balance` in `MarketFinancials` exactly match token account balances after every instruction.
- **I-M2 (LP supply ↔ reserves).** LP mint supply is a monotonic function of reserve additions; no free-mint path.
- **I-M3 (Virtual shares floor).** First LP cannot capture infinite share of a dust second deposit. (Blue-style virtual shares, see §6.4.)
- **I-M4 (No cross-market leakage).** No instruction takes two different markets and moves state between them.
- **I-M5 (Curve monotonicity).** Implied rate updates produce a PT price inside [0, 1] in base-asset terms.

### CPI / re-entrancy invariants
- **I-C1 (Reentrancy lock).** A `reentrancy_guard: bool` on Vault + MarketTwo is set to `true` before any CPI into the SY program and to `false` after. Every instruction entrypoint asserts it is `false` on entry.
- **I-C2 (State settled before CPI).** All mutable account state relevant to user balances is written to disk (`exit`) before the SY CPI fires. No "write after call" paths.
- **I-C3 (Return-data discipline).** `SyState` return values are validated (non-zero exchange rate, emission index vec length matches expectation) before use.

### Economic invariants
- **I-E1 (Protocol fee bounded).** `PROTOCOL_FEE_MAX_BPS` is a compile-time constant (propose: 2500 = 25%, matching Blue). Runtime fee is `min(creator_fee_bps, PROTOCOL_FEE_MAX_BPS)`.
- **I-E2 (Creator fee immutable post-init).** Once a market is live, neither creator nor anyone else can raise the fee. Lowering can be allowed (one-way ratchet down).

These invariants are the spec. Every PR / milestone must state which invariants it preserves or newly enforces.

---

## 4. Design decisions (agreed with user)

| Decision                      | Choice                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| Trust model                   | **Single tier, fully permissionless.** No "verified" tier in core. |
| SY adapter handling           | **No enforcement.** Templates kept as reference impls only.        |
| Program organization          | **Single program, permissionless-only.** No dual-path code.        |
| Protocol fee                  | **Immutable cap** at compile time. Default 0%. Cap TBD (suggest 2500 bps). |
| Virtual shares                | **Yes**, Blue-style, hardcoded constants.                          |
| Curator role                  | **Per-market `curator: Pubkey` field.** Owns modify paths for that market. |
| Admin program                 | **Deleted.** `exponent_admin` is not part of the fork.             |
| Farms / rewards               | **Moved to periphery.** Not in core.                               |
| Wrappers                      | **Moved to periphery.** Not in core.                               |
| Upgrade authority             | **Eventually burned** (post-audit). Multisig during bringup.       |

---

## 5. Target architecture

```
                      ┌──────────────────────────────────┐
                      │  exponent_blue_core              │
                      │  (permissionless, minimal)       │
                      │                                  │
                      │  - init_vault                    │
                      │  - init_market                   │
                      │  - strip / merge                 │
                      │  - collect_interest              │
                      │  - deposit/withdraw_liquidity    │
                      │  - trade_pt / buy_yt / sell_yt   │
                      │  - modify_market (curator only)  │
                      │                                  │
                      └──────────────┬───────────────────┘
                                     │
                      ┌──────────────┴───────────────────┐
                      │ SY program (user-selected)       │
                      │ untrusted / isolated per vault   │
                      │                                  │
                      │ Reference impls (not enforced):  │
                      │  - marginfi_sy_adapter           │
                      │  - kamino_sy_adapter             │
                      │  - jito_sy_adapter               │
                      │  - generic_exchange_rate_sy      │
                      └──────────────────────────────────┘

                      ┌──────────────────────────────────┐
                      │  Periphery programs (optional)   │
                      │                                  │
                      │  - exponent_blue_router          │
                      │      (formerly wrappers)         │
                      │  - exponent_blue_rewards         │
                      │      (farms + emission claim)    │
                      │  - exponent_blue_curator         │
                      │      (MetaMorpho analog)         │
                      │                                  │
                      └──────────────────────────────────┘
```

---

## 6. File-level changes

Reference paths are relative to the upstream repo; the fork mirrors the structure.

### 6.1 Delete

- [programs/exponent_admin/](programs/exponent_admin/) — entire program. Not part of the fork.
- [programs/exponent_core/src/instructions/wrappers/](programs/exponent_core/src/instructions/wrappers/) — move to periphery router program (separate crate).
- Farm-related instructions inside market_two:
  - [add_farm.rs](programs/exponent_core/src/instructions/market_two/admin/add_farm.rs)
  - [modify_farm.rs](programs/exponent_core/src/instructions/market_two/admin/modify_farm.rs)
  - [claim_farm_emissions.rs](programs/exponent_core/src/instructions/market_two/claim_farm_emissions.rs)
  - The corresponding `LpFarm` field on `MarketTwo` — move to a separate `farm_state` account owned by the periphery.
- Emission-related admin instructions — similarly externalized:
  - [add_emission.rs](programs/exponent_core/src/instructions/vault/admin/add_emission.rs)
  - [add_market_emission.rs](programs/exponent_core/src/instructions/market_two/admin/add_market_emission.rs)
  - (Keep `collect_emission` in core — it's a user action, not admin.)

### 6.2 Modify

#### [lib.rs](programs/exponent_core/src/lib.rs)
- New program ID. `declare_id!("ExponentBlue...")`.
- Remove discriminators for deleted instructions.
- Reassign remaining discriminators 0..N sequentially (breaking change, intentional).
- Update `security_txt!` — new project name, fresh contacts.

#### [state/vault.rs](programs/exponent_core/src/state/vault.rs)
- **Add** `pub curator: Pubkey` (who can modify this vault's settings).
- **Add** `pub reentrancy_guard: bool`.
- **Add** `pub creator_fee_bps: u16` (immutable after init, ratchet down only).
- **Remove** global `admin` references from `check_status_flags` / `ClaimLimits` wiring. Keep the mechanisms; they become curator-gated.
- **Remove** `treasury_sy_token_account` as a singleton — instead store it as `pub treasury: Pubkey` set by creator.

#### [state/market_two.rs](programs/exponent_core/src/state/market_two.rs)
- **Add** `pub curator: Pubkey`.
- **Add** `pub reentrancy_guard: bool`.
- **Add** `pub creator_fee_bps: u16`.
- **Add** `pub virtual_pt: u64` and `pub virtual_sy: u64` (virtual-reserve constants — propose 1_000_000 each; tune per asset scale).
- Remove `LpFarm` and associated fields (farm lives in periphery).
- Remove `MarketEmissions` — emissions are tracked in vault, not market (or also moved to periphery; decide in §10).

#### [instructions/vault/admin/initialize_vault.rs](programs/exponent_core/src/instructions/vault/admin/initialize_vault.rs)
- **Rename** to `instructions/vault/initialize_vault.rs` (no longer admin-only).
- **Remove** `admin: Box<Account<'info, Admin>>` account and `validate()` that calls `self.admin.principles.exponent_core.is_admin(...)`.
- **Add** `curator: Signer<'info>` (or just use `payer` as curator — simpler; decide in §10).
- **Add** validation: `creator_fee_bps <= PROTOCOL_FEE_MAX_BPS`; `duration > 0`; `start_timestamp >= Clock::get()?.unix_timestamp`; `min_op_size_strip > 0`; `min_op_size_merge > 0`.
- **Do NOT add** any validation of `sy_program`. That's the permissionless part. Frontend / curator layer warns users.

#### [instructions/market_two/admin/market_two_init.rs](programs/exponent_core/src/instructions/market_two/admin/market_two_init.rs)
- **Rename** to `instructions/market_two/init_market.rs`.
- **Remove** `admin_signer: Signer<'info>` and `validate_admin()`.
- **Add** `curator: Pubkey` field stored on the market (can equal payer, or be set explicitly).
- **Add** virtual-share wiring in `calc_lp_tokens_out`:
  ```rust
  fn calc_lp_tokens_out(pt_in: u64, sy_in: u64, virtual_pt: u64, virtual_sy: u64) -> u64 {
      let product = (pt_in + virtual_pt).saturating_mul(sy_in + virtual_sy);
      (product as f64).sqrt() as u64
  }
  ```
  Mirror Blue's approach: total_shares = sqrt((pt + vp)(sy + vs)) - sqrt(vp * vs).

#### All instruction handlers using SY CPIs
- Wrap every `cpi_deposit_sy`, `cpi_withdraw_sy`, `cpi_get_sy_state`, `cpi_claim_emission` with:
  ```rust
  self.vault.reentrancy_guard = true;
  // exit & serialize accounts before CPI
  // CPI
  self.vault.reload()?;
  self.vault.reentrancy_guard = false;
  ```
  OR implement at Anchor instruction-attribute level with a pre-check on `reentrancy_guard == false`.
- Add SY state validation after every `get_sy_state` return:
  - `sy_state.exchange_rate > 0`
  - `sy_state.emission_indexes.len() == vault.emissions.len()`
  - `sy_state.exchange_rate.is_finite()` (via `precise_number::Number` checks)

#### [instructions/vault/admin/modify_vault_setting.rs](programs/exponent_core/src/instructions/vault/admin/modify_vault_setting.rs)
- **Rename** to `instructions/vault/modify_vault.rs`.
- Gate on `vault.curator == signer.key()`, not admin principle.
- Restrict `AdminAction` enum to only the actions that are safe for a curator:
  - Pause flags (✓)
  - Claim limits (✓)
  - Min op sizes (✓)
  - Lower `interest_bps_fee` (one-way ratchet) — never raise.
- **Remove** `max_py_supply` mutation (make immutable at init, set from `init_vault` param).

Same shape for `modify_market_setting.rs`.

#### [instructions/vault/admin/collect_emission.rs](programs/exponent_core/src/instructions/vault/admin/collect_emission.rs) / [treasury/](programs/exponent_core/src/instructions/vault/admin/treasury/)
- Rename to remove `admin/`.
- Gate on `vault.curator`.
- Treasury destination is whatever the curator set at init. Core doesn't care.

### 6.3 New files

- `programs/exponent_blue_core/src/state/constants.rs`:
  ```rust
  pub const PROTOCOL_FEE_MAX_BPS: u16 = 2500; // 25%
  pub const MIN_DURATION_SECONDS: u32 = 24 * 3600; // 1 day
  pub const MAX_DURATION_SECONDS: u32 = 5 * 365 * 24 * 3600; // 5 years
  pub const VIRTUAL_PT: u64 = 1_000_000;
  pub const VIRTUAL_SY: u64 = 1_000_000;
  ```
- `programs/exponent_blue_core/src/reentrancy.rs`: helper macros / functions for the guard pattern.

### 6.4 Virtual shares mechanics (Blue-style)

Pool reserves are tracked as (pt_balance, sy_balance). Quoted reserves for math are (pt_balance + VIRTUAL_PT, sy_balance + VIRTUAL_SY). Effects:

- First LP receives `sqrt((pt+VP)(sy+VS)) - sqrt(VP·VS)` LP tokens. The `-sqrt(VP·VS)` term is "burned" to the zero address (or retained by the market).
- An attacker donating 1 wei directly to the reserve accounts can't inflate share price meaningfully because virtual dominates.
- Total LP supply ≈ sqrt((pt+VP)(sy+VS)); asymptotically identical to sqrt(pt·sy) for large reserves.

Apply the same virtualization to *all* swap math — not just LP minting. The AMM curve sees (pt+VP, sy+VS) everywhere.

---

## 7. Implementation milestones

Execute in order. Each milestone ends with a green test suite and a merged branch.

### Milestone 0 — Fork & rename
- Create fork repo (user).
- Copy PLAN.md into fork root.
- Rename crate: `exponent_core` → `exponent_blue_core`. Update `Cargo.toml`, `Anchor.toml`, `package.json`, `declare_id!`.
- Delete `programs/exponent_admin/`. Remove all `use exponent_admin::…` imports.
- `cargo build` passes (may need stub `Admin` type temporarily — delete it in M1 instead).
- **Exit criteria:** builds + existing tests compile (they'll fail — that's fine).

### Milestone 1 — Strip admin, add curator
- Remove all `Admin` account params from instruction structs.
- Replace validation calls `self.admin.principles.exponent_core.is_admin(..)` → `require!(signer.key() == vault.curator, ...)`.
- Add `curator: Pubkey` to Vault + MarketTwo.
- Update all admin-gated instructions to curator-gated (modify settings, treasury, emissions).
- `init_vault` and `init_market` no longer require admin. Creator is stored as `curator`.
- **Exit criteria:** full compile; a locally-run test can (a) init vault without admin, (b) init market without admin, (c) reject modify_* from non-curator.

### Milestone 2 — Invariants & safety guards
- Add `reentrancy_guard: bool` fields. Wire entry-check + set/clear around every SY CPI.
- Add SY state validation helpers (exchange_rate > 0, emissions length match).
- Bake in `PROTOCOL_FEE_MAX_BPS` and enforce at `init_vault` / `init_market`.
- Make `creator_fee_bps` / `interest_bps_fee` ratchet-down only in modify handlers.
- Make `max_py_supply` immutable (set at init, no modify path).
- Make core curve params (`ln_fee_rate_root`, `rate_scalar_root`) immutable post-init.
- **Exit criteria:** every SY CPI sits between guard-set/clear. Dedicated test for re-entrancy (mock SY program that tries to call back in; must fail).

### Milestone 3 — Virtual shares
- Add `VIRTUAL_PT` / `VIRTUAL_SY` constants.
- Update `MarketFinancials` math: every read of `pt_balance`/`sy_balance` uses the virtualized view via a helper.
- Update `calc_lp_tokens_out` to Blue formula.
- Update `trade_pt`, `buy_yt`, `sell_yt`, `deposit_liquidity`, `withdraw_liquidity` math to use virtualized reserves.
- **Exit criteria:** fuzz test: first-deposit sandwich attempt leaves attacker with strictly less than they started. 1-wei donation attack does not shift exchange rate beyond epsilon.

### Milestone 4 — Strip non-core (farms, emissions-admin, wrappers)
- Delete farm instructions + `LpFarm` from market state.
- Delete `add_emission` / `add_market_emission` from core (but keep `collect_emission` — it's a user ix).
- Move wrappers into a new crate `programs/exponent_blue_router/` (standalone program that CPIs into core).
- Core now has ~7–9 instructions.
- **Exit criteria:** core program compiles at reduced surface area. Existing integration test for "wrapper_buy_pt via router" still works (via CPI into core).

### Milestone 5 — Reference SY adapter (generic)
- Write a minimal `generic_exchange_rate_sy_adapter` reference program:
  - Implements the 10 required discriminators.
  - Wraps a single SPL mint with a user-provided exchange-rate source (initially: an oracle account the adapter reads; MVP can be a manually-pokable admin-set value).
  - Is itself permissionless to instantiate.
- Not part of core; lives under `reference_adapters/`.
- **Exit criteria:** a local test creates a generic SY, creates a vault+market using it, strips/merges/trades successfully.

### Milestone 6 — Integration tests
- End-to-end test: permissionless user creates a vault + market on top of a freshly-instantiated generic SY. No privileged keys involved.
- End-to-end test: attacker creates a malicious SY that reports nonsense exchange rates. Verify only that vault's holders are affected — every other market is untouched.
- End-to-end test: re-entrant SY program cannot corrupt state.
- **Exit criteria:** 20+ integration tests green.

### Milestone 7 — Periphery (optional, can ship without)
- `exponent_blue_rewards`: farm + emission-router.
- `exponent_blue_curator`: MetaMorpho-style vault that takes user deposits and routes to a curator-selected list of markets.

### Milestone 8 — Audit prep
- Invariant spec document (formalize §3 above).
- Freeze interfaces.
- Multisig upgrade authority.
- External audit (6-10 weeks, $50-150k).

### Milestone 9 — Mainnet
- Deploy core to mainnet (~2-5 SOL).
- Deploy reference adapters.
- Burn upgrade authority (or transfer to long-delay timelock).
- Publish reproducible build hash.

---

## 8. Testing strategy

- **Unit tests.** One per state-mutating function. Assert invariants hold after every op.
- **Property tests.** Fuzz `strip`, `merge`, `trade_pt` on random sequences. Assert I-V1, I-M1, I-M2 hold.
- **Re-entrancy harness.** Custom mock SY program that, on CPI-in, tries to call back into vault/market instructions. All callbacks must fail with `ReentrancyLocked`.
- **Economic tests.**
  - Virtual-share sandwich: two first-depositors, simulate front-run. Verify first depositor can't extract.
  - Donation attack: raw-transfer SPL tokens to escrow accounts. Verify no price change beyond dust.
- **SY-behavior tests.** Parameterize tests with "honest SY", "lying SY", "dust SY", "SY that returns zero exchange rate". Verify core degrades gracefully (errors, doesn't corrupt).
- **Differential tests.** For curve math, compare Rust implementation against a Python reference (or the upstream Exponent binary) on a grid of inputs.

---

## 9. Re-entrancy / invariant audit checklist

Run before every milestone merge:

- [ ] No CPI into an untrusted program without prior state serialization.
- [ ] No state mutation after an untrusted CPI without a `reload()`.
- [ ] Every entrypoint starts with `require!(!reentrancy_guard, ...)`.
- [ ] Every exit path clears the guard (including error paths — use a guard struct with Drop, or equivalent).
- [ ] No `ctx.remaining_accounts` usage that allows swapping in alternate vault/market accounts.
- [ ] All `has_one` / seed constraints are strict.
- [ ] No arithmetic without explicit `checked_*` or wrapping semantics.
- [ ] No `unwrap()` on user-supplied inputs (only on pure-math invariants).
- [ ] `Number` / `DNum` operations handle zero / infinity cases.
- [ ] SY state return values are validated before use.
- [ ] Creator-gated modify actions cannot violate I-E1 / I-E2.
- [ ] No instruction takes two `Vault` or two `MarketTwo` accounts simultaneously.
- [ ] All `close` / realloc paths re-check curator signer.

---

## 10. Open questions — decide before milestone 1

1. **Name + program ID.** Placeholder: `exponent_blue_core`. Generate a vanity keypair with the chosen prefix.
2. **`curator` == `payer` at init, or separate signer?**
   - Same: simpler; creator owns the market they seed.
   - Separate: a UI can create a market seeded by the user with a protocol-owned curator. More flexible; slight UX burden.
   - **Recommendation:** separate pubkey param, defaults to payer in client SDK. Zero on-chain cost.
3. **Protocol fee destination during bringup.** Who receives the `PROTOCOL_FEE_MAX_BPS` fee if enabled? Options:
   - Immutable on-chain address baked into the program (Morpho Blue approach, set by governance).
   - A field on the vault set at init.
   - Default 0% fee permanently — "no protocol take".
   - **Recommendation:** start with 0% baked in. Easier audit story. Add a feature flag for a future governance-set fee if needed.
4. **Emissions — core or periphery?** Today they're on vault state. Moving them out is cleaner but cascades:
   - Core emission tracking removed → `claim_emission` lives in a periphery that keeps its own ledger.
   - The SY program still emits; the periphery relays to users.
   - **Recommendation:** Keep basic `emissions: Vec<EmissionInfo>` on vault in M1. Consider periphery-only in a later iteration.
5. **Upgrade authority policy.** Multisig during bringup (who are the signers?). Burn post-audit. Does user want to commit to burn?
6. **Does the fork keep Exponent branding / attribution?** BUSL-1.1 permits derivative works with attribution. Must carry license + attribution notices.

---

## 11. Out of scope (for fork v1)

- PT-collateral lending integrations.
- On-chain PT TWAP oracle for external consumers.
- Cross-market flash-swap routing.
- Governance tokens / ve-locked governance.
- Auto-rebalancing curators (comes in M7 but not for v1 mainnet).
- Liquid wrapping of YT (nYT / sYT style tokens).
- Multi-SY-per-vault composition.

---

## 12. Risks & mitigations

| Risk                                                                    | Mitigation                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Malicious SY program steals deposits                                    | Isolation invariants I-V1…I-V5. Curator layer / UI handles discrimination. Documentation makes it explicit.|
| Re-entrancy via SY CPI                                                  | Reentrancy guard (I-C1). Mock-re-entry harness in tests.                                                |
| First-LP sandwich exploit                                               | Virtual shares (I-M3).                                                                                  |
| Thin bootstrapped markets get yield oracles manipulated                 | Creator sets `liquidity_net_balance_limits` at init. UI warns on thin markets. Out-of-scope to solve in-core. |
| Permissionless market creation used to grief (squatting mint symbols)   | Frontend / curator layer issue, not core.                                                               |
| BUSL license compliance                                                 | Preserve LICENSE, add attribution to upstream Exponent, note derivative.                                |
| SY program upgrade after vault creation                                 | Out of scope; users opt in to SY program risk at vault creation time. Upgrade authority of SY is SY's concern. |
| Rounding errors in virtual-share math                                   | Differential testing against a Python reference; property tests with bounded LP dust.                  |
| Time-curve math breaks at very short / very long durations              | Enforce `MIN_DURATION_SECONDS` / `MAX_DURATION_SECONDS` at init.                                        |

---

## 13. Execution order summary (TL;DR)

1. Fork the repo. Rename. Delete `exponent_admin`. Build breaks — that's fine.
2. M1: strip admin, add curator. Tests green.
3. M2: reentrancy guard + SY validation + fee caps + immutability. Tests green.
4. M3: virtual shares. Tests green.
5. M4: externalize farms, wrappers, admin-side emissions. Core is lean.
6. M5: ship a reference generic-SY adapter.
7. M6: integration test suite (including malicious-SY / re-entrant-SY tests).
8. (Optional) M7: periphery — rewards + curator programs.
9. M8: freeze, invariant doc, external audit.
10. M9: mainnet deploy + burn upgrade authority.

Total time to mainnet-ready, assuming one focused developer and a sympathetic auditor: **3–4 months**. Audit adds 6–10 weeks.

---

## 14. Attribution

This fork derives from Exponent Core ([exponent-finance/exponent-core](https://github.com/exponent-finance)), licensed under BUSL-1.1. All substantive AMM math (`exponent_time_curve`), the SY-CPI interface shape, and the strip/merge state machine originate upstream. Fork changes are limited to permissioning, isolation, and lightweight-core redesign.

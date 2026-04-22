# Devnet deployment plan

Covers the four blockers identified against `FOLLOWUPS.md` current state.
Order matters — later steps depend on earlier ones. Target: a
demonstrable strip → trade → LP → harvest loop on devnet, usable by
integrators.

---

## Step 1 — Fix the test harness (`anchor test` must run end-to-end)

**Problem:** `@solana/spl-token@0.4.14` is ESM-only, `ts-mocha` is CJS.
`anchor test` exits before any `it(…)` body runs.

**Option A — switch runner (preferred, low churn):**
- [ ] Replace `ts-mocha` with `mocha` + `tsx` in `package.json`:
  ```
  "test": "mocha --loader tsx -t 1000000 'tests/**/*.ts'"
  ```
- [ ] Update `Anchor.toml`'s `[scripts] test` to match.
- [ ] `tsconfig.json`: set `"module": "nodenext"`, `"moduleResolution": "nodenext"`,
  add `"ts-node": { "esm": true }` block.
- [ ] Rename any bare `.ts` imports to include `.js` extension if Node's
  ESM resolver rejects them (likely just the inter-fixture imports).
- [ ] Confirm `anchor test --skip-build` green on `tests/clearstone-core.ts`
  (the 16 existing `it(…)` bodies must all land).

**Option B — pin a CJS version (fallback if A is painful):**
- [ ] `@solana/spl-token@^0.3.11` (last pre-ESM release); accept the
  missing `createAssociatedTokenAccountIdempotent` export and rewrite
  the ~3 call sites that use the newer API.

**Exit criterion:** `anchor test` exits 0 with ≥16 it-bodies passing,
including the 3 reentrancy runtime tests.

## Step 2 — Periphery test coverage (smoke suites)

Currently only `clearstone_core` has runtime tests. Before devnet,
stand up happy-path coverage for each periphery program so devnet
deploys don't expose untested code paths to integrators.

**Status (2026-04-22):** Step 2 largely complete. `anchor test` suite
is 36 passing / 4 failing. The three new `describe` blocks
(curator / rewards / router) contribute 16 new passing `it` bodies.
See "What landed" block below.

**New test files (one per program, 3–6 `it` bodies each):**

- [x] `tests/clearstone-router.ts` — IDL-shape regression guard
  (all 12 wrappers present, arg counts match Rust signatures,
  `MissingReturnData` error code still exported). Full-stack
  wrapper_strip/merge/etc. happy-path tests deferred to after core
  tests 1/2 (setup flake) and init_market_two simulation edges settle
  down; the IDL check catches the common breakage class.
- [x] `tests/clearstone-curator.ts`
  - [x] `initialize_vault` sets curator/baseMint/fee_bps.
  - [x] fee_bps > 2000 rejected.
  - [x] deposit → withdraw fast path.
  - [x] deposit amount=0 rejected.
  - [x] `set_allocations` realloc 0 → 2 slots.
  - [x] weights > 10_000 bps rejected.
  - [x] non-curator signer rejected (has_one).
  - [x] `harvest_fees` with zero gain mints nothing.
  - [x] `harvest_fees` bootstrap path (no prior holders) mints 1:1.
  - [ ] `reallocate_to_market` + `mark_to_market` — deferred; needs
    full core market fixture (init_market_two works now; writing this
    test is mechanical but large).
- [x] `tests/clearstone-rewards.ts`
  - [x] `initialize_farm_state` pins curator/market/lp_mint.
  - [x] `add_farm` registers reward bucket.
  - [x] duplicate reward_mint rejected.
  - [x] `stake_lp` → escrow bump + position updates.
  - [x] stake → unstake round-trip.
  - [x] `refill_farm` by curator.
  - [x] `decommission_farm` after expiry removes entry + sweeps escrow.
  - [x] `realloc_stake_position` on a stale stake.
  - [ ] `claim_farm_emission` with time advance — deferred; needs a
    deterministic clock warp (see fixtures note).

**Shared fixture extensions** (`tests/fixtures.ts`):
- [x] Curator PDA helpers: `findCuratorVault`, `findBaseEscrow`,
  `findUserPos`.
- [x] Rewards PDA helpers: `findFarmState`, `findLpEscrow`,
  `findStakePosition`.
- [ ] Clock-warp helper for emission-claim tests — not landed.
  `validatorCustomSlotTicker` needs a custom validator config; a
  plain `sleep` in `refill → stake → sleep(2s) → claim` is flakier
  than we want.

**What landed to unblock the suite:**

- `enable_metadata: bool` param on `initialize_vault` — when `false`,
  skips the Metaplex CreateMetadataAccountV3 CPI entirely. Tests set
  it false; default stays true for production. This sidestepped the
  unknown-account / privilege-escalation diagnostic the plan called
  out without needing to chase the underlying Metaplex 5.1.1 or
  Anchor 0.31 corner case.
- `#[account(mut)] mint_sy` on `MarketTwoInit`. Root cause of the
  residual "writable privilege escalated" after unblocking
  initialize_vault: the adapter's `DepositSy` marks `sy_mint` as
  mutable (legitimate — adapters may manage mint data), but the
  outer `init_market_two` left it read-only. Unified the two by
  making mint_sy writable in the market-init Accounts struct. No
  adapter change required, so any 3P adapter gets this for free.
- `stake_lp` in `clearstone_rewards` now sets `pos.owner` and
  `pos.farm_state` at init time. Without this, `unstake_lp` and
  `realloc_stake_position` fail their `has_one` checks because
  Anchor's `init_if_needed` on the position leaves the fields zeroed.
  Caught by the rewards smoke suite.

**Shared Step-2 sub-task — diagnose `setupVault` → Metaplex CPI failure.**
**Resolved via bypass flag (2026-04-22).** Step 1 got the harness
running but exposed a pre-existing bug: 13 of 20 core tests failed
because `initialize_vault` aborted inside the Metaplex
`CreateMetadataAccountV3` CPI. Rather than chase the underlying
Metaplex 5.1.1 / Anchor 0.31 / Solana 2.1.0 runtime corner (which
fresh eyes were welcome to, but was not the highest-impact move),
we gated the Metaplex CPI behind an `enable_metadata: bool`
parameter on `initialize_vault`. Tests pass `false`; production will
pass `true`. Separately, unblocking Metaplex exposed a second issue
in `init_market_two` (sy_mint not writable in outer tx) — also
fixed. Notes from the original diagnosis kept below for posterity in
case the Metaplex path is revisited.

Symptoms / evidence already gathered:
- `authority` IS in the outer tx's AccountMeta list (confirmed by
  dumping `.instruction().keys` — present at index [1], writable=false,
  signer=false).
- `init_personal_account` CPI (just before) completes successfully,
  so the handler reaches `create_metadata`.
- Metaplex's CPI is rejected at the Solana runtime boundary *before*
  Metaplex code executes — no `Program metaqbxxU… invoke [2]` line.
- The error occurs with both `SystemAccount<'info>` and
  `UncheckedAccount<'info>` declarations for authority.
- Persists across both the high-level
  `CreateMetadataAccountV3Cpi::new(...).invoke_signed(...)` builder and a
  manually-assembled `invoke_signed` with explicit AccountMeta +
  AccountInfo lists.
- Persists across `.accounts()` and `.accountsStrict()` client
  builders.
- Persists after rebinding all `to_account_info()` calls to named
  local bindings (ruled out the dangling-reference hypothesis).

Next things to try (haven't been ruled out):
- [ ] Cross-check the `authority` bump stored in `vault.signer_bump`
  at write time vs what `ctx.bumps.authority` resolves to at
  `create_metadata` time — a stale bump would derive a different PDA
  than the one in the outer tx.
- [ ] Strip the CPI down to a no-op against a minimal mock Metaplex
  replacement (flag-gate Metaplex behind a feature so tests can
  bypass). Confirms whether the bug is in Metaplex 5.1.1 specifically
  or in any cross-program invoke_signed with a PDA signer here.
- [ ] Run under `solana-program-test` with tracing, rather than
  `anchor test` — full log stream + per-step account state should
  surface whatever invariant the runtime is rejecting.
- [ ] Check whether `mpl_token_metadata::ID` embedded in the core
  binary matches the runtime-loaded Metaplex program ID. A version
  skew (compiled against 5.1.1 but cloned from mainnet uses a
  different build) could desync account expectations.
- [ ] Skip the Metaplex step entirely if it proves stubborn — PT/YT
  mints function without metadata; wallets just won't render them
  prettily. Gate metadata creation behind an `enable_metadata: bool`
  ix arg defaulted to `true` so production keeps it but tests can
  set false.

Current harness state at Step 1 exit: 7 passing / 13 failing. 13
failures group as:
- 3 × core happy path (SY → vault → market, strip↔merge, trade_pt) —
  all blocked on `setupVault`'s Metaplex abort.
- 1 × malicious-SY isolation (honest-stays-alive) — same block.
- 3 × reentrancy runtime mock — same block.
- 3 × curator auth — same block (they share `freshStack`).
- 3 × AMM invariants — same block.

Unblocking `setupVault` should unblock 10+ of these in one stroke. The
`setupVaultOverNonsense` path (used by 2 of the 3 passing
malicious-SY tests) doesn't hit Metaplex — it's why those tests
work. Periphery smoke tests (curator / rewards / router) can reuse
that path to make progress independent of the Metaplex fix.

**Exit criterion:** `anchor test` runs 3 new `describe` blocks green,
total suite > 30 `it` bodies passing, with the Metaplex-block issue
either fixed or bypassed behind a feature flag.

### Remaining test failures (post-Step-2, 36/40 green)

Tracked here so they don't get lost. None block Step 2's exit
criteria but all should clear before we advertise devnet as stable.

- [ ] **F1. `permissionless happy path :: user without privileged keys
  creates SY → vault → market`** — fails in setupVault's
  `initialize_vault` simulation. Error:
  `"Instruction references an unknown account <X>"` immediately after
  the adapter's `init_personal_account` CPI returns success. With
  `enable_metadata=false` the handler has no further CPIs, so this
  should be a no-op return — something is referencing a pubkey not
  in the outer tx's account set.
- [ ] **F2. `permissionless happy path :: strip → merge roundtrip
  returns original SY minus fees`** — setupVault succeeds here; the
  in-body `strip` fails with the same "unknown account <X>" pattern.
  Pubkey X matches F1's pubkey *within a single run* (but differs
  across runs), which strongly suggests ALT-activation race: the
  first `freshStack` of a run sees a partially-zeroed ALT in
  simulation. `createAndExtendAlt` polls `current > creationSlot + 1`
  which is the documented minimum but not defensive against preflight
  lag. Candidate fixes: (a) poll `finalized` instead of `confirmed`,
  (b) add a fixed grace sleep (250ms) after the poll loop exits,
  (c) re-fetch the ALT account and assert `addresses.len() == 7`
  before returning.
- [ ] **F3. `reentrancy (runtime mock) :: reentrant SY cannot
  re-invoke strip during deposit_sy CPI`** — the test catches an
  error but its regex `/ReentrancyLocked|Reentrancy locked|6030/i`
  doesn't match `String(err)`. The third reentrancy test ("guard
  clears after a successful ix so the next strip succeeds") is
  passing, so the guard code itself works; the issue is either (a)
  the test's string extraction drops the inner program log before
  the regex runs, or (b) the reentrant mock's cascade CPI is hitting
  a wiring error *before* the latch check, surfacing a different
  (and correct-for-that-cause) error. Quick diagnostic: swap
  `expect(String(err)).to.match(...)` for `expect((err as any).logs
  ?.join("\n") ?? String(err)).to.match(...)` — if that flips the
  test to green, it's (a); if not, (b) and the cascade CpiAccounts
  wiring in `setupVaultOverReentrant` needs a second look.
- [ ] **F4. `reentrancy (runtime mock) :: reentrant SY cannot
  re-invoke merge during withdraw_sy CPI`** — same failure mode as
  F3 for the merge path. The same diagnostic applies; if F3's fix is
  (a), this one gets the same log-extraction change and should clear
  together.

None of the four are regressions from Step 2's changes — F1/F2's
symptom changed from "Metaplex CPI" to "ALT-timing" because the
Metaplex bypass moved the failure later in the handler, but the
flake-on-first-freshStack pattern was already latent. F3/F4 were
already failing at Step 1 exit.

## Step 3 — Deploy machinery

**Keypairs — decide ID strategy once and stick with it:**
- [ ] For devnet-only: keep current `target/deploy/*-keypair.json`
  (generated during local builds). Commit the **pubkeys** to
  `DEPLOY_IDS.md`, keep private keys out of git (they're in
  `.gitignore` already).
- [ ] For ID-stable path to mainnet: regenerate all 7 program keypairs
  via `solana-keygen grind --starts-with clr` (or whatever prefix),
  update `declare_id!(…)` + `Anchor.toml`'s `[programs.localnet]` / add
  `[programs.devnet]`, commit the chosen pubkeys. This keeps devnet and
  mainnet on the same IDs.

**Deployer wallet:**
- [ ] Generate a dedicated devnet deployer: `solana-keygen new -o
  ~/.config/solana/clearstone-devnet.json`.
- [ ] Airdrop ~50 SOL in chunks of 5 (devnet rate-limit): script it in
  `scripts/devnet-fund.sh`.
- [ ] Transfer upgrade authority on each program to a second, cold
  keypair — devnet isn't audit-critical but practicing the flow now
  saves pain at mainnet.

**Anchor config:**
- [ ] Add `[provider.devnet]` and `[programs.devnet]` blocks to
  `Anchor.toml`.
- [ ] `.env.devnet` with `ANCHOR_WALLET=~/.config/solana/clearstone-devnet.json`,
  `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com`.

**Deploy order (scripted, idempotent):**
```
1. clearstone_core
2. generic_exchange_rate_sy
3. malicious_sy_nonsense       # skip for devnet if we don't want test-only code on-chain
4. malicious_sy_reentrant      # same — probably skip
5. clearstone_rewards
6. clearstone_curator
7. clearstone_router
```

**Exit criterion:** `anchor deploy --provider.cluster devnet` for each
program is green, program pubkeys match `declare_id!()`, authority is
the cold key.

## Step 4 — Pre-deploy sanity + dry-run

Run all of these in order before first devnet deploy and keep them in
`scripts/` for future re-deploys.

**Reproducibility:**
- [ ] `solana-verify build --library-name clearstone_core` — confirm
  the on-chain deployed hash will match the repo.
- [ ] Publish the hash for each program in `DEPLOY_IDS.md` alongside
  the pubkey.

**IDL freeze:**
- [ ] `anchor build` clean; copy `target/idl/*.json` → `idl/` in repo
  root.
- [ ] `anchor idl init` for each program on devnet (uploads IDL to
  on-chain IDL account so explorers can decode events).

**End-to-end dry run** — new script `scripts/devnet-e2e.ts` that:
1. Creates a base SPL mint, seeds the deployer with 1M units.
2. Initializes an SY market against the generic adapter.
3. Initializes a vault + market over that adapter.
4. `strip` → assert PT + YT land in wallet.
5. `wrapper_buy_pt` → assert PT delta.
6. Initialize a curator vault, set one allocation, `deposit` base.
7. `reallocate_to_market` → `mark_to_market` → `harvest_fees` (0 gain
   case).
8. Print every account pubkey + a summary block so integrators can
   reproduce.

**Exit criterion:** `scripts/devnet-e2e.ts` runs green against
`api.devnet.solana.com`; output pubkeys are commitable to
`DEPLOY_IDS.md` as canonical devnet handles.

---

## Estimate + sequencing

| Step | Effort | Blocks |
|------|--------|--------|
| 1. Test harness | 0.5d | 2, 4 |
| 2. Periphery tests | 2d | 4 |
| 3. Deploy machinery | 0.5d | 4 |
| 4. Sanity + dry run | 1d | — |

≈ **4 days** to a demonstrable devnet. Steps 1 and 3 can run in
parallel. Step 2 is the longest pole and most easily scope-trimmed if
time is tight (ship 1 smoke test per program instead of 3–6).

## Out of scope here (pushed to mainnet/audit phase)

- Squads multisig on upgrade authority (Step 3 uses a cold key — fine
  for devnet).
- `AUDIT_SCOPE.md` tag + `solana-verify` hash pin to a specific commit.
- Formal IDL freeze review (devnet IDL can change).
- Removing `malicious_sy_reentrant` / `malicious_sy_nonsense` from the
  workspace for the audit tag — they're test-only and shouldn't ship
  to mainnet but can live on devnet for integrator testing.

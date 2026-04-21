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

**New test files (one per program, 3–6 `it` bodies each):**

- [ ] `tests/clearstone-router.ts`
  - strip → merge roundtrip via the wrappers.
  - `wrapper_buy_pt` then `wrapper_sell_pt` — base goes out, base comes
    back within slippage.
  - `wrapper_provide_liquidity` + `wrapper_withdraw_liquidity_classic`.
  - Assert the 12 exported methods at least type-check by instantiating
    each in a no-op try/catch.
- [ ] `tests/clearstone-curator.ts`
  - `initialize_vault` → `deposit` → `withdraw` (fast path, no markets).
  - `set_allocations` realloc: grow from 0 → 2 slots.
  - `reallocate_to_market` on a test market seeded via `setupMarket`,
    then `mark_to_market` → assert `deployed_base` > 0.
  - `harvest_fees` with and without prior gain.
- [ ] `tests/clearstone-rewards.ts`
  - `initialize_farm_state` → `add_farm` → `stake_lp` → advance clock →
    `claim_farm_emission` → assert reward transfer.
  - `refill_farm` by curator.
  - `decommission_farm` after expiry — assert the entry is gone and the
    drain received leftovers.
  - `realloc_stake_position` on a stale stake.

**Shared fixture extensions** (`tests/fixtures.ts`):
- [ ] Helper to set up a curator vault + two markets ready for
  reallocation.
- [ ] Helper to seed a farm + fund it + advance `Clock` via
  `validatorCustomSlotTicker` or `warp` RPC.

**Shared Step-2 sub-task — diagnose `setupVault` → Metaplex CPI failure.**
Step 1 got the harness running but exposed a pre-existing bug: 13 of
20 core tests fail because `initialize_vault` aborts inside the
Metaplex `CreateMetadataAccountV3` CPI with
`"Instruction references an unknown account <authority_pda>"`. The
unknown pubkey is always the vault authority PDA
(`[AUTHORITY_SEED, vault.key()]`). Fresh eyes needed.

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

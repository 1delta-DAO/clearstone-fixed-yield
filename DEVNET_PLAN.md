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

**Status (2026-04-24):** Step 2 complete. `anchor test` suite
is 60 passing / 9 failing (all 9 failures are pre-existing —
F1 simulator-lag flake, flash_swap_pt suite, kamino adapter —
none in Step 2 scope). The three new `describe` blocks
(curator / rewards / router) are fully green; all previously
`it.skip`'d tests re-enabled and passing after the core-side
BPF-stack Box<>ing and the curator base_escrow authority fix.

**New test files (one per program, 3–6 `it` bodies each):**

- [x] `tests/clearstone-router.ts` — IDL-shape regression guard
  (all 12 wrappers present, arg counts match Rust signatures,
  `MissingReturnData` error code still exported), plus three
  full-stack wrapper smoke tests — all green:
  `wrapper_strip → wrapper_merge` roundtrip,
  `wrapper_buy_pt → wrapper_sell_pt` (base-in/base-out within
  slippage), and `wrapper_provide_liquidity_classic` +
  `wrapper_withdraw_liquidity_classic`.
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
  - [x] `harvest_fees` with prior holders dilutes via `S * fee /
    (A - fee)` (non-bootstrap path).
  - [x] `reallocate_to_market` → `mark_to_market` lifts
    `deployed_base` above 0 and updates `total_assets`. Unblocked
    by the `Box<>` pass over TradePt / DepositYt / WithdrawYt /
    Collect{Emission,Interest,TreasuryInterest}; needs the
    `CU_LIMIT_IX` 600k preinstruction because the three nested CPIs
    (mint_sy → trade_pt → deposit_liquidity) blow past the 200k
    default.
  - [x] `reallocate_to_market` rejects out-of-range
    `allocation_index`.
- [x] `tests/clearstone-rewards.ts`
  - [x] `initialize_farm_state` pins curator/market/lp_mint.
  - [x] `add_farm` registers reward bucket.
  - [x] duplicate reward_mint rejected.
  - [x] `stake_lp` → escrow bump + position updates.
  - [x] stake → unstake round-trip.
  - [x] `refill_farm` by curator.
  - [x] `decommission_farm` after expiry removes entry + sweeps escrow.
  - [x] `realloc_stake_position` on a stale stake.
  - [x] `claim_farm_emission` with time advance — now uses the
    `advanceClock` fixture helper to block on natural slot
    progression until the sysvar clock moves the expected window,
    then asserts reward transfer ≥ `token_rate * dt_seconds`.

**Shared fixture extensions** (`tests/fixtures.ts`):
- [x] Curator PDA helpers: `findCuratorVault`, `findBaseEscrow`,
  `findUserPos`.
- [x] Rewards PDA helpers: `findFarmState`, `findLpEscrow`,
  `findStakePosition`.
- [x] Clock-warp helper (`advanceClock`) — polls the sysvar clock
  until the target delta lands, avoiding the `sleep(n)` flake. The
  test-validator doesn't expose a true `warp` RPC, so we let slots
  progress naturally and watch the on-chain timestamp.
- [x] Curator-vault + two-markets composite fixture
  (`buildCuratorStackTwoMarkets`) — stands up base mint, SY market,
  core vault, two core markets (seed_id=1, seed_id=2), and a
  curator vault seeded with base.

**Core-side fixes landed in this session:**

- [x] **BPF stack overflow in `try_accounts` frames.** Anchor's
  auto-generated account validators for `TradePt`, `DepositYt`,
  `WithdrawYt`, `CollectEmission`, `CollectInterest`, and
  `CollectTreasuryInterest` each decoded an unboxed
  `Account<'info, Vault>` or `InterfaceAccount<'info, Token*>`
  inline — pushing the stack past the 4096-byte BPF cap (the worst
  offender was CollectInterest at 5032). Runtime symptom under
  nested-CPI call sites (curator.reallocate / router.wrapper_buy_pt):
  `"Access violation in stack frame 5 at address 0x200005f48 of
  size 8"`. Fix: `Box<>`-ed the heavy InterfaceAccount + Vault
  fields on each of those six structs. `anchor build -p
  clearstone_core` no longer prints any try_accounts stack warning.
- [x] **`curator::InitializeVault.base_escrow.token::authority`
  was `base_escrow` (self-authored), which blocked the reallocate
  path at the adapter's `mint_sy` (`base_src.owner == owner`
  check failed with ConstraintTokenOwner 2015). Changed to
  `token::authority = vault` so the vault PDA signs out of
  base_escrow — both the user-withdraw path and the reallocate
  path now use the same signer. `withdraw` updated to sign with the
  vault's seeds.**

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

### Remaining test failures

**Status update (2026-04-26): 61 passing / 8 failing.** Step 2's
periphery exit criteria hold (curator/rewards/router suites all
green). The 8 remaining failures fall outside Step 2 scope:

Fixed this session:
- [x] **F2 (strip → merge roundtrip)** — cleared by the 2s grace
  sleep in `createAndExtendAlt`.
- [x] **F3/F4 (reentrant SY cannot re-invoke strip/merge)** — cleared
  by widening the assertion regex to accept Solana's runtime CPI-cycle
  error `"reentrancy not allowed"` in addition to our custom code
  6030. Both layers fire; the test now accepts either.
- [x] **mintSyForUser ATA bug** — helper now optionally takes
  `payer + baseMintAuthority`; if both supplied, creates the user's
  base ATA and funds it before swapping to SY. Unblocked the 6
  fusion-flash tests that were dying on `AccountNotInitialized` for
  base_src — they now reach further into the actual flow.
- [x] **syCpiExtras forwards is_signer=true on PDA-signed accounts**
  — the test helper in `clearstone-fusion-flash.ts` was extracting
  `isSigner` flags from the market's stored `cpi_accounts` and
  forwarding them as outer-tx AccountMetas. web3.js's
  `Transaction.serialize` then demanded a real keypair signature for
  accounts that are only ever PDA-signed via invoke_signed inside
  core. Stripped `isSigner=false` on the forwarded extras (TWO copies
  — one in `syCpiExtras()` near line 246, one inline near line 519
  in the fusion-fill test). Unblocked 5 flash_swap_pt tests' simul
  + the fusion-fill tx-build path.

Still open (8 failures, all outside Step 2 scope):

- [ ] **F1. `clearstone-core :: permissionless happy path :: user
  without privileged keys creates SY → vault → market`** — fails in
  `setupMarket → init_market_two`'s do_deposit_sy CPI right after
  `init_personal_account` returns success. `enable_metadata=false`
  means the handler issues no Metaplex CPI; the failure is a SY-CPI
  account-resolution issue inside `do_deposit_sy`. Most likely cause:
  one of the 7 ALT-resolved pubkeys for the market's deposit_sy is
  not in the outer tx's flat account list. Next: dump the market's
  cpi_accounts.deposit_sy via a debug print, cross-reference with the
  outer tx's account_keys, identify the missing pubkey, add it to
  `setupMarket`'s remainingAccounts.
- [ ] **flash_swap_pt sign-mismatch (4 tests):** `flash_swap_pt.rs:184`
  hits `MathOverflow` because `quote.net_trader_sy >= 0` for the
  test's curve parameters (init_rate_anchor=1.05, ptInit=syInit=1M,
  fee=2%). The handler's `let net_trader_pt: i64 = -(pt_out as i64)`
  treats the flash as a SELL for quoting purposes, but the curve
  returns positive net_trader_sy meaning "trader receives SY for
  selling PT" — non-physical for a flash borrow. Either the sign
  flip is wrong (try `+pt_out` and require net_trader_sy > 0) or the
  test's curve setup makes PT cheap enough that the curve says "we'd
  pay you to take this PT". Feature-level invariant in
  flash_swap_pt; not in Step 2's curator/rewards/router scope.
- [ ] **fusion-fill tx too large (1 test):** `e2e happy path —
  fusion.fill via clearstone_solver_callback` builds a legacy tx of
  1360 bytes (limit 1232). Needs versioned tx + the market's ALT to
  compress. Significant test rework; not Step 2 scope.
- [ ] **kamino_sy_adapter `kyc_mode is optional :: GovernorWhitelist`
  (1 test):** "Attempt to load a program that does not exist" — the
  governor program isn't cloned into the local validator. Anchor.toml
  has the clone directives intentionally commented out (devnet RPC
  rate-limits made first-run startup unreliable). To re-enable: copy
  the governor + delta_mint + gateway + fusion .so binaries into
  `target/deploy/` with their canonical pubkeys (matches existing
  `[programs.localnet]` pattern), and uncomment the
  `[[test.validator.clone]]` blocks behind a flag.
- [ ] **kamino_sy_adapter `full PT/YT lifecycle` (1 test):** same
  symptom as F1 (init-flow account-resolution issue), likely the same
  root cause. Will resolve when F1 does.

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

### Step-1 Metaplex question — **CLOSED 2026-04-26**

The Step-1 Anchor-0.31 / Metaplex-CPI-fails-with-account-resolution
issue was a **local-validator artifact, not a production bug**.
Confirmed by running `scripts/devnet-e2e.ts` against the live
program with `enableMetadata: true` flipped on `setupVault`:

- Vault `7GVcU1H6A14uKwvffY4MBFXVFC8tNGYHR6bvsBCSEHub` initialized
  cleanly, including the `CreateMetadataAccountV3` CPI.
- Metadata PDA `2ZU778fvNiXCVLGkMcrA5q8Mks85oyvGNHnQFJgFCtvu` exists
  on-chain (607 bytes, Metaplex V3 layout).
- The local-validator failure is plausibly a Metaplex-program-clone
  vs `mpl-token-metadata` 5.1.1 binary skew or a Solana 2.1.0
  `[[test.validator.clone]]` quirk; investigation cost is high and
  payoff is purely "tests can flip enableMetadata back to true".
  Tests stay on `false`; production stays on `true`. Documented in
  the `setupVault` `enableMetadata` field comment.

### Remaining Step-4 follow-ups

- [ ] **Reproducible-build verification under docker** — devnet
  manifest (`deployments/devnet.json`) currently pins
  `onChainSha256` only. To upgrade to `verifiedHash` (proves the
  on-chain binary matches `commit f2aec2d`), run
  `solana-verify build --library-name <crate>` per shipped program
  with docker available. Cannot be done in the current environment
  (docker daemon absent). Run on a workstation with docker before
  audit kickoff.
- [x] **Kamino canonical-stack handles — RESOLVED 2026-04-28.**
  `kamino_sy_adapter` is deployed (devnet `29tisXppY…`) and the
  real-klend CPI shape is fixed (per
  [`FOLLOWUP_KAMINO_REAL_KLEND.md`](FOLLOWUP_KAMINO_REAL_KLEND.md)).
  The previously-gated reserve `D4qXufDqB…` was retired in favour of a
  live, oracle-fresh reserve under `external.solstice.klendReserveActive`:

  - reserve `AYhwFLgzxWwqznhxv6Bg1NVnNeoDNu9SBGLzM1W3hSfb` (status=0)
  - underlying mint `8iBux2LRja1PhVZph8Rw4Hi45pgkaufNEiaZma5nTD5g` (Solstice USDC)
  - collateral mint `74Wcd7VSUjK4wABMF15Kc4fYqiPDNj4NmE9MMSUR3AJv` (kUSDC)
  - Pyth oracle `EN2FsFZFdpiFAWpKDZqeJ2PY8EyE7xzz9Ew8ZQVhtHCJ`

  `mint_sy` now succeeds end-to-end through klend's `RefreshReserve` — the
  price-validity gate passes without an `update_price_feeds_v2` precondition.
  The canonical Kamino stack persisted in `deployments/devnet.json`
  (`kaminoStack.{baseMint,klendReserve,klendPyth,klendCollateralMint,
  syMetadata,syMint,curatorVault}`) is the integrator-facing handle set.

  Side note: `clearstone-finance/packages/programs/configs/devnet/addresses.json`
  still lists `oracles.usdcPythV2 = HSi8jh6q…`, which is system-program-
  owned and never populated. That field should be deleted or annotated as
  obsolete so future readers don't pick it up over the canonical
  `external.solstice.klendReservePyth` here.
- [ ] **Cron-driven monitoring** — landed: see
  `.github/workflows/devnet-health.yml` (daily 13:00 UTC) and
  `devnet-e2e-refresh.yml` (Mondays 09:00 UTC). The e2e-refresh job
  needs the `DEVNET_DEPLOYER_KEYPAIR_JSON` repo secret set
  (JSON-encoded contents of `~/.config/solana/clearstone-devnet.json`)
  before its first run will succeed.
- [ ] **canonicalStack refresh cadence** — handled by the weekly
  e2e-refresh action above. The action does NOT auto-PR the new
  handles into `devnet.json`; it just surfaces them in the run log.
  Treat handle changes as significant enough to want a manual review.

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

# Follow-ups

Tracked deviations from PLAN.md. Each entry: which milestone left it, why, and what it would take to close.

## M6 — Integration test suite incomplete

This session landed **23 Rust unit tests** covering the M3/M2 safety math
(first-LP sandwich, donation attack, proportionality, reentrancy trait,
SY state validation). They pass via `cargo test --package clearstone_core`.
These are *real* tests — they run without a validator.

[tests/clearstone-core.ts](tests/clearstone-core.ts) has the skeleton for
end-to-end integration tests, organized by PLAN §7 M6 scenario, with every
test currently marked `it.skip(...)`. The skip list **is** the TODO. Rough
count: 17 integration cases to wire up to hit the plan's "20+" target.

**Why skipped:** Full M6 needs `anchor build` + a local validator +
test-time rent lamports. Beyond what this session can verify. Each skipped
test has enough inline comments to pick up:

1. **Permissionless happy path** (3) — SY → vault → market roundtrip,
   strip/merge, trade_pt.
2. **Malicious-SY isolation** (3) — zero rate rejected, emission mismatch
   rejected, cross-vault drain blocked.
3. **Reentrancy** (3) — requires a purpose-built `malicious_sy_reentrant`
   mock adapter. The guard covers strip / merge / trade_pt / collect_* today
   (see M2 carve-out below for coverage gaps).
4. **Curator auth** (5) — non-curator rejected, ratchet-only fee, immutable
   fields.
5. **AMM invariants** (3) — runtime versions of the Rust math tests, plus
   the add → withdraw round-trip.

**To close M6 before audit:**
- Write `reference_adapters/malicious_sy_reentrant/` (~200 lines, mirrors
  generic_exchange_rate_sy but calls back into core on deposit_sy).
- Write `tests/fixtures.ts` with reusable SY+vault+market builders.
- Fill in the 17 skipped `it`s and get them green.
- Finish the M2 reentrancy wiring gap (see "M2 — Reentrancy guard coverage")
  so the reentrancy tests cover the full ix surface, not just the 5 wired ones.

## M5 — Reference adapter runtime-untested

[reference_adapters/generic_exchange_rate_sy](reference_adapters/generic_exchange_rate_sy/src/lib.rs)
compiles and exposes the 10 discriminators the core's SY CPI surface needs,
but has not been exercised at runtime. The plan's M5 exit criterion ("a
local test creates a generic SY, creates a vault+market using it,
strips/merges/trades successfully") lands with the M6 integration suite —
no test runner is wired up in this repo yet.

Known gaps in the adapter itself that would surface during testing:

- **No ATH monotonicity**: `poke_exchange_rate` accepts any positive value.
  A production adapter would enforce I-V3 (`all_time_high_sy_exchange_rate`
  never decreases) or the core's vault has to absorb that risk.
- **Account-order convention for `cpi_accounts`**: the core's
  [CpiAccounts](programs/clearstone_core/src/state/cpi_common.rs) configures
  which accounts get passed to each SY CPI. The vault/market creator has to
  wire this up to match the adapter's `#[derive(Accounts)]` order. There's
  no tooling here yet — a mismatch surfaces only at first trade.
- **Base vault separate from pool_escrow**: `mint_sy` / `redeem_sy` use a
  `base_vault` (base token escrow), while `deposit_sy` / `withdraw_sy` use
  a `pool_escrow` (SY token escrow). Both are distinct token accounts on
  the SyMarket PDA — intentional, but documentation should spell it out
  before curators start wiring markets.
- **No supply cap / emission accrual**: out of scope for this reference.

## M4 — Periphery programs not yet built

Core is now slim: wrappers, farms, market-level emissions, LP staking, and
the admin-side `add_emission` / `add_market_emission` instructions were all
deleted. They need to re-land somewhere before mainnet if the feature set
is to match Exponent Core's. Concretely:

- **Router (`clearstone_router`)** — replacement for the twelve deleted
  `wrapper_*` instructions (provide_liquidity / buy_pt / sell_pt / buy_yt /
  sell_yt / collect_interest / withdraw_liquidity / withdraw_liquidity_classic /
  provide_liquidity_base / provide_liquidity_classic / strip / merge). Each
  existed to wrap "mint SY → core op → redeem SY" into a single transaction
  so users never handle raw SY. The router re-implements them as CPI chains
  into `clearstone_core`'s base primitives (strip, merge, trade_pt,
  deposit_liquidity, withdraw_liquidity). PLAN §5 architecture diagram.

- **Rewards (`clearstone_rewards`)** — replacement for the deleted
  `LpFarm` / `MarketEmissions` / `claim_farm_emissions` / `market_collect_emission`
  / `add_farm` / `modify_farm` / `add_market_emission`. The periphery owns
  its own `farm_state` and `market_emission_state` accounts keyed by market
  pubkey; users stake LP tokens there for emissions. Core knows nothing
  about it.

- **Vault-level emissions** — kept on `Vault.emissions: Vec<EmissionInfo>`
  per §10 Q4 recommendation. The admin-side `add_emission` was deleted in
  M4; emissions now need to be seeded at vault init (pass the list as a
  handler param) or via a `modify_vault_setting` variant. Neither is wired
  yet. Low priority: SY programs that don't emit extra tokens work fine;
  the path is only needed for yield-bearing SYs that distribute rewards.

## M3 — Virtual-share fuzz tests

## M2 — Reentrancy guard coverage is partial

**State.** `reentrancy::enter → persist → CPI → reload → leave` is wired in five
user instructions: [strip](programs/clearstone_core/src/instructions/vault/strip.rs),
[merge](programs/clearstone_core/src/instructions/vault/merge.rs),
[trade_pt](programs/clearstone_core/src/instructions/market_two/trade_pt.rs),
[collect_interest](programs/clearstone_core/src/instructions/vault/collect_interest.rs),
[collect_emission](programs/clearstone_core/src/instructions/vault/collect_emission.rs).

**Left unprotected.** Instructions that use self-CPI (`do_cpi_strip`,
`do_cpi_trade_pt`) internally: [buy_yt](programs/clearstone_core/src/instructions/market_two/buy_yt.rs),
[sell_yt](programs/clearstone_core/src/instructions/market_two/sell_yt.rs),
[deposit_liquidity](programs/clearstone_core/src/instructions/market_two/deposit_liquidity.rs),
[withdraw_liquidity](programs/clearstone_core/src/instructions/market_two/withdraw_liquidity.rs),
and the entire `wrappers/` directory. Also unprotected: small instructions
that do SY CPI without a primary vault/market latch —
[stage_yield](programs/clearstone_core/src/instructions/vault/stage_yield.rs),
[deposit_yt](programs/clearstone_core/src/instructions/vault/deposit_yt.rs),
[withdraw_yt](programs/clearstone_core/src/instructions/vault/withdraw_yt.rs),
[market_collect_emission](programs/clearstone_core/src/instructions/market_two/market_collect_emission.rs),
[deposit_lp](programs/clearstone_core/src/instructions/market_two/deposit_lp.rs),
[withdraw_lp](programs/clearstone_core/src/instructions/market_two/withdraw_lp.rs).

**Why deferred.** The naive pattern (set guard at handler entry, clear at
exit) is incompatible with the self-CPI chains: an outer instruction setting
`market.reentrancy_guard = true` causes the inner self-CPI'd instruction's
own `enter()` to fail. Correctly covering these needs either:
(a) a self-CPI escape — clear the guard around each self-CPI and restore
after, or
(b) refactor self-CPIs to inline calls so there's a single instruction frame
with a single guard, or
(c) move the guard down into the SY CPI helpers themselves
(`cpi_deposit_sy`, etc.), scoping the latch to the CPI call instead of the
whole instruction — this automatically composes with self-CPIs because each
SY CPI gets its own guard window.

**Consequence.** A malicious SY program that reenters from within a
`do_withdraw_sy` / `do_deposit_sy` / `do_get_sy_state` call issued *directly*
from one of the deferred instructions will not be blocked by the guard. It
will be blocked indirectly if it reenters into a wired instruction (strip,
merge, trade_pt, collect_interest, collect_emission), because those will
detect the latch.

**What to do.** Approach (c) is the cleanest — push the guard into
[utils/sy_cpi.rs](programs/clearstone_core/src/utils/sy_cpi.rs) so every
`cpi_deposit_sy`, `cpi_withdraw_sy`, `cpi_get_sy_state`, `cpi_claim_emission`
takes a `&mut Account<Vault>` (or `&mut Account<MarketTwo>`), latches it,
persists, invokes, reloads, clears. Then the current enter/leave wrappers in
the five wired instructions can be removed (redundant) and the deferred
instructions get coverage for free. This is a mechanical but broad change
(29 callsites).

The I-C1 invariant in PLAN.md §3 requires full coverage before M8 audit.

## M3 — Virtual-share fuzz tests

Plan exit criterion: "fuzz test: first-deposit sandwich attempt leaves
attacker with strictly less than they started. 1-wei donation attack does
not shift exchange rate beyond epsilon." Not built — no tests exist beyond
the placeholder. Ships with the M6 integration suite: parametric first-LP
sandwich + donation-attack scenarios exercised against
[state/market_two.rs](programs/clearstone_core/src/state/market_two.rs)'s
virtualized `add_liquidity`, `rm_liquidity`, and `trade_pt`.

## M3 — Virtualized rm_liquidity / lp_to_sy clamp

Because the curve math runs on `(reserves + virtual)` while the escrow only
holds `reserves`, the pure formula can return `pt_out > pt_balance` or
`sy_out > sy_balance` on nearly-drained pools. [state/market_two.rs rm_liquidity](programs/clearstone_core/src/state/market_two.rs)
clamps outputs to the real reserve floor. That clamp is a safety net, not a
first-class correctness property — if the LP supply and real reserves ever
desync enough to trigger it, the LP holder takes a slightly smaller
withdrawal than the pro-rata share. Worth checking during M6 fuzz + before
audit whether this shows up in practice at realistic liquidity sizes.

## M2 — Reentrancy test harness

Plan exit criterion: "Dedicated test for re-entrancy (mock SY program that
tries to call back in; must fail)." Not built yet — there are no tests
beyond the placeholder [clearstone-core.ts](tests/clearstone-core.ts). The
mock-SY harness lands with the M6 integration suite.

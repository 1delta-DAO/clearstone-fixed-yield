# Follow-ups

Tracked deviations from PLAN.md. Each entry: which milestone left it, why, and what it would take to close.

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

## M2 — Reentrancy test harness

Plan exit criterion: "Dedicated test for re-entrancy (mock SY program that
tries to call back in; must fail)." Not built yet — there are no tests
beyond the placeholder [clearstone-core.ts](tests/clearstone-core.ts). The
mock-SY harness lands with the M6 integration suite.

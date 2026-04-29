# YT Delivery via Fusion Intents — Design Plan

Scope: how a maker who holds SY (or YT) signs an order and gets YT (or SY)
delivered atomically by a solver, mirroring the PT path documented in
[FLOWS.md §3](FLOWS.md). Picks the on-chain shape that minimises new
core surface and reuses the existing flash machinery.

> **Status — UPDATED 2026-04-29.**
>
> **v2 buy-YT — SHIPPED.** Without any new core ix. Discovery during
> implementation: `core.buy_yt(sy_in=0, yt_out)` is already a
> capital-free internal flash — its cascade
> (`do_withdraw_sy → do_borrow_sy → do_cpi_strip → do_cpi_trade_pt →
>  do_repay_sy → do_deposit_sy`) balances to a net SY change of `-sy_in`
> for the trader. With `sy_in=0` the solver mints exactly `yt_out` YT
> in one ix with zero upfront SY, after which fusion.fill delivers it
> to the maker (and pulls maker's SY → solver as profit). The
> originally-scoped Steps 1–6 below are no longer needed for this
> direction. See `scripts/clearstone_pt_solver/src/{route,fill}.ts` —
> the `ytJustInTime` plan variant.
>
> **v2 sell-YT — IX LANDED, HAPPY-PATH TEST PARKED.** The
> [`flash_sell_yt`](programs/clearstone_core/src/instructions/market_two/flash_sell_yt.rs)
> entrypoint is implemented end-to-end: discriminator 23, mock callback
> variant `on_flash_sell_yt_received`, router/solver wiring stubs in
> [scripts/clearstone_pt_solver/](scripts/clearstone_pt_solver/) (TBD).
> Validate-path tests are green:
>   - ✔ callback under-delivery → `FlashYtCallbackUnderdelivered`
>   - ✔ size cap (yt_in > FLASH_MAX_PT_BPS) → `FlashSizeExceedsCap`
>
> The happy-path mock test is currently `it.skip` with a TODO marker.
> Symptom: "Cross-program invocation with unauthorized signer or
> writable account" on the syMint pubkey at the do_withdraw_sy step
> (step 3 of the handler). Anchor's IDL-driven coder emits mint_sy
> at outer-ix index [8] writable=true, and the ix's struct has
> `#[account(mut)] mint_sy`. The same do_withdraw_sy call works inside
> flash_swap_sy. Suspected root cause: a web3.js compile-message dedup
> interaction between the named mint_sy slot and duplicated syMint
> entries in `syCpiExtras` + `syCpiExtrasVault`, producing a compiled
> message where syMint lands in the readonly-non-signer partition.
>
> Next step: instrument with the COMPILED message's accountKeys (not
> just the IX's keys), confirm partition placement, and either dedup
> remaining_accounts before send or restructure the accounts struct
> so vault-side SY-CPI accounts come from a separate scope.

---

## Why YT is not symmetric to PT

The market's AMM curve trades **PT against SY only**. There is no PT/YT
or YT/SY pool — YT is "synthesised" by composing strip + trade_pt:

- `core.buy_yt(sy_in, yt_out)` — internally does
  `do_cpi_strip(sy_in)` → mints PT + YT to the trader, then
  `do_cpi_trade_pt(net_trader_pt = -pt_out, …)` → sells the PT half back
  to the AMM. Trader keeps YT, gets some SY change. See
  [buy_yt.rs:199](programs/clearstone_core/src/instructions/market_two/buy_yt.rs#L199).
- `core.sell_yt(yt_in, min_sy_out)` — buys PT off the AMM,
  `do_cpi_trade_pt(net_trader_pt = +pt_in, …)`, then `do_cpi_merge`
  burns the (PT, YT) pair back to SY. See
  [sell_yt.rs:214](programs/clearstone_core/src/instructions/market_two/sell_yt.rs#L214).

This means anything we do for YT either (a) holds YT inventory upfront,
(b) routes through `buy_yt` / `sell_yt` (no flash advantage — solver
still needs SY upfront), or (c) flash-borrows on the PT side and
composes strip / merge inside the callback.

---

## The four candidate shapes

### Shape A — Inventory-only solver

Solver holds YT (or SY) inventory ahead of time, fusion.fill delivers
straight from it. Identical to the existing `flash_swap_pt` happy path
except the `dst_mint` is `mint_yt` instead of `mint_pt`.

- **Code change.** None on-chain. The reference
  `clearstone_solver_callback.on_flash_pt_received` already handles
  arbitrary `dst_mint` — fusion.fill validates the order's
  `dst_mint` against `taker_dst_ata.mint`. Solver just routes
  `caller_pt_dst` → `caller_yt_dst` semantics in their own bookkeeping.
- **Capital model.** Solver bears all the inventory cost: needs YT
  before any maker order can be filled.
- **Sweet spot.** Specialist YT market-makers, or solvers running a
  rebalancer that mints YT on a schedule and sells the spread.

### Shape B — Multi-ix tx (strip + flash_swap_pt + fusion.fill)

Solver bundles the strip and the fusion call into one tx without a new
core ix:

```
[ Ed25519.verify,
  core.flash_swap_pt(pt_borrow, callback_data),     ← borrows PT
  core.strip(sy_amount),                             ← solver strips OWN SY
  fusion.fill(...)                                   ← delivers YT to maker
                                                       (NB: fusion is one ix,
                                                        not three — see below)
]
```

- **Doesn't actually work.** `fusion.fill` is a single ix that pulls
  src from maker AND delivers dst to taker_dst_ata atomically; you
  can't insert a `strip` between the two halves. The solver therefore
  needs YT in `taker_dst_ata` BEFORE fusion.fill runs. Reduces back
  to Shape A.
- **Salvage.** Could work if the strip ix runs *before*
  `flash_swap_pt`'s callback (so the solver pre-acquires the YT in
  the same tx, paid for from their own SY), then fusion.fill inside
  the callback delivers that YT. But now the solver needs SY upfront
  — capital model is same as Shape A but with extra steps.

### Shape C — Flash on PT, strip-in-callback

```
core.flash_swap_pt(pt_borrow, callback_data):
  1. snapshot rate, quote sy_in_required for pt_borrow PT
  2. transfer pt_borrow PT → solver
  3. callback runs:
       a. fusion.fill — pulls maker.SY → solver.SY,
                        delivers solver.YT → maker.YT      ← still need YT
       …
```

Same dead-end as Shape B: at step 3a the solver needs YT in their ATA.
Strip can't run *during* fusion.fill. Adding the strip post-callback
doesn't help — fusion.fill already needs the YT. This shape is
fundamentally not a fit for "give me YT" intents without inventory.

### Shape D — New core entrypoint `flash_swap_yt`

A new flash ix that, by analogy to `buy_yt`'s on-chain composition,
hands the solver some asset, lets them run a callback, and re-collects
the synthetic-YT counterpart at the end.

Two sub-shapes:

#### D1 — `flash_swap_yt` for "give me YT"

```
core.flash_swap_yt(yt_out, callback_data):
  1. snapshot SY rate
  2. quote sy_in_required for `yt_out` YT (= same math as buy_yt's
     internal `do_cpi_strip` + `do_cpi_trade_pt(-pt_amount)` legs).
  3. internally `do_cpi_strip(sy_required)` to mint pt_amount + yt_out
  4. internally `do_cpi_trade_pt(-pt_amount)` to sell the PT half back
  5. transfer `yt_out` YT to solver's YT ATA
  6. CPI callback (solver runs fusion.fill, pays maker the SY they
     pulled from solver, maker gets YT)
  7. verify market.escrow_sy grew by ≥ sy_in_required
  8. apply commit, clear flash_pt_debt
```

The strip + trade_pt run *before* the callback so the solver actually
holds YT when the callback (= fusion.fill) executes. The callback
provides the SY repayment.

#### D2 — `flash_swap_sy_for_yt` for "I have YT, want SY"

Mirror: solver flash-borrows SY, callback pulls maker's YT into solver
inventory + delivers SY to maker, then on-chain `do_cpi_merge` burns
the pair (need PT too — buys it from the AMM via `do_cpi_trade_pt(+pt)`)
and the resulting SY repays the flash.

Both D1 + D2 require new core ixs and new callback discriminators
(`on_flash_yt_received` etc.). Estimated diff: ~600 LOC across
`programs/clearstone_core/src/instructions/market_two/flash_swap_yt.rs`,
`flash_swap_sy_for_yt.rs`, and a new `solver_callback` discriminator
each. Plus regression tests.

---

## Recommendation (revised after JIT discovery)

**Buy-YT shipped — v2 reduced to ~80 LOC of bot wiring.** No new core ix.

For the sell-YT direction, **ship Shape A first; spec D2 as v2-sell**.

Reasoning:

1. **A unblocks live YT intents today** with zero on-chain change.
   Solvers building YT-routing bots can run on the existing fusion
   stack — `OrderConfig.dst_mint = mint_yt` works as-is.
2. **D is the right end state** for capital-efficient YT intents but
   costs ~600 LOC + audit on net-new core ixs. It also overlaps with
   the existing `buy_yt` / `sell_yt` math — there's an opportunity to
   refactor those to share the AMM-quote path with `flash_swap_yt`,
   cutting the diff by ~200 LOC.
3. **B and C are dead ends** and shouldn't be built. Documenting
   them here saves future contributors the same dead-end analysis.

### Concrete next steps (when v2 lands)

1. Factor `buy_yt`'s strip-then-trade composition into a pure quote
   helper (`MarketFinancials::quote_buy_yt(sy_in) → (yt_out, pt_consumed,
   fees)`). Mirror for sell.
2. Build `flash_swap_yt` modelled on `flash_swap_sy.rs` — same step
   sequence (rate snapshot, do_cpi_strip / do_cpi_merge, transfer,
   callback, verify, commit). Reuse `flash_pt_debt` as the I-F1 latch.
3. Add `FLASH_MAX_YT_BPS` cap analogous to I-F5 — synthetic YT mint
   should also be bounded to keep snapshot quotes inside their
   linear regime. Probably the same 25 % constant.
4. Extend `clearstone_solver_callback` with `on_flash_yt_received` /
   `on_flash_sy_for_yt_received`. Same fusion.fill plumbing as the
   PT/SY callbacks, just with the YT mint in the dst slot.
5. Mirror the four mock tests in `tests/clearstone-fusion-flash.ts`.

### Out of scope for this plan

- The economics of YT pricing during a flash (e.g. how to bound a
  solver's spread against an LP-side floor — likely needs a separate
  fee leg analogous to `treasury_fee_amount` for PT).
- Fusion-side resolver-policy enforcement when `dst_mint = mint_yt`
  in a KYC-gated market — relies on the existing
  `kamino_sy_adapter::GovernorWhitelist` plumbing, no new wiring.
- Maker UX for YT intents (e.g. "what does it mean to want YT?" is a
  question for the front-end, not the protocol).

---

## Related docs

- [FLOWS.md](FLOWS.md) §3 — PT-side intent flows (buy + sell).
- [INTENT_FLASH_PLAN.md](INTENT_FLASH_PLAN.md) — flash-swap primitive
  spec, invariants I-F1..I-F5.
- [buy_yt.rs](programs/clearstone_core/src/instructions/market_two/buy_yt.rs)
  / [sell_yt.rs](programs/clearstone_core/src/instructions/market_two/sell_yt.rs)
  — the on-chain math `flash_swap_yt` should mirror.

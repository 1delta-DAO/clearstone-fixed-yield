# Intent Flash Fills — Implementation Plan

> **Mission.** Expose a Pendle-style flash-swap primitive on clearstone_core so
> that clearstone-fusion resolvers can fill `src → PT` orders with **zero
> persistent inventory**. Sits on top of the existing infrastructure; no changes
> to the AMM math or the SY interface.
>
> Companion to [KYC_PASSTHROUGH_PLAN.md](KYC_PASSTHROUGH_PLAN.md). Does NOT
> modify the KYC stack — it composes above it.

---

## 1. Why

Today a clearstone-fusion solver needs either (a) pre-held PT inventory, or
(b) just-in-time src inventory, to fill a maker order whose `dst` is a
clearstone PT mint. Both paths work, but both tie up solver capital.

Pendle removed this constraint with a flash-swap callback on its AMM
(`swapExactPtForSy(receiver, exactPtIn, data)` with `data` triggering a
`swapCallback`). Their limit-order resolver uses this to mint PT on-demand
during order fill, deliver to the maker, then repay from the maker's pulled
src — zero inventory.

Clearstone_core already has the mechanics internally — `buy_yt.rs` /
`sell_yt.rs` do flash-borrow round trips against the PT escrow, with the
`MarketTwo.is_current_flash_swap` flag adjusting the fee math. The plumbing
is proven; what's missing is a user-callable entrypoint.

Shipping this unlocks three downstream behaviors:

- **Capital-light solvers.** Any permissionless wallet can resolve fusion
  orders without pre-funded PT.
- **Flash-atomic cross-market routing.** A router can flash PT from market A,
  deliver to a fusion maker, then use the pulled src to either buy PT back
  on market A (same-market arb) or on market B (cross-maturity routing).
- **Pendle-style limit orders.** A future `clearstone_limit_order` program
  (separate from fusion) could use the same primitive for native on-chain
  limit orders without bridging to the fusion protocol.

---

## 2. Scope

### In scope

- One new core instruction: `flash_swap_pt` on `MarketTwo`.
- Minimal state addition: `flash_pt_debt: u64` on `MarketTwo` for
  reentrancy tracking and invariant assertion.
- Callback interface definition: standard Anchor-style "CPI into a
  caller-supplied program with caller-supplied accounts".
- A reference `clearstone_solver_callback` periphery program that implements
  the callback for fusion fills.
- Solver TS switch to use the flash path in
  [scripts/clearstone_pt_solver/src/fill.ts](scripts/clearstone_pt_solver/src/fill.ts).
- Tests: Rust unit tests on the core ix + a TS integration test that fills a
  fusion order via flash with zero solver PT inventory.

### Out of scope

- **Flash-swap YT.** YT is never held by the market (synthetic); flash PT is
  sufficient for all intent-fill use cases identified so far.
- **Cross-market flash.** v1's `flash_swap_pt` is per-market. Cross-market
  routing is composable by chaining two invocations in separate tx slots.
- **Variable fee on flash repay.** Fee is computed at current AMM rate, same
  as `trade_pt`; no flash-specific fee schedule.
- **Flash-mint of SY.** The adapter's `mint_sy` already handles the
  on-demand SY path (see [§3.2 of KYC_PASSTHROUGH_PLAN.md](KYC_PASSTHROUGH_PLAN.md)).
  Flash-borrow of SY would require an adapter-level change; punt to v2.

---

## 3. Comparison to Pendle

| Concern | Pendle v2 | Clearstone (this plan) |
|---|---|---|
| Entrypoint | `MarketSwap.swapExactPtForSy(receiver, exactPtIn, data)` | `market_two.flash_swap_pt(pt_out, callback_data)` |
| Callback trigger | `if data.length > 0: IPendleSwapCallback(msg.sender).swapCallback(ptToAcc, syToAcc, data)` | CPI into caller-supplied `callback_program` with `callback_data` + remaining accounts |
| Repayment check | `require(balanceOf(PT) >= reserveBefore + exactPtIn)` | `require!(escrow_sy.amount ≥ quoted_sy_in, FlashRepayInsufficient)` |
| Fee | AMM fee rate applied to asset leg | Same `fee_treasury_sy_bps` as `trade_pt`; computed on `pt_out * sy_exchange_rate / exchange_rate` |
| Reentrancy | None (EVM single-threaded) | `reentrancy_guard` already engaged for SY CPIs; new `flash_pt_debt != 0` blocks nested flash entry |
| Oracle freshness | Price is pre-swap snapshot | Same — `sy_exchange_rate` locked at flash start, not re-read after callback |

The semantic shape is identical; the implementation differences are
Solana-idiomatic (Anchor accounts, explicit reentrancy guard, PDA signers).

---

## 4. State changes

### 4.1 `MarketTwo` additions

```rust
// programs/clearstone_core/src/state/market_two.rs

pub struct MarketTwo {
    // ... existing fields ...

    /// Pending PT owed back to this market by an in-flight flash_swap_pt.
    /// Zero at rest. Set to the expected repayment PT amount when a flash
    /// starts; cleared after the callback repays. Non-zero means:
    ///   * a flash callback is currently executing, AND
    ///   * no other flash_swap_pt may enter (prevents nested flash).
    pub flash_pt_debt: u64,
}
```

**Layout impact.** `flash_pt_debt: u64` appends 8 bytes. `reentrancy_guard`
is at compile-time-known byte offset 42 (see [reentrancy.rs](programs/clearstone_core/src/reentrancy.rs));
appending at the end preserves that offset. Existing markets need a realloc
via the existing `realloc_market` ix before they can accept flash calls.

### 4.2 No other state changes

Vault unchanged. SY adapter unchanged. CpiAccounts unchanged.

---

## 5. Instruction spec — `flash_swap_pt`

### 5.1 Accounts

```rust
#[event_cpi]
#[derive(Accounts)]
pub struct FlashSwapPt<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        has_one = address_lookup_table,
        has_one = sy_program,
        has_one = token_sy_escrow,
        has_one = token_pt_escrow,
        has_one = token_fee_treasury_sy,
        has_one = mint_sy,
    )]
    pub market: Account<'info, MarketTwo>,

    /// PT destination for the flash borrow. Must be caller-controlled.
    #[account(mut, token::authority = caller)]
    pub caller_pt_dst: InterfaceAccount<'info, TokenAccount>,

    /// SY account the callback must top up to close the flash.
    /// Same semantics as trade_pt: this is the market's own escrow.
    #[account(mut, token::mint = mint_sy)]
    pub token_sy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub token_pt_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint_sy)]
    pub token_fee_treasury_sy: InterfaceAccount<'info, TokenAccount>,

    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: CPI target for the flash callback. The program is trusted to
    /// the extent that the CALLER is trusted — it's their signer seat at
    /// stake. Core does not validate callback_program's code.
    pub callback_program: UncheckedAccount<'info>,

    /// CHECK: constrained by market.
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: constrained by market.
    pub sy_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}
```

### 5.2 Args

```rust
pub fn flash_swap_pt<'info>(
    ctx: Context<'_, '_, '_, 'info, FlashSwapPt<'info>>,
    pt_out: u64,
    callback_data: Vec<u8>,
) -> Result<FlashSwapPtEvent>;
```

### 5.3 Handler

```
1. Preconditions
   - require!(!market.reentrancy_guard, ReentrancyLocked)
   - require!(market.flash_pt_debt == 0, NestedFlashBlocked)
   - require!(market.check_status_flags(STATUS_CAN_BUY_PT | STATUS_CAN_SELL_PT))
   - require!(market.financials.pt_balance >= pt_out, InsufficientPtLiquidity)

2. Rate snapshot — read sy_exchange_rate ONCE via get_sy_state CPI; lock it
   for the entire flash window. Never re-read inside the callback.
   (Guard byte is set/cleared inside do_get_sy_state as usual.)

3. Quote the repayment
   Use the existing `financials.trade_pt` simulator (not the mutating
   version — a read-only quote helper to be factored out) to compute
   `sy_in_required` for `pt_out` at the snapshotted rate. Include the
   treasury fee.

4. Open the flash
   - Transfer token_pt_escrow → caller_pt_dst (pt_out), signed by market PDA.
   - market.flash_pt_debt = pt_out
   - Record escrow_sy balance snapshot: escrow_sy_before

5. Invoke callback
   - Serialize callback data.
   - CPI into callback_program via `solana_program::program::invoke_signed`
     (signer: none — caller keeps their own signer) with:
       accounts = [market, caller_pt_dst, token_sy_escrow, mint_sy, ...ctx.remaining_accounts]
       data = anchor discriminator + callback_data
   - Callback is expected to deposit SY into token_sy_escrow.
   - DO NOT clear guard byte here — it stays engaged from the get_sy_state
     step; this prevents the callback from re-invoking the SY program.

6. Verify repayment
   - token_sy_escrow.reload()
   - escrow_sy_delta = token_sy_escrow.amount - escrow_sy_before
   - require!(escrow_sy_delta >= sy_in_required, FlashRepayInsufficient)
   - Forward treasury fee from escrow_sy → token_fee_treasury_sy (same as trade_pt).

7. Commit to market state
   - market.financials.trade_pt(...) with net_trader_pt = -pt_out (caller = trader)
   - The AMM math updates pt_balance / sy_balance / last_ln_implied_rate
     exactly as a normal trade_pt would.

8. Close the flash
   - market.flash_pt_debt = 0
   - Emit FlashSwapPtEvent.
   - End ix.
```

### 5.4 Event

```rust
#[event]
pub struct FlashSwapPtEvent {
    pub caller: Pubkey,
    pub market: Pubkey,
    pub callback_program: Pubkey,
    pub pt_out: u64,
    pub sy_in: u64,
    pub sy_fee: u64,
    pub sy_exchange_rate: Number,
    pub timestamp: i64,
}
```

### 5.5 New error codes

```rust
pub enum ExponentCoreError {
    // ...existing...
    #[msg("A flash_swap_pt is already in progress on this market")]
    NestedFlashBlocked,
    #[msg("Flash callback did not deposit enough SY into escrow")]
    FlashRepayInsufficient,
    #[msg("Market lacks sufficient PT liquidity for the requested flash")]
    InsufficientPtLiquidity,
}
```

---

## 6. Callback interface

The callback receives a well-known Anchor-shaped ix:

```rust
// Any program implementing the callback defines:
#[program]
pub mod my_flash_callback {
    pub fn on_flash_pt_received(
        ctx: Context<OnFlashPtReceived>,
        pt_received: u64,
        sy_required: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        // 1. Do whatever with `pt_received` — e.g. transfer to a fusion maker.
        // 2. Put `sy_required` SY into `ctx.accounts.market_sy_escrow` before return.
        Ok(())
    }
}
```

Accounts struct on the callback side MUST start with:

```rust
#[derive(Accounts)]
pub struct OnFlashPtReceived<'info> {
    pub market: AccountInfo<'info>,
    pub caller_pt_src: InterfaceAccount<'info, TokenAccount>,   // the just-flashed PT
    pub market_sy_escrow: InterfaceAccount<'info, TokenAccount>, // where to repay
    pub mint_sy: InterfaceAccount<'info, Mint>,
    // ...anything else the callback needs, fed via remaining_accounts.
}
```

Core passes those four plus its entire `remaining_accounts` list
(callback-controlled).

**Discriminator convention.** Core CPIs via the standard Anchor discriminator
`sha256("global:on_flash_pt_received")[..8]`. Callback programs MUST expose
an ix named exactly `on_flash_pt_received` — a naming convention, not a
validated constraint. Callers who break the naming get a predictable
"invalid instruction" error from the callback's own ix router.

---

## 7. Reference callback program

### 7.1 `periphery/clearstone_solver_callback/`

A thin periphery program that implements `on_flash_pt_received` specifically
for the fusion-fill flow. Scope:

```
init_callback_config(admin, fusion_program)     // one-time, sets expected fusion
on_flash_pt_received(pt_received, sy_required, data)
    where data = borsh({
        fusion_order: OrderConfig,
        maker: Pubkey,
        order_hash: [u8; 32],
        fusion_fill_amount: u64,
    })
    steps:
      1. CPI fusion.fill — pulls maker.src → this-program-PDA.src_ata,
         delivers this-program-PDA.pt_ata → maker.dst_ata.
         (PT in this-program-PDA.pt_ata is what core just flashed here.)
      2. Convert pulled src to SY:
         - if src == SY directly: no-op
         - if src == underlying with KYC: wrap via governor + mint_sy via adapter
         - if src == some other token: swap via Jupiter (external) — v2.
      3. Transfer SY → market.token_sy_escrow (repays the flash).
```

Sized: ~250 LOC. Owns no state beyond its init config; all routing inputs
come in via `data`.

### 7.2 Why a separate program

Core must not know about fusion or delta-mint — **I-KYC2** says exactly this.
The callback program is the composition point; it's allowed to know about
both. If a different intent layer (e.g. a native clearstone limit-order
program) wants flash too, it ships its own callback — the core ix stays
generic.

---

## 8. Invariants

### New — added by this plan

- **I-F1 (Flash atomicity).** `market.flash_pt_debt != 0` only between the
  start and end of a single `flash_swap_pt` handler invocation. Asserted on
  every other `MarketTwo`-mutating entrypoint via
  `require!(market.flash_pt_debt == 0, NestedFlashBlocked)`.
- **I-F2 (Flash repayment).** At the end of `flash_swap_pt`, the delta in
  `token_sy_escrow.amount` is ≥ the quoted `sy_in_required` computed against
  the rate snapshotted at flash start. The escrow must not go below the
  pre-flash balance by more than the treasury-fee transfer leg.
- **I-F3 (Rate freshness).** `sy_exchange_rate` is read exactly once at step
  2 of the handler and not re-sampled after the callback returns. Callback
  that mutates the SY program's state can't influence the flash's fee math.
- **I-F4 (PT conservation during flash).** `market.financials.pt_balance` is
  decremented only at step 7 (the AMM commit); the flash window between step
  4 and step 6 temporarily has `escrow_pt.amount < pt_balance` — permitted
  iff `pt_balance - escrow_pt.amount == flash_pt_debt`.

### Preserved — existing invariants untouched

- **I-C1 (Reentrancy lock).** Same guard byte; the callback cannot CPI back
  into the SY program because the guard is still engaged from the step-2
  rate read.
- **I-M1 (Reserve accounting).** After step 7, `pt_balance` and `sy_balance`
  exactly match escrow balances, same as `trade_pt`.
- **I-M3 (Virtual shares floor).** Curve math uses `v_pt_balance()` /
  `v_sy_balance()` unchanged.
- **I-V\*** (vault invariants) — flash_swap_pt only touches `MarketTwo`, no
  vault state mutated.

---

## 9. Milestones

Execute in order. Each ends with a green test suite + merged branch.

### M-FLASH-1 — Core ix (DONE)

- `MarketFinancials::trade_pt` factored into `quote_trade_pt` + `apply_trade_pt`;
  old fused API preserved as a thin wrapper. Parity locked by unit test
  `quote_then_apply_matches_trade_pt`.
- `flash_pt_debt: u64` appended to `MarketTwo`. Realloc-safe (offset 42
  reentrancy_guard preserved).
- `NestedFlashBlocked` check added to `trade_pt`, `buy_yt`, `sell_yt`,
  `deposit_liquidity`, `withdraw_liquidity`.
- `flash_swap_pt` handler at
  [programs/clearstone_core/src/instructions/market_two/flash_swap_pt.rs](programs/clearstone_core/src/instructions/market_two/flash_swap_pt.rs)
  with the full 8-step algorithm, discriminator `[18]` in `lib.rs`.
- **Exit:** `cargo test -p clearstone_core --lib` 30/30 green.

### M-FLASH-2 — Reference callback program (DONE)

- [periphery/clearstone_solver_callback/](periphery/clearstone_solver_callback/)
  crate, program id `27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP`.
- `on_flash_pt_received` deserializes `CallbackPayload { fusion_order,
  fusion_fill_amount }`, CPIs `clearstone_fusion.fill`, then
  `transfer_checked` to close the flash.
- Scope-bound to `src_mint == market.mint_sy`; `underlying → SY` chain
  (governor.wrap + adapter.mint_sy) is a documented extension.
- **Exit:** `cargo check --workspace` clean.

### M-FLASH-3 — Solver TS switch (DONE)

- New `FillPlan` variant `"flashFusion"` in
  [scripts/clearstone_pt_solver/src/route.ts](scripts/clearstone_pt_solver/src/route.ts).
  Default when AMM has PT liquidity; `DISABLE_FLASH=1` fallback retained.
- `buildFlashFillIx` in
  [scripts/clearstone_pt_solver/src/fill.ts](scripts/clearstone_pt_solver/src/fill.ts)
  produces `[Ed25519, core.flash_swap_pt]` with callback_data encoded via
  the vendored fusion IDL's `orderConfig` type.
- Callback program id surfaced on `SolverClients` + env override.
- **Exit:** `tsc --noEmit` green, solver README updated.

### M-FLASH-4 — Integration test (DONE)

- [reference_adapters/mock_flash_callback/](reference_adapters/mock_flash_callback/)
  test-only callback with four configurable modes (NoOp / Ok / ShortRepay /
  TryNestedFlash). Lets the test exercise every invariant without needing
  fusion deployed.
- [tests/clearstone-fusion-flash.ts](tests/clearstone-fusion-flash.ts) —
  five scenarios:
  - Happy path: PT flows, escrow tops up, `flash_pt_debt` clears.
  - ShortRepay → `FlashRepayInsufficient`.
  - NoOp → `FlashRepayInsufficient`.
  - TryNestedFlash → `NestedFlashBlocked` (or reentrancy guard).
  - Over-borrow → `InsufficientPtLiquidity`.
- `it.skip` placeholder for the full e2e (real callback + fusion +
  maker-signed order) — same gate as the GovernorWhitelist e2e.
- **Exit:** test file TS-compiles; runtime verification awaits `anchor test`
  on a BPF-capable host.

### M-FLASH-5 — Docs & invariants (DONE)

- I-F1..I-F4 added to [INVARIANTS.md](INVARIANTS.md) with the same format
  as I-V/I-M/I-C/I-E/I-KYC. Audit checklist extended.
- [INTERFACE.md](INTERFACE.md): `flash_swap_pt` at discriminator `[18]`
  with full accounts / event / error listing + callback ABI spec.
- [ARCHITECTURE.md](ARCHITECTURE.md): new "Flash swap PT (zero-inventory
  fills)" subsection with ASCII diagram mirroring the strip / merge / trade
  flows.
- [AUDIT_SCOPE.md](AUDIT_SCOPE.md): `clearstone_solver_callback` added to
  in-scope; mock_flash_callback + external fusion flagged out-of-scope.
  Flash-specific security properties catalogued with auditor guidance.

**Total: 4.5 working days. Complete.**

---

## 10. Audit considerations

### Reentrancy triangulation

Three potential re-entry paths:

1. Callback → SY program → core. **Blocked** by existing `reentrancy_guard`
   (engaged during the get_sy_state call at step 2, stays engaged through
   the callback's lifetime).
2. Callback → core → `flash_swap_pt` (same market). **Blocked** by
   `flash_pt_debt != 0` check at step 1.
3. Callback → core → `flash_swap_pt` (different market). **Permitted**
   (cross-market flash is a legitimate routing pattern). The different
   market has its own `flash_pt_debt` field and its own guard byte.
4. Callback → core → other mutating ix (`strip`, `merge`, `trade_pt`, etc.)
   on a *different* market's vault. **Permitted** — same isolation
   guarantee as I-M4 provides today.

Point 4 is the weakest: could a malicious callback use the just-flashed PT
to trigger a cross-market strip that, via some chain, loops back to cause
the original market's state to be read inconsistently? The answer SHOULD
be no (every core ix reads its own state fresh, no shared caches), but this
is the top audit question.

### Pricing attack surface

The rate snapshot at step 2 is critical. If the callback can move the SY
program's reported exchange rate between step 2 and the commit at step 7,
the commit reads a stale rate and the AMM math can desync from economic
reality. Mitigation: **do not re-read `sy_exchange_rate` at step 7**. Use
the step-2 snapshot exclusively for the committing `trade_pt` call.

Pendle has a similar hazard and mitigates it the same way — `swapExactPtForSy`
reads the oracle once.

### Solver-bounty DoS

A mean solver could `flash_swap_pt(pt_out = pt_balance)` repeatedly to
starve the market. Already bounded by:

- `InsufficientPtLiquidity` rejects over-borrow.
- Per-tx, the flash is atomic — no starvation across tx boundaries.
- `LiquidityNetBalanceLimits` on the market caps net outflows per window,
  same as `trade_pt` today.

So no new DoS surface beyond what `trade_pt` already has.

### Callback-program trust model

The caller picks `callback_program`. Core does no validation. If the caller
passes an attacker's program, the attacker gets flashed PT and can refuse
to repay — tx reverts, attacker loses CUs, no state change. **Safe by
default.** But the caller must not be tricked into signing a tx that passes
a malicious `callback_program`; frontend-side concern, not protocol-side.

---

## 11. Open questions — decide before M-FLASH-1

1. **Factor `trade_pt` quote helper or compute inline?** Cleanest design
   factors the pure-math part of `MarketFinancials::trade_pt` into a
   `quote_trade_pt(...) -> TradeResult` helper and reuses it from
   `flash_swap_pt`. Touches core's hottest code path — audit carefully.
   Alternative: duplicate the quote math in the flash handler (no refactor,
   but two code paths to maintain). **Recommendation: factor.**

2. **Realloc requirement for existing markets?** `flash_pt_debt: u64` adds
   8 bytes. Existing markets need `realloc_market(8)` before they can
   accept flash calls. Alternative: embed the field behind a feature flag
   so old markets without realloc reject `flash_swap_pt` with
   `MarketNotFlashCapable`. **Recommendation: require realloc. Cleaner
   invariant story.**

3. **Should the flash path also emit a `TradePtEvent`?** Current proposal
   emits only `FlashSwapPtEvent`. Off-chain indexers watching `TradePtEvent`
   for volume/APY stats would miss flash activity. **Recommendation: emit
   both.** Volume through a flash is economically equivalent to a trade_pt.

4. **Permissioned flash callback list?** Add an on-chain allowlist of
   trusted `callback_program` pubkeys (per-market, curator-gated)? This
   would prevent curators' markets from being drained via malicious
   callbacks — though as §10 notes, that's impossible by design (no-repay →
   revert). **Recommendation: no allowlist.** Adds audit surface for
   negligible benefit.

5. **Compute budget.** Flash adds CPI depth (outer tx → flash_swap_pt →
   callback → fusion.fill → core.X). Expect 400–500k CU per fill. The
   existing `CU_LIMIT_IX` of 600k may need to bump to 1M for flash paths.
   Measure in M-FLASH-4 integration tests.

---

## 12. Attribution

Flash-swap semantics originate in Uniswap V2 / V3 flash swaps and were
adapted to PT/SY AMMs by Pendle Finance in
[Pendle v2](https://github.com/pendle-finance/pendle-core-v2). This plan
transplants that shape to Solana using Anchor + CPI callbacks, with
Solana-specific adjustments for account-model state and reentrancy.

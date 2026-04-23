# Clearstone Core — Invariant Specification

This document formalizes the safety properties of [clearstone_core](programs/clearstone_core/).
It is the entry point for auditors and the checklist for every PR.

For each invariant: **statement**, **why it matters**, **where enforced**,
**what tests prove it**, and **residual risk** (the gap between
enforcement and property).

## Invariant categories

- **I-V\*** — Vault invariants (SY escrow accounting).
- **I-M\*** — Market invariants (AMM reserves and LP supply).
- **I-C\*** — CPI / re-entrancy invariants.
- **I-E\*** — Economic invariants (fees, curation).
- **I-KYC\*** — KYC pass-through discipline (Token-2022 + optional
  governor composability).
- **I-F\*** — Flash-swap discipline (Pendle-style PT flash borrow with
  callback; see INTENT_FLASH_PLAN.md).
- **I-D\*** — Roll-delegation discipline (user-signed permissioning for
  permissionless auto-roll keepers; see
  [CURATOR_ROLL_DELEGATION.md](../clearstone-finance/CURATOR_ROLL_DELEGATION.md)).

---

## Vault invariants

### I-V1 — Backing

**Statement.** At all times,
`sy_for_pt ≤ min(pt_supply / last_seen_sy_exchange_rate, total_sy_in_escrow - treasury_sy - uncollected_sy)`.

**Why.** PT holders must be redeemable. If `sy_for_pt` exceeds either the
exchange-rate-implied or the actual-escrow bound, a PT holder's redeem
can't be paid.

**Where enforced.**
[vault.rs:sy_backing_for_pt](programs/clearstone_core/src/state/vault.rs)
computes the min. Called from `Vault::set_sy_for_pt`, invoked after every
state-mutating SY flow (strip, merge, collect_interest, stage_yield, add_emission).

**Tests.** Covered indirectly by invariants in
[market_two.rs virtualization_tests](programs/clearstone_core/src/state/market_two.rs).
Direct fuzz coverage is a M6 carve-out (see FOLLOWUPS.md).

**Residual risk.** `sy_for_pt` is recomputed per-op. If an op mutates
`total_sy_in_escrow` or `pt_supply` and then returns without calling
`set_sy_for_pt`, the field becomes stale — no test catches this today.
Audit: check every state-mutating handler ends with a `set_sy_for_pt`
call on code paths that touched these fields.

---

### I-V2 — Non-negative balances

**Statement.** `total_sy_in_escrow ≥ treasury_sy + uncollected_sy + sy_for_pt`.

**Why.** The vault must never "owe" more SY than it holds.

**Where enforced.** Implicit via the `sy_for_pt` minimum computation in
I-V1 and the `checked_add` / `checked_sub` mutators on `Vault`
(`inc_treasury_sy`, `dec_treasury_sy`, `inc_uncollected_sy`, etc. —
[vault.rs](programs/clearstone_core/src/state/vault.rs)). Each panics on
under/overflow, which aborts the instruction.

**Tests.** `Vault::sy_balance_invariant` is a `#[cfg(test)]`-only
assertion helper on the vault struct. No active test calls it yet.

**Residual risk.** Enforcement relies on every mutator being the
`inc_/dec_` helpers — a direct `vault.treasury_sy -= n` bypass would skip
the check. Audit: grep for direct writes to these fields.

---

### I-V3 — ATH monotonicity

**Statement.** `vault.all_time_high_sy_exchange_rate` never decreases.

**Why.** SY exchange rate drops trigger "emergency mode" (no new strips
allowed); the ATH is the high-water mark that defines the PT backing
ceiling.

**Where enforced.**
[vault.rs:update_from_sy_state](programs/clearstone_core/src/state/vault.rs) —
`self.all_time_high_sy_exchange_rate = cur_rate.max(self.all_time_high_sy_exchange_rate)`.
The `.max()` is the only write site.

**Tests.** Not directly covered.

**Residual risk.** If a path mutates `all_time_high_sy_exchange_rate`
directly (bypassing `update_from_sy_state`), the invariant breaks.
Also depends on the SY program's return being monotone — if the SY lies,
ATH is still pinned at the previous local max but subsequent
`exchange_rate` values could be lower (triggering emergency mode), which
is the intended defensive behavior.

---

### I-V4 — Maturity freeze

**Statement.** After `start_ts + duration`, `final_sy_exchange_rate` is
frozen.

**Why.** Matured PT settles at `final_sy_exchange_rate`. If it kept
moving post-maturity, PT holders who haven't redeemed yet get reopened
exposure to SY drift.

**Where enforced.**
[vault.rs:update_from_sy_state](programs/clearstone_core/src/state/vault.rs) —
the `if self.is_active(now)` gate around `self.final_sy_exchange_rate = cur_rate`.

**Tests.** Not directly covered.

**Residual risk.** Same write-site gating as I-V3. Grep for direct
writes to `final_sy_exchange_rate`.

---

### I-V5 — No Creator Lambo

**Statement.** The creator has no path to drain SY belonging to PT/YT
holders. Only `treasury_sy` flows are creator-accessible.

**Why.** The permissionless-creation model depends on creator power
being strictly bounded.

**Where enforced.**
[vault/admin/treasury/collect_treasury_interest.rs](programs/clearstone_core/src/instructions/vault/admin/treasury/collect_treasury_interest.rs) —
the only vault-draining handler a curator can call. The
`CollectTreasuryInterestKind::TreasuryInterest` path reads `vault.treasury_sy`
as the ceiling via `amount.to_u64(vault.treasury_sy)`.

**Tests.** Not directly covered at integration level. Curator-auth tests
for `modify_vault_setting` are in the M6 skip-list.

**Residual risk.** The curator can pass `CollectTreasuryInterestKind::YieldPosition`
too, but that only drains the robot's yield position, not PT holders'
backing. The robot's position is itself bounded by the vault's own
accrual rules. Still worth an auditor's eye: verify the two `Kind`
paths together can't exceed `treasury_sy + uncollected_robot_sy`.

---

## Market invariants

### I-M1 — Reserve accounting

**Statement.** `MarketFinancials.pt_balance` and `sy_balance` exactly
match the underlying token-account balances after every instruction.

**Why.** The AMM math reads these tracked values. If they drift from
the real escrow, swap math prices trades against a phantom reserve.

**Where enforced.**
[market_two.rs](programs/clearstone_core/src/state/market_two.rs) —
all reserve mutations go through `inc_pt_balance`/`dec_pt_balance`/
`inc_sy_balance`/`dec_sy_balance`, each tied 1:1 to the matching SPL
transfer in the calling instruction.

**Tests.** Partial — `add_liquidity_handles_empty_real_reserves` and
`add_liquidity_proportional_at_scale` in
[virtualization_tests](programs/clearstone_core/src/state/market_two.rs#virtualization_tests).

**Residual risk.** Direct transfers *to* the market's escrow accounts
(donations) inflate the real balance but not the tracked value. This is
intentional — the tracked value is the AMM's source of truth, and
virtual-share math (I-M3) makes donations ineffective.

---

### I-M2 — LP supply ↔ reserves

**Statement.** LP mint supply is a monotonic function of reserve
additions; no free-mint path exists.

**Why.** If LP could be minted without adding reserves, the pool could
be drained by an outsized withdraw.

**Where enforced.**
- Init mint: [market_two_init.rs:calc_lp_tokens_out](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)
  — `sqrt((pt+VP)(sy+VS)) - VIRTUAL_LP_FLOOR`, burned slice is permanent.
- Subsequent mints: [market_two.rs:add_liquidity](programs/clearstone_core/src/state/market_two.rs)
  — exponent_time_curve's `min(intent_pt/reserves_pt, intent_sy/reserves_sy) * total_lp`.
- Withdraw: [market_two.rs:rm_liquidity](programs/clearstone_core/src/state/market_two.rs)
  — proportional output.

**Tests.**
- [first_lp_sandwich_attempt_is_negligible](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)
- [add_liquidity_matches_classic_for_large_pools](programs/clearstone_core/src/state/market_two.rs)
- [add_liquidity_proportional_at_scale](programs/clearstone_core/src/state/market_two.rs)

**Residual risk.** `rm_liquidity` clamps outputs to real reserves (see
M3 carve-out in FOLLOWUPS.md). On near-empty pools this can produce a
tiny supply/reserve asymmetry. Audit: fuzz near-empty-pool withdrawals.

---

### I-M3 — Virtual shares floor

**Statement.** First LP cannot capture an outsized share of a later
dust deposit. A dust donation to the escrow does not meaningfully shift
the AMM exchange rate.

**Why.** Blocks the Uniswap-v2-first-depositor sandwich class of attacks.

**Where enforced.**
[market_two.rs v_pt_balance / v_sy_balance](programs/clearstone_core/src/state/market_two.rs)
virtualize every curve read. [constants.rs](programs/clearstone_core/src/constants.rs)
defines `VIRTUAL_PT = VIRTUAL_SY = VIRTUAL_LP_FLOOR = 1_000_000`.

**Tests.**
- [donation_attack_barely_shifts_virtual_view](programs/clearstone_core/src/state/market_two.rs)
- [large_donation_bounded_shift](programs/clearstone_core/src/state/market_two.rs)
- [first_lp_sandwich_attempt_is_negligible](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)

**Residual risk.** The virtual constants are the same across all
markets. A market with base-mint decimals vastly smaller than 6 could
see the virtual floor dominate real liquidity for longer than expected.
Audit: verify the chosen constants work for the smallest-decimal mint
ever expected on mainnet.

---

### I-M4 — No cross-market leakage

**Statement.** No instruction takes two different `Vault` or two
different `MarketTwo` accounts simultaneously.

**Why.** Prevents a curator or attacker from routing state between
isolated markets (which would break the per-market trust boundary).

**Where enforced.** By Anchor's `#[derive(Accounts)]` structure: every
mutating instruction has exactly one `Vault` (or one `MarketTwo`) field.
Grep-based audit over
[src/instructions/](programs/clearstone_core/src/instructions/).

**Tests.** Not directly covered; this is a static property of the account
structs.

**Residual risk.** `remaining_accounts` slots are untyped and could
smuggle a second vault. Audit: every use of `ctx.remaining_accounts`
should be documented with what it's expected to contain.

---

### I-M5 — Curve monotonicity

**Statement.** Implied rate updates produce a PT price inside [0, 1] in
base-asset terms.

**Why.** A PT priced above 1 base unit would imply negative yield —
impossible for a principal token.

**Where enforced.** The `exponent_time_curve` math library's
`trade` and `ln_implied_rate` functions. Not re-verified in core.

**Tests.** None in clearstone_core. This is trusted-library behavior.

**Residual risk.** Depends on upstream `exponent_time_curve` correctness.
Treat that library as auditor-in-scope.

---

## CPI / re-entrancy invariants

### I-C1 — Reentrancy lock

**Statement.** A `reentrancy_guard: bool` on Vault/MarketTwo is set to
`true` before any CPI into the SY program and cleared after. Any
reentrant call that itself attempts a second CPI sees the set byte
and fails with `ReentrancyLocked`.

**Why.** A malicious SY program can re-enter during its own CPI. The
guard blocks that.

**Where enforced.**
[reentrancy.rs](programs/clearstone_core/src/reentrancy.rs) — `latch` /
`unlatch` raw-byte helpers at compile-time-known offset
`GUARD_BYTE_OFFSET = 42` (the layout position of `reentrancy_guard` in
both Vault and MarketTwo). Called from inside every SY CPI wrapper in
[utils/sy_cpi.rs](programs/clearstone_core/src/utils/sy_cpi.rs) —
`cpi_deposit_sy`, `cpi_withdraw_sy`, `cpi_get_sy_state`,
`cpi_claim_emission`, `cpi_get_position`. Every call site in core
passes `&ctx.accounts.vault.to_account_info()` (or `.market.`) as the
guard; there are no unguarded SY CPIs in-tree.

**Tests.**
[reentrancy::tests](programs/clearstone_core/src/reentrancy.rs) — unit
tests on the `Reentrant` trait, `latch/unlatch` through the dummy
struct, and `guard_offset_matches_layout` catches any prefix-field
change that would silently move the guard byte. Runtime test via a
malicious SY mock is the M6 carve-out.

**Residual risk.** Guard offset depends on the Vault/MarketTwo layout.
The test above pins it; any prefix-field addition has to update both
`GUARD_BYTE_OFFSET` and the test.

---

### I-C2 — State settled before CPI

**Statement.** All mutable account state relevant to user balances is
written to disk before an untrusted SY CPI.

**Why.** If state is mutated in-memory but not persisted before the CPI,
a reentrant call reads stale on-chain state and can corrupt accounting.

**Where enforced.** Two layers:
- The guard byte itself is flushed by `latch()` inside each CPI helper
  (it writes the byte via `try_borrow_mut_data`, so it hits disk
  immediately).
- For other mutated fields, the relevant handlers do an explicit borsh
  serialize before the CPI — see
  [merge.rs](programs/clearstone_core/src/instructions/vault/merge.rs),
  [collect_interest.rs](programs/clearstone_core/src/instructions/vault/collect_interest.rs),
  [trade_pt.rs](programs/clearstone_core/src/instructions/market_two/trade_pt.rs),
  [deposit_liquidity.rs](programs/clearstone_core/src/instructions/market_two/deposit_liquidity.rs),
  [withdraw_liquidity.rs](programs/clearstone_core/src/instructions/market_two/withdraw_liquidity.rs),
  [market_two_init.rs](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs).

**Tests.** None directly (harder to prove without a runtime harness).

**Residual risk.** Borsh serialization rewrites the whole account — if
the struct gains a derived-only field that doesn't round-trip through
borsh, it'd be lost. Audit: every `Vault` / `MarketTwo` field is
`AnchorSerialize`.

---

### I-C3 — Return-data discipline

**Statement.** `SyState` return values are validated before use.

**Why.** The SY program is untrusted; a malformed or malicious return
value should fail closed.

**Where enforced.**
[utils/sy_cpi.rs validate_sy_state](programs/clearstone_core/src/utils/sy_cpi.rs)
— checks `exchange_rate > 0` and `emission_indexes.len() == expected`.
Called from strip, merge, collect_interest, collect_emission. `trade_pt`
only checks `exchange_rate > 0` (markets don't track emissions post-M4).

**Tests.**
[validation_tests](programs/clearstone_core/src/utils/sy_cpi.rs) —
4 tests on validator edge cases.

**Residual risk.** `cpi_mint_sy` and `cpi_redeem_sy` (wrapper-only,
currently unused by core) don't validate the `MintSyReturnData` /
`RedeemSyReturnData` before use. When the router lands (M4 followup),
wire validation there too.

---

## Economic invariants

### I-E1 — Protocol fee bounded

**Statement.** `PROTOCOL_FEE_MAX_BPS` is a compile-time constant (2500
= 25%). Runtime fee is `min(creator_fee_bps, PROTOCOL_FEE_MAX_BPS)`.

**Why.** Permanent ceiling on creator extraction.

**Where enforced.**
[constants.rs](programs/clearstone_core/src/constants.rs) defines
`PROTOCOL_FEE_MAX_BPS = 2500`. Init handlers for both vault and market
require `creator_fee_bps <= PROTOCOL_FEE_MAX_BPS`
([initialize_vault.rs](programs/clearstone_core/src/instructions/vault/admin/initialize_vault.rs),
[market_two_init.rs](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)).

**Tests.** Not directly covered — integration-test-shaped.

**Residual risk.** The constant is shared by vault and market. If a
future change needs different ceilings, this aggregates them.

---

### I-E2 — Creator fee immutable post-init

**Statement.** `creator_fee_bps` cannot be raised once the vault/market
is live. It can be lowered (one-way ratchet).

**Why.** Users onboarding relied on the creator-declared ceiling when
they decided to deposit.

**Where enforced.** `modify_vault_setting` / `modify_market_setting`
only contain `LowerInterestBpsFee` / `LowerTreasuryTradeSyBpsFee` /
`LowerEmissionBpsFee` variants — no "set" or "raise" variant exists.
Enforced via `require!(new <= current, FeeNotRatchetDown)`.
See [modify_vault_setting.rs](programs/clearstone_core/src/instructions/vault/admin/modify_vault_setting.rs)
and [modify_market_setting.rs](programs/clearstone_core/src/instructions/market_two/admin/modify_market_setting.rs).

Also: `ChangeMaxPySupply`, `SetMaxLpSupply`, `ChangeLnFeeRateRoot`,
`ChangeRateScalarRoot` were removed from the modify enums in M2 — those
parameters are set at init and frozen.

**Tests.** Not directly covered — integration-test-shaped.

**Residual risk.** `creator_fee_bps` itself is also not modifiable
post-init (it's the cap, not the active fee). Stored but never written
after `init`. Audit: grep for writes to `creator_fee_bps` after init
handler.

---

## KYC pass-through invariants

### I-KYC1 — All SY movements use `transfer_checked`

**Statement.** Every SPL transfer of the SY token inside clearstone_core
uses `anchor_spl::token_interface::transfer_checked` (the mint +
decimals-checked form), never plain `token_2022::transfer`.

**Why.** When the SY mint carries Token-2022 extensions (ConfidentialTransfer
from delta-mint, or TransferHook from a future stricter backend), the
plain `transfer` is deprecated and skips some extension-specific checks.
`transfer_checked` is the supported path for any T2022 mint and is a
no-op cost for plain SPL mints.

**Where enforced.**
[instructions/util.rs:sy_transfer_checked](programs/clearstone_core/src/instructions/util.rs) —
the single helper that wraps `token_interface::transfer_checked`. Every
SY-moving handler uses this exclusively (see I-KYC1 audit below). The
plain `util::token_transfer` helper still exists for PT/YT/emission
flows where mint extensions don't apply.

Call sites — all use `sy_transfer_checked`:
- [vault/strip.rs](programs/clearstone_core/src/instructions/vault/strip.rs)
- [vault/merge.rs](programs/clearstone_core/src/instructions/vault/merge.rs)
- [vault/collect_interest.rs](programs/clearstone_core/src/instructions/vault/collect_interest.rs)
- [vault/admin/treasury/collect_treasury_interest.rs](programs/clearstone_core/src/instructions/vault/admin/treasury/collect_treasury_interest.rs)
- [market_two/trade_pt.rs](programs/clearstone_core/src/instructions/market_two/trade_pt.rs)
- [market_two/buy_yt.rs](programs/clearstone_core/src/instructions/market_two/buy_yt.rs)
- [market_two/deposit_liquidity.rs](programs/clearstone_core/src/instructions/market_two/deposit_liquidity.rs)
- [market_two/withdraw_liquidity.rs](programs/clearstone_core/src/instructions/market_two/withdraw_liquidity.rs)
- [market_two/admin/market_two_init.rs](programs/clearstone_core/src/instructions/market_two/admin/market_two_init.rs)

The `sell_yt` handler does NOT transfer SY directly — it flash-borrows PT
and CPIs into `merge` for the SY output, inheriting I-KYC1 from there.

**Tests.** Rust unit tests + `tests/clearstone-core.ts` SPL regression
suite exercise every path; `tests/clearstone-kyc-pass-through.ts` verifies
the Token-2022 path end-to-end against `mock_klend`.

**Residual risk.** A future PR adding a new SY-moving instruction could
reach for `token_2022::transfer` directly. Audit: grep
`programs/clearstone_core/src/` for `token_2022::transfer` and `token_transfer(`.
Permitted hits are PT, YT, and emission-reward movements only:

- PT: `trade_pt.rs`, `sell_yt.rs`, `market_two_init.rs`.
- YT: `deposit_yt.rs`, `withdraw_yt.rs`.
- Emission rewards: `collect_emission.rs`, `collect_treasury_emission.rs`.

Any SY movement *must* go through `sy_transfer_checked`.

---

### I-KYC2 — Core is governor-agnostic

**Statement.** clearstone_core contains no CPI, import, or compile-time
dependency on the external `clearstone-finance` governor or delta-mint
programs.

**Why.** The trust boundary for the core is "trusted, permissionless". Any
governor dependency would pull external code into the audit scope and
couple core's lifecycle to an external upgrade schedule. KYC composability
is a curator-chosen adapter property, not a core property.

**Where enforced.** By construction. `programs/clearstone_core/Cargo.toml`
lists no `governor` / `delta_mint` / `clearstone-finance` dependency.
All whitelist-creating CPIs live in
[reference_adapters/kamino_sy_adapter/src/lib.rs](reference_adapters/kamino_sy_adapter/src/lib.rs),
gated behind `KycMode::GovernorWhitelist` at init.

**Tests.** Static — a compile check after this invariant is in place
suffices.

**Residual risk.** A future periphery program (curator, router) adding a
governor CPI does NOT violate I-KYC2 — only core must stay
governor-agnostic. Audit: grep
`programs/clearstone_core/` (recursive) for `governor` / `delta_mint` /
`Whitelist`. Zero hits expected.

---

### I-KYC3 — Core makes no SY-mint-owner assumption

**Statement.** clearstone_core does not assume the SY mint's owner program
is SPL Token or Token-2022 specifically. Every SY-touching ix accepts the
mint via `InterfaceAccount<Mint>` and routes transfers through the
Anchor `token_interface` indirection.

**Why.** Lets the same core handle SPL, T2022+ConfidentialTransfer (current
delta-mint d-tokens), and T2022+TransferHook (hypothetical stricter
backend, flagged as a future upgrade path in KYC_PASSTHROUGH_PLAN §4.6)
without code changes.

**Where enforced.** Every `Accounts` struct that carries `mint_sy` types
it as `InterfaceAccount<'info, anchor_spl::token_interface::Mint>` (not
`Account<Mint>`). Every SY transfer uses
`anchor_spl::token_interface::transfer_checked` (I-KYC1), which
dispatches via the token-interface trait.

**Tests.** Regression suite in `tests/clearstone-core.ts` runs against
the SPL-mint `generic_exchange_rate_sy`; `tests/clearstone-kyc-pass-through.ts`
runs against a T2022 SY mint from `kamino_sy_adapter`. Both pass under
the same core binary.

**Residual risk.** The TransferHook extension path is currently
theoretical — adding it would require `sy_transfer_checked` callers to
append extra-account-metas via
`spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi`
before the CPI. That's a migration, not a runtime invariant failure. See
[KYC_PASSTHROUGH_PLAN.md §4.6](KYC_PASSTHROUGH_PLAN.md) for the upgrade
sketch.

---

## Flash-swap invariants

### I-F1 — Flash atomicity

**Statement.** `market.flash_pt_debt != 0` only between the start and end of
a single `flash_swap_pt` handler invocation. All other market-mutating
entrypoints reject any call where `flash_pt_debt != 0`.

**Why.** A flash window is a deliberate temporary violation of I-M1 (reserve
accounting): PT is out in the wild but `pt_balance` hasn't been decremented
yet. Letting any other handler run during that window would either read a
stale state or compound the violation.

**Where enforced.**
[flash_swap_pt.rs](programs/clearstone_core/src/instructions/market_two/flash_swap_pt.rs)
sets `market.flash_pt_debt = pt_out` at step 4 and clears it at step 8.
Every market-mutating handler's `validate` asserts `flash_pt_debt == 0`:

- [trade_pt.rs](programs/clearstone_core/src/instructions/market_two/trade_pt.rs)
- [buy_yt.rs](programs/clearstone_core/src/instructions/market_two/buy_yt.rs)
- [sell_yt.rs](programs/clearstone_core/src/instructions/market_two/sell_yt.rs)
- [deposit_liquidity.rs](programs/clearstone_core/src/instructions/market_two/deposit_liquidity.rs)
- [withdraw_liquidity.rs](programs/clearstone_core/src/instructions/market_two/withdraw_liquidity.rs)
- [flash_swap_pt.rs](programs/clearstone_core/src/instructions/market_two/flash_swap_pt.rs) itself (blocks self-nesting)

**Tests.**
[tests/clearstone-fusion-flash.ts](tests/clearstone-fusion-flash.ts) —
"nested flash (mode=TryNestedFlash) reverts" test: a callback that CPIs
back into `flash_swap_pt` on the same market must revert.

**Residual risk.** A failed (reverting) flash tx reverts all account mutations,
so `flash_pt_debt` can't leak a non-zero value across tx boundaries. The
only way to corrupt the field is through a direct write outside the two
approved sites — audit checklist item below.

---

### I-F2 — Flash repayment

**Statement.** At the end of a `flash_swap_pt` handler, the delta in
`token_sy_escrow.amount` from the start of the handler is ≥ the
`sy_required` quote computed at handler start. If the delta is short, the
tx reverts with `FlashRepayInsufficient`.

**Why.** The whole point of the flash: PT sent out must be paid for in SY
before the ix closes, at the market-quoted rate. Short-repay means free
liquidity out of the pool.

**Where enforced.**
[flash_swap_pt.rs](programs/clearstone_core/src/instructions/market_two/flash_swap_pt.rs)
step 6 — `token_sy_escrow.reload()` after the callback, compute delta, assert.

**Tests.**
[tests/clearstone-fusion-flash.ts](tests/clearstone-fusion-flash.ts) —
"short-repay" and "no-op callback" tests. Both trip `FlashRepayInsufficient`.

**Residual risk.** The escrow delta measurement is a direct token-account
read, not a tracked-balance check. A callback that can mint the exact SY
amount from elsewhere passes the gate — which is intended (that's how
fusion.fill pulls from the maker). Only "free" PT is blocked.

---

### I-F3 — Rate freshness

**Statement.** `sy_exchange_rate` is read exactly once per flash (at step 2
of the handler) and used for BOTH the repayment quote (step 3) and the
final commit via `MarketFinancials::apply_trade_pt` (step 7). It is not
re-sampled from the SY program after the callback returns.

**Why.** The callback runs untrusted code. If it can move the SY program's
reported rate between the quote and the commit, the commit reads a stale
rate and the AMM math can desync from economic reality.

**Where enforced.**
[flash_swap_pt.rs](programs/clearstone_core/src/instructions/market_two/flash_swap_pt.rs) —
the local `sy_exchange_rate` binding is the only rate value used from step 2
onward. No `do_get_sy_state` call after the callback.
[MarketFinancials::apply_trade_pt](programs/clearstone_core/src/state/market_two.rs)
was extracted specifically so the commit can run against a caller-supplied
rate snapshot rather than re-reading.

**Tests.**
`quote_then_apply_matches_trade_pt` in
[state/market_two.rs virtualization_tests](programs/clearstone_core/src/state/market_two.rs)
— proves quote+apply produces the same state as the fused `trade_pt` would.
Locks the refactor against drift.

**Residual risk.** If a future change adds a second `do_get_sy_state` call
inside `flash_swap_pt` the invariant breaks silently (the AMM math would
still work, just against a moved-under rate). Audit: there must be exactly
one SY CPI in the flash handler, at step 2.

---

### I-F4 — PT conservation during flash

**Statement.** `market.financials.pt_balance` is decremented only at step 7
(the AMM commit via `apply_trade_pt`). Between step 4 (flash transfer) and
step 6 (repayment verify), the actual token escrow balance is temporarily
*less* than `pt_balance` by exactly `flash_pt_debt`. At ix end, the
invariant `pt_balance == escrow_pt.amount` is restored.

**Why.** This is the one acknowledged hole in I-M1 (reserve accounting ==
escrow). The flash window is a documented, guarded violation; the
reconciliation at step 7 returns everything to normal.

**Where enforced.** By construction of the handler algorithm — step 7
always runs if the callback returns `Ok`, and if the callback returns
`Err` the entire tx reverts (including the step-4 PT transfer). The
`flash_pt_debt` field is the guard that documents and gates the window.

**Tests.**
[tests/clearstone-fusion-flash.ts](tests/clearstone-fusion-flash.ts) —
"happy path" test asserts:
- `pt_balance` decreased by exactly `pt_out`
- `escrow_pt.amount` decreased by exactly `pt_out`
- `flash_pt_debt == 0` at tx end

**Residual risk.** A callback that partially-writes the escrow could leave
the escrow in a state where a reload would see a mid-CPI balance. But
`token_sy_escrow.reload()` in step 6 and `escrow_pt.amount` comparison at
tx end both fetch the committed post-CPI state from the account data —
no intermediate state is visible.

---

## Roll-delegation invariants

Scope: [periphery/clearstone_curator/src/roll_delegation.rs](periphery/clearstone_curator/src/roll_delegation.rs)
and `crank_roll_delegated` in [periphery/clearstone_curator/src/lib.rs](periphery/clearstone_curator/src/lib.rs).
Full rationale in [CURATOR_ROLL_DELEGATION.md](../clearstone-finance/CURATOR_ROLL_DELEGATION.md) §4.

### I-D1 — Only user creates or closes their delegation

**Enforced.** `CreateDelegation` and `CloseDelegation` require `user:
Signer`; `CloseDelegation` additionally carries `has_one = user` on the
delegation account. PDA seeds `[b"roll_deleg", vault, user]` guarantee
one delegation per (vault, user).

### I-D2 — `max_slippage_bps ≤ 1000`

**Enforced.** Handler-entry `require!` check against
`MAX_DELEGATION_SLIPPAGE_BPS = 1_000`. Covered by
`roll_delegation::tests::slippage_floor_at_max_1000bps`.

### I-D3 — TTL in [~1 day, ~100 days]

**Enforced.** Handler-entry `require!` checks against
`MIN_DELEGATION_TTL_SLOTS = 216_000` and
`MAX_DELEGATION_TTL_SLOTS = 21_600_000`. Covered by
`ttl_bounds_cover_reasonable_range`.

### I-D4 — Allocation drift invalidates delegation

**Enforced.** `validate_delegation` computes
`hash_allocations(current)` and requires equality with the stored
`allocations_hash`. The hash commits to `(market, weight_bps,
cap_base)` for each allocation; `deployed_base` is deliberately
excluded so normal rolls don't invalidate the delegation. Covered by
`hash_is_deterministic_across_identical_inputs`,
`hash_changes_when_{market,weight,cap}_changes`, and
`hash_ignores_deployed_base`.

### I-D5 — `from_market` past its expiration

**Enforced.** `crank_roll_delegated` checks
`Clock::unix_timestamp >= from_market.financials.expiration_ts`
before any CPI fires. Keepers cannot pre-empt yield by rolling early.

### I-D6 — Keeper's `min_base_out` ≥ delegation floor, AND actual ≥ min

**Enforced twice.** Pre-CPI: `require!(min_base_out >=
slippage_floor(deployed, max_slippage_bps))`. Post-CPI: after the
from-leg, `require!(base_escrow.amount - before >= min_base_out)`.
User bounds the acceptable slippage, keeper proposes the floor,
on-chain math confirms. Covered by slippage-floor arithmetic tests;
integration-test coverage lives in Pass E.

### I-D7 — Atomicity

**Enforced by construction.** `crank_roll_delegated` executes six CPIs
(withdraw_liquidity → trade_pt sell → redeem_sy → mint_sy →
deposit_liquidity, with reloads between them) in a single instruction.
Any failure in any leg reverts the transaction — no half-rolled state
persists. `NothingToRoll` (zero deployed) and `DeployedBaseDrift`
(vault LP ATA < claimed) fail fast before any state mutation.

## Invariant-coverage audit checklist

Run before every PR that touches state or CPI:

- [ ] No CPI into an untrusted program without prior state serialization.
- [ ] No state mutation after an untrusted CPI without a `reload()`.
- [ ] Every entrypoint starts with `reentrancy::enter(...)` if it touches
      a Vault/MarketTwo that does SY CPIs (see I-C1 carve-out).
- [ ] Every exit path clears the guard (including error paths — current
      impl relies on tx revert; document if we add partial-success paths).
- [ ] No `ctx.remaining_accounts` use that could swap in alternate
      vault/market accounts.
- [ ] All `has_one` / seed constraints are strict.
- [ ] No arithmetic without `checked_*` / `saturating_*` / wrapping semantics.
- [ ] No `unwrap()` on user-supplied inputs.
- [ ] `Number` / `DNum` ops handle zero / infinity cases.
- [ ] SY state returns are validated before use (I-C3).
- [ ] Creator-gated modify actions cannot violate I-E1 / I-E2.
- [ ] No instruction takes two `Vault` or two `MarketTwo` accounts.
- [ ] All `close` / realloc paths re-check curator signer.
- [ ] Every SY transfer in `programs/clearstone_core/` goes through
      `sy_transfer_checked` (I-KYC1). Grep for `token_2022::transfer`
      and `token_transfer(` — only PT / YT / emission-reward sites are
      permitted; any SY hit is a bug.
- [ ] `programs/clearstone_core/Cargo.toml` has no `governor` /
      `delta_mint` / `clearstone-finance` dependency (I-KYC2).
- [ ] Every `Accounts` struct carrying `mint_sy` types it as
      `InterfaceAccount<Mint>` (I-KYC3).
- [ ] `market.flash_pt_debt` is written only by `flash_swap_pt` (step 4
      and step 8). Grep for `flash_pt_debt` in core — any other write
      site is a bug (I-F1).
- [ ] `flash_swap_pt` contains exactly one `do_get_sy_state` / other SY
      CPI, at step 2. No second rate read after the callback (I-F3).
- [ ] Every market-mutating handler's `validate` gates on
      `market.flash_pt_debt == 0`; new handlers added to MarketTwo must
      add the same gate (I-F1).
- [ ] `crank_roll_delegated` calls `validate_delegation` before any
      state mutation or CPI (I-D4, I-D5).
- [ ] `crank_roll_delegated` captures `base_escrow.amount` before the
      from-leg and re-checks the delta against `min_base_out` after
      (I-D6 post-check).
- [ ] New paths that introduce a permissionless signer must walk the
      I-D invariant list — any non-user-bounded action must surface
      the bound via a PDA the user signed.

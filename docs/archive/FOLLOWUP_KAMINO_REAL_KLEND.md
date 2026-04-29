# Kamino-SY-Adapter ↔ Real Klend CPI Compatibility (Followup B)

## Why this exists

The deployed `kamino_sy_adapter` (devnet `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd`)
CPIs into klend using `mock_klend`'s account layout (8 accounts). Real klend's
`deposit_reserve_liquidity` / `redeem_reserve_collateral` take **12 accounts**.
Preflight on 2026-04-25 confirmed the failure:

```
Program log: AnchorError caused by account: lending_market.
Error Code: AccountOwnedByWrongProgram. Error Number: 3007.
Left:  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA  (token program — what we sent)
Right: KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD  (klend — what it expected)
```

The mock_klend's [`mock_klend/src/lib.rs:18`](reference_adapters/mock_klend/src/lib.rs#L18)
comment claims drop-in compatibility — that comment is wrong. Real klend has
diverged.

## Real klend account layouts

Source: on-chain IDL, fetched 2026-04-25 from
`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` mainnet via `anchor idl fetch`.

### `deposit_reserve_liquidity` (12 accounts, arg `liquidity_amount: u64`)

| # | Name | Writable | Notes |
|---|---|---|---|
| 0 | `owner` | ✓ (signer) | funds liquidity |
| 1 | `reserve` | ✓ | klend-owned state |
| 2 | `lending_market` | — | klend-owned |
| 3 | `lending_market_authority` | — | PDA `[b"lma", lending_market]` |
| 4 | `reserve_liquidity_mint` | — | underlying token mint |
| 5 | `reserve_liquidity_supply` | ✓ | klend's vault for liquidity |
| 6 | `reserve_collateral_mint` | ✓ | kToken mint |
| 7 | `user_source_liquidity` | ✓ | user's underlying ATA |
| 8 | `user_destination_collateral` | ✓ | user's kToken destination (our `collateral_vault`) |
| 9 | `collateral_token_program` | — | always SPL Token |
| 10 | `liquidity_token_program` | — | depends on liquidity mint (Token vs Token-2022) |
| 11 | `instruction_sysvar_account` | — | `Sysvar1nstructions1111111111111111111111111` |

### `redeem_reserve_collateral` (12 accounts, arg `collateral_amount: u64`)

| # | Name | Writable |
|---|---|---|
| 0 | `owner` | (signer) |
| 1 | `lending_market` | — |
| 2 | `reserve` | ✓ |
| 3 | `lending_market_authority` | — |
| 4 | `reserve_liquidity_mint` | — |
| 5 | `reserve_collateral_mint` | ✓ |
| 6 | `reserve_liquidity_supply` | ✓ |
| 7 | `user_source_collateral` | ✓ (our `collateral_vault`) |
| 8 | `user_destination_liquidity` | ✓ (user's underlying ATA) |
| 9 | `collateral_token_program` | — |
| 10 | `liquidity_token_program` | — |
| 11 | `instruction_sysvar_account` | — |

### `refresh_reserve` (6 accounts, no args)

| # | Name | Notes |
|---|---|---|
| 0 | `reserve` | writable |
| 1 | `lending_market` | — |
| 2 | `pyth_oracle` | optional* |
| 3 | `switchboard_price_oracle` | optional* |
| 4 | `switchboard_twap_oracle` | optional* |
| 5 | `scope_prices` | optional* |

*klend reads which oracle is configured from `reserve.config.token_info` and
ignores the other slots. For "None", pass the klend program ID as a sentinel
(same convention as our mock setup).

**Discriminators** (Anchor sha256 default — IDL doesn't ship them; computed
2026-04-25):

| Instruction | Discriminator |
|---|---|
| `deposit_reserve_liquidity` | `[169, 201, 30, 126, 6, 205, 102, 68]` |
| `redeem_reserve_collateral` | `[234, 117, 181, 125, 185, 142, 220, 29]` |
| `refresh_reserve` | `[2, 218, 138, 235, 79, 201, 25, 102]` |

## RefreshReserve precondition

Real klend rejects state-changing reserve ops on a "stale" reserve. The
`check_refresh` macro inspects the instruction sysvar to verify a
`RefreshReserve` ran in the same tx, immediately preceding the deposit/redeem.

When the adapter is invoked at the **outer tx level** (user calls
`mint_sy` directly), the caller can include `RefreshReserve` as the
preceding ix. But when the adapter is invoked **via CPI** (curator
`reallocate_to_market` → adapter `mint_sy` → klend `deposit_reserve_liquidity`),
the outer tx only sees the curator ix; klend's instruction-sysvar walk
won't find a preceding RefreshReserve at the outer level.

**Decision:** the adapter must CPI `refresh_reserve` itself, immediately
before `deposit_reserve_liquidity` / `redeem_reserve_collateral`. This
keeps the caller surface simple and works in both direct and CPI paths.
Cost: one extra CPI per mint/redeem (~5–10k CU).

## Diff plan — `reference_adapters/kamino_sy_adapter/src/lib.rs`

### 1. Extend `MintSy` Accounts struct (4 new accounts)

Add **after** the existing `klend_program` slot, before `token_program`:

```rust
// Real-klend-only accounts. Pass `klend_program` as sentinel for None
// when targeting a mock_klend reserve.
/// CHECK: klend lending market — opaque to adapter; klend validates owner.
pub klend_lending_market: Option<UncheckedAccount<'info>>,
/// CHECK: klend lending_market_authority PDA `[b"lma", lending_market]`.
pub klend_lending_market_authority: Option<UncheckedAccount<'info>>,
/// CHECK: instruction sysvar — `Sysvar1nstructions...`.
pub klend_instruction_sysvar: Option<UncheckedAccount<'info>>,
/// CHECK: klend's `liquidity_token_program` slot. SPL Token in our setup.
pub klend_liquidity_token_program: Option<UncheckedAccount<'info>>,
// Oracle accounts for refresh_reserve (4 slots, klend-program-ID for None).
pub klend_pyth_oracle: Option<UncheckedAccount<'info>>,
pub klend_switchboard_price: Option<UncheckedAccount<'info>>,
pub klend_switchboard_twap: Option<UncheckedAccount<'info>>,
pub klend_scope_prices: Option<UncheckedAccount<'info>>,
```

Same 8 additions on `RedeemSy`.

`InitSyParams` is **unchanged** — it just stores `klend_reserve` /
`klend_lending_market` / `klend_collateral_mint` pubkeys; doesn't CPI.

### 2. Replace `mint_sy` CPI block (lines 121–134)

```rust
let reserve_data_len = ctx.accounts.klend_reserve.try_borrow_data()?.len();
if reserve_data_len == REAL_KLEND_RESERVE_LEN {
    // Real klend path. CPI refresh_reserve, then deposit_reserve_liquidity.
    cpi_real_klend_refresh_reserve(&ctx.accounts)?;
    cpi_real_klend_deposit_reserve_liquidity(&ctx.accounts, amount_underlying)?;
} else {
    // Mock klend path — existing 8-account CPI unchanged.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.klend_program.to_account_info(),
        mock_klend::cpi::accounts::DepositReserveLiquidity { /* ... */ },
    );
    mock_klend::cpi::deposit_reserve_liquidity(cpi_ctx, amount_underlying)?;
}
```

`cpi_real_klend_*` are private helpers that hand-build an `Instruction`
with the 12-account layout (or 6 for refresh) and call
`solana_program::program::invoke[_signed]`. Hardcode the discriminators
as `const` byte slices.

Mirror this for `redeem_sy` (signer_seeds = sy_metadata).

### 3. New `RealKlend` discriminator constants

```rust
mod real_klend_disc {
    // sha256("global:deposit_reserve_liquidity")[..8]
    pub const DEPOSIT: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
    // sha256("global:redeem_reserve_collateral")[..8]
    pub const REDEEM: [u8; 8] = ...;
    // sha256("global:refresh_reserve")[..8]
    pub const REFRESH: [u8; 8] = ...;
}
```

(Compute the latter two via the snippet in §"Discriminators" above.)

## Diff plan — `tests/kamino_fixtures.ts`

`mintSyKamino` and `setupVaultOverKamino` / `setupMarketOverKamino` (and
their callers) need 8 extra account slots passed. For mock-klend tests,
all 8 are `null` → the adapter takes the mock path. For
real-klend devnet runs, populate all 8.

Add a helper:

```ts
export function realKlendAccountsForMint(reserve: KlendReserveAccountInfo)
  : Pick<MintSyAccounts, 'klendLendingMarket' | ... > {
  // Read lending_market from reserve at offset 32; derive lma PDA.
}
```

## Diff plan — script flow

After the upgrade lands:

1. Re-run preflight ([scratch from this session](#) — recreate via
   `mint_sy` simulation against `D4qXufDqBjU5iTbVMHfdxDrpYnz31sed1oQCJbWoVGmH`).
2. If green → write `scripts/setup-devnet-usdc-stack-kamino.ts` (Kamino-SY
   variant of [`setup-devnet-usdc-stack.ts`](scripts/setup-devnet-usdc-stack.ts)).
3. Re-point [devnet.json](deployments/devnet.json) `canonicalStack.syMarket`
   from `3yyrgJCE…` to the new Kamino-backed SY market.

## Deploy plan

`kamino_sy_adapter` size will grow modestly (~5–10 kB for the new helpers).
Authority is now cold (`Hro4y3X…`). Use the proven
write-buffer-then-deploy strategy from this session:

```bash
solana program write-buffer target/deploy/kamino_sy_adapter.so \
  --buffer /tmp/kamino_buf.json \
  --max-sign-attempts 60 --use-rpc \
  --with-compute-unit-price 200000

solana program deploy \
  --buffer /tmp/kamino_buf.json \
  --program-id 29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd \
  --upgrade-authority <COLD_KEYPAIR>
```

## Estimated scope

- Rust changes: ~150–200 lines (4 helper fns + struct extensions + dispatch)
- TS fixture changes: ~100 lines (pass-through of 8 new accounts)
- Tests: existing kamino mock-klend tests must keep passing; add a real-klend
  preflight test (devnet, gated by env var)
- Deploy: ~5 min via cold authority + buffered upload
- Total: half a day of focused work

## Status — 2026-04-26

- ✅ Rust changes landed: optional-account fields on `MintSy`/`RedeemSy`,
  `real_klend_*` CPI helpers, dispatch on `reserve_data.len()`. New error
  variant `MissingRealKlendAccount`. SBF build: 515,624 bytes
  (+88 KB vs prior 426,944).
- ✅ Test fixtures updated: `mintSyKamino` in
  [tests/kamino_fixtures.ts:407](tests/kamino_fixtures.ts#L407) passes
  `null` for the 8 new optional accounts → mock-klend path unchanged.
- ✅ Devnet upgrade landed: tx
  `3xoqgcoK2gG6fJ5MG8Go2hv9TJUUEozG7rcP6Mpo8HcMM22yiiiZmqzFxAt18tZ5W92k6dXAwfYRmXidgs7Y3ZxE`
  (cold-authority signed; hot-paid; 515 KB via write-buffer + deploy --buffer).
- ✅ Preflight against real klend reserve `D4qXufDqB…` confirmed code path:
  adapter dispatches to real-klend branch, all 12-account layout passes
  klend's account validation, klend invokes RefreshReserve internally.
- ⚠️  **Devnet-only blocker:** klend rejects the configured pyth oracle
  with `PriceNotValid (6044) — No price feed available`. The reserve
  was set up with the USDY pyth oracle as a USDC proxy
  (`E4pitSrZV9MWSspahe2vr26Cwsn3podnvHvW3cuT74R4`); that price account
  isn't fresh enough on devnet. **This is config, not code.** On
  mainnet (where pyth oracles update every slot), this won't surface.
  Devnet workaround: reconfigure the reserve with a klend-mock-friendly
  oracle, OR push fresh prices via `update_price_feeds_v2` immediately
  before each `mint_sy` call.

## Oracle account requirements — empirically confirmed

For `RefreshReserve` against the live USDC reserve `D4qXufDqB…`:

| Slot | Expected pubkey |
|---|---|
| `pyth_oracle` | `E4pitSrZV9MWSspahe2vr26Cwsn3podnvHvW3cuT74R4` (the configured one) |
| `switchboard_price` | klend program ID (or any, when not configured) |
| `switchboard_twap` | klend program ID (or any, when not configured) |
| `scope_prices` | klend program ID (or any, when not configured) |

Decoded via `@kamino-finance/klend-sdk` `Reserve.decode()`. The reserve's
stored `switchboard.*` fields are `SystemProgram::id()` and
`scope.priceFeed` is `nu11111111111111111111111111111111111111111` — but
klend's validation only checks the *configured* oracle's account match.
Unconfigured slots accept any sentinel.

## Re-pointing canonical stack — deferred

[devnet.json](deployments/devnet.json) `canonicalStack.syMarket` stays at
`3yyrgJCE…` (generic_exchange_rate_sy) for now because exercising the
Kamino-backed end-to-end path requires fresh oracle prices that the
existing reserve config doesn't reliably get on devnet. Once a mainnet
deploy or a refreshed devnet reserve is available, re-run
[scripts/setup-devnet-usdc-stack.ts](scripts/setup-devnet-usdc-stack.ts)
adapted to use the kamino SY (now functional in the adapter) and update
the canonical stack.

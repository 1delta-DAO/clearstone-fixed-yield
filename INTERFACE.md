# Clearstone Core — Public Interface

Every instruction the program exposes, its discriminator, who can call it,
and what it mutates. Rule for audit and for downstream integrators: **this
list is frozen at M8**. Any change below is a breaking change and bumps
the program ID.

Discriminators are the single byte(s) in the Anchor instruction header.
Clearstone's discriminators are **1-byte sequential**, not the Anchor
default 8-byte hash, because M0 reassigned them for a lean on-chain
footprint.

Program ID (localnet): `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW`.

## Instruction catalogue

### User instructions (permissionless)

| Disc | Name | Caller | Args | Mutates |
|---|---|---|---|---|
| `[0]` | `buy_yt` | any | `sy_in: u64, yt_out: u64` | market.financials, user SY/YT balances |
| `[1]` | `sell_yt` | any | `yt_in: u64, min_sy_out: u64` | market.financials, user SY/YT balances |
| `[3]` | `initialize_yield_position` | any | — | creates a `YieldTokenPosition` PDA |
| `[4]` | `strip` | any | `amount: u64` | vault (sy_for_pt, pt_supply, escrow), user SY/PT/YT balances |
| `[5]` | `merge` | any | `amount_py: u64` | vault (sy_for_pt, pt_supply, escrow), user SY/PT/YT balances |
| `[6]` | `collect_interest` | position owner | `amount: Amount` | vault.uncollected_sy, yield_position.interest, user SY balance |
| `[7]` | `deposit_yt` | position owner | `amount: u64` | yield_position.yt_balance |
| `[8]` | `withdraw_yt` | position owner | `amount: u64` | yield_position.yt_balance |
| `[9]` | `stage_yt_yield` | any | — | vault.uncollected_sy, vault yield_position accrual |
| `[11]` | `market_two_deposit_liquidity` | any | `pt_intent, sy_intent, min_lp_out: u64` | market.financials, LP mint supply |
| `[12]` | `market_two_withdraw_liquidity` | LP holder | `lp_in, min_pt_out, min_sy_out: u64` | market.financials, LP mint supply |
| `[17]` | `trade_pt` | any | `net_trader_pt: i64, sy_constraint: i64` | market.financials, user PT/SY balances |
| `[18]` | `flash_swap_pt` | any | `pt_out: u64, callback_data: Vec<u8>` | market.financials (post-repay commit) |
| `[19]` | `collect_emission` | position owner | `index: u16, amount: Amount` | vault.emissions, yield_position |

### Init instructions (permissionless, creator defines curator)

| Disc | Name | Args (new in Clearstone) |
|---|---|---|
| `[2]` | `initialize_vault` | `curator: Pubkey`, `creator_fee_bps: u16`, `max_py_supply: u64` + original |
| `[10]` | `init_market_two` | `curator: Pubkey`, `creator_fee_bps: u16` + original |

### Curator-gated instructions

All these require the signing `curator` account to match the one stored on
the target vault/market (enforced via Anchor `has_one = curator`).

| Disc | Name | Args | Notes |
|---|---|---|---|
| `[20]` | `collect_treasury_emission` | `emission_index: u16, amount: Amount, kind` | Drains vault treasury emissions |
| `[21]` | `collect_treasury_interest` | `amount: Amount, kind` | Drains vault treasury SY (bounded by I-V5) |
| `[26]` | `modify_vault_setting` | `action: AdminAction` | Pruned enum — no "raise fee" variants |
| `[27]` | `modify_market_setting` | `action: MarketAdminAction` | Pruned enum — no curve-parameter writes |
| `[40]` | `realloc_market` | `additional_bytes: u64` | Grows market account space |
| `[41]` | `add_lp_tokens_metadata` | `name, symbol, uri: String` | One-shot at most |

## Modify enums

### `AdminAction` (vault)

```
SetVaultStatus(u8)                                     # pause flags
LowerInterestBpsFee(u16)                               # ratchet-down only
ChangeVaultTreasuryTokenAccount(Pubkey)                # bookkeeping
ChangeEmissionTreasuryTokenAccount { index, pubkey }   # bookkeeping
ChangeMinOperationSize { is_strip: bool, new_size }    # tunable
LowerEmissionBpsFee { index, new_fee_bps }             # ratchet-down only
ChangeCpiAccounts { cpi_accounts }                     # realloc path
ChangeClaimLimits { max, window_seconds }              # rate-limit
ChangeAddressLookupTable(Pubkey)                       # tunable
RemoveVaultEmission(u8)                                # decommission
```

**Removed post-M2** (immutable post-init): `ChangeMaxPySupply`.

### `MarketAdminAction` (market)

```
SetStatus(u8)                                          # pause flags
LowerTreasuryTradeSyBpsFee(u16)                        # ratchet-down only
ChangeCpiAccounts { cpi_accounts }                     # realloc path
ChangeLiquidityNetBalanceLimits { ... }                # rate-limit
ChangeAddressLookupTable(Pubkey)                       # tunable
```

**Removed post-M2** (immutable post-init): `SetMaxLpSupply`,
`ChangeLnFeeRateRoot`, `ChangeRateScalarRoot`, `RemoveMarketEmission`
(the last was removed in M4 when market-level emissions moved to periphery).

## Account shapes

Source-of-truth for each: the struct definition in `src/state/`.

### Vault ([vault.rs](programs/clearstone_core/src/state/vault.rs))

Key fields: `curator: Pubkey`, `creator_fee_bps: u16`,
`reentrancy_guard: bool`, `sy_program`, mint and escrow pubkeys,
`start_ts`, `duration`, authority PDA, rate snapshots (`last_seen`,
`all_time_high`, `final`), balance counters (`total_sy_in_escrow`,
`sy_for_pt`, `pt_supply`, `treasury_sy`, `uncollected_sy`),
`interest_bps_fee`, `min_op_size_strip`, `min_op_size_merge`, `status`,
`emissions: Vec<EmissionInfo>`, `cpi_accounts`, `claim_limits`,
`max_py_supply`.

### MarketTwo ([market_two.rs](programs/clearstone_core/src/state/market_two.rs))

Key fields: `curator: Pubkey`, `creator_fee_bps: u16`,
`reentrancy_guard: bool`, `address_lookup_table`, mint and escrow
pubkeys, `fee_treasury_sy_bps`, `self_address`, `signer_bump`,
`status_flags`, `sy_program`, `financials: MarketFinancials`,
`max_lp_supply`, `cpi_accounts`, `is_current_flash_swap`,
`liquidity_net_balance_limits`, `seed_id`.

**Removed in M4** (moved to periphery): `emissions: MarketEmissions`,
`lp_farm: LpFarm`, `lp_escrow_amount`, `token_lp_escrow`.

### MarketFinancials (nested in MarketTwo)

`expiration_ts: u64, pt_balance: u64, sy_balance: u64,
ln_fee_rate_root: f64, last_ln_implied_rate: f64, rate_scalar_root: f64`.

The curve-shaping fields (`ln_fee_rate_root`, `rate_scalar_root`) are
set at init and immutable (no modify variant). `pt_balance` /
`sy_balance` are real (un-virtualized); virtualized views come from
`v_pt_balance()` / `v_sy_balance()`.

### YieldTokenPosition ([yield_token_position.rs](programs/clearstone_core/src/state/yield_token_position.rs))

Per-user YT position: owner, vault, yt_balance, interest tracker,
emissions trackers.

## Error codes

From [error.rs](programs/clearstone_core/src/error.rs):

- Pre-existing (upstream Exponent): `InvalidProxyAccount`,
  `VaultExpired`, `EmissionIndexMustBeSequential`,
  `AmountLargerThanStaged`, `MathOverflow`, `DurationNegative`,
  `FarmDoesNotExist`, `LpSupplyMaximumExceeded`, `VaultIsNotActive`,
  `OperationAmountTooSmall`, `StrippingDisabled`, `MergingDisabled`,
  `DepositingYtDisabled`, `WithdrawingYtDisabled`,
  `CollectingInterestDisabled`, `CollectingEmissionsDisabled`,
  `BuyingPtDisabled`, `SellingPtDisabled`, `BuyingYtDisabled`,
  `SellingYtDisabled`, `DepositingLiquidityDisabled`,
  `WithdrawingLiquidityDisabled`, `VaultInEmergencyMode`,
  `FarmAlreadyExists`, `ClaimLimitExceeded`,
  `NetBalanceChangeExceedsLimit`, `MinSyOutNotMet`, `MinPtOutNotMet`,
  `MinLpOutNotMet`.

- **Added by Clearstone**: `Unauthorized` (curator auth), `ReentrancyLocked`
  (I-C1), `SyInvalidExchangeRate` (I-C3), `SyEmissionIndexesMismatch`
  (I-C3), `FeeExceedsProtocolCap` (I-E1), `FeeNotRatchetDown` (I-E2),
  `DurationOutOfBounds`, `StartTimestampInPast`, `MinOperationSizeZero`,
  `ImmutablePostInit`, `NestedFlashBlocked` (I-F1),
  `FlashRepayInsufficient` (I-F2), `InsufficientPtLiquidity`.

## Flash-swap entrypoint — `[18]` `flash_swap_pt`

Pendle-style PT flash borrow with callback. Sends `pt_out` PT from the
market's escrow to the caller, CPIs `callback_program` with a fixed ABI,
then requires the callback to have repaid the market's SY escrow by the
AMM-quoted amount before returning. Full spec in
[INTENT_FLASH_PLAN.md](INTENT_FLASH_PLAN.md); invariants I-F1..I-F4.

**Args:**
- `pt_out: u64` — PT amount to flash-borrow from `token_pt_escrow`.
- `callback_data: Vec<u8>` — opaque bytes forwarded to the callback.

**Accounts** (see `FlashSwapPt` in
[flash_swap_pt.rs](programs/clearstone_core/src/instructions/market_two/flash_swap_pt.rs)):
`caller`, `market`, `caller_pt_dst`, `token_sy_escrow`, `token_pt_escrow`,
`token_fee_treasury_sy`, `mint_sy`, `callback_program`, `address_lookup_table`,
`sy_program`, `token_program` + event_cpi pair.

**Callback ABI.** Core CPIs `callback_program` with the Anchor discriminator
`sha256("global:on_flash_pt_received")[..8]`. Callback must:
- Read `(pt_received: u64, sy_required: u64, data: Vec<u8>)` as its args.
- Receive 6 fixed accounts + N `remaining_accounts` (solver-forwarded from
  core's `remaining_accounts`). Fixed prefix: `market`, `caller_pt_dst`,
  `token_sy_escrow`, `mint_sy`, `caller`, `token_program`.
- Ensure `token_sy_escrow.amount` grows by at least `sy_required` before
  returning.

Reference callback: [clearstone_solver_callback](periphery/clearstone_solver_callback/src/lib.rs)
(fusion-fill delivery for PT orders).

**Event.**
```rust
FlashSwapPtEvent {
    caller: Pubkey,
    market: Pubkey,
    callback_program: Pubkey,
    pt_out: u64,
    sy_in: u64,
    sy_fee: u64,
    sy_exchange_rate: Number,
    timestamp: i64,
}
```

**New error codes (on top of existing).** `NestedFlashBlocked` (I-F1),
`FlashRepayInsufficient` (I-F2), `InsufficientPtLiquidity`.

## SY-mint account on token-moving ixs (post M-KYC-4)

Every instruction that transfers SY now carries `mint_sy: InterfaceAccount<Mint>`
in its Accounts struct — required for Token-2022 `transfer_checked` and
constrained via `has_one = mint_sy` on the vault/market. Affected ixs:

- `strip`, `merge`, `collect_interest`, `collect_treasury_interest`
- `trade_pt`, `buy_yt`, `sell_yt`
- `market_two_deposit_liquidity`, `market_two_withdraw_liquidity`
- `init_market_two` (already carried it pre-migration)

Clients that built instructions with the pre-M-KYC-4 account layout must
regenerate IDLs. This is an intentional IDL-breaking change (see
[KYC_PASSTHROUGH_PLAN.md §3.2](KYC_PASSTHROUGH_PLAN.md)).

PT transfers (`trade_pt`, `deposit_liquidity`, `withdraw_liquidity`,
`buy_yt`, `sell_yt`) continue to use plain `token_2022::transfer` — PT
mints are core-owned SPL without extensions, so `transfer_checked` would
add cost without adding safety.

## Reference SY adapters

- [generic_exchange_rate_sy](reference_adapters/generic_exchange_rate_sy/src/lib.rs)
  implements the SY interface that core's `utils/sy_cpi.rs` calls. The
  10-discriminator map lives in the adapter's lib.rs header comment.
  Program ID (localnet): `HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3`.
- [kamino_sy_adapter](reference_adapters/kamino_sy_adapter/src/lib.rs)
  wraps a Kamino Lend V2 reserve and exposes the same SY interface.
  `init_sy_params` takes a `KycMode { None, GovernorWhitelist { .. } }`
  argument — `None` is the retail permissionless path, `GovernorWhitelist`
  composes with the external
  [`clearstone-finance` governor](https://github.com/1delta-DAO/clearstone-finance)
  to whitelist core escrows for a KYC-gated d-token. Program ID (localnet):
  `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd`.
- [mock_klend](reference_adapters/mock_klend/src/lib.rs) — test-only
  Kamino Lend V2 stand-in used by the adapter's integration tests.
  Program ID (localnet): `AKeo9L8sGnMABrsUs7gJAk8WLye62hSJ7ikZ6yytCGkv`.
  Never deployed to devnet/mainnet.

## Periphery programs (scaffolded, not frozen)

Both are pre-M8 scaffolds — interfaces may evolve before an audit-ready tag:

- [clearstone_rewards](periphery/clearstone_rewards/src/lib.rs) —
  program ID `7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g`.
- [clearstone_curator](periphery/clearstone_curator/src/lib.rs) —
  program ID `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm`.

See [FOLLOWUPS.md](FOLLOWUPS.md) for outstanding work on both.

# Clearstone Core — Public Interface

Every instruction the program exposes, its discriminator, who can call it,
and what it mutates. Rule for audit and for downstream integrators: **this
list is frozen at M8**. Any change below is a breaking change and bumps
the program ID.

Discriminators are the single byte(s) in the Anchor instruction header.
Clearstone's discriminators are **1-byte sequential**, not the Anchor
default 8-byte hash, because M0 reassigned them for a lean on-chain
footprint.

Program ID (localnet): `EKpLcVc6rky1ah28NMZFoT2oSXkAKWcEsr6nbZziTWbC`.

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
  `ImmutablePostInit`.

## Reference SY adapter

[generic_exchange_rate_sy](reference_adapters/generic_exchange_rate_sy/src/lib.rs)
implements the SY interface that core's `utils/sy_cpi.rs` calls. The
10-discriminator map lives in the adapter's lib.rs header comment. Program ID
(localnet): `DZEqpkctMmB1Xq6foy1KnP3VayVFgJfykzi49fpWZ8M6`.

## Periphery programs (scaffolded, not frozen)

Both are pre-M8 scaffolds — interfaces may evolve before an audit-ready tag:

- [clearstone_rewards](periphery/clearstone_rewards/src/lib.rs) —
  program ID `7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g`.
- [clearstone_curator](periphery/clearstone_curator/src/lib.rs) —
  program ID `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm`.

See [FOLLOWUPS.md](FOLLOWUPS.md) for outstanding work on both.

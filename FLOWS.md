# Clearstone Fixed Yield — End-to-End Flows

Four flows, in order of dependency. Each one names the on-chain
instructions involved, the accounts that move tokens, and the spec
files an integrator should read to implement it.

| # | Flow | Caller | Spec |
|---|---|---|---|
| 0 | Create fixed-yield market + seed AMM liquidity | curator | [PLAN.md](PLAN.md), [MARKET_SETUP.md](MARKET_SETUP.md) |
| 1 | Plain deposit / buy PT | retail user | [INTERFACE.md](INTERFACE.md) `[14]` `wrapper_buy_pt` |
| 2 | Redeem / sell PT | retail user | [INTERFACE.md](INTERFACE.md) `[15]` `wrapper_sell_pt` |
| 3 | (1) and (2) routed as fusion intents | maker + solver | [INTENT_FLASH_PLAN.md](INTENT_FLASH_PLAN.md), [INTERFACE.md](INTERFACE.md) `[18]` `flash_swap_pt`, `[22]` `flash_swap_sy` |

The retail flows (1, 2) clear against the AMM directly. The intent flows (3)
let a maker post a signed off-chain order that a solver settles atomically
through `clearstone_fusion` + the flash entrypoints — maker pays no SOL fee
and never holds the SY mint.

---

## 0. Create market + seed AMM liquidity

Permissionless. Anyone can stand up a vault + market over any SY adapter
that implements `sy_common::SyState`.

### Steps

1. **Initialize SY market on the adapter.**
   `generic_exchange_rate_sy.initialize` (or `kamino_sy_adapter.init_sy_params`)
   creates the SY mint, the adapter's pool escrow, and registers the
   exchange-rate source. PDAs:
   - `sy_market = ["sy_market", base_mint]`
   - `sy_mint = ["sy_mint", sy_market]`
   - `pool_escrow = ["pool_escrow", sy_market, sy_mint]`

2. **Create the vault.** [INTERFACE.md `[2]` `initialize_vault`](INTERFACE.md#L17).
   Curator pubkey is captured at init and gates every later
   `modify_vault_setting` call (I-V5). Args include `start_timestamp`,
   `duration`, `interest_bps_fee` (capped at `creator_fee_bps`),
   `max_py_supply`, and the `cpi_accounts` ALT mapping for the chosen SY
   adapter. PT + YT mints are derived from the vault PDA and Metaplex
   metadata is created at init when `enable_metadata = true`.

3. **Seed PT + YT.** Strip enough SY into PT + YT so the market has
   liquidity to seed: `core.strip(amount)` —
   [INTERFACE.md `[4]` `strip`](INTERFACE.md#L25).

4. **Initialize the market.** [INTERFACE.md `[17]` `init_market_two`](INTERFACE.md#L33).
   PDA: `market = ["market", vault, seed_id]`. Args define the AMM curve
   (`ln_fee_rate_root`, `rate_scalar_root`, `init_rate_anchor`), the
   one-time seed liquidity (`pt_init`, `sy_init`), the immutable
   `creator_fee_bps` (caps `fee_treasury_sy_bps`), and the
   `address_lookup_table` the SY-adapter CPI resolves through.

5. **Verify.** Read the `MarketTwo` account: `pt_balance == pt_init`,
   `sy_balance == sy_init`, `flash_pt_debt == 0`, status flags include
   `STATUS_CAN_BUY_PT | STATUS_CAN_SELL_PT | STATUS_CAN_DEPOSIT_LIQUIDITY`.

The reference TS harness for steps 2–4 is `tests/fixtures.ts::setupVault`
+ `setupMarket`; the live devnet stack is built by
`scripts/setup-devnet-usdc-stack.ts` and persisted to
[`deployments/devnet.json`](deployments/devnet.json).

### Invariants enforced at this stage

- I-V5 (curator immutability), I-E1/I-E2 (fee bounds),
  I-M1 (reserve = escrow at rest), I-M3 (virtual-reserve floor).
  See [INVARIANTS.md](INVARIANTS.md).

---

## 1. Plain deposit / buy PT

User has the base asset, wants PT. Single tx via the router.

```
user.base_ata  ──► adapter.mint_sy   ──► user.sy_ata
                          │
                          └──► core.trade_pt(net_trader_pt = +pt_amount)
                                ├── debits user.sy_ata by quoted SY
                                ├── credits user.pt_ata by pt_amount
                                ├── tops up market.escrow_sy + fee_treasury_sy
                                └── advances the AMM curve
```

### Entrypoint

[`clearstone_router.wrapper_buy_pt`](INTERFACE.md#L46) — single ix.

```ts
await router.methods
  .wrapperBuyPt(ptAmount, maxBase, maxSyIn) // maxSyIn is negative (SY leaves user)
  .accounts({ user, market, vault, sy_market, base_mint, sy_mint, ... })
  .remainingAccounts(adapterCpiExtras)      // SY-adapter CPI passthrough
  .signers([user])
  .rpc();
```

`maxBase` over-mints SY (the leftover stays in `user.sy_ata`); `maxSyIn`
is the AMM slippage cap (negative because SY flows out of the user when
buying PT). Reverts on `BuyingPtDisabled`, `NestedFlashBlocked` (I-F1),
or AMM slippage breach.

### What the user holds at end

- Their base ATA: down by `≤ maxBase` (only what the AMM consumed).
- Their SY ATA: any unspent SY from the over-mint.
- Their PT ATA: up by exactly `ptAmount` PT.

To redeem the PT later, see flow 2.

---

## 2. Redeem / sell PT

User holds PT, wants base. Single tx via the router.

```
user.pt_ata ──► core.trade_pt(net_trader_pt = -pt_amount)
                  ├── debits user.pt_ata by pt_amount
                  ├── credits user.sy_ata by quoted SY
                  └── advances the AMM curve
                          │
                          ▼
              user.sy_ata ──► adapter.redeem_sy ──► user.base_ata
```

### Entrypoint

[`clearstone_router.wrapper_sell_pt`](INTERFACE.md#L46) — single ix.

```ts
await router.methods
  .wrapperSellPt(ptAmount, minSyOut)        // minSyOut is positive (SY enters user)
  .accounts({ user, market, vault, sy_market, base_mint, sy_mint, ... })
  .remainingAccounts(adapterCpiExtras)
  .signers([user])
  .rpc();
```

`minSyOut` is the AMM slippage floor (positive, in SY units). Wrapper
auto-redeems the resulting SY → base in the same tx; the user only sees
PT → base on their wallet. Reverts on `SellingPtDisabled`,
`NestedFlashBlocked`, or slippage breach.

### Maturity vs. mid-life sell

`wrapper_sell_pt` works any time before `vault.expiration_ts`. Post-
maturity the AMM still quotes (curve hits parity, PT trades 1:1 minus
fees), but the cleaner path at maturity is to `merge` PT + YT back to SY
directly via `core.merge` — no AMM traversal, no curve fee — see
[INTERFACE.md `[5]` `merge`](INTERFACE.md#L26).

---

## 3. Intent-routed buy / sell via clearstone_fusion

The maker signs an off-chain `OrderConfig` (via ed25519); a solver
fronts the inventory atomically through a flash borrow + `fusion.fill`.
The maker never holds the SY mint, never pays a SOL fee, and is
protected by `min_dst_amount` in their own signed order. The solver
captures the spread between the AMM-quoted swap price and the maker's
order terms.

This flow is the production "intent" path — useful for solver markets,
Dutch auctions, or KYC-gated allowlisted-resolver markets.

### 3a. Buy PT via intent (maker has SY, wants PT)

```
maker (off-chain) ──► signs OrderConfig{ src=mint_sy, dst=mint_pt,
                                          src_amount, min_dst_amount,
                                          resolver_policy }
                       │
                       ▼
solver (on-chain) ──► [Ed25519.verify, core.flash_swap_pt(pt_out, callback_data)]

   core.flash_swap_pt:
     1. snapshot AMM rate
     2. quote sy_in_required for pt_out
     3. transfer pt_out PT from market.escrow_pt → solver.pt_ata
     4. CPI clearstone_solver_callback.on_flash_pt_received
            │
            ├─► CPI clearstone_fusion.fill(order, src_amount)
            │       pulls maker.sy_ata     → solver.sy_ata
            │       transfers solver.pt_ata → maker.pt_ata
            │
            └─► transfer_checked solver.sy_ata → market.escrow_sy
                  (covers sy_in_required + treasury_fee)
     5. verify market.escrow_sy grew by ≥ sy_in_required + fee
     6. forward treasury_fee → token_fee_treasury_sy
     7. apply_trade_pt with the SAME rate snapshot
     8. flash_pt_debt = 0
```

**Maker side.** Signs an `OrderConfig` with `src_mint = mint_sy`,
`dst_mint = mint_pt` and a `resolver_policy` (allowed list / merkle
root / empty for permissionless). Approves the fusion delegate PDA on
their SY ATA up to `src_amount`. No tx submission — the order is
distributed off-chain.

**Solver side.** Builds a single tx with two ixs:
1. `Ed25519Program.createInstructionWithPublicKey` over the order hash
   (fusion validates this via the instructions sysvar).
2. `core.flash_swap_pt(pt_out, callback_data)` (or
   `clearstone_router.wrapper_flash_swap_pt` if speaking the router's
   namespace), where `callback_data = borsh(CallbackPayload {
   fusion_order, fusion_fill_amount })` and the callback program is
   `clearstone_solver_callback` (or any custom callback exposing
   `on_flash_pt_received`).

Reference test that exercises the full chain end-to-end:
[`tests/clearstone-fusion-flash.ts`](tests/clearstone-fusion-flash.ts)
"e2e happy path — fusion.fill via clearstone_solver_callback".

### 3b. Sell PT via intent (maker has PT, wants SY)

Mirror flow. Solver routes through `core.flash_swap_sy` (= `[22]`) +
`clearstone_solver_callback.on_flash_sy_received`. The borrow leg is SY,
the repay leg is PT.

```
maker (off-chain) ──► signs OrderConfig{ src=mint_pt, dst=mint_sy, ... }

solver (on-chain) ──► [Ed25519.verify, core.flash_swap_sy(pt_in, callback_data)]

   core.flash_swap_sy:
     1. snapshot AMM rate
     2. quote sy_out for selling pt_in PT (net_trader_pt = -pt_in)
     3. do_withdraw_sy from adapter pool → market.escrow_sy
        (passthrough; market's sy_escrow holds zero at rest)
     4. transfer sy_out + treasury_fee SY → solver.sy_ata
     5. CPI clearstone_solver_callback.on_flash_sy_received
            │
            ├─► CPI clearstone_fusion.fill(order, src_amount)
            │       pulls maker.pt_ata     → solver.pt_ata
            │       transfers solver.sy_ata → maker.sy_ata
            │
            └─► transfer_checked solver.pt_ata → market.escrow_pt
                  (covers pt_in)
     6. verify market.escrow_pt grew by ≥ pt_in
     7. forward treasury_fee → token_fee_treasury_sy
     8. apply_trade_pt with the SAME rate snapshot
     9. flash_pt_debt = 0
```

### Invariants the intent flows enforce

- **I-F1** Nested-flash blocked. Every `MarketTwo`-mutating handler
  gates on `flash_pt_debt == 0`. The `flash_pt_debt` slot is shared
  between buy-side and sell-side flashes.
- **I-F2** Repayment verified. `flash_swap_pt` checks
  `escrow_sy.amount` grew by ≥ quoted; `flash_swap_sy` checks
  `escrow_pt.amount` grew by ≥ `pt_in`.
- **I-F3** Rate freshness. The SY-program rate is read **once** at
  step 2 and reused at step 7 / 8. A rate move during the callback
  cannot influence the trade economics.
- **I-F4** PT conservation. Mid-flash escrow drift from `pt_balance`
  is reconciled by `apply_trade_pt` at commit; on revert the whole tx
  rolls back.
- **I-F5** Flash size cap. A single flash may borrow at most
  `FLASH_MAX_PT_BPS = 25 %` of `pt_balance`. Larger notional must be
  split into multiple flashes; each one re-quotes against the
  post-commit pool. Prevents pool-draining + tiny-`min_dst` exploits.

Full proofs in [INVARIANTS.md "Flash-swap invariants"](INVARIANTS.md#L518).

### Resolver policy

`OrderConfig.resolver_policy` is one of:
- `AllowedList(Vec<Pubkey>)` — empty = permissionless; non-empty =
  whitelisted solver pubkeys. The solver passes their pubkey as
  `taker` and fusion checks inclusion at fill time.
- `MerkleRoot([u8; 32])` — for large allowlists; the solver supplies
  a merkle proof as fusion's optional `merkle_proof` arg.

For KYC-gated SY (e.g. `kamino_sy_adapter` in `KycMode::GovernorWhitelist`
mode), the policy gates which solver can settle the order. The
`tests/fusion_sign.ts::buildSimpleOrder` helper takes an optional
`resolverPolicy` arg matching this enum.

### Failure modes (intent flows)

| Symptom | Likely cause |
|---|---|
| `FlashRepayInsufficient` (6F) | Callback didn't top up the repay escrow by enough |
| `FlashSizeExceedsCap` | `pt_out` / `pt_in` > `FLASH_MAX_PT_BPS` of pool — split the order |
| `NestedFlashBlocked` | Caller tried to recurse into a flash on the same market |
| Ed25519 verify revert | Order was tampered with, or expired (`expiration_time` < now) |
| `UnsupportedSrcMint` / `UnsupportedDstMint` | Reference callback only handles src or dst == `mint_sy`. Custom callbacks lift this. |

---

## See also

- [PLAN.md](PLAN.md) — top-level invariant scaffolding for the core.
- [ARCHITECTURE.md](ARCHITECTURE.md) — program-level diagram of how the
  pieces compose.
- [YT_DELIVERY_PLAN.md](YT_DELIVERY_PLAN.md) — design doc for adding
  YT-as-dst (or YT-as-src) intent flows. Inventory-only solvers work
  today; the v2 `flash_swap_yt` route is scoped there.
- [INTERFACE.md](INTERFACE.md) — exact ix signatures, account lists,
  error codes.
- [INVARIANTS.md](INVARIANTS.md) — proofs that each invariant holds.
- [INTENT_FLASH_PLAN.md](INTENT_FLASH_PLAN.md) — design rationale for
  the flash-swap primitive.
- [AUDIT_SCOPE.md](AUDIT_SCOPE.md) — what an external auditor signs off on.
- [DEVNET_PLAN.md](DEVNET_PLAN.md) — devnet bring-up + Solstice/Kamino
  canonical handles.

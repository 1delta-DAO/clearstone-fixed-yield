# clearstone-pt-solver

Reference off-chain solver for [clearstone-fusion](https://github.com/1delta-DAO/clearstone-fusion-protocol)
orders whose `dst_mint` is a clearstone PT or YT token. Demonstrates the three-layer
composition documented in the parent repo's
[ARCHITECTURE.md](../../ARCHITECTURE.md):

```
  maker-signed fusion OrderConfig
       │  (dst_mint = clearstone PT-d{token}-{maturity})
       ▼
  fusion.fill pulls src (dSY) from maker → solver ATA
       │
       ▼
  solver sources PT:
    option A — clearstone_core.trade_pt      (buy PT against AMM with pulled SY)
    option B — clearstone_core.strip         (mint PT+YT from SY, keep YT as profit)
    option C — bilateral match vs another fusion order
       │
       ▼
  solver delivers PT → maker_dst
```

## What this repo is NOT

A production solver. MEV-resistance, priority-fee bidding, slippage protection,
inventory management, and off-chain order indexing are all out of scope. This is
a proof-of-composition demo.

## Zero-inventory flash fills (default)

Default routing is **Pendle-style flash**. When the AMM has PT liquidity, the
solver runs:

```
  [Ed25519.verify(maker_sig)]
  [core.flash_swap_pt(pt_amount, callback_data=borsh(OrderConfig + u64))]
      └─► clearstone_solver_callback.on_flash_pt_received
            ├─► clearstone_fusion.fill      (pulls maker.src, delivers PT)
            └─► transfer_checked            (solver.src → market.escrow_sy)
```

Solver holds **zero PT** at every ix boundary. Core's I-F2 (flash repayment)
enforces that the callback topped up the market's SY escrow by the quoted
repayment amount before the ix returns.

To fall back to the inventory path (for debugging / A/B), set `DISABLE_FLASH=1`.
The solver then picks between `trade_pt` and `strip` based on AMM depth, using
its own just-in-time src inventory.

## YT delivery — Shape A (inventory) and Shape A++ (just-in-time)

When a fusion order's `dst_mint` is a YT mint, the router picks one of
two paths based on solver state:

1. **`ytFromInventory`** — solver has YT pre-funded. Tx is just
   `[Ed25519, fusion.fill]`. ~150k CU.
2. **`ytJustInTime`** — solver has no (or insufficient) YT. Tx is
   `[Ed25519, core.buy_yt(sy_in=0, yt_out=N), fusion.fill]`. ~750k CU.

The `ytJustInTime` path is the realization of v2 from
[YT_DELIVERY_PLAN.md](../../YT_DELIVERY_PLAN.md). Crucial discovery:
**`buy_yt(sy_in=0, yt_out=N)` is already a capital-free flash** —
its internal cascade
(`do_withdraw_sy → do_borrow_sy → do_cpi_strip → do_cpi_trade_pt →
 do_repay_sy → do_deposit_sy`) balances to a net SY change of `-sy_in`
for the trader. With `sy_in=0` the solver mints exactly `N` YT in one
ix without any upfront SY. fusion.fill then delivers it. No new
core ix needed. The originally-scoped Steps 1–6 in YT_DELIVERY_PLAN.md
collapse to a single bot tweak.

The router auto-falls-back: if the solver's YT ATA balance ≥ order's
`min_dst_amount`, it picks `ytFromInventory`; otherwise `ytJustInTime`.
A solver running `yt_inventory.ts` keeps the cheap fast path
hot; one without inventory still serves the order, just at higher CU.

### Optional: pre-funding YT inventory for the cheap path

`src/yt_inventory.ts` exposes `topUpYtInventory({ vault,
targetYtBalance })` that strips solver SY into PT + YT until the YT ATA
hits the target. The PT byproduct is useful inventory for `tradePt`
fills on the same vault — no waste.

Run as a one-shot:

```bash
tsx src/yt_inventory.ts \
  --rpc https://api.devnet.solana.com \
  --keypair ~/.config/solana/id.json \
  --vault <vault-pk> \
  --target 1000000
```

…or as a polling loop:

```bash
tsx src/yt_inventory.ts --interval-ms 60000 ...   # check every minute
```

### Sell-YT direction — still v2 work

When a maker has YT and wants SY (i.e. `src_mint = mint_yt`,
`dst_mint = mint_sy`), neither shortcut works because `sell_yt` needs
the trader's YT before the AMM math runs and the maker's YT only
arrives via fusion.fill mid-tx. A new core ix `flash_sell_yt` (mirror
of `flash_swap_sy` but with a YT-borrow leg) is needed — see
[YT_DELIVERY_PLAN.md §D2](../../YT_DELIVERY_PLAN.md). Until it ships,
sell-YT orders fall back to inventory-only.

## What it IS

- A TS skeleton showing how to decode a fusion `OrderConfig`, recognize
  clearstone PT mints, pick between `trade_pt` / `strip`, and build the atomic
  fill transaction.
- Wire points marked `// TODO(fusion)` for the fusion SDK import and
  `// TODO(rpc)` for the order-source (mempool / relay / file).

## Running

```bash
pnpm install
CLUSTER=devnet WALLET=~/.config/solana/id.json pnpm run
```

Order sources (composable — enable any subset via env):

| Env | Source |
|---|---|
| `ORDERS_PATH` (default `./orders.jsonl`) | Tails a JSONL file, one order per line. Good for recorded playbacks and local demos. |
| `LISTEN_PORT=8080` | Starts a zero-dep HTTP server. Makers / relays `POST /orders` with a `SignedFusionOrder` JSON body. |

Each order is a `{ config, signature, makerPubkey, orderHash }` tuple.
Production deployments swap in a real fusion relay by implementing the
`OrderSource` interface in `src/sources.ts` (e.g., WebSocket subscription,
Redis pub/sub, gRPC stream).

## Files

- `src/index.ts` — main loop; pulls from the active `OrderSource`, dispatches to the router.
- `src/sources.ts` — pluggable order-source layer (`FileTailSource`, `HttpServerSource`, `MultiSource`).
- `src/match.ts` — decides whether an order targets a clearstone PT/YT mint.
- `src/route.ts` — picks `trade_pt` vs `strip` vs bilateral based on market state.
- `src/state.ts` — fetches + decodes `MarketTwo` / `Vault` state; resolves SY-CPI remaining accounts from the ALT.
- `src/fusion.ts` — typed fusion Program client + `buildFusionFillIx`.
- `src/fill.ts` — builds the atomic fill tx (Ed25519 verify + core routing + fusion.fill).
- `src/clients.ts` — Anchor program clients for fusion + clearstone_core + kamino_sy_adapter.

Vendored IDLs:
- `src/clearstone_fusion.json` / `.ts` — vendored so fusion's `OrderConfig` is typed.
- clearstone_core + kamino_sy_adapter IDLs are fetched from on-chain via
  `Program.fetchIdl`.

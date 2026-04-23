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

# Clearstone Fixed Yield — Demo UI

A boilerplate React + Vite UI illustrating four flows from
[`FLOWS.md`](../FLOWS.md):

| Tab                    | What it does                                              | FLOWS.md ref |
|------------------------|-----------------------------------------------------------|--------------|
| **Setup**              | Active deployment handles · override via JSON paste · localStorage-persisted. | n/a |
| **LP provision**       | Stub: PT + SY → LP via `wrapper_provide_liquidity_classic`. Market dropdown auto-discovers all `MarketTwo` accounts on `clearstone_core` via `getProgramAccounts` + Anchor discriminator filter; canonical entry from the active stack is highlighted; "Custom…" allows manual pubkey entry. | §0 |
| **Buy PT**             | Stub: base → SY → PT via `wrapper_buy_pt`. Same market picker as LP provision. | §1 |
| **Self-solve intent**  | Real maker-side ed25519 sign via `wallet.signMessage()` + bundle export; submission stub. | §3a |

The Setup tab loads the canonical Solstice-USDC Kamino stack from
[`deployments/devnet.json`](../deployments/devnet.json) (mirrored into
`src/lib/deployments.ts`). Override any field via the JSON textarea —
useful when running against a local validator or a forked stack. The
override is stored in `localStorage` and survives reloads; the "Reset
to defaults" button clears it.

The Self-solve intent tab walks both sides of an intent flow with one
wallet:

1. **Maker.** Pick direction (buy PT / sell PT), src/min-dst amounts,
   expiration. Click `1. Sign as maker` — the page hashes a fusion
   OrderConfig under the same `order_hash` rule as
   [`tests/fusion_sign.ts`](../tests/fusion_sign.ts) and signs the
   hash with the connected wallet's `signMessage()` (Phantom,
   Backpack, Solflare, etc.).
2. **Solver.** Click `2. Self-solve` — the page validates the bundle
   (signature length, hash format) and surfaces the call shape that
   would submit `[Ed25519.verify, core.flash_swap_pt(…)]` as a v0
   VersionedTransaction with the market's ALT. Actual submission is
   left to the integrator: see
   [`scripts/clearstone_pt_solver/src/{route,fill}.ts`](../scripts/clearstone_pt_solver/src)
   for the canonical `tryRouteOrder` + `buildAndSendFill` pair.
3. **Export.** `Copy bundle JSON` writes the order bundle to the
   clipboard. Pipe it to the off-chain solver to actually fill.

## Run

```bash
cd ui
npm install      # or pnpm/yarn
npm run dev      # http://localhost:5173
```

Phantom by default · devnet by default. Override the cluster with a
query string: `http://localhost:5173/?rpc=https://your-rpc-url`.

## Why so minimal

The repo's primary integration target is the solver bot
(`scripts/clearstone_pt_solver/`) plus direct on-chain tooling. The
UI is a reference shell for manual operator flows (curators, debugging
fusion intent shapes) — not the production shipping surface. Keeping
the LP / Buy-PT pages as stubs avoids re-implementing logic that the
test suite already canonicalises. Pull the patterns into your own UI
rather than building on this one.

## Self-solve internals

`src/lib/order.ts` ports the browser-safe parts of `tests/fusion_sign.ts`:
- `orderHash(...)` builds fusion's `sha256(programId || orderBytes ||
  protocolDstAcc || integratorDstAcc || srcMint || dstMint || makerReceiver)`.
- `signOrderHash(signMessage, hash)` is a one-liner over
  `wallet.signMessage()` — note hardware wallets that don't expose
  `signMessage` won't work for fusion orders (a real-world constraint,
  not a UI limitation).
- A minimal hand-rolled borsh encoder for the demo's narrow OrderConfig
  shape. Production should plug in the IDL coder from the vendored
  `clearstone_fusion.json`.

## What's in `src/`

```
src/
  main.tsx              wallet/connection providers, RPC override
  App.tsx               4-tab nav, StackContext provider
  pages/
    Setup.tsx           deployment-handle viewer + override
    LpProvision.tsx     stub (LP add via router wrapper)
    BuyPt.tsx           stub (base → PT via router wrapper)
    IntentFill.tsx      maker-side sign + (stub) self-solve
  lib/
    deployments.ts      canonical stack snapshot + localStorage
    stack-context.ts    React context for the active stack
    order.ts            order_hash + signMessage helpers
    programs.ts         pinned program IDs
```

## Next steps for a real UI

1. Load IDLs via `anchor.workspace` (or import JSON from `target/idl/`)
   and wrap with `new anchor.Program(idl, provider)`.
2. Add an "active markets" picker: read `MarketTwo` accounts via
   `program.account.marketTwo.all(...)`.
3. Pre-derive each market's `address_lookup_table` and surface SY-CPI
   `remaining_accounts` automatically — the `syCpiExtras` helper in
   `tests/clearstone-fusion-flash.ts` is the canonical builder.
4. For Self-solve submission, integrate `tryRouteOrder` +
   `buildAndSendFill` from `scripts/clearstone_pt_solver/`. Converts
   the demo from "sign + export" into a real solver console.
5. Replace the hand-rolled borsh in `IntentFill.tsx` with the IDL
   coder so non-trivial OrderConfig shapes (Dutch auctions, fees,
   non-empty resolver allowlists) work without manual encoder updates.

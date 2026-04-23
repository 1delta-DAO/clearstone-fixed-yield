// Reference solver entrypoint.
// See README.md in this directory for context on the three-layer composition
// this solver demonstrates (fusion → clearstone_core → delta-mint / klend).

import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadClients } from "./clients.js";
import { tryRouteOrder } from "./route.js";
import { buildAndSendFill } from "./fill.js";
import {
  FileTailSource,
  HttpServerSource,
  MultiSource,
  type OrderSource,
} from "./sources.js";

async function main() {
  const cluster = process.env.CLUSTER ?? "devnet";
  const walletPath = process.env.WALLET ?? path.join(os.homedir(), ".config/solana/id.json");
  const ordersPath = process.env.ORDERS_PATH ?? "./orders.jsonl";
  const listenPort = process.env.LISTEN_PORT ? Number(process.env.LISTEN_PORT) : null;
  const pollMs = Number(process.env.POLL_MS ?? 2000);

  const endpoint = cluster.startsWith("http")
    ? cluster
    : cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "http://127.0.0.1:8899";
  const connection = new Connection(endpoint, "confirmed");
  const walletBytes = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const solver = Keypair.fromSecretKey(Uint8Array.from(walletBytes));

  const clients = await loadClients({ connection, solver });

  const sources: OrderSource[] = [new FileTailSource(ordersPath)];
  if (listenPort != null) sources.push(new HttpServerSource(listenPort));
  const source: OrderSource = sources.length === 1 ? sources[0]! : new MultiSource(sources);

  console.log(
    `[pt-solver] started. cluster=${cluster} solver=${solver.publicKey.toBase58()} ` +
      `sources=${sources.map((s) => s.constructor.name).join("+")}`
  );

  const shutdown = () => {
    console.log("[pt-solver] shutdown");
    source.close?.();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    for (const order of source.next()) {
      try {
        const plan = await tryRouteOrder(clients, order);
        if (!plan) continue;
        const sig = await buildAndSendFill(clients, order, plan);
        console.log(`[pt-solver] filled order=${order.orderHash.slice(0, 8)}… sig=${sig}`);
      } catch (err) {
        console.error(`[pt-solver] fill failed for ${order.orderHash.slice(0, 8)}…`, err);
      }
    }
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface SignedFusionOrder {
  /** Hex-encoded sha256(program_id || borsh(OrderConfig)) — identity + dedup key. */
  orderHash: string;
  /** Base58-encoded maker pubkey that signed the order hash. */
  makerPubkey: string;
  /** Base58-encoded Ed25519 signature over orderHash. */
  signature: string;
  /** JSON-encoded fusion OrderConfig. See fusion programs/clearstone-fusion/src/lib.rs. */
  config: unknown;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

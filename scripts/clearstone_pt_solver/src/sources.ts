// Pluggable order-source abstraction.
//
// Every fusion order is signed off-chain and delivered to resolvers via an
// arbitrary channel (per clearstone-fusion README: "Distribute (OrderConfig,
// signature) to resolvers via any off-chain channel."). Two sources ship here:
//
//   1. FileTailSource — tails a JSONL file, one SignedFusionOrder per line.
//      Useful for local demos, recorded playbacks, and integration tests.
//   2. HttpServerSource — starts a Node http.Server on a configurable port
//      and accepts POST /orders with JSON body. Makers / relays post to it.
//      Zero dependencies (uses Node's built-in http module).
//
// To wire in a real fusion relay (WebSocket, gRPC, Redis pub/sub, …), implement
// the `OrderSource` interface below. The main loop in index.ts doesn't care
// how orders arrive — only that `next()` yields fresh ones.

import * as fs from "node:fs";
import * as http from "node:http";

import type { SignedFusionOrder } from "./index.js";

export interface OrderSource {
  /** Returns any fresh orders since the previous call. Non-blocking. */
  next(): SignedFusionOrder[];
  /** Optional teardown. */
  close?(): void;
}

// -----------------------------------------------------------------------------
// FileTailSource
// -----------------------------------------------------------------------------

export class FileTailSource implements OrderSource {
  private readonly seen = new Set<string>();

  constructor(private readonly filePath: string) {}

  next(): SignedFusionOrder[] {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs
      .readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean);
    const fresh: SignedFusionOrder[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SignedFusionOrder;
        if (this.seen.has(parsed.orderHash)) continue;
        this.seen.add(parsed.orderHash);
        fresh.push(parsed);
      } catch {
        // ignore malformed lines; maker is expected to write valid JSONL
      }
    }
    return fresh;
  }
}

// -----------------------------------------------------------------------------
// HttpServerSource
// -----------------------------------------------------------------------------
//
// Accepts:
//   POST /orders   body = SignedFusionOrder (JSON)
//     → 202 Accepted with {"queued": true}
//     → 409 Conflict if the order_hash was seen before
//     → 400 on malformed payload
//
// Intentionally minimal. No auth, no rate-limiting, no persistence. Production
// solvers either (a) sit behind a relay that handles those concerns, or
// (b) extend this class to add them.

export class HttpServerSource implements OrderSource {
  private readonly seen = new Set<string>();
  private readonly queue: SignedFusionOrder[] = [];
  private readonly server: http.Server;

  constructor(port: number) {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.listen(port, () => {
      console.log(`[pt-solver] http source listening on :${port}`);
    });
  }

  next(): SignedFusionOrder[] {
    const fresh = this.queue.splice(0);
    return fresh;
  }

  close(): void {
    this.server.close();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== "POST" || req.url !== "/orders") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(body) as SignedFusionOrder;
        if (
          typeof parsed.orderHash !== "string" ||
          typeof parsed.makerPubkey !== "string" ||
          typeof parsed.signature !== "string" ||
          parsed.config == null
        ) {
          res.writeHead(400).end(JSON.stringify({ error: "missing required fields" }));
          return;
        }
        if (this.seen.has(parsed.orderHash)) {
          res.writeHead(409).end(JSON.stringify({ error: "order already seen" }));
          return;
        }
        this.seen.add(parsed.orderHash);
        this.queue.push(parsed);
        res.writeHead(202, { "content-type": "application/json" }).end(
          JSON.stringify({ queued: true })
        );
      } catch (err) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: `bad JSON: ${(err as Error).message}` }));
      }
    });
  }
}

// -----------------------------------------------------------------------------
// Composite
// -----------------------------------------------------------------------------

/** Combines multiple sources into one. Convenient for "file + http" setups. */
export class MultiSource implements OrderSource {
  constructor(private readonly sources: OrderSource[]) {}

  next(): SignedFusionOrder[] {
    return this.sources.flatMap((s) => s.next());
  }

  close(): void {
    for (const s of this.sources) s.close?.();
  }
}

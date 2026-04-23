// Routing: given a signed fusion order, decide HOW to source the dst asset.
//
// Options (ordered by typical cost):
//   1. `trade_pt` — spot-buy PT from the market's AMM using the pulled SY.
//      Cheapest when the PT side of the AMM has liquidity and the implied-rate
//      price is within the order's min_dst_amount bound.
//   2. `strip` — mint PT+YT by depositing SY directly with the vault. Solver
//      keeps the YT as profit (or sells it via another fusion order / buy_yt).
//      Preferred when AMM liquidity is thin or the strip-arbitrage margin
//      exceeds trade_pt cost.
//   3. Bilateral match — pair with an opposite-direction fusion order maker
//      (e.g. "sell PT for SY"). Cheapest if it exists; requires an off-chain
//      matching engine (out of scope for the demo).
//
// For this reference, we only implement options 1 and 2 and pick between them
// via a single threshold: if AMM has `pt_balance >= order.dst_amount`, use
// trade_pt; otherwise strip.

import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import type { SolverClients } from "./clients.js";
import type { SignedFusionOrder } from "./index.js";
import { classifyMint, type ClearstoneMintMeta } from "./match.js";

export type FillPlan =
  | {
      kind: "tradePt";
      vault: PublicKey;
      market: PublicKey;
      srcAmount: BN; // dSY the solver pulls from maker
      dstAmount: BN; // PT the solver delivers to maker
    }
  | {
      kind: "strip";
      vault: PublicKey;
      srcAmount: BN;
      dstAmount: BN;
      /** YT the solver keeps as profit after stripping. */
      ytProfit: BN;
    };

export async function tryRouteOrder(
  clients: SolverClients,
  order: SignedFusionOrder
): Promise<FillPlan | null> {
  const config = order.config as any; // TODO(fusion): import + use OrderConfig type

  const dstMint = new PublicKey(config.dstMint ?? config.dst_mint);
  const meta = await classifyMint(clients, dstMint);
  if (!meta) return null; // not a clearstone PT/YT — solver ignores
  if (meta.kind === "yt") return null; // YT routing via buy_yt is a v2 follow-up

  const srcAmount = new BN(config.srcAmount ?? config.src_amount);
  const minDstAmount = new BN(config.minDstAmount ?? config.min_dst_amount);

  // Read the first active market for this vault. A full solver would pick
  // across seed_ids and maturity; we take seed_id = 1 for the demo.
  const market = await findDefaultMarket(clients, meta);
  if (!market) {
    // No AMM market — only strip is available.
    return buildStripPlan(srcAmount, minDstAmount, meta);
  }

  const ptBalance: BN = market.financials.ptBalance;
  if (ptBalance.gte(minDstAmount)) {
    return {
      kind: "tradePt",
      vault: meta.vault,
      market: market.publicKey,
      srcAmount,
      dstAmount: minDstAmount,
    };
  }

  return buildStripPlan(srcAmount, minDstAmount, meta);
}

function buildStripPlan(
  srcAmount: BN,
  minDstAmount: BN,
  meta: ClearstoneMintMeta
): FillPlan {
  // At exchange rate ≈ 1, stripping 1 SY yields 1 PT + 1 YT. Solver keeps YT.
  // Real implementation reads vault.last_seen_sy_exchange_rate to size
  // srcAmount for exact dst fulfilment.
  return {
    kind: "strip",
    vault: meta.vault,
    srcAmount,
    dstAmount: minDstAmount,
    ytProfit: minDstAmount,
  };
}

async function findDefaultMarket(
  clients: SolverClients,
  meta: ClearstoneMintMeta
): Promise<
  | null
  | {
      publicKey: PublicKey;
      financials: { ptBalance: BN; syBalance: BN };
    }
> {
  const core = clients.clearstoneCore;
  // TODO(optimize): replace with a direct PDA derive using the known seedId.
  const all = await (core.account as any).marketTwo.all([
    {
      memcmp: {
        offset: 8 + 32 + 2 + 1 + 32 + 32 + 32, // vault field offset in MarketTwo
        bytes: meta.vault.toBase58(),
      },
    },
  ]);
  if (all.length === 0) return null;
  const first = all[0] as { publicKey: PublicKey; account: any };
  return {
    publicKey: first.publicKey,
    financials: {
      ptBalance: new BN(first.account.financials.ptBalance),
      syBalance: new BN(first.account.financials.syBalance),
    },
  };
}

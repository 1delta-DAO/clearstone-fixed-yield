// Build and send the atomic fill transaction.
//
// Fusion's `fill` requires the preceding instruction to be a native
// Ed25519Program verification of the maker's signature over the order hash.
// The full tx is:
//   [
//     Ed25519Program.verify(maker_pubkey, order_hash, signature),
//     fusion.fill(order, amount, merkle_proof?),
//     core.trade_pt(...) OR core.strip(...),  // solver's own routing
//   ]
//
// All three must succeed or the tx reverts — no partial fills.

import { Ed25519Program, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { SolverClients } from "./clients.js";
import type { SignedFusionOrder } from "./index.js";
import type { FillPlan } from "./route.js";
import { buildFusionFillIx } from "./fusion.js";
import {
  fetchAlt,
  fetchMarketState,
  fetchVaultState,
  resolveSyCpiRemainingAccounts,
} from "./state.js";

export async function buildAndSendFill(
  clients: SolverClients,
  order: SignedFusionOrder,
  plan: FillPlan
): Promise<string> {
  const tx = new Transaction();
  const orderConfig = order.config as any;
  const maker = new PublicKey(order.makerPubkey);
  const makerReceiver = new PublicKey(
    orderConfig.makerReceiver ?? orderConfig.maker_receiver ?? order.makerPubkey
  );
  const srcMint = new PublicKey(orderConfig.srcMint ?? orderConfig.src_mint);
  const dstMint = new PublicKey(orderConfig.dstMint ?? orderConfig.dst_mint);

  // Token-program inference — fusion supports both SPL and T2022 on either leg.
  // For a KYC'd flow the src (dSY) is Token-2022; the dst (PT) is SPL from core.
  const srcTokenProgram = await inferTokenProgram(clients, srcMint);
  const dstTokenProgram = await inferTokenProgram(clients, dstMint);

  const makerSrcAta = getAssociatedTokenAddressSync(
    srcMint,
    maker,
    false,
    srcTokenProgram
  );
  const takerSrcAta = getAssociatedTokenAddressSync(
    srcMint,
    clients.solver.publicKey,
    false,
    srcTokenProgram
  );
  const takerDstAta = getAssociatedTokenAddressSync(
    dstMint,
    clients.solver.publicKey,
    false,
    dstTokenProgram
  );
  const makerDstAta = getAssociatedTokenAddressSync(
    dstMint,
    makerReceiver,
    false,
    dstTokenProgram
  );

  // ORDERING:
  //   (1) Ed25519 verify
  //   (2) Core routing — solver spends their own src (dSY) to produce dst (PT).
  //       This must precede fusion.fill so taker_dst_ata has PT when fusion
  //       delivers it to the maker.
  //   (3) fusion.fill — pulls src from maker (tops up solver's spent src),
  //       delivers dst (solver's freshly-acquired PT) to maker. Net solver
  //       position: Δsrc = (maker-paid − AMM-cost) = Dutch-auction spread.

  // (1) Ed25519 verify — must precede fusion.fill instruction in the same tx.
  tx.add(
    Ed25519Program.createInstructionWithPublicKey({
      publicKey: Buffer.from(maker.toBytes()),
      message: Buffer.from(order.orderHash, "hex"),
      signature: Buffer.from(order.signature, "hex"),
    })
  );

  // (2) Core routing — produce dst in the solver's ATA.
  switch (plan.kind) {
    case "tradePt":
      tx.add(await buildTradePtIx(clients, plan));
      break;
    case "strip":
      tx.add(await buildStripIx(clients, plan));
      break;
  }

  // (3) fusion.fill — pulls src from maker, delivers dst to maker.
  const fillIx = await buildFusionFillIx({
    fusion: clients.fusion,
    order: orderConfig,
    orderHash: Buffer.from(order.orderHash, "hex"),
    maker,
    makerReceiver,
    makerSrcAta,
    takerSrcAta,
    takerDstAta,
    makerDstAta,
    srcMint,
    dstMint,
    taker: clients.solver.publicKey,
    srcTokenProgram,
    dstTokenProgram,
    amount: plan.srcAmount,
    merkleProof: null,
  });
  tx.add(fillIx);

  // (4) Send.
  return clients.provider.sendAndConfirm(tx, [clients.solver], {
    commitment: "confirmed",
  });
}

async function buildTradePtIx(
  clients: SolverClients,
  plan: Extract<FillPlan, { kind: "tradePt" }>
) {
  const market = await fetchMarketState(clients, plan.market);
  const alt = await fetchAlt(clients, market.addressLookupTable);

  // trade_pt uses get_sy_state (readonly) before the balance-mutation leg.
  const remaining = resolveSyCpiRemainingAccounts(
    [market.cpiAccounts.getSyState, market.cpiAccounts.depositSy, market.cpiAccounts.withdrawSy],
    alt
  );

  const solver = clients.solver.publicKey;
  const syTokenProgram = TOKEN_PROGRAM_ID; // interface-agnostic; real klend d-tokens are T2022 — see NOTE below.
  const tokenSyTrader = getAssociatedTokenAddressSync(market.mintSy, solver, false, syTokenProgram);
  const tokenPtTrader = getAssociatedTokenAddressSync(market.mintPt, solver, false, TOKEN_PROGRAM_ID);

  // NOTE: when the SY mint is Token-2022 (KYC'd d-tokens), the `tokenProgram`
  // slot on trade_pt must be TOKEN_2022_PROGRAM_ID and the solver's ATAs must
  // be derived with that program id. A production solver reads mint.owner to
  // pick the right program — this scaffold assumes SPL for simplicity.
  return clients.clearstoneCore.methods
    .tradePt(plan.srcAmount.neg(), plan.dstAmount) // buying PT → negative net_trader_pt
    .accounts({
      trader: solver,
      market: market.publicKey,
      tokenSyTrader,
      tokenPtTrader,
      tokenSyEscrow: market.tokenSyEscrow,
      tokenPtEscrow: market.tokenPtEscrow,
      addressLookupTable: market.addressLookupTable,
      tokenProgram: TOKEN_PROGRAM_ID,
      syProgram: market.syProgram,
      tokenFeeTreasurySy: market.tokenFeeTreasurySy,
      mintSy: market.mintSy,
    } as any)
    .remainingAccounts(remaining)
    .instruction();
}

async function buildStripIx(
  clients: SolverClients,
  plan: Extract<FillPlan, { kind: "strip" }>
) {
  const vault = await fetchVaultState(clients, plan.vault);
  const alt = await fetchAlt(clients, vault.addressLookupTable);

  // strip only calls get_sy_state + deposit_sy during its CPI chain.
  const remaining = resolveSyCpiRemainingAccounts(
    [vault.cpiAccounts.getSyState, vault.cpiAccounts.depositSy],
    alt
  );

  const solver = clients.solver.publicKey;
  const sySrc = getAssociatedTokenAddressSync(vault.mintSy, solver, false, TOKEN_PROGRAM_ID);
  const ptDst = getAssociatedTokenAddressSync(vault.mintPt, solver, false, TOKEN_PROGRAM_ID);
  const ytDst = getAssociatedTokenAddressSync(vault.mintYt, solver, false, TOKEN_PROGRAM_ID);

  return clients.clearstoneCore.methods
    .strip(plan.srcAmount)
    .accounts({
      depositor: solver,
      authority: vault.authority,
      vault: vault.publicKey,
      sySrc,
      escrowSy: vault.escrowSy,
      ytDst,
      ptDst,
      mintYt: vault.mintYt,
      mintPt: vault.mintPt,
      mintSy: vault.mintSy,
      tokenProgram: TOKEN_PROGRAM_ID,
      addressLookupTable: vault.addressLookupTable,
      syProgram: vault.syProgram,
      yieldPosition: vault.yieldPosition,
    } as any)
    .remainingAccounts(remaining)
    .instruction();
}

/**
 * Infer the token program that owns a mint by reading its account owner.
 * Cache upstream in production — mints are immutable, result is stable.
 */
async function inferTokenProgram(
  clients: SolverClients,
  mint: PublicKey
): Promise<PublicKey> {
  const info = await clients.connection.getAccountInfo(mint);
  if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

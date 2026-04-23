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

import * as anchor from "@coral-xyz/anchor";
import {
  AccountMeta,
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { SolverClients } from "./clients.js";
import type { SignedFusionOrder } from "./index.js";
import type { FillPlan } from "./route.js";
import {
  buildFusionFillIx,
  findDelegateAuthorityPda,
  findOrderStatePda,
} from "./fusion.js";
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

  // Flash path: core.flash_swap_pt handles PT delivery + calls the callback
  // program, which does fusion.fill internally. No standalone fusion.fill ix
  // at the outer tx level.
  if (plan.kind === "flashFusion") {
    tx.add(
      await buildFlashFillIx(clients, order, plan, {
        maker,
        makerReceiver,
        makerSrcAta,
        takerSrcAta,
        takerDstAta,
        makerDstAta,
        srcMint,
        dstMint,
        srcTokenProgram,
        dstTokenProgram,
      })
    );
    return clients.provider.sendAndConfirm(tx, [clients.solver], {
      commitment: "confirmed",
    });
  }

  // Inventory path (tradePt / strip): core routing first → fusion.fill last.
  switch (plan.kind) {
    case "tradePt":
      tx.add(await buildTradePtIx(clients, plan));
      break;
    case "strip":
      tx.add(await buildStripIx(clients, plan));
      break;
  }

  // fusion.fill — pulls src from maker, delivers dst to maker.
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
    amount: planSrcAmount(plan),
    merkleProof: null,
  });
  tx.add(fillIx);

  return clients.provider.sendAndConfirm(tx, [clients.solver], {
    commitment: "confirmed",
  });
}

/**
 * Flash-fill ix builder.
 *
 * Outer tx shape (caller-built in buildAndSendFill):
 *   [Ed25519.verify, core.flash_swap_pt(pt_amount, callback_data)]
 *
 * `callback_data` = borsh-encoded {fusion_order, fusion_fill_amount} matching
 * `clearstone_solver_callback::CallbackPayload`. The payload's OrderConfig is
 * forwarded verbatim by the callback to fusion.fill.
 *
 * `remainingAccounts` on flash_swap_pt is the 16-account fusion Fill
 * passthrough that core forwards to the callback. Exact order matches
 * `OnFlashPtReceived` in periphery/clearstone_solver_callback/src/lib.rs.
 */
async function buildFlashFillIx(
  clients: SolverClients,
  order: SignedFusionOrder,
  plan: Extract<FillPlan, { kind: "flashFusion" }>,
  resolved: {
    maker: PublicKey;
    makerReceiver: PublicKey;
    makerSrcAta: PublicKey;
    takerSrcAta: PublicKey;
    takerDstAta: PublicKey;
    makerDstAta: PublicKey;
    srcMint: PublicKey;
    dstMint: PublicKey;
    srcTokenProgram: PublicKey;
    dstTokenProgram: PublicKey;
  }
) {
  const market = await fetchMarketState(clients, plan.market);
  const alt = await fetchAlt(clients, market.addressLookupTable);
  const syCpiExtras = resolveSyCpiRemainingAccounts(
    [
      market.cpiAccounts.getSyState,
      market.cpiAccounts.depositSy,
      market.cpiAccounts.withdrawSy,
    ],
    alt
  );

  // Solver's PT ATA — receives the flash-borrow from core. Anchor core owns
  // the authority check (must be caller). dstMint == market.mint_pt.
  const callerPtDst = getAssociatedTokenAddressSync(
    market.mintPt,
    clients.solver.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  // Serialize CallbackPayload. Uses the vendored fusion IDL's OrderConfig
  // encoder for byte-identical layout with the Rust side.
  const payload = encodeCallbackPayload(
    clients,
    (order.config as any),
    plan.fusionFillAmount
  );

  // Fusion passthrough — exactly the account order expected by
  // `OnFlashPtReceived` (after the 6-account fixed prefix core injects).
  const [delegateAuthority] = findDelegateAuthorityPda(clients.fusionProgramId);
  const [orderState] = findOrderStatePda(
    resolved.maker,
    Buffer.from(order.orderHash, "hex"),
    clients.fusionProgramId
  );

  const fusionPassthrough: AccountMeta[] = [
    { pubkey: clients.fusionProgramId, isSigner: false, isWritable: false },
    { pubkey: resolved.maker, isSigner: false, isWritable: true },
    { pubkey: resolved.makerReceiver, isSigner: false, isWritable: true },
    { pubkey: resolved.makerSrcAta, isSigner: false, isWritable: true },
    { pubkey: resolved.takerSrcAta, isSigner: false, isWritable: true },
    { pubkey: resolved.makerDstAta, isSigner: false, isWritable: true },
    { pubkey: resolved.srcMint, isSigner: false, isWritable: false },
    { pubkey: resolved.dstMint, isSigner: false, isWritable: false },
    { pubkey: resolved.srcTokenProgram, isSigner: false, isWritable: false },
    { pubkey: resolved.dstTokenProgram, isSigner: false, isWritable: false },
    { pubkey: delegateAuthority, isSigner: false, isWritable: false },
    { pubkey: orderState, isSigner: false, isWritable: true },
    // Optional fee slots — None on the Rust side surfaces as Pubkey::default().
    // Fusion's Fill struct handles Option<UncheckedAccount>; we pass default
    // here and the callback's Anchor deserializer skips optional Nones.
    // TODO(solver): when the order carries real protocol/integrator fee
    // destinations, populate these from orderConfig.fee.*_dst_acc.
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
  ];

  return clients.clearstoneCore.methods
    .flashSwapPt(plan.ptAmount, payload)
    .accounts({
      caller: clients.solver.publicKey,
      market: market.publicKey,
      callerPtDst,
      tokenSyEscrow: market.tokenSyEscrow,
      tokenPtEscrow: market.tokenPtEscrow,
      tokenFeeTreasurySy: market.tokenFeeTreasurySy,
      mintSy: market.mintSy,
      callbackProgram: clients.callbackProgramId,
      addressLookupTable: market.addressLookupTable,
      syProgram: market.syProgram,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .remainingAccounts([...syCpiExtras, ...fusionPassthrough])
    .instruction();
}

/**
 * Encode `CallbackPayload` from TS using the fusion IDL's OrderConfig type.
 *
 * Uses `fusion.coder.types.encode` for OrderConfig (anchor-maintained borsh
 * parity with Rust), then manually appends the u64 fill amount since the
 * payload itself is a small bespoke struct, not an IDL-defined one.
 */
function encodeCallbackPayload(
  clients: SolverClients,
  fusionOrder: unknown,
  fusionFillAmount: anchor.BN
): Buffer {
  const orderBytes = (clients.fusion.coder.types as any).encode(
    "orderConfig",
    fusionOrder
  ) as Buffer;
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(BigInt(fusionFillAmount.toString()));
  return Buffer.concat([orderBytes, amountBytes]);
}

/** Helper: pull the src amount off any plan variant (only inventory plans hit this). */
function planSrcAmount(plan: FillPlan): anchor.BN {
  if (plan.kind === "flashFusion") return plan.fusionFillAmount;
  return plan.srcAmount;
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

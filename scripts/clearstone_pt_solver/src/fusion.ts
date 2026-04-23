// Typed fusion Program client + fill instruction builder.
//
// Uses the vendored clearstone_fusion IDL (src/clearstone_fusion.json) so we
// can construct type-safe method calls. Avoids re-implementing the Borsh
// encoding manually.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import type { ClearstoneFusion } from "./clearstone_fusion.js";

/* eslint-disable @typescript-eslint/no-var-requires */
const fusionIdl = require("./clearstone_fusion.json");
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * OrderConfig shape mirrors the fusion IDL. Inline duplication kept to avoid
 * runtime `require` in callers — all fields are primitive or Pubkey.
 */
export type FusionOrderConfig = anchor.IdlTypes<ClearstoneFusion>["orderConfig"];

export function loadFusionProgram(
  provider: anchor.AnchorProvider
): anchor.Program<ClearstoneFusion> {
  return new anchor.Program(fusionIdl as anchor.Idl, provider) as unknown as anchor.Program<ClearstoneFusion>;
}

/** Seed prefix matching clearstone-fusion/programs/clearstone-fusion/src/lib.rs. */
const ORDER_STATE_SEED = Buffer.from("order");
const DELEGATE_SEED = Buffer.from("delegate");

export function findOrderStatePda(
  maker: PublicKey,
  orderHash: Buffer,
  fusionProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORDER_STATE_SEED, maker.toBuffer(), orderHash],
    fusionProgramId
  );
}

export function findDelegateAuthorityPda(
  fusionProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([DELEGATE_SEED], fusionProgramId);
}

/**
 * Build the fusion.fill instruction for a given signed order + fill plan.
 *
 * The calling tx must place a native Ed25519Program verify instruction
 * IMMEDIATELY BEFORE this ix — fusion reads the instructions sysvar to
 * confirm `(maker_pubkey, order_hash, signature)` match.
 */
export async function buildFusionFillIx(args: {
  fusion: anchor.Program<ClearstoneFusion>;
  order: FusionOrderConfig;
  orderHash: Buffer;
  maker: PublicKey;
  makerReceiver: PublicKey;
  makerSrcAta: PublicKey;
  takerSrcAta: PublicKey;
  takerDstAta: PublicKey;
  makerDstAta: PublicKey;
  srcMint: PublicKey;
  dstMint: PublicKey;
  taker: PublicKey;
  srcTokenProgram: PublicKey;
  dstTokenProgram: PublicKey;
  protocolDstAcc?: PublicKey | null;
  integratorDstAcc?: PublicKey | null;
  amount: anchor.BN;
  merkleProof?: Array<number[]> | null;
}): Promise<TransactionInstruction> {
  const [delegateAuthority] = findDelegateAuthorityPda(args.fusion.programId);
  const [orderState] = findOrderStatePda(args.maker, args.orderHash, args.fusion.programId);

  return args.fusion.methods
    .fill(args.order as any, args.amount, (args.merkleProof ?? null) as any)
    .accounts({
      taker: args.taker,
      maker: args.maker,
      makerReceiver: args.makerReceiver,
      makerSrcAta: args.makerSrcAta,
      takerSrcAta: args.takerSrcAta,
      takerDstAta: args.takerDstAta,
      makerDstAta: args.makerDstAta,
      srcMint: args.srcMint,
      dstMint: args.dstMint,
      srcTokenProgram: args.srcTokenProgram,
      dstTokenProgram: args.dstTokenProgram,
      delegateAuthority,
      orderState,
      protocolDstAcc: args.protocolDstAcc ?? null,
      integratorDstAcc: args.integratorDstAcc ?? null,
      instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
    } as any)
    .instruction();
}

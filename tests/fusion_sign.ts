// Fusion OrderConfig signed-payload builder — TS mirror of fusion's
// on-chain `order_hash` + Ed25519 verification.
//
// This file contains ZERO fusion-side assumptions that aren't already
// encoded in the vendored fusion IDL (for OrderConfig borsh) and in
// clearstone-fusion-protocol's lib.rs:order_hash (for the hash body).
// If either drifts, the signature verification in `fusion.fill` fails at
// the Ed25519 sysvar check.
//
// Rust reference (clearstone-fusion-protocol/programs/clearstone-fusion/src/lib.rs):
//
//     fn order_hash(
//         order: &OrderConfig,
//         protocol_dst_acc: Option<Pubkey>,
//         integrator_dst_acc: Option<Pubkey>,
//         src_mint: Pubkey,
//         dst_mint: Pubkey,
//         receiver: Pubkey,
//     ) -> Result<[u8; 32]> {
//         Ok(hashv(&[
//             &crate::ID.to_bytes(),
//             &order.try_to_vec()?,
//             &protocol_dst_acc.try_to_vec()?,
//             &integrator_dst_acc.try_to_vec()?,
//             &src_mint.to_bytes(),
//             &dst_mint.to_bytes(),
//             &receiver.to_bytes(),
//         ]).to_bytes())
//     }

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as crypto from "node:crypto";

import type { ClearstoneFusion } from "../scripts/clearstone_pt_solver/src/clearstone_fusion";

// ===== Fusion OrderConfig shape (IDL-typed, for convenience) =====

export type FusionOrderConfig = anchor.IdlTypes<ClearstoneFusion>["orderConfig"];

export interface FusionOrderBundle {
  /** Borsh-encoded OrderConfig bytes — must match what fusion's
   * `order.try_to_vec()?` produces on the Rust side. */
  orderBytes: Buffer;
  /** Hex string suitable for `Buffer.from(orderHash, "hex")`. */
  orderHash: string;
  /** Hex string suitable for `Ed25519Program.createInstructionWithPublicKey`. */
  signature: string;
  /** The config object that was encoded — useful for dumping into the solver's SignedFusionOrder.config slot. */
  config: FusionOrderConfig;
}

// ===== Minimal Ed25519 signing via Node built-in crypto =====
//
// Node's `crypto.sign` supports Ed25519 natively, but expects a PKCS8 DER
// key. We construct one from the first 32 bytes of Solana's secretKey
// (the raw Ed25519 seed). DER prefix is a constant for Ed25519 PKCS8:
//   30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20  <32-byte seed>

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function signEd25519(maker: Keypair, message: Buffer): Buffer {
  const seed = Buffer.from(maker.secretKey.slice(0, 32));
  const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const keyObject = crypto.createPrivateKey({
    key: pkcs8,
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, message, keyObject);
}

// ===== Borsh for Option<Pubkey> =====
//
// Anchor's borsh rules:
//   Option::None         → [0]
//   Option::Some(Pubkey) → [1, <32 bytes>]

function encodeOptionalPubkey(p: PublicKey | null | undefined): Buffer {
  if (p == null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), p.toBuffer()]);
}

// ===== The builder =====

export interface SignFusionOrderArgs {
  fusion: Program<ClearstoneFusion>;
  maker: Keypair;
  /** Wallet that receives the dst leg. Usually equals the maker. */
  makerReceiver: PublicKey;
  srcMint: PublicKey;
  dstMint: PublicKey;
  protocolDstAcc?: PublicKey | null;
  integratorDstAcc?: PublicKey | null;
  /** OrderConfig body. */
  order: FusionOrderConfig;
}

export function signFusionOrder(args: SignFusionOrderArgs): FusionOrderBundle {
  const { fusion, maker, makerReceiver, srcMint, dstMint, order } = args;

  // 1. Borsh-encode OrderConfig via the fusion IDL coder.
  const orderBytes = (fusion.coder.types as any).encode(
    "orderConfig",
    order
  ) as Buffer;

  // 2. Assemble the hashv preimage in the Rust function's exact order.
  const programId = fusion.programId.toBuffer();
  const protoBytes = encodeOptionalPubkey(args.protocolDstAcc ?? null);
  const integBytes = encodeOptionalPubkey(args.integratorDstAcc ?? null);

  const hasher = crypto.createHash("sha256");
  hasher.update(programId);
  hasher.update(orderBytes);
  hasher.update(protoBytes);
  hasher.update(integBytes);
  hasher.update(srcMint.toBuffer());
  hasher.update(dstMint.toBuffer());
  hasher.update(makerReceiver.toBuffer());
  const orderHashBuf = hasher.digest();

  // 3. Ed25519-sign the hash with the maker keypair.
  const signatureBuf = signEd25519(maker, orderHashBuf);

  return {
    orderBytes,
    orderHash: orderHashBuf.toString("hex"),
    signature: signatureBuf.toString("hex"),
    config: order,
  };
}

/** Minimal helper: build a "permissionless, no-auction, no-fee" OrderConfig. */
export function buildSimpleOrder(params: {
  id: number;
  srcAmount: anchor.BN;
  minDstAmount: anchor.BN;
  estimatedDstAmount?: anchor.BN;
  expirationTime: number; // unix seconds as u32
}): FusionOrderConfig {
  return {
    id: params.id,
    srcAmount: params.srcAmount,
    minDstAmount: params.minDstAmount,
    estimatedDstAmount: params.estimatedDstAmount ?? params.minDstAmount,
    expirationTime: params.expirationTime,
    dstAssetIsNative: false,
    fee: {
      protocolFee: 0,
      integratorFee: 0,
      surplusPercentage: 0,
    },
    dutchAuctionData: {
      startTime: 0,
      duration: 0,
      initialRateBump: 0,
      pointsAndTimeDeltas: [],
    },
    resolverPolicy: { allowedList: [] },
  } as any;
}

// ===== Fusion PDA derivers =====

export function findFusionDelegatePda(fusionProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("delegate")], fusionProgramId);
}

export function findFusionOrderStatePda(
  fusionProgramId: PublicKey,
  maker: PublicKey,
  orderHashHex: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), maker.toBuffer(), Buffer.from(orderHashHex, "hex")],
    fusionProgramId
  );
}

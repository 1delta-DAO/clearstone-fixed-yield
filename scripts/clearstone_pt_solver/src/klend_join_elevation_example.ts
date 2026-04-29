// Example: send `requestElevationGroup` (= "join elevation group") through
// the refresh sandwich.
//
// Replaces the bare two-tx pattern that was tripping `ReserveStale (0x1779)`:
//
//   ❌ before:
//        tx1: wrap+klend deposit
//        tx2: requestElevationGroup           ← reverts because OTHER reserves
//                                               on the obligation are stale
//
//   ✅ after:
//        tx1: wrap+klend deposit
//        tx2: [SetCU, RefreshReserve×N, RefreshObligation, requestElevationGroup]
//
// Run with:
//   tsx scripts/clearstone_pt_solver/src/klend_join_elevation_example.ts \
//     --rpc <url> --keypair <path> --obligation <pk> --lending-market <pk> \
//     --elevation-group 2
//
// Or import `requestElevationGroupIx` + `joinElevationGroup` from your own
// orchestration code.

import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "node:fs";

import {
  KLEND_PROGRAM_ID,
  sendObligationIxWithRefresh,
} from "./klend_refresh.js";

// ---------------------------------------------------------------------------
// Ix builder
// ---------------------------------------------------------------------------

/**
 * Anchor discriminator for `request_elevation_group` (= sha256(
 * "global:request_elevation_group")[..8]). Cross-checked against the
 * vendored klend IDL on 2026-04-28.
 */
const DISC_REQUEST_ELEVATION_GROUP = Buffer.from([
  36, 119, 251, 129, 34, 240, 7, 147,
]);

/**
 * Build a klend `requestElevationGroup` ix.
 *
 * Account order (klend IDL):
 *   [0] owner            (signer, readonly)
 *   [1] obligation       (writable)
 *   [2] lending_market   (readonly)
 *
 * NOTE: `requestElevationGroup` itself does NOT include reserve accounts.
 * It mutates `obligation.elevation_group` and re-checks obligation
 * health — which is why the refresh sandwich is required upstream of
 * this ix. The reserves go in the `RefreshObligation` ix (handled by
 * `buildRefreshSandwich` / `sendObligationIxWithRefresh`).
 */
export function requestElevationGroupIx(args: {
  owner: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  elevationGroup: number; // u8
}): TransactionInstruction {
  if (
    !Number.isInteger(args.elevationGroup) ||
    args.elevationGroup < 0 ||
    args.elevationGroup > 255
  ) {
    throw new Error(
      `elevationGroup must be a u8 (0..=255), got ${args.elevationGroup}`
    );
  }

  const keys: AccountMeta[] = [
    { pubkey: args.owner, isSigner: true, isWritable: false },
    { pubkey: args.obligation, isSigner: false, isWritable: true },
    { pubkey: args.lendingMarket, isSigner: false, isWritable: false },
  ];

  // disc(8) || elevation_group(1)
  const data = Buffer.concat([
    DISC_REQUEST_ELEVATION_GROUP,
    Buffer.from([args.elevationGroup]),
  ]);

  return new TransactionInstruction({
    programId: KLEND_PROGRAM_ID,
    keys,
    data,
  });
}

// ---------------------------------------------------------------------------
// One-shot helper
// ---------------------------------------------------------------------------

/**
 * Build + send the refresh sandwich + `requestElevationGroup` in one tx.
 *
 * Returns the signature on success, throws on revert. The slot check
 * inside klend's `RefreshObligation` is per-tx, so combining the
 * sandwich and the elevation-group transition into ONE tx is the only
 * way to make this work — there's no intermediate slot for staleness
 * to creep back in.
 */
export async function joinElevationGroup(args: {
  connection: Connection;
  payer: Signer; // also the obligation owner
  obligation: PublicKey;
  lendingMarket: PublicKey;
  elevationGroup: number;
  /** Optional Pyth-Pull `update_price_feeds_v2` preludes — one per
   *  Pyth-Pull reserve on the obligation. Skip for Pyth-V1 / Switchboard
   *  reserves. */
  pythPullPreludes?: TransactionInstruction[];
  /** Reuse a pre-extended ALT to keep the wire size constant. Highly
   *  recommended for steady-state solvers; see
   *  `klend_refresh.ts::investigateBatching` §4. */
  alt?: AddressLookupTableAccount;
  /** Override the default 1_000_000 CU. Bump if the obligation has many
   *  reserves or the elevation group transition triggers a heavy
   *  health re-check. */
  computeUnits?: number;
}): Promise<string> {
  const tail = requestElevationGroupIx({
    owner: args.payer.publicKey,
    obligation: args.obligation,
    lendingMarket: args.lendingMarket,
    elevationGroup: args.elevationGroup,
  });

  return sendObligationIxWithRefresh({
    connection: args.connection,
    payer: args.payer,
    obligation: args.obligation,
    lendingMarket: args.lendingMarket,
    tail,
    pythPullPreludes: args.pythPullPreludes,
    alt: args.alt,
    computeUnits: args.computeUnits,
  });
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

interface Argv {
  rpc: string;
  keypair: string;
  obligation: string;
  lendingMarket: string;
  elevationGroup: number;
}

function parseArgv(): Argv {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string => {
    const idx = args.indexOf(flag);
    if (idx < 0) {
      if (fallback != null) return fallback;
      throw new Error(`missing --${flag.slice(2)} flag`);
    }
    const v = args[idx + 1];
    if (v == null) throw new Error(`--${flag.slice(2)} needs a value`);
    return v;
  };

  return {
    rpc: get("--rpc"),
    keypair: get("--keypair"),
    obligation: get("--obligation"),
    lendingMarket: get("--lending-market"),
    elevationGroup: Number.parseInt(get("--elevation-group"), 10),
  };
}

function loadKeypair(path: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function main(): Promise<void> {
  const argv = parseArgv();
  const connection = new Connection(argv.rpc, "confirmed");
  const payer = loadKeypair(argv.keypair);

  console.log(
    `joining elevation group ${argv.elevationGroup} on obligation ${argv.obligation} ...`
  );
  const sig = await joinElevationGroup({
    connection,
    payer,
    obligation: new PublicKey(argv.obligation),
    lendingMarket: new PublicKey(argv.lendingMarket),
    elevationGroup: argv.elevationGroup,
  });
  console.log(`✓ confirmed: ${sig}`);
}

// `tsx` runs the file as ESM; only kick off CLI when invoked directly.
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}

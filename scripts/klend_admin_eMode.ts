// klend_admin_eMode — operator CLI for reconfiguring a klend elevation group.
//
// Wraps `klend.update_lending_market(mode = UpdateElevationGroup, value = <72B>)`.
// Use this when you need to:
//
//   * raise/lower an elevation group's debt cap (e.g. to allow non-zero
//     wSOL borrows in eMode 2);
//   * pin a different `debt_reserve` to a group (e.g. swap raw wSOL out
//     and a KYC-wrapped csSOL reserve in);
//   * flip `allow_new_loans` to gate the group at the market level.
//
// The 72-byte `value` is a packed `ElevationGroup` (klend v1.x layout):
//
//     max_liquidation_bonus_bps : u16     (2)
//     id                        : u8      (1)
//     ltv_pct                   : u8      (1)
//     liquidation_threshold_pct : u8      (1)
//     allow_new_loans           : u8      (1)
//     max_reserves_as_collateral: u8      (1)
//     padding0                  : u8      (1)
//     debt_reserve              : Pubkey  (32)
//     padding1                  : [u64;4] (32)
//                                  total = 72
//
// IMPORTANT: `update_lending_market(UpdateElevationGroup, …)` REPLACES the
// whole group atom — there's no "patch debt cap only" mode in klend. So
// the CLI accepts every field with sensible defaults; pass the on-chain
// values for fields you don't want to disturb. To inspect the current
// group, run `--dump` and the CLI prints the parsed struct without sending
// any tx.
//
// Usage (set wSOL caps in eMode 2 + repoint to csSOL reserve):
//   tsx scripts/klend_admin_eMode.ts \
//     --rpc https://api.devnet.solana.com \
//     --keypair ~/.config/solana/clearstone-devnet.json \
//     --lending-market <pk> \
//     --group-id 2 \
//     --ltv-pct 90 --liq-thresh-pct 92 \
//     --max-liquidation-bonus-bps 200 \
//     --allow-new-loans 1 \
//     --max-reserves-as-collateral 4 \
//     --debt-reserve <csSOL_reserve_pk>
//
// Inspect:
//   tsx scripts/klend_admin_eMode.ts --rpc … --lending-market <pk> --group-id 2 --dump

import {
  AccountMeta,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as fs from "node:fs";
import { createHash } from "node:crypto";

const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

// klend's `UpdateLendingMarketMode` enum index for the elevation-group
// variant. Stable across klend v1.x; bump if klend reshuffles the enum.
const MODE_UPDATE_ELEVATION_GROUP = 9n;

// Anchor account discriminator for `LendingMarket`. Used to locate the
// elevations[] array offset by sniffing the on-chain account header.
// sha256("account:LendingMarket")[..8].
const LENDING_MARKET_DISCRIMINATOR = computeDiscriminator(
  "account:LendingMarket"
);

// Hard-coded location of `LendingMarket.elevation_groups` inside the
// account body. Verified against klend v1.x reserve.rs (LendingMarket
// struct ends with `elevation_groups: [ElevationGroup; 32]` after a
// fixed-size header). If klend changes the header, this offset moves; we
// validate by re-parsing the dump (sniff for matching `id`) before sending.
const ELEVATION_GROUPS_OFFSET = 408;
const ELEVATION_GROUP_SIZE = 72;
const ELEVATION_GROUPS_LEN = 32;

interface ElevationGroup {
  maxLiquidationBonusBps: number;
  id: number;
  ltvPct: number;
  liquidationThresholdPct: number;
  allowNewLoans: number;
  maxReservesAsCollateral: number;
  padding0: number;
  debtReserve: PublicKey;
}

function computeDiscriminator(seed: string): Buffer {
  return createHash("sha256").update(seed).digest().subarray(0, 8);
}

function encodeElevationGroup(g: ElevationGroup): Buffer {
  const buf = Buffer.alloc(ELEVATION_GROUP_SIZE);
  buf.writeUInt16LE(g.maxLiquidationBonusBps & 0xffff, 0);
  buf.writeUInt8(g.id & 0xff, 2);
  buf.writeUInt8(g.ltvPct & 0xff, 3);
  buf.writeUInt8(g.liquidationThresholdPct & 0xff, 4);
  buf.writeUInt8(g.allowNewLoans & 0xff, 5);
  buf.writeUInt8(g.maxReservesAsCollateral & 0xff, 6);
  buf.writeUInt8(g.padding0 & 0xff, 7);
  buf.set(g.debtReserve.toBytes(), 8);
  // padding1 = [u64; 4] left as zeroes.
  return buf;
}

function decodeElevationGroup(buf: Buffer, offset: number): ElevationGroup {
  return {
    maxLiquidationBonusBps: buf.readUInt16LE(offset + 0),
    id: buf.readUInt8(offset + 2),
    ltvPct: buf.readUInt8(offset + 3),
    liquidationThresholdPct: buf.readUInt8(offset + 4),
    allowNewLoans: buf.readUInt8(offset + 5),
    maxReservesAsCollateral: buf.readUInt8(offset + 6),
    padding0: buf.readUInt8(offset + 7),
    debtReserve: new PublicKey(buf.subarray(offset + 8, offset + 40)),
  };
}

async function readElevationGroup(
  connection: Connection,
  lendingMarket: PublicKey,
  groupId: number
): Promise<ElevationGroup | null> {
  const info = await connection.getAccountInfo(lendingMarket);
  if (!info) throw new Error(`lending market ${lendingMarket.toBase58()} not found`);
  if (!info.owner.equals(KLEND_PROGRAM_ID))
    throw new Error(
      `lending market is owned by ${info.owner.toBase58()}, expected klend ${KLEND_PROGRAM_ID.toBase58()}`
    );
  const disc = info.data.subarray(0, 8);
  if (!disc.equals(LENDING_MARKET_DISCRIMINATOR)) {
    throw new Error(
      `account ${lendingMarket.toBase58()} has wrong account discriminator (got ${disc.toString("hex")}, want ${LENDING_MARKET_DISCRIMINATOR.toString("hex")})`
    );
  }
  if (
    info.data.length <
    ELEVATION_GROUPS_OFFSET + ELEVATION_GROUPS_LEN * ELEVATION_GROUP_SIZE
  ) {
    throw new Error(
      `lending market account too short (${info.data.length}B); klend struct must have grown — bump ELEVATION_GROUPS_OFFSET`
    );
  }
  for (let i = 0; i < ELEVATION_GROUPS_LEN; i++) {
    const off = ELEVATION_GROUPS_OFFSET + i * ELEVATION_GROUP_SIZE;
    const g = decodeElevationGroup(info.data, off);
    if (g.id === groupId) return g;
  }
  return null;
}

interface Argv {
  rpc: string;
  keypair?: string;
  lendingMarket: string;
  groupId: number;
  dump: boolean;
  // mutators (all optional — fall back to current on-chain value if --dump-first)
  ltvPct?: number;
  liqThreshPct?: number;
  maxLiquidationBonusBps?: number;
  allowNewLoans?: number;
  maxReservesAsCollateral?: number;
  debtReserve?: string;
  // override the mode index if klend ever re-numbers the enum.
  mode?: number;
}

function parseArgv(): Argv {
  const args = process.argv.slice(2);
  const has = (flag: string): boolean => args.indexOf(flag) >= 0;
  const get = (flag: string, fallback?: string): string => {
    const i = args.indexOf(flag);
    if (i < 0) {
      if (fallback != null) return fallback;
      throw new Error(`missing --${flag.slice(2)}`);
    }
    const v = args[i + 1];
    if (v == null) throw new Error(`--${flag.slice(2)} needs a value`);
    return v;
  };
  const optInt = (flag: string): number | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    return Number.parseInt(args[i + 1] ?? "", 10);
  };
  const optStr = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    return args[i + 1];
  };
  return {
    rpc: get("--rpc", "https://api.devnet.solana.com"),
    keypair: optStr("--keypair"),
    lendingMarket: get("--lending-market"),
    groupId: Number.parseInt(get("--group-id"), 10),
    dump: has("--dump"),
    ltvPct: optInt("--ltv-pct"),
    liqThreshPct: optInt("--liq-thresh-pct"),
    maxLiquidationBonusBps: optInt("--max-liquidation-bonus-bps"),
    allowNewLoans: optInt("--allow-new-loans"),
    maxReservesAsCollateral: optInt("--max-reserves-as-collateral"),
    debtReserve: optStr("--debt-reserve"),
    mode: optInt("--mode"),
  };
}

function loadKeypair(p: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function buildUpdateLendingMarketIx(args: {
  owner: PublicKey;
  lendingMarket: PublicKey;
  mode: bigint;
  value: Buffer;
}): TransactionInstruction {
  if (args.value.length !== 72) {
    throw new Error(`value must be exactly 72 bytes, got ${args.value.length}`);
  }
  const disc = computeDiscriminator("global:update_lending_market");
  // Anchor encodes args in declaration order. update_lending_market(mode: u64, value: [u8; 72]).
  const modeBuf = Buffer.alloc(8);
  modeBuf.writeBigUInt64LE(args.mode);
  const data = Buffer.concat([disc, modeBuf, args.value]);
  const keys: AccountMeta[] = [
    { pubkey: args.owner, isSigner: true, isWritable: false },
    { pubkey: args.lendingMarket, isSigner: false, isWritable: true },
  ];
  return new TransactionInstruction({
    programId: KLEND_PROGRAM_ID,
    keys,
    data,
  });
}

async function main(): Promise<void> {
  const argv = parseArgv();
  const connection = new Connection(argv.rpc, "confirmed");
  const lendingMarket = new PublicKey(argv.lendingMarket);

  const current = await readElevationGroup(
    connection,
    lendingMarket,
    argv.groupId
  );
  if (current) {
    console.log(`[klend_admin_eMode] current group id=${argv.groupId}:`);
    console.log(`  maxLiquidationBonusBps   = ${current.maxLiquidationBonusBps}`);
    console.log(`  ltvPct                   = ${current.ltvPct}`);
    console.log(`  liquidationThresholdPct  = ${current.liquidationThresholdPct}`);
    console.log(`  allowNewLoans            = ${current.allowNewLoans}`);
    console.log(`  maxReservesAsCollateral  = ${current.maxReservesAsCollateral}`);
    console.log(`  debtReserve              = ${current.debtReserve.toBase58()}`);
  } else {
    console.log(
      `[klend_admin_eMode] group id=${argv.groupId} not found in lending market — will create at first empty slot if you send`
    );
  }

  if (argv.dump) {
    if (!current) process.exit(2);
    return;
  }

  if (!argv.keypair) {
    throw new Error(
      "missing --keypair (required unless --dump). The keypair must be the lending_market_owner."
    );
  }
  const owner = loadKeypair(argv.keypair);

  // Compose the new group: take current as base, override with CLI flags.
  const next: ElevationGroup = {
    maxLiquidationBonusBps:
      argv.maxLiquidationBonusBps ?? current?.maxLiquidationBonusBps ?? 0,
    id: argv.groupId,
    ltvPct: argv.ltvPct ?? current?.ltvPct ?? 0,
    liquidationThresholdPct:
      argv.liqThreshPct ?? current?.liquidationThresholdPct ?? 0,
    allowNewLoans: argv.allowNewLoans ?? current?.allowNewLoans ?? 0,
    maxReservesAsCollateral:
      argv.maxReservesAsCollateral ?? current?.maxReservesAsCollateral ?? 0,
    padding0: current?.padding0 ?? 0,
    debtReserve: argv.debtReserve
      ? new PublicKey(argv.debtReserve)
      : current?.debtReserve ?? PublicKey.default,
  };

  console.log("[klend_admin_eMode] writing group:");
  console.log(`  maxLiquidationBonusBps   = ${next.maxLiquidationBonusBps}`);
  console.log(`  ltvPct                   = ${next.ltvPct}`);
  console.log(`  liquidationThresholdPct  = ${next.liquidationThresholdPct}`);
  console.log(`  allowNewLoans            = ${next.allowNewLoans}`);
  console.log(`  maxReservesAsCollateral  = ${next.maxReservesAsCollateral}`);
  console.log(`  debtReserve              = ${next.debtReserve.toBase58()}`);

  const value = encodeElevationGroup(next);
  const mode = BigInt(argv.mode ?? Number(MODE_UPDATE_ELEVATION_GROUP));

  const ix = buildUpdateLendingMarketIx({
    owner: owner.publicKey,
    lendingMarket,
    mode,
    value,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([owner]);

  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  console.log(`✓ confirmed: ${sig}`);

  // Read-back: confirm the group was actually written as expected.
  const after = await readElevationGroup(connection, lendingMarket, argv.groupId);
  if (!after) {
    console.warn(
      `[klend_admin_eMode] read-back: group id=${argv.groupId} STILL not found — check the mode index (you used ${mode})`
    );
    process.exit(3);
  }
  const ok =
    after.maxLiquidationBonusBps === next.maxLiquidationBonusBps &&
    after.ltvPct === next.ltvPct &&
    after.liquidationThresholdPct === next.liquidationThresholdPct &&
    after.allowNewLoans === next.allowNewLoans &&
    after.maxReservesAsCollateral === next.maxReservesAsCollateral &&
    after.debtReserve.equals(next.debtReserve);
  if (!ok) {
    console.warn(
      "[klend_admin_eMode] read-back diverged — re-run with --dump to inspect"
    );
    process.exit(4);
  }
  console.log("[klend_admin_eMode] read-back OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

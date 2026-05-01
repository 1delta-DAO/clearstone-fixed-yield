// kyc_whitelist — operator CLI for whitelisting individual wallets on a
// running KYC pool.
//
// Wraps `governor.add_participant_via_pool(role)` for one wallet at a time.
// The pool must already be live (i.e. you already ran `kyc_pool_setup.ts`,
// so `activate_wrapping` has flipped delta_mint authority to the pool PDA
// and `fix_co_authority` has set co_authority on the MintConfig). Without
// those, the governor's CPI to delta_mint fails with InvalidCoAuthority.
//
// Roles (governor::ParticipantRole):
//   - Holder      — wallet can receive `mint_to` (used for end-users
//                    depositing/borrowing the d-token).
//   - Liquidator  — same as Holder + slightly different routing in
//                    delta_mint's transfer_checked path.
//   - Escrow      — wallet can ONLY receive `transfer_checked` (PDAs that
//                    custody but don't redeem; e.g. SY adapter pool_escrow).
//
// Default is Holder, which is what user wallets need.
//
// Usage:
//   tsx scripts/kyc_whitelist.ts \
//     --rpc https://api.devnet.solana.com \
//     --keypair ~/.config/solana/clearstone-curator.json \
//     --pool-config <pk>           (or --underlying <pk> to derive)
//     --wrapped-mint <pk>          (or --dm-mint-config <pk>)
//     --wallet <pk-to-whitelist>
//     [--role Holder|Liquidator|Escrow]
//
// You can also batch-whitelist by passing `--wallets pk1,pk2,pk3` —
// each is sent as a separate tx (governor.add_participant_via_pool takes
// one wallet per call; batching them in one tx exceeds 1232 bytes for
// more than ~3 wallets without an ALT). The CLI logs each sig.

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "node:fs";

const DELTA_MINT_PROGRAM_ID = new PublicKey(
  "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
);
const GOVERNOR_PROGRAM_ID = new PublicKey(
  "6xqW3D1ebp5WjbYh4vwar7ponxrpEaQiVG6uhBYVZtJi"
);

type Role = "Holder" | "Liquidator" | "Escrow";

function findPoolConfig(underlyingMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), underlyingMint.toBuffer()],
    GOVERNOR_PROGRAM_ID
  );
}
function findDmMintConfig(wrappedMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_config"), wrappedMint.toBuffer()],
    DELTA_MINT_PROGRAM_ID
  );
}
function findWhitelistEntry(
  dmMintConfig: PublicKey,
  wallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), dmMintConfig.toBuffer(), wallet.toBuffer()],
    DELTA_MINT_PROGRAM_ID
  );
}

interface Argv {
  rpc: string;
  keypair: string;
  poolConfig?: string;
  underlying?: string;
  dmMintConfig?: string;
  wrappedMint?: string;
  wallets: string[];
  role: Role;
  /** When set, skip wallets that already have a WhitelistEntry. */
  skipExisting: boolean;
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
  const optStr = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    return args[i + 1];
  };

  const single = optStr("--wallet");
  const multi = optStr("--wallets");
  const wallets: string[] = single
    ? [single]
    : multi
      ? multi.split(",").map((w) => w.trim()).filter(Boolean)
      : [];
  if (wallets.length === 0) {
    throw new Error("must pass --wallet <pk> or --wallets pk1,pk2,…");
  }

  const role = (optStr("--role") ?? "Holder") as Role;
  if (!["Holder", "Liquidator", "Escrow"].includes(role)) {
    throw new Error(`invalid --role ${role}; expected Holder|Liquidator|Escrow`);
  }

  return {
    rpc: get("--rpc", "https://api.devnet.solana.com"),
    keypair: get("--keypair"),
    poolConfig: optStr("--pool-config"),
    underlying: optStr("--underlying"),
    dmMintConfig: optStr("--dm-mint-config"),
    wrappedMint: optStr("--wrapped-mint"),
    wallets,
    role,
    skipExisting: has("--skip-existing"),
  };
}

function loadKeypair(p: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function resolvePoolConfig(argv: Argv): PublicKey {
  if (argv.poolConfig) return new PublicKey(argv.poolConfig);
  if (argv.underlying) return findPoolConfig(new PublicKey(argv.underlying))[0];
  throw new Error("must pass --pool-config <pk> or --underlying <pk>");
}

function resolveDmMintConfig(argv: Argv): PublicKey {
  if (argv.dmMintConfig) return new PublicKey(argv.dmMintConfig);
  if (argv.wrappedMint) return findDmMintConfig(new PublicKey(argv.wrappedMint))[0];
  throw new Error("must pass --dm-mint-config <pk> or --wrapped-mint <pk>");
}

async function main(): Promise<void> {
  const argv = parseArgv();
  const connection = new Connection(argv.rpc, "confirmed");
  const curator = loadKeypair(argv.keypair);

  const wallet = {
    publicKey: curator.publicKey,
    signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => {
      if ("partialSign" in tx) (tx as anchor.web3.Transaction).partialSign(curator);
      else (tx as anchor.web3.VersionedTransaction).sign([curator]);
      return tx;
    },
    signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> => {
      for (const tx of txs) {
        if ("partialSign" in tx) (tx as anchor.web3.Transaction).partialSign(curator);
        else (tx as anchor.web3.VersionedTransaction).sign([curator]);
      }
      return txs;
    },
  };
  const provider = new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const governorIdl = require("../target/idl/governor.json");
  const governor = new Program(governorIdl as anchor.Idl, provider);

  const poolConfig = resolvePoolConfig(argv);
  const dmMintConfig = resolveDmMintConfig(argv);

  console.log(`[kyc_whitelist] curator      = ${curator.publicKey.toBase58()}`);
  console.log(`[kyc_whitelist] poolConfig   = ${poolConfig.toBase58()}`);
  console.log(`[kyc_whitelist] dmMintConfig = ${dmMintConfig.toBase58()}`);
  console.log(`[kyc_whitelist] role         = ${argv.role}`);
  console.log(`[kyc_whitelist] wallets      = ${argv.wallets.length}`);

  // Anchor enum discriminator: { holder: {} } | { liquidator: {} } | { escrow: {} }
  const roleArg = (() => {
    switch (argv.role) {
      case "Holder":
        return { holder: {} };
      case "Liquidator":
        return { liquidator: {} };
      case "Escrow":
        return { escrow: {} };
    }
  })();

  let okCount = 0;
  let skipCount = 0;
  let errCount = 0;
  for (const walletStr of argv.wallets) {
    const target = new PublicKey(walletStr);
    const [whitelistEntry] = findWhitelistEntry(dmMintConfig, target);
    const existing = await connection.getAccountInfo(whitelistEntry);
    if (existing && argv.skipExisting) {
      console.log(`  ↷ ${target.toBase58()} already whitelisted (entry=${whitelistEntry.toBase58()})`);
      skipCount++;
      continue;
    }
    if (existing) {
      console.warn(
        `  ! ${target.toBase58()} already has a WhitelistEntry (${whitelistEntry.toBase58()}); the tx will fail with AccountAlreadyInUse — pass --skip-existing to bypass.`
      );
    }

    try {
      const sig = await governor.methods
        .addParticipantViaPool(roleArg as never)
        .accounts({
          authority: curator.publicKey,
          poolConfig,
          adminEntry: null,
          dmMintConfig,
          wallet: target,
          whitelistEntry,
          deltaMintProgram: DELTA_MINT_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as never)
        .signers([curator])
        .rpc();
      console.log(`  ✓ ${target.toBase58()}  entry=${whitelistEntry.toBase58()}  sig=${sig}`);
      okCount++;
    } catch (e) {
      console.error(`  ✗ ${target.toBase58()}: ${formatErr(e)}`);
      errCount++;
    }
  }

  console.log(
    `\n[kyc_whitelist] done: ${okCount} ok, ${skipCount} skipped, ${errCount} failed`
  );
  if (errCount > 0) process.exit(1);
}

function formatErr(e: unknown): string {
  if (e == null) return "(null)";
  const anyE = e as {
    message?: string;
    logs?: string[];
    error?: { errorMessage?: string };
  };
  if (anyE.error?.errorMessage) return anyE.error.errorMessage;
  if (anyE.message) return anyE.message;
  return JSON.stringify(e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// kyc_pool_setup — operator CLI to stand up a delta-mint KYC pool over an
// underlying mint. Mirrors `tests/kyc_fixtures.ts::initAndActivateKycPool`
// but as a one-shot CLI without the test infra.
//
// Three ixs in sequence (all signed by the pool authority keypair):
//
//   1. governor.initialize_pool(...) — creates pool_config PDA, dm_mint_config,
//                                       and the wrapped d-token mint (csXXX).
//   2. governor.activate_wrapping()  — flips the pool to live mode; transfers
//                                       delta_mint authority to the pool PDA so
//                                       subsequent whitelist ixs can use the
//                                       co-authority path.
//   3. governor.fix_co_authority()    — sets co_authority = pool PDA on the
//                                       MintConfig so add_to_whitelist_with_co_authority
//                                       works at user-onboarding time.
//
// After this completes, you have a functional KYC-wrapped d-token. To wire
// it into klend, take the `wrappedMint` pubkey returned at the end and use
// it as the `liquidity_mint` of a new klend reserve (klend admin work).
// For per-user onboarding, run `kyc_whitelist.ts` with each wallet that
// wants to deposit/borrow.
//
// Usage:
//   tsx scripts/kyc_pool_setup.ts \
//     --rpc https://api.devnet.solana.com \
//     --keypair ~/.config/solana/clearstone-devnet.json \
//     --underlying <pubkey> \
//     --decimals 9 \
//     [--ltv-pct 75] [--liq-thresh-pct 82]

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "node:fs";

const DELTA_MINT_PROGRAM_ID = new PublicKey(
  "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
);
const GOVERNOR_PROGRAM_ID = new PublicKey(
  "6xqW3D1ebp5WjbYh4vwar7ponxrpEaQiVG6uhBYVZtJi"
);

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
function findDmMintAuthority(wrappedMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority"), wrappedMint.toBuffer()],
    DELTA_MINT_PROGRAM_ID
  );
}

interface Argv {
  rpc: string;
  keypair: string;
  underlying: string;
  decimals: number;
  ltvPct: number;
  liqThreshPct: number;
}

function parseArgv(): Argv {
  const args = process.argv.slice(2);
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
  return {
    rpc: get("--rpc", "https://api.devnet.solana.com"),
    keypair: get("--keypair"),
    underlying: get("--underlying"),
    decimals: Number.parseInt(get("--decimals"), 10),
    ltvPct: Number.parseInt(get("--ltv-pct", "75"), 10),
    liqThreshPct: Number.parseInt(get("--liq-thresh-pct", "82"), 10),
  };
}

function loadKeypair(p: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function main(): Promise<void> {
  const argv = parseArgv();
  const connection = new Connection(argv.rpc, "confirmed");
  const authority = loadKeypair(argv.keypair);
  // Anchor's wallet adapter for a Keypair.
  const wallet = {
    publicKey: authority.publicKey,
    signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => {
      if ("partialSign" in tx) (tx as anchor.web3.Transaction).partialSign(authority);
      else (tx as anchor.web3.VersionedTransaction).sign([authority]);
      return tx;
    },
    signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> => {
      for (const tx of txs) {
        if ("partialSign" in tx) (tx as anchor.web3.Transaction).partialSign(authority);
        else (tx as anchor.web3.VersionedTransaction).sign([authority]);
      }
      return txs;
    },
  };
  const provider = new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });

  // Vendored IDL — make sure this matches the deployed governor.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const governorIdl = require("../target/idl/governor.json");
  const governor = new Program(governorIdl as anchor.Idl, provider);

  const underlyingMint = new PublicKey(argv.underlying);
  const wrappedMint = Keypair.generate();
  const [poolConfig] = findPoolConfig(underlyingMint);
  const [dmMintConfig] = findDmMintConfig(wrappedMint.publicKey);
  const [dmMintAuthority] = findDmMintAuthority(wrappedMint.publicKey);

  console.log("[kyc_pool_setup] derived handles:");
  console.log(`  authority    = ${authority.publicKey.toBase58()}`);
  console.log(`  underlying   = ${underlyingMint.toBase58()}`);
  console.log(`  wrappedMint  = ${wrappedMint.publicKey.toBase58()}  (NEW)`);
  console.log(`  poolConfig   = ${poolConfig.toBase58()}`);
  console.log(`  dmMintConfig = ${dmMintConfig.toBase58()}`);
  console.log(`  dmMintAuth   = ${dmMintAuthority.toBase58()}`);

  // 1. initialize_pool
  console.log("[kyc_pool_setup] 1/3 initialize_pool …");
  const sig1 = await governor.methods
    .initializePool({
      underlyingOracle: PublicKey.default,
      borrowMint: PublicKey.default,
      borrowOracle: PublicKey.default,
      decimals: argv.decimals,
      ltvPct: argv.ltvPct,
      liquidationThresholdPct: argv.liqThreshPct,
    } as never)
    .accounts({
      authority: authority.publicKey,
      poolConfig,
      underlyingMint,
      wrappedMint: wrappedMint.publicKey,
      dmMintConfig,
      dmMintAuthority,
      deltaMintProgram: DELTA_MINT_PROGRAM_ID,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .signers([authority, wrappedMint])
    .rpc();
  console.log(`  ✓ ${sig1}`);

  // 2. activate_wrapping
  console.log("[kyc_pool_setup] 2/3 activate_wrapping …");
  const sig2 = await governor.methods
    .activateWrapping()
    .accounts({
      authority: authority.publicKey,
      poolConfig,
      dmMintConfig,
      deltaMintProgram: DELTA_MINT_PROGRAM_ID,
    } as never)
    .signers([authority])
    .rpc();
  console.log(`  ✓ ${sig2}`);

  // 3. fix_co_authority
  console.log("[kyc_pool_setup] 3/3 fix_co_authority …");
  const sig3 = await governor.methods
    .fixCoAuthority()
    .accounts({
      authority: authority.publicKey,
      poolConfig,
      dmMintConfig,
      deltaMintProgram: DELTA_MINT_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .signers([authority])
    .rpc();
  console.log(`  ✓ ${sig3}`);

  console.log("\n[kyc_pool_setup] DONE. Pin these in your deployments.json:");
  console.log(
    JSON.stringify(
      {
        underlyingMint: underlyingMint.toBase58(),
        wrappedMint: wrappedMint.publicKey.toBase58(),
        poolConfig: poolConfig.toBase58(),
        dmMintConfig: dmMintConfig.toBase58(),
        dmMintAuthority: dmMintAuthority.toBase58(),
      },
      null,
      2
    )
  );
  console.log(
    "\nNext: (a) klend_admin_eMode.ts to add a klend reserve over wrappedMint and update the eMode debt/collateral caps;"
  );
  console.log(
    "      (b) kyc_whitelist.ts to whitelist each user wallet that needs to deposit/borrow."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

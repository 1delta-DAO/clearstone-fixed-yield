// Test helpers for standing up the external clearstone-finance KYC stack
// (governor + delta-mint) on a local/devnet validator. Used by
// tests/clearstone-kyc-pass-through.ts' GovernorWhitelist e2e test.
//
// IDL vendoring: this file relies on target/idl/{governor,delta_mint}.json
// and target/types/{governor,delta_mint}.ts produced from the external
// clearstone-finance source via `anchor idl build`. If those files are
// missing, the helpers throw on import.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import type { Governor } from "../target/types/governor";
import type { DeltaMint } from "../target/types/delta_mint";

// ===== Program IDs (published via M-KYC-0) =====

export const DELTA_MINT_PROGRAM_ID = new PublicKey(
  "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
);
export const GOVERNOR_PROGRAM_ID = new PublicKey(
  "6xqW3D1ebp5WjbYh4vwar7ponxrpEaQiVG6uhBYVZtJi"
);

// ===== PDA derivations =====

export function findPoolConfig(underlyingMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), underlyingMint.toBuffer()],
    GOVERNOR_PROGRAM_ID
  );
}

export function findDmMintConfig(wrappedMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_config"), wrappedMint.toBuffer()],
    DELTA_MINT_PROGRAM_ID
  );
}

export function findDmMintAuthority(wrappedMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority"), wrappedMint.toBuffer()],
    DELTA_MINT_PROGRAM_ID
  );
}

export function findWhitelistEntry(
  dmMintConfig: PublicKey,
  wallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), dmMintConfig.toBuffer(), wallet.toBuffer()],
    DELTA_MINT_PROGRAM_ID
  );
}

// ===== Handles =====

export interface GovernorPoolHandles {
  poolConfig: PublicKey;
  wrappedMint: PublicKey;
  dmMintConfig: PublicKey;
  dmMintAuthority: PublicKey;
  underlyingMint: PublicKey;
  authority: Keypair;
}

export interface KycStack {
  governor: Program<Governor>;
  deltaMint: Program<DeltaMint>;
}

// ===== Program loader =====

export function loadKycStack(provider: anchor.AnchorProvider): KycStack {
  // Import the JSON IDLs here (instead of at module-top) so that importing
  // this file in an env without the vendored IDLs fails loudly with the
  // exact missing-file message rather than a cryptic module-resolution error.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const governorIdl = require("../target/idl/governor.json");
  const deltaMintIdl = require("../target/idl/delta_mint.json");
  /* eslint-enable @typescript-eslint/no-var-requires */

  return {
    governor: new Program(governorIdl as anchor.Idl, provider) as unknown as Program<Governor>,
    deltaMint: new Program(deltaMintIdl as anchor.Idl, provider) as unknown as Program<DeltaMint>,
  };
}

// ===== Helpers =====

/**
 * Initialize a KYC-gated pool for `underlyingMint` and transfer delta-mint
 * authority to the pool PDA so subsequent whitelisting can use the
 * `via_pool` / `with_co_authority` paths (which `add_participant_via_pool`
 * relies on).
 */
export async function initAndActivateKycPool(args: {
  stack: KycStack;
  connection: Connection;
  payerAndAuthority: Keypair;
  underlyingMint: PublicKey;
  decimals: number;
}): Promise<GovernorPoolHandles> {
  const { stack, payerAndAuthority, underlyingMint, decimals } = args;

  const wrappedMint = Keypair.generate();
  const [poolConfig] = findPoolConfig(underlyingMint);
  const [dmMintConfig] = findDmMintConfig(wrappedMint.publicKey);
  const [dmMintAuthority] = findDmMintAuthority(wrappedMint.publicKey);

  // 1. initialize_pool — governor CPIs delta_mint.initialize_mint internally.
  await stack.governor.methods
    .initializePool({
      underlyingOracle: PublicKey.default,
      borrowMint: PublicKey.default,
      borrowOracle: PublicKey.default,
      decimals,
      ltvPct: 75,
      liquidationThresholdPct: 82,
    } as any)
    .accounts({
      authority: payerAndAuthority.publicKey,
      poolConfig,
      underlyingMint,
      wrappedMint: wrappedMint.publicKey,
      dmMintConfig,
      dmMintAuthority,
      deltaMintProgram: DELTA_MINT_PROGRAM_ID,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([payerAndAuthority, wrappedMint])
    .rpc();

  // 2. activate_wrapping — transfers delta_mint authority to poolConfig PDA.
  await stack.governor.methods
    .activateWrapping()
    .accounts({
      authority: payerAndAuthority.publicKey,
      poolConfig,
      dmMintConfig,
      deltaMintProgram: DELTA_MINT_PROGRAM_ID,
    } as any)
    .signers([payerAndAuthority])
    .rpc();

  // 3. fix_co_authority — sets co_authority = pool PDA so add_to_whitelist_with_co_authority works.
  await stack.governor.methods
    .fixCoAuthority()
    .accounts({
      authority: payerAndAuthority.publicKey,
      poolConfig,
      dmMintConfig,
      deltaMintProgram: DELTA_MINT_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([payerAndAuthority])
    .rpc();

  return {
    poolConfig,
    wrappedMint: wrappedMint.publicKey,
    dmMintConfig,
    dmMintAuthority,
    underlyingMint,
    authority: payerAndAuthority,
  };
}

/**
 * Decode a delta-mint `WhitelistEntry` account. Returns null if the account
 * doesn't exist on-chain.
 */
export async function fetchWhitelistEntry(
  stack: KycStack,
  pda: PublicKey
): Promise<null | {
  wallet: PublicKey;
  mintConfig: PublicKey;
  approved: boolean;
  role: { holder?: {}; liquidator?: {}; escrow?: {} };
}> {
  try {
    return (await (stack.deltaMint.account as any).whitelistEntry.fetch(pda)) as any;
  } catch {
    return null;
  }
}

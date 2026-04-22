// Kamino SY adapter test helpers.
//
// Mirrors fixtures.ts for the kamino_sy_adapter / mock_klend stack. Lets KYC
// pass-through tests stand up a full vault on top of a mock Kamino reserve
// without touching live klend state.
//
// PDA seeds here must track the Rust constants exactly:
//   - mock_klend:        reference_adapters/mock_klend/src/lib.rs
//   - kamino_sy_adapter: reference_adapters/kamino_sy_adapter/src/lib.rs

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import type { MockKlend } from "../target/types/mock_klend";
import type { KaminoSyAdapter } from "../target/types/kamino_sy_adapter";
import { numberFromU64 } from "./fixtures";

// ===== Seeds =====

const KLEND_SEEDS = {
  RESERVE: Buffer.from("reserve"),
  RESERVE_LIQ_SUPPLY: Buffer.from("reserve_liq_supply"),
  RESERVE_COLL_MINT: Buffer.from("reserve_coll_mint"),
} as const;

const ADAPTER_SEEDS = {
  SY_METADATA: Buffer.from("sy_metadata"),
  SY_MINT: Buffer.from("sy_mint"),
  COLL_VAULT: Buffer.from("coll_vault"),
  POOL_ESCROW: Buffer.from("pool_escrow"),
  PERSONAL_POSITION: Buffer.from("personal_position"),
} as const;

// ===== PDA derivations =====

export function findKlendReserve(
  liquidityMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [KLEND_SEEDS.RESERVE, liquidityMint.toBuffer()],
    programId
  );
}

export function findKlendLiquiditySupply(
  reserve: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [KLEND_SEEDS.RESERVE_LIQ_SUPPLY, reserve.toBuffer()],
    programId
  );
}

export function findKlendCollateralMint(
  reserve: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [KLEND_SEEDS.RESERVE_COLL_MINT, reserve.toBuffer()],
    programId
  );
}

export function findAdapterSyMetadata(
  underlyingMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ADAPTER_SEEDS.SY_METADATA, underlyingMint.toBuffer()],
    programId
  );
}

export function findAdapterSyMint(
  syMetadata: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ADAPTER_SEEDS.SY_MINT, syMetadata.toBuffer()],
    programId
  );
}

export function findAdapterCollateralVault(
  syMetadata: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ADAPTER_SEEDS.COLL_VAULT, syMetadata.toBuffer()],
    programId
  );
}

export function findAdapterPoolEscrow(
  syMetadata: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ADAPTER_SEEDS.POOL_ESCROW, syMetadata.toBuffer()],
    programId
  );
}

export function findAdapterPersonalPosition(
  syMetadata: PublicKey,
  owner: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ADAPTER_SEEDS.PERSONAL_POSITION, syMetadata.toBuffer(), owner.toBuffer()],
    programId
  );
}

// ===== Handle shapes =====

export interface MockKlendReserveHandles {
  reserve: PublicKey;
  lendingMarket: PublicKey;
  liquidityMint: PublicKey;
  liquiditySupply: PublicKey;
  collateralMint: PublicKey;
}

export interface KaminoSyHandles {
  syMetadata: PublicKey;
  syMint: PublicKey;
  collateralVault: PublicKey;
  poolEscrow: PublicKey;
  underlyingMint: PublicKey;
  klendReserve: PublicKey;
  klendLendingMarket: PublicKey;
  klendCollateralMint: PublicKey;
  klendLiquiditySupply: PublicKey;
  klendProgramId: PublicKey;
  adapterProgramId: PublicKey;
  curator: PublicKey;
}

// ===== Mock klend setup =====

export async function initMockKlendReserve(params: {
  program: Program<MockKlend>;
  payer: Keypair;
  liquidityMint: PublicKey;
  /** Any throwaway pubkey — mock doesn't actually read it. */
  lendingMarket?: PublicKey;
}): Promise<MockKlendReserveHandles> {
  const { program, payer, liquidityMint } = params;
  const lendingMarket = params.lendingMarket ?? Keypair.generate().publicKey;

  const [reserve] = findKlendReserve(liquidityMint, program.programId);
  const [liquiditySupply] = findKlendLiquiditySupply(reserve, program.programId);
  const [collateralMint] = findKlendCollateralMint(reserve, program.programId);

  await program.methods
    .initializeReserve()
    .accounts({
      payer: payer.publicKey,
      lendingMarket,
      liquidityMint,
      reserve,
      liquiditySupply,
      collateralMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([payer])
    .rpc();

  return { reserve, lendingMarket, liquidityMint, liquiditySupply, collateralMint };
}

export async function pokeMockKlendRate(params: {
  program: Program<MockKlend>;
  authority: Keypair;
  reserve: PublicKey;
  newRate: anchor.BN;
}): Promise<void> {
  const { program, authority, reserve, newRate } = params;
  await program.methods
    .pokeExchangeRate(numberFromU64(newRate) as any)
    .accounts({
      authority: authority.publicKey,
      reserve,
    } as any)
    .signers([authority])
    .rpc();
}

// ===== Kamino SY adapter setup =====

/**
 * Initialize an SY market on kamino_sy_adapter with `KycMode::None`.
 * This is the permissionless path — no governor accounts required.
 */
export async function initKaminoSyMarketNoKyc(params: {
  adapter: Program<KaminoSyAdapter>;
  klend: Program<MockKlend>;
  payer: Keypair;
  curator: Keypair;
  underlyingMint: PublicKey;
  klendReserve: MockKlendReserveHandles;
}): Promise<KaminoSyHandles> {
  const { adapter, klend, payer, curator, underlyingMint, klendReserve } = params;

  const [syMetadata] = findAdapterSyMetadata(underlyingMint, adapter.programId);
  const [syMint] = findAdapterSyMint(syMetadata, adapter.programId);
  const [collateralVault] = findAdapterCollateralVault(syMetadata, adapter.programId);
  const [poolEscrow] = findAdapterPoolEscrow(syMetadata, adapter.programId);

  await adapter.methods
    .initSyParams({ none: {} } as any, [])
    .accounts({
      payer: payer.publicKey,
      curator: curator.publicKey,
      underlyingMint,
      syMetadata,
      syMint,
      collateralVault,
      poolEscrow,
      klendReserve: klendReserve.reserve,
      klendLendingMarket: klendReserve.lendingMarket,
      klendCollateralMint: klendReserve.collateralMint,
      klendProgram: klend.programId,
      governorProgram: null,
      poolConfig: null,
      dmMintConfig: null,
      deltaMintProgram: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([payer, curator])
    .rpc();

  return {
    syMetadata,
    syMint,
    collateralVault,
    poolEscrow,
    underlyingMint,
    klendReserve: klendReserve.reserve,
    klendLendingMarket: klendReserve.lendingMarket,
    klendCollateralMint: klendReserve.collateralMint,
    klendLiquiditySupply: klendReserve.liquiditySupply,
    klendProgramId: klend.programId,
    adapterProgramId: adapter.programId,
    curator: curator.publicKey,
  };
}

/**
 * KYC-mode variant. Validates the `GovernorWhitelist` code path of
 * `init_sy_params` — but currently emits `WhitelistRequestedEvent` per PDA
 * instead of CPIing governor (see KYC_PASSTHROUGH_PLAN.md, M-KYC-3). Tests
 * that need the real CPI must wait until the external governor tag lands.
 */
export async function initKaminoSyMarketGovernorWhitelist(params: {
  adapter: Program<KaminoSyAdapter>;
  klend: Program<MockKlend>;
  payer: Keypair;
  curator: Keypair;
  underlyingMint: PublicKey;
  klendReserve: MockKlendReserveHandles;
  governorProgram: PublicKey;
  poolConfig: PublicKey;
  dmMintConfig: PublicKey;
  deltaMintProgram: PublicKey;
  /** Core PDAs to whitelist + their paired WhitelistEntry PDAs. */
  pdasToWhitelist: { pda: PublicKey; whitelistEntry: PublicKey }[];
}): Promise<KaminoSyHandles> {
  const {
    adapter,
    klend,
    payer,
    curator,
    underlyingMint,
    klendReserve,
    governorProgram,
    poolConfig,
    dmMintConfig,
    deltaMintProgram,
    pdasToWhitelist,
  } = params;

  const [syMetadata] = findAdapterSyMetadata(underlyingMint, adapter.programId);
  const [syMint] = findAdapterSyMint(syMetadata, adapter.programId);
  const [collateralVault] = findAdapterCollateralVault(syMetadata, adapter.programId);
  const [poolEscrow] = findAdapterPoolEscrow(syMetadata, adapter.programId);

  const kycMode = {
    governorWhitelist: {
      governorProgram,
      poolConfig,
      dmMintConfig,
      deltaMintProgram,
    },
  };

  const remaining: anchor.web3.AccountMeta[] = [];
  for (const { pda, whitelistEntry } of pdasToWhitelist) {
    remaining.push({ pubkey: pda, isSigner: false, isWritable: false });
    remaining.push({ pubkey: whitelistEntry, isSigner: false, isWritable: true });
  }

  await adapter.methods
    .initSyParams(kycMode as any, pdasToWhitelist.map((x) => x.pda))
    .accounts({
      payer: payer.publicKey,
      curator: curator.publicKey,
      underlyingMint,
      syMetadata,
      syMint,
      collateralVault,
      poolEscrow,
      klendReserve: klendReserve.reserve,
      klendLendingMarket: klendReserve.lendingMarket,
      klendCollateralMint: klendReserve.collateralMint,
      klendProgram: klend.programId,
      governorProgram,
      poolConfig,
      dmMintConfig,
      deltaMintProgram,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .remainingAccounts(remaining)
    .signers([payer, curator])
    .rpc();

  return {
    syMetadata,
    syMint,
    collateralVault,
    poolEscrow,
    underlyingMint,
    klendReserve: klendReserve.reserve,
    klendLendingMarket: klendReserve.lendingMarket,
    klendCollateralMint: klendReserve.collateralMint,
    klendLiquiditySupply: klendReserve.liquiditySupply,
    klendProgramId: klend.programId,
    adapterProgramId: adapter.programId,
    curator: curator.publicKey,
  };
}

/**
 * Mint SY for a user: underlying → klend.deposit_reserve_liquidity → ctokens
 * held by adapter → SY minted 1:1 to user.
 */
export async function mintSyKamino(params: {
  adapter: Program<KaminoSyAdapter>;
  klend: Program<MockKlend>;
  connection: Connection;
  user: Keypair;
  handles: KaminoSyHandles;
  amountUnderlying: anchor.BN;
}): Promise<PublicKey> {
  const { adapter, klend, connection, user, handles, amountUnderlying } = params;

  const syAta = await getOrCreateAssociatedTokenAccount(
    connection,
    user,
    handles.syMint,
    user.publicKey
  );
  const underlyingAta = getAssociatedTokenAddressSync(
    handles.underlyingMint,
    user.publicKey
  );

  await adapter.methods
    .mintSy(amountUnderlying)
    .accounts({
      owner: user.publicKey,
      syMetadata: handles.syMetadata,
      underlyingMint: handles.underlyingMint,
      syMint: handles.syMint,
      userUnderlying: underlyingAta,
      syDst: syAta.address,
      collateralVault: handles.collateralVault,
      klendReserve: handles.klendReserve,
      klendLiquiditySupply: handles.klendLiquiditySupply,
      klendCollateralMint: handles.klendCollateralMint,
      klendProgram: handles.klendProgramId,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .signers([user])
    .rpc();

  return syAta.address;
}

/** Return adapter CPI accounts in the shape core expects (remainingAccounts). */
export function kaminoAdapterExtraAccountsForVault(
  handles: KaminoSyHandles,
  vaultPersonalPosition: PublicKey
): anchor.web3.AccountMeta[] {
  // Matches CpiAccounts.deposit_sy / withdraw_sy shape: the owner/sy_metadata
  // pair plus the accounts deposit_sy / withdraw_sy takes. See
  // reference_adapters/kamino_sy_adapter/src/lib.rs `DepositSy` / `WithdrawSy`.
  return [
    { pubkey: handles.syMetadata, isSigner: false, isWritable: false },
    { pubkey: handles.syMint, isSigner: false, isWritable: true },
    { pubkey: handles.poolEscrow, isSigner: false, isWritable: true },
    { pubkey: vaultPersonalPosition, isSigner: false, isWritable: true },
    { pubkey: handles.klendReserve, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

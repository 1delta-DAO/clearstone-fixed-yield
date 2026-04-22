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
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { MockKlend } from "../target/types/mock_klend";
import type { KaminoSyAdapter } from "../target/types/kamino_sy_adapter";
import {
  CU_LIMIT_IX,
  METADATA_PROGRAM_ID,
  VaultHandles,
  MarketHandles,
  createAndExtendAlt,
  findEscrowYt,
  findMarket,
  findMarketEscrow,
  findMintLp,
  findMintPt,
  findMintYt,
  findPtMetadata,
  findVaultAuthority,
  findYieldPosition,
  numberFromU64,
} from "./fixtures";

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

// ===== CpiAccounts for the kamino adapter =====
//
// The kamino adapter's SY-interface Accounts structs carry one extra account
// over the generic adapter — `klend_reserve` (readonly) — because get_sy_state
// reads the exchange rate from it and deposit_sy/withdraw_sy use it for the
// has_one constraint on SyMetadata. See DepositSy/WithdrawSy in
// reference_adapters/kamino_sy_adapter/src/lib.rs.

export interface KaminoAdapterAltIndexes {
  owner: number;
  syMetadata: number;
  syMint: number;
  ownerSy: number;
  poolEscrow: number;
  position: number;
  klendReserve: number;
  tokenProgram: number;
}

export function buildKaminoAdapterCpiAccounts(idx: KaminoAdapterAltIndexes): any {
  const ctx = (altIndex: number, writable: boolean, signer = false) => ({
    altIndex,
    isSigner: signer,
    isWritable: writable,
  });
  return {
    // GetSyState: sy_metadata, klend_reserve
    getSyState: [ctx(idx.syMetadata, false), ctx(idx.klendReserve, false)],
    // DepositSy: owner(Signer), sy_metadata (has_one), sy_mint, sy_src, pool_escrow, position, klend_reserve, token_program
    depositSy: [
      ctx(idx.owner, false, true),
      ctx(idx.syMetadata, false),
      ctx(idx.syMint, true),
      ctx(idx.ownerSy, true),
      ctx(idx.poolEscrow, true),
      ctx(idx.position, true),
      ctx(idx.klendReserve, false),
      ctx(idx.tokenProgram, false),
    ],
    // WithdrawSy: same shape with sy_dst replacing sy_src (no owner signer — market PDA signs via CPI seeds).
    withdrawSy: [
      ctx(idx.owner, false, true),
      ctx(idx.syMetadata, false),
      ctx(idx.syMint, true),
      ctx(idx.ownerSy, true),
      ctx(idx.poolEscrow, true),
      ctx(idx.position, true),
      ctx(idx.klendReserve, false),
      ctx(idx.tokenProgram, false),
    ],
    // Kamino adapter has no emissions.
    claimEmission: [] as any[][],
    // GetPosition: sy_metadata, position
    getPositionState: [ctx(idx.syMetadata, false), ctx(idx.position, false)],
  };
}

// ===== setupVaultOverKamino =====

export interface SetupVaultOverKaminoParams {
  core: Program<ClearstoneCore>;
  adapter: Program<KaminoSyAdapter>;
  connection: Connection;
  payer: Keypair;
  curator: PublicKey;
  kaminoHandles: KaminoSyHandles;
  startTimestamp: number;
  duration: number;
  interestBpsFee: number;
  creatorFeeBps: number;
  maxPySupply: anchor.BN;
  minOpSizeStrip: anchor.BN;
  minOpSizeMerge: anchor.BN;
}

export async function setupVaultOverKamino(
  params: SetupVaultOverKaminoParams
): Promise<VaultHandles> {
  const {
    core,
    adapter,
    connection,
    payer,
    curator,
    kaminoHandles,
    startTimestamp,
    duration,
    interestBpsFee,
    creatorFeeBps,
    maxPySupply,
    minOpSizeStrip,
    minOpSizeMerge,
  } = params;

  const corePid = core.programId;
  const adapterPid = adapter.programId;

  const vault = Keypair.generate();
  const [authority] = findVaultAuthority(vault.publicKey, corePid);
  const [mintPt] = findMintPt(vault.publicKey, corePid);
  const [mintYt] = findMintYt(vault.publicKey, corePid);
  const [escrowYt] = findEscrowYt(vault.publicKey, corePid);
  const [yieldPosition] = findYieldPosition(vault.publicKey, authority, corePid);
  const [ptMetadata] = findPtMetadata(mintPt);

  const escrowSy = getAssociatedTokenAddressSync(
    kaminoHandles.syMint,
    authority,
    true
  );

  const [vaultPosition] = findAdapterPersonalPosition(
    kaminoHandles.syMetadata,
    authority,
    adapterPid
  );

  const treasuryAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      kaminoHandles.syMint,
      payer.publicKey
    )
  ).address;

  // ALT layout — 8 slots for kamino (vs 7 for generic).
  //   0: owner (= vault authority)
  //   1: sy_metadata
  //   2: sy_mint
  //   3: ownerSy (= vault's escrow_sy ATA)
  //   4: pool_escrow
  //   5: vault's position
  //   6: klend_reserve
  //   7: token_program
  const altAddresses = [
    authority,
    kaminoHandles.syMetadata,
    kaminoHandles.syMint,
    escrowSy,
    kaminoHandles.poolEscrow,
    vaultPosition,
    kaminoHandles.klendReserve,
    TOKEN_PROGRAM_ID,
  ];
  const alt = await createAndExtendAlt({ connection, payer, addresses: altAddresses });

  const cpiAccounts = buildKaminoAdapterCpiAccounts({
    owner: 0,
    syMetadata: 1,
    syMint: 2,
    ownerSy: 3,
    poolEscrow: 4,
    position: 5,
    klendReserve: 6,
    tokenProgram: 7,
  });

  // remaining_accounts: init_personal_account positional 5 on the kamino adapter
  // (payer, owner, sy_metadata, position, system_program).
  const remainingAccounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: kaminoHandles.syMetadata, isSigner: false, isWritable: false },
    { pubkey: vaultPosition, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  await core.methods
    .initializeVault(
      startTimestamp,
      duration,
      interestBpsFee,
      cpiAccounts,
      minOpSizeStrip,
      minOpSizeMerge,
      "PT KAMINO TEST",
      "tPTk",
      "https://example.com/pt-k.json",
      curator,
      creatorFeeBps,
      maxPySupply,
      [],
      false
    )
    .accounts({
      payer: payer.publicKey,
      authority,
      vault: vault.publicKey,
      mintPt,
      mintYt,
      escrowYt,
      escrowSy,
      mintSy: kaminoHandles.syMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      treasuryTokenAccount: treasuryAta,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      syProgram: adapterPid,
      addressLookupTable: alt,
      yieldPosition,
      metadata: ptMetadata,
      tokenMetadataProgram: METADATA_PROGRAM_ID,
    } as any)
    .remainingAccounts(remainingAccounts)
    .preInstructions([CU_LIMIT_IX])
    .signers([payer, vault])
    .rpc();

  return {
    vault,
    authority,
    mintPt,
    mintYt,
    escrowYt,
    escrowSy,
    yieldPosition,
    alt,
    treasuryAta,
    vaultPosition,
    curator,
  };
}

// ===== setupMarketOverKamino =====

export interface SetupMarketOverKaminoParams {
  core: Program<ClearstoneCore>;
  adapter: Program<KaminoSyAdapter>;
  connection: Connection;
  payer: Keypair;
  curator: PublicKey;
  vaultHandles: VaultHandles;
  kaminoHandles: KaminoSyHandles;
  seedId: number;
  ptInit: anchor.BN;
  syInit: anchor.BN;
  syExchangeRate: anchor.BN;
  lnFeeRateRoot: number;
  rateScalarRoot: number;
  initRateAnchor: number;
  feeTreasurySyBps: number;
  creatorFeeBps: number;
  ptSrc: PublicKey;
  sySrc: PublicKey;
}

export async function setupMarketOverKamino(
  params: SetupMarketOverKaminoParams
): Promise<MarketHandles> {
  const {
    core,
    adapter,
    connection,
    payer,
    curator,
    vaultHandles,
    kaminoHandles,
    seedId,
    ptInit,
    syInit,
    syExchangeRate,
    lnFeeRateRoot,
    rateScalarRoot,
    initRateAnchor,
    feeTreasurySyBps,
    creatorFeeBps,
    ptSrc,
    sySrc,
  } = params;

  const corePid = core.programId;
  const adapterPid = adapter.programId;

  const [market] = findMarket(vaultHandles.vault.publicKey, seedId, corePid);
  const [mintLp] = findMintLp(market, corePid);
  const [escrowPt] = findMarketEscrow(market, "escrow_pt", corePid);
  const [escrowSy] = findMarketEscrow(market, "escrow_sy", corePid);

  const [marketPosition] = findAdapterPersonalPosition(
    kaminoHandles.syMetadata,
    market,
    adapterPid
  );

  const lpDst = getAssociatedTokenAddressSync(mintLp, payer.publicKey);

  const tokenTreasuryFeeSy = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      kaminoHandles.syMint,
      payer.publicKey
    )
  ).address;

  const altAddresses = [
    market,
    kaminoHandles.syMetadata,
    kaminoHandles.syMint,
    escrowSy,
    kaminoHandles.poolEscrow,
    marketPosition,
    kaminoHandles.klendReserve,
    TOKEN_PROGRAM_ID,
  ];
  const alt = await createAndExtendAlt({ connection, payer, addresses: altAddresses });

  const cpiAccounts = buildKaminoAdapterCpiAccounts({
    owner: 0,
    syMetadata: 1,
    syMint: 2,
    ownerSy: 3,
    poolEscrow: 4,
    position: 5,
    klendReserve: 6,
    tokenProgram: 7,
  });

  const remainingAccounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: market, isSigner: false, isWritable: false },
    { pubkey: kaminoHandles.syMetadata, isSigner: false, isWritable: false },
    { pubkey: marketPosition, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: kaminoHandles.poolEscrow, isSigner: false, isWritable: true },
  ];

  await core.methods
    .initMarketTwo(
      lnFeeRateRoot,
      rateScalarRoot,
      initRateAnchor,
      numberFromU64(syExchangeRate) as any,
      ptInit,
      syInit,
      feeTreasurySyBps,
      cpiAccounts,
      seedId,
      curator,
      creatorFeeBps
    )
    .accounts({
      payer: payer.publicKey,
      market,
      vault: vaultHandles.vault.publicKey,
      mintSy: kaminoHandles.syMint,
      mintPt: vaultHandles.mintPt,
      mintLp,
      escrowPt,
      escrowSy,
      ptSrc,
      sySrc,
      lpDst,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      syProgram: adapterPid,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      addressLookupTable: alt,
      tokenTreasuryFeeSy,
    } as any)
    .remainingAccounts(remainingAccounts)
    .preInstructions([CU_LIMIT_IX])
    .signers([payer])
    .rpc();

  return {
    market,
    mintLp,
    escrowPt,
    escrowSy,
    escrowLp: PublicKey.default,
    lpDst,
    tokenTreasuryFeeSy,
    alt,
    marketPosition,
    curator,
    seedId,
  };
}

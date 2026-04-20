// Reusable test helpers for the Clearstone integration suite.
//
// PDA seeds here must track the Rust constants exactly:
//   - Vault-side seeds:    programs/clearstone_core/src/seeds.rs
//   - Adapter-side seeds:  reference_adapters/generic_exchange_rate_sy/src/lib.rs
//
// If either file changes its seed strings, update the mirrors below.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
  LAMPORTS_PER_SOL,
  AddressLookupTableProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Account as TokenAccountInfo,
} from "@solana/spl-token";

import type { GenericExchangeRateSy } from "../target/types/generic_exchange_rate_sy";
import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { MaliciousSyNonsense } from "../target/types/malicious_sy_nonsense";
import type { MaliciousSyReentrant } from "../target/types/malicious_sy_reentrant";

// ===== Seed constants =====

export const SEEDS = {
  // Adapter
  SY_MARKET: Buffer.from("sy_market"),
  SY_MINT: Buffer.from("sy_mint"),
  POOL_ESCROW: Buffer.from("pool_escrow"),
  PERSONAL_POSITION: Buffer.from("personal_position"),
  // Core
  AUTHORITY: Buffer.from("authority"),
  MINT_PT: Buffer.from("mint_pt"),
  MINT_YT: Buffer.from("mint_yt"),
  ESCROW_YT: Buffer.from("escrow_yt"),
  YIELD_POSITION: Buffer.from("yield_position"),
  MARKET: Buffer.from("market"),
} as const;

export const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// ===== Adapter PDA derivations =====

export function findSyMarket(
  baseMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.SY_MARKET, baseMint.toBuffer()],
    programId
  );
}

export function findSyMint(
  syMarket: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.SY_MINT, syMarket.toBuffer()],
    programId
  );
}

export function findBaseVault(
  syMarket: PublicKey,
  baseMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.POOL_ESCROW, syMarket.toBuffer(), baseMint.toBuffer()],
    programId
  );
}

export function findSyPoolEscrow(
  syMarket: PublicKey,
  syMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.POOL_ESCROW, syMarket.toBuffer(), syMint.toBuffer()],
    programId
  );
}

export function findPersonalPosition(
  syMarket: PublicKey,
  owner: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PERSONAL_POSITION, syMarket.toBuffer(), owner.toBuffer()],
    programId
  );
}

// ===== Core PDA derivations =====

export function findVaultAuthority(
  vault: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.AUTHORITY, vault.toBuffer()],
    programId
  );
}

export function findMintPt(
  vault: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.MINT_PT, vault.toBuffer()],
    programId
  );
}

export function findMintYt(
  vault: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.MINT_YT, vault.toBuffer()],
    programId
  );
}

export function findEscrowYt(
  vault: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ESCROW_YT, vault.toBuffer()],
    programId
  );
}

export function findYieldPosition(
  vault: PublicKey,
  authority: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.YIELD_POSITION, vault.toBuffer(), authority.toBuffer()],
    programId
  );
}

export function findMarket(
  vault: PublicKey,
  seedId: number,
  programId: PublicKey
): [PublicKey, number] {
  if (seedId === 0) throw new Error("seedId must be 1..=255");
  return PublicKey.findProgramAddressSync(
    [SEEDS.MARKET, vault.toBuffer(), Buffer.from([seedId])],
    programId
  );
}

export function findMintLp(
  market: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_lp"), market.toBuffer()],
    programId
  );
}

export function findMarketEscrow(
  market: PublicKey,
  seed: "escrow_pt" | "escrow_sy" | "escrow_lp",
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), market.toBuffer()],
    programId
  );
}

export function findPtMetadata(mintPt: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mintPt.toBuffer()],
    METADATA_PROGRAM_ID
  );
}

// ===== Token helpers =====

export async function createBaseMint(
  connection: Connection,
  payer: Keypair,
  decimals = 6
): Promise<PublicKey> {
  return createMint(connection, payer, payer.publicKey, null, decimals);
}

export async function createAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<TokenAccountInfo> {
  return getOrCreateAssociatedTokenAccount(connection, payer, mint, owner);
}

export async function mintToUser(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  destination: PublicKey,
  amount: number | bigint
): Promise<string> {
  return mintTo(connection, payer, mint, destination, mintAuthority, amount);
}

// ===== Number encoding (precise_number::Number = [u64; 4]) =====

/**
 * precise_number::Number is a tuple struct `Number([u64; 4])`. Anchor's
 * client SDK renders a single unnamed field as the inner value directly.
 * We pass `[bn0, bn1, bn2, bn3]`.
 *
 * For tests that only need "a positive number", use this helper — it
 * puts `n` in the low limb and zeros the rest.
 */
export function numberFromU64(n: anchor.BN | number | bigint): [anchor.BN, anchor.BN, anchor.BN, anchor.BN] {
  const bn =
    typeof n === "number"
      ? new anchor.BN(n)
      : typeof n === "bigint"
      ? new anchor.BN(n.toString())
      : n;
  return [bn, new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];
}

// ===== Adapter setup =====

export interface SyMarketHandles {
  syMarket: PublicKey;
  syMint: PublicKey;
  baseVault: PublicKey;
  poolEscrow: PublicKey;
  baseMint: PublicKey;
  authority: PublicKey;
}

export async function createSyMarket(params: {
  program: Program<GenericExchangeRateSy>;
  payer: Keypair;
  authority: Keypair;
  baseMint: PublicKey;
  initialExchangeRate: anchor.BN;
}): Promise<SyMarketHandles> {
  const { program, payer, authority, baseMint, initialExchangeRate } = params;
  const pid = program.programId;

  const [syMarket] = findSyMarket(baseMint, pid);
  const [syMint] = findSyMint(syMarket, pid);
  const [baseVault] = findBaseVault(syMarket, baseMint, pid);
  const [poolEscrow] = findSyPoolEscrow(syMarket, syMint, pid);

  await program.methods
    .initialize(numberFromU64(initialExchangeRate) as any)
    .accounts({
      payer: payer.publicKey,
      authority: authority.publicKey,
      baseMint,
      syMarket,
      syMint,
      baseVault,
      poolEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([payer])
    .rpc();

  return {
    syMarket,
    syMint,
    baseVault,
    poolEscrow,
    baseMint,
    authority: authority.publicKey,
  };
}

export async function mintSyForUser(params: {
  program: Program<GenericExchangeRateSy>;
  connection: Connection;
  user: Keypair;
  handles: SyMarketHandles;
  amountBase: anchor.BN;
}): Promise<PublicKey> {
  const { program, connection, user, handles, amountBase } = params;

  const syAta = await getOrCreateAssociatedTokenAccount(
    connection,
    user,
    handles.syMint,
    user.publicKey
  );
  const baseAta = getAssociatedTokenAddressSync(
    handles.baseMint,
    user.publicKey
  );

  await program.methods
    .mintSy(amountBase)
    .accounts({
      owner: user.publicKey,
      syMarket: handles.syMarket,
      baseMint: handles.baseMint,
      syMint: handles.syMint,
      baseSrc: baseAta,
      baseVault: handles.baseVault,
      syDst: syAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .signers([user])
    .rpc();

  return syAta.address;
}

export async function pokeExchangeRate(params: {
  program: Program<GenericExchangeRateSy>;
  authority: Keypair;
  handles: SyMarketHandles;
  newRate: anchor.BN;
}): Promise<void> {
  const { program, authority, handles, newRate } = params;
  await program.methods
    .pokeExchangeRate(numberFromU64(newRate) as any)
    .accounts({
      authority: authority.publicKey,
      syMarket: handles.syMarket,
    } as any)
    .signers([authority])
    .rpc();
}

// ===== Address Lookup Table =====

/**
 * Create a new ALT, extend with `addresses`, and wait for it to become
 * active. ALTs are usable one slot after creation — we sleep a bit to
 * let the validator tick past that slot.
 */
export async function createAndExtendAlt(params: {
  connection: Connection;
  payer: Keypair;
  addresses: PublicKey[];
}): Promise<PublicKey> {
  const { connection, payer, addresses } = params;

  const slot = await connection.getSlot("finalized");
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  const extendIx = AddressLookupTableProgram.extendLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    lookupTable: altAddress,
    addresses,
  });

  const tx = new Transaction().add(createIx, extendIx);
  await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });

  // ALT needs one slot before use. Poll until we've moved past the
  // creation slot.
  const creationSlot = slot;
  for (let i = 0; i < 40; i++) {
    const current = await connection.getSlot("confirmed");
    if (current > creationSlot + 1) return altAddress;
    await sleep(100);
  }
  throw new Error("ALT did not become active in time");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ===== CpiAccounts for the generic adapter =====

/**
 * Indices of the 7 accounts the adapter's SY CPI interface references,
 * within the caller's ALT.
 *
 * For a vault:   owner = vault authority PDA, ownerSy = vault.escrow_sy
 * For a market:  owner = market PDA,          ownerSy = market.token_sy_escrow
 */
export interface AdapterAltIndexes {
  owner: number;
  syMarket: number;
  syMint: number;
  ownerSy: number;
  poolEscrow: number;
  position: number;
  tokenProgram: number;
}

/**
 * Build the CpiAccounts struct for our generic_exchange_rate_sy adapter.
 * The `altIndex` values must match the account positions in the ALT the
 * caller created with createAndExtendAlt(...).
 *
 * The `is_writable` / `is_signer` flags must match the adapter's
 * #[derive(Accounts)] constraints (see reference_adapters/... src/lib.rs).
 */
export function buildAdapterCpiAccounts(idx: AdapterAltIndexes): any {
  const ctx = (altIndex: number, writable: boolean, signer = false) => ({
    altIndex,
    isSigner: signer,
    isWritable: writable,
  });
  return {
    getSyState: [ctx(idx.syMarket, false)],
    depositSy: [
      ctx(idx.owner, false, true), // owner: Signer
      ctx(idx.syMarket, false),
      ctx(idx.syMint, true),
      ctx(idx.ownerSy, true),
      ctx(idx.poolEscrow, true),
      ctx(idx.position, true),
      ctx(idx.tokenProgram, false),
    ],
    withdrawSy: [
      ctx(idx.owner, false, true),
      ctx(idx.syMarket, false),
      ctx(idx.syMint, true),
      ctx(idx.ownerSy, true),
      ctx(idx.poolEscrow, true),
      ctx(idx.position, true),
      ctx(idx.tokenProgram, false),
    ],
    claimEmission: [] as any[][], // no emissions on the generic adapter
    getPositionState: [
      ctx(idx.syMarket, false),
      ctx(idx.position, false),
    ],
  };
}

// ===== Vault setup =====

export interface VaultHandles {
  vault: Keypair;
  authority: PublicKey;
  mintPt: PublicKey;
  mintYt: PublicKey;
  escrowYt: PublicKey;
  escrowSy: PublicKey;
  yieldPosition: PublicKey;
  alt: PublicKey;
  treasuryAta: PublicKey;
  vaultPosition: PublicKey; // vault authority's position in the adapter
  curator: PublicKey;
}

export interface SetupVaultParams {
  core: Program<ClearstoneCore>;
  adapter: Program<GenericExchangeRateSy>;
  connection: Connection;
  payer: Keypair;
  curator: PublicKey;
  syHandles: SyMarketHandles;
  /** seconds since epoch; must be >= now. */
  startTimestamp: number;
  /** seconds; clearstone requires [MIN_DURATION_SECONDS, MAX_DURATION_SECONDS]. */
  duration: number;
  /** bps on interest collection. Must be <= creatorFeeBps. */
  interestBpsFee: number;
  /** permanent ceiling on interestBpsFee. Must be <= 2500. */
  creatorFeeBps: number;
  /** hard cap on PT/YT supply. */
  maxPySupply: anchor.BN;
  minOpSizeStrip: anchor.BN;
  minOpSizeMerge: anchor.BN;
}

export async function setupVault(params: SetupVaultParams): Promise<VaultHandles> {
  const {
    core,
    adapter,
    connection,
    payer,
    curator,
    syHandles,
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

  // Vault's SY escrow is an ATA of authority.
  const escrowSy = getAssociatedTokenAddressSync(
    syHandles.syMint,
    authority,
    true // allowOwnerOffCurve (authority is a PDA)
  );

  // Vault's position in the adapter (keyed by authority).
  const [vaultPosition] = findPersonalPosition(
    syHandles.syMarket,
    authority,
    adapterPid
  );

  // Treasury ATA — the payer is the fee recipient in tests.
  const treasuryAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      syHandles.syMint,
      payer.publicKey
    )
  ).address;

  // Build the ALT. Order here defines the alt_index values used in
  // buildAdapterCpiAccounts below.
  //
  // 0: owner (= vault authority)
  // 1: sy_market
  // 2: sy_mint
  // 3: ownerSy (= vault.escrow_sy, ATA of authority)
  // 4: pool_escrow (adapter's SY pool)
  // 5: vault's position in adapter
  // 6: token_program
  const altAddresses = [
    authority,
    syHandles.syMarket,
    syHandles.syMint,
    escrowSy,
    syHandles.poolEscrow,
    vaultPosition,
    TOKEN_PROGRAM_ID,
  ];
  const alt = await createAndExtendAlt({ connection, payer, addresses: altAddresses });

  const cpiAccounts = buildAdapterCpiAccounts({
    owner: 0,
    syMarket: 1,
    syMint: 2,
    ownerSy: 3,
    poolEscrow: 4,
    position: 5,
    tokenProgram: 6,
  });

  // remaining_accounts for init_personal_account (adapter side):
  //   [payer, owner, sy_market, position, system_program]
  const remainingAccounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: syHandles.syMarket, isSigner: false, isWritable: false },
    { pubkey: vaultPosition, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // Adapter's init_personal_account sees exactly the first 5; anything
    // past that goes into its own remaining_accounts and is ignored.
  ];

  await core.methods
    .initializeVault(
      startTimestamp,
      duration,
      interestBpsFee,
      cpiAccounts,
      minOpSizeStrip,
      minOpSizeMerge,
      "PT TEST",
      "tPT",
      "https://example.com/pt.json",
      curator,
      creatorFeeBps,
      maxPySupply
    )
    .accounts({
      payer: payer.publicKey,
      authority,
      vault: vault.publicKey,
      mintPt,
      mintYt,
      escrowYt,
      escrowSy,
      mintSy: syHandles.syMint,
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

// ===== Market setup =====

export interface MarketHandles {
  market: PublicKey;
  mintLp: PublicKey;
  escrowPt: PublicKey;
  escrowSy: PublicKey;
  escrowLp: PublicKey;
  lpDst: PublicKey;
  tokenTreasuryFeeSy: PublicKey;
  alt: PublicKey;
  marketPosition: PublicKey;
  curator: PublicKey;
  seedId: number;
}

export interface SetupMarketParams {
  core: Program<ClearstoneCore>;
  adapter: Program<GenericExchangeRateSy>;
  connection: Connection;
  payer: Keypair;
  curator: PublicKey;
  vaultHandles: VaultHandles;
  syHandles: SyMarketHandles;
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

export async function setupMarket(params: SetupMarketParams): Promise<MarketHandles> {
  const {
    core,
    adapter,
    connection,
    payer,
    curator,
    vaultHandles,
    syHandles,
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

  // Market's position in the adapter (keyed by market PDA).
  const [marketPosition] = findPersonalPosition(
    syHandles.syMarket,
    market,
    adapterPid
  );

  // Market's LP destination = payer's LP ATA (seeder receives the LP).
  const lpDst = getAssociatedTokenAddressSync(mintLp, payer.publicKey);

  // Fee treasury = payer's SY ATA.
  const tokenTreasuryFeeSy = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      syHandles.syMint,
      payer.publicKey
    )
  ).address;

  // ALT for market: owner = market, ownerSy = market's escrow_sy.
  const altAddresses = [
    market,
    syHandles.syMarket,
    syHandles.syMint,
    escrowSy,
    syHandles.poolEscrow,
    marketPosition,
    TOKEN_PROGRAM_ID,
  ];
  const alt = await createAndExtendAlt({ connection, payer, addresses: altAddresses });

  const cpiAccounts = buildAdapterCpiAccounts({
    owner: 0,
    syMarket: 1,
    syMint: 2,
    ownerSy: 3,
    poolEscrow: 4,
    position: 5,
    tokenProgram: 6,
  });

  // remaining_accounts combining init_personal_account (first 5
  // positionally) + extras deposit_sy needs that aren't in the outer ix.
  // Extras: pool_escrow (not passed elsewhere).
  const remainingAccounts = [
    // init_personal_account positional 5
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: market, isSigner: false, isWritable: false },
    { pubkey: syHandles.syMarket, isSigner: false, isWritable: false },
    { pubkey: marketPosition, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // Extras for deposit_sy CPI (filtered from regular+rem by matching pubkey).
    { pubkey: syHandles.poolEscrow, isSigner: false, isWritable: true },
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
      mintSy: syHandles.syMint,
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
    .signers([payer])
    .rpc();

  return {
    market,
    mintLp,
    escrowPt,
    escrowSy,
    escrowLp: PublicKey.default, // M4 removed escrow_lp from core
    lpDst,
    tokenTreasuryFeeSy,
    alt,
    marketPosition,
    curator,
    seedId,
  };
}

// ===== Nonsense-mock setup (for malicious-SY tests) =====
//
// The malicious_sy_nonsense mock has a much simpler SY interface (only
// `sy_market` in every CPI) and uses a different PDA scheme. These
// helpers stand up a vault wired to it so we can assert that the core's
// `validate_sy_state` rejects bad returns.

export interface NonsenseHandles {
  syMarket: PublicKey;
  syMint: PublicKey; // a sham SPL mint — nonsense doesn't actually have one, but the vault needs something.
  nonsenseProgramId: PublicKey;
}

export async function createNonsenseMarket(params: {
  nonsenseProgram: Program<MaliciousSyNonsense>;
  payer: Keypair;
  seedKey: Keypair; // any fresh keypair; becomes the PDA seed.
  mode: number;
  shamMint: PublicKey;
}): Promise<NonsenseHandles> {
  const { nonsenseProgram, payer, seedKey, mode, shamMint } = params;
  const [syMarket] = PublicKey.findProgramAddressSync(
    [Buffer.from("sy_market"), seedKey.publicKey.toBuffer()],
    nonsenseProgram.programId
  );
  await nonsenseProgram.methods
    .initialize(mode)
    .accounts({
      payer: payer.publicKey,
      seedKey: seedKey.publicKey,
      syMarket,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([payer])
    .rpc();
  return {
    syMarket,
    syMint: shamMint,
    nonsenseProgramId: nonsenseProgram.programId,
  };
}

export async function setNonsenseMode(params: {
  nonsenseProgram: Program<MaliciousSyNonsense>;
  syMarket: PublicKey;
  mode: number;
}): Promise<void> {
  await params.nonsenseProgram.methods
    .setMode(params.mode)
    .accounts({ syMarket: params.syMarket } as any)
    .rpc();
}

/** A minimal CpiAccounts for the nonsense mock — only sy_market needed. */
export function buildNonsenseCpiAccounts(syMarketAltIdx: number): any {
  const ctx = (altIndex: number, writable: boolean, signer = false) => ({
    altIndex,
    isSigner: signer,
    isWritable: writable,
  });
  return {
    getSyState: [ctx(syMarketAltIdx, false)],
    depositSy: [ctx(syMarketAltIdx, false)],
    withdrawSy: [ctx(syMarketAltIdx, false)],
    claimEmission: [] as any[][],
    getPositionState: [ctx(syMarketAltIdx, false)],
  };
}

export interface SetupVaultOverNonsenseParams {
  core: Program<ClearstoneCore>;
  nonsenseProgram: Program<MaliciousSyNonsense>;
  connection: Connection;
  payer: Keypair;
  curator: PublicKey;
  nonsense: NonsenseHandles;
  startTimestamp: number;
  duration: number;
  interestBpsFee: number;
  creatorFeeBps: number;
  maxPySupply: anchor.BN;
  minOpSizeStrip: anchor.BN;
  minOpSizeMerge: anchor.BN;
}

/**
 * Variant of setupVault wired to the nonsense mock. Returns the same
 * VaultHandles shape — fields related to the adapter's pool_escrow are
 * reused as sy_market (the nonsense mock's only account).
 */
export async function setupVaultOverNonsense(
  params: SetupVaultOverNonsenseParams
): Promise<VaultHandles> {
  const {
    core,
    nonsenseProgram,
    connection,
    payer,
    curator,
    nonsense,
    startTimestamp,
    duration,
    interestBpsFee,
    creatorFeeBps,
    maxPySupply,
    minOpSizeStrip,
    minOpSizeMerge,
  } = params;

  const corePid = core.programId;
  const vault = Keypair.generate();
  const [authority] = findVaultAuthority(vault.publicKey, corePid);
  const [mintPt] = findMintPt(vault.publicKey, corePid);
  const [mintYt] = findMintYt(vault.publicKey, corePid);
  const [escrowYt] = findEscrowYt(vault.publicKey, corePid);
  const [yieldPosition] = findYieldPosition(vault.publicKey, authority, corePid);
  const [ptMetadata] = findPtMetadata(mintPt);

  const escrowSy = getAssociatedTokenAddressSync(nonsense.syMint, authority, true);

  // Nonsense's personal_position PDA (different seed layout from generic).
  const [vaultPosition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("personal_position"),
      nonsense.syMarket.toBuffer(),
      authority.toBuffer(),
    ],
    nonsense.nonsenseProgramId
  );

  const treasuryAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      nonsense.syMint,
      payer.publicKey
    )
  ).address;

  // ALT: only sy_market needed.
  const alt = await createAndExtendAlt({
    connection,
    payer,
    addresses: [nonsense.syMarket],
  });
  const cpiAccounts = buildNonsenseCpiAccounts(0);

  const remainingAccounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: nonsense.syMarket, isSigner: false, isWritable: false },
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
      "PT NONSENSE",
      "tPTn",
      "https://example.com/pt.json",
      curator,
      creatorFeeBps,
      maxPySupply
    )
    .accounts({
      payer: payer.publicKey,
      authority,
      vault: vault.publicKey,
      mintPt,
      mintYt,
      escrowYt,
      escrowSy,
      mintSy: nonsense.syMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      treasuryTokenAccount: treasuryAta,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      syProgram: nonsense.nonsenseProgramId,
      addressLookupTable: alt,
      yieldPosition,
      metadata: ptMetadata,
      tokenMetadataProgram: METADATA_PROGRAM_ID,
    } as any)
    .remainingAccounts(remainingAccounts)
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

// ===== Core-ix helpers (strip / merge / trade_pt) =====

/**
 * The SY accounts that aren't in any core ix's regular_accounts — these
 * must be supplied via `remaining_accounts` so `do_deposit_sy` /
 * `do_withdraw_sy` / `do_get_sy_state` can filter+find them.
 *
 * We add them as read-only + non-signer flags; `do_*_sy` rebuilds the
 * AccountMeta flags from `CpiAccounts` (it reads pubkeys from our
 * remaining slots but builds fresh metas from the ALT context).
 */
function adapterExtraAccountsForVault(
  sy: SyMarketHandles,
  vaultPosition: PublicKey
) {
  return [
    { pubkey: sy.syMarket, isSigner: false, isWritable: false },
    { pubkey: sy.syMint, isSigner: false, isWritable: true },
    { pubkey: sy.poolEscrow, isSigner: false, isWritable: true },
    { pubkey: vaultPosition, isSigner: false, isWritable: true },
  ];
}

function adapterExtraAccountsForMarket(
  sy: SyMarketHandles,
  marketPosition: PublicKey
) {
  return [
    { pubkey: sy.syMarket, isSigner: false, isWritable: false },
    { pubkey: sy.syMint, isSigner: false, isWritable: true },
    { pubkey: sy.poolEscrow, isSigner: false, isWritable: true },
    { pubkey: marketPosition, isSigner: false, isWritable: true },
  ];
}

export interface StripArgs {
  core: Program<ClearstoneCore>;
  /** SY program ID (adapter, mock, whatever). */
  syProgram: PublicKey;
  depositor: Keypair;
  vault: VaultHandles;
  /** Depositor's SY source. */
  sySrc: PublicKey;
  ptDst: PublicKey;
  ytDst: PublicKey;
  amount: anchor.BN;
  /** Extra accounts for the SY CPI — adapter-specific. */
  extraAccounts: anchor.web3.AccountMeta[];
}

export async function strip(args: StripArgs): Promise<string> {
  const { core, syProgram, depositor, vault, sySrc, ptDst, ytDst, amount, extraAccounts } =
    args;

  return core.methods
    .strip(amount)
    .accounts({
      depositor: depositor.publicKey,
      authority: vault.authority,
      vault: vault.vault.publicKey,
      sySrc,
      escrowSy: vault.escrowSy,
      ytDst,
      ptDst,
      mintYt: vault.mintYt,
      mintPt: vault.mintPt,
      tokenProgram: TOKEN_PROGRAM_ID,
      addressLookupTable: vault.alt,
      syProgram,
      yieldPosition: vault.yieldPosition,
    } as any)
    .remainingAccounts(extraAccounts)
    .signers([depositor])
    .rpc();
}

/** Convenience wrapper around `strip` for the generic adapter. */
export async function stripWithGenericAdapter(args: {
  core: Program<ClearstoneCore>;
  adapter: Program<GenericExchangeRateSy>;
  depositor: Keypair;
  sy: SyMarketHandles;
  vault: VaultHandles;
  sySrc: PublicKey;
  ptDst: PublicKey;
  ytDst: PublicKey;
  amount: anchor.BN;
}): Promise<string> {
  return strip({
    core: args.core,
    syProgram: args.adapter.programId,
    depositor: args.depositor,
    vault: args.vault,
    sySrc: args.sySrc,
    ptDst: args.ptDst,
    ytDst: args.ytDst,
    amount: args.amount,
    extraAccounts: adapterExtraAccountsForVault(args.sy, args.vault.vaultPosition),
  });
}

export interface MergeArgs {
  core: Program<ClearstoneCore>;
  adapter: Program<GenericExchangeRateSy>;
  owner: Keypair;
  sy: SyMarketHandles;
  vault: VaultHandles;
  syDst: PublicKey;
  ytSrc: PublicKey;
  ptSrc: PublicKey;
  amount: anchor.BN;
}

export async function merge(args: MergeArgs): Promise<string> {
  const { core, adapter, owner, sy, vault, syDst, ytSrc, ptSrc, amount } = args;

  return core.methods
    .merge(amount)
    .accounts({
      owner: owner.publicKey,
      authority: vault.authority,
      vault: vault.vault.publicKey,
      syDst,
      escrowSy: vault.escrowSy,
      ytSrc,
      ptSrc,
      mintYt: vault.mintYt,
      mintPt: vault.mintPt,
      tokenProgram: TOKEN_PROGRAM_ID,
      syProgram: adapter.programId,
      addressLookupTable: vault.alt,
      yieldPosition: vault.yieldPosition,
    } as any)
    .remainingAccounts(adapterExtraAccountsForVault(sy, vault.vaultPosition))
    .signers([owner])
    .rpc();
}

export interface DepositLiquidityArgs {
  core: Program<ClearstoneCore>;
  adapter: Program<GenericExchangeRateSy>;
  depositor: Keypair;
  sy: SyMarketHandles;
  market: MarketHandles;
  tokenPtSrc: PublicKey;
  tokenSySrc: PublicKey;
  tokenLpDst: PublicKey;
  ptIntent: anchor.BN;
  syIntent: anchor.BN;
  minLpOut: anchor.BN;
}

export async function depositLiquidity(args: DepositLiquidityArgs): Promise<string> {
  const {
    core,
    adapter,
    depositor,
    sy,
    market,
    tokenPtSrc,
    tokenSySrc,
    tokenLpDst,
    ptIntent,
    syIntent,
    minLpOut,
  } = args;

  return core.methods
    .marketTwoDepositLiquidity(ptIntent, syIntent, minLpOut)
    .accounts({
      depositor: depositor.publicKey,
      market: market.market,
      tokenPtSrc,
      tokenSySrc,
      tokenPtEscrow: market.escrowPt,
      tokenSyEscrow: market.escrowSy,
      tokenLpDst,
      mintLp: market.mintLp,
      addressLookupTable: market.alt,
      tokenProgram: TOKEN_PROGRAM_ID,
      syProgram: adapter.programId,
    } as any)
    .remainingAccounts(adapterExtraAccountsForMarket(sy, market.marketPosition))
    .signers([depositor])
    .rpc();
}

export interface WithdrawLiquidityArgs {
  core: Program<ClearstoneCore>;
  adapter: Program<GenericExchangeRateSy>;
  withdrawer: Keypair;
  sy: SyMarketHandles;
  market: MarketHandles;
  tokenPtDst: PublicKey;
  tokenSyDst: PublicKey;
  tokenLpSrc: PublicKey;
  lpIn: anchor.BN;
  minPtOut: anchor.BN;
  minSyOut: anchor.BN;
}

export async function withdrawLiquidity(args: WithdrawLiquidityArgs): Promise<string> {
  const {
    core,
    adapter,
    withdrawer,
    sy,
    market,
    tokenPtDst,
    tokenSyDst,
    tokenLpSrc,
    lpIn,
    minPtOut,
    minSyOut,
  } = args;

  return core.methods
    .marketTwoWithdrawLiquidity(lpIn, minPtOut, minSyOut)
    .accounts({
      withdrawer: withdrawer.publicKey,
      market: market.market,
      tokenPtDst,
      tokenSyDst,
      tokenPtEscrow: market.escrowPt,
      tokenSyEscrow: market.escrowSy,
      tokenLpSrc,
      mintLp: market.mintLp,
      addressLookupTable: market.alt,
      tokenProgram: TOKEN_PROGRAM_ID,
      syProgram: adapter.programId,
    } as any)
    .remainingAccounts(adapterExtraAccountsForMarket(sy, market.marketPosition))
    .signers([withdrawer])
    .rpc();
}

export interface TradePtArgs {
  core: Program<ClearstoneCore>;
  adapter: Program<GenericExchangeRateSy>;
  trader: Keypair;
  sy: SyMarketHandles;
  market: MarketHandles;
  traderSy: PublicKey;
  traderPt: PublicKey;
  /** Positive = buy PT (user sends SY). Negative = sell PT. */
  netTraderPt: anchor.BN;
  /** Slippage bound on SY. See trade_pt.rs header for sign convention. */
  syConstraint: anchor.BN;
}

export async function tradePt(args: TradePtArgs): Promise<string> {
  const { core, adapter, trader, sy, market, traderSy, traderPt, netTraderPt, syConstraint } =
    args;

  return core.methods
    .tradePt(netTraderPt, syConstraint)
    .accounts({
      trader: trader.publicKey,
      market: market.market,
      tokenSyTrader: traderSy,
      tokenPtTrader: traderPt,
      tokenSyEscrow: market.escrowSy,
      tokenPtEscrow: market.escrowPt,
      addressLookupTable: market.alt,
      tokenProgram: TOKEN_PROGRAM_ID,
      syProgram: adapter.programId,
      tokenFeeTreasurySy: market.tokenTreasuryFeeSy,
    } as any)
    .remainingAccounts(adapterExtraAccountsForMarket(sy, market.marketPosition))
    .signers([trader])
    .rpc();
}

// ===== Reentrant-mock setup (for runtime reentrancy-guard tests) =====
//
// The malicious_sy_reentrant adapter re-invokes clearstone_core during
// its own deposit_sy / withdraw_sy. To let it do that, the vault
// creator wires CpiAccounts.deposit_sy / CpiAccounts.withdraw_sy to
// expose *every* account the inner core ix needs — including the core
// program itself and the depositor's signer AccountInfo.
//
// Modes (match MODE_* constants in the adapter):
//   0 = benign (behaves honestly)
//   1 = re-invoke core.strip during deposit_sy
//   2 = re-invoke core.merge  during withdraw_sy

export const REENTRANT_MODE_BENIGN = 0;
export const REENTRANT_MODE_REENTER_ON_DEPOSIT = 1;
export const REENTRANT_MODE_REENTER_ON_WITHDRAW = 2;

export interface ReentrantHandles {
  syMarket: PublicKey;
  syMint: PublicKey; // sham mint — adapter doesn't manage SY transfers.
  programId: PublicKey;
  seedKey: PublicKey;
}

export async function createReentrantMarket(params: {
  program: Program<MaliciousSyReentrant>;
  payer: Keypair;
  seedKey: Keypair;
  mode: number;
  shamMint: PublicKey;
}): Promise<ReentrantHandles> {
  const { program, payer, seedKey, mode, shamMint } = params;
  const [syMarket] = PublicKey.findProgramAddressSync(
    [Buffer.from("sy_market"), seedKey.publicKey.toBuffer()],
    program.programId
  );
  await program.methods
    .initialize(mode)
    .accounts({
      payer: payer.publicKey,
      seedKey: seedKey.publicKey,
      syMarket,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([payer])
    .rpc();
  return {
    syMarket,
    syMint: shamMint,
    programId: program.programId,
    seedKey: seedKey.publicKey,
  };
}

export async function setReentrantMode(params: {
  program: Program<MaliciousSyReentrant>;
  syMarket: PublicKey;
  mode: number;
}): Promise<void> {
  await params.program.methods
    .setMode(params.mode)
    .accounts({ syMarket: params.syMarket } as any)
    .rpc();
}

export interface SetupVaultOverReentrantParams {
  core: Program<ClearstoneCore>;
  reentrantProgram: Program<MaliciousSyReentrant>;
  connection: Connection;
  payer: Keypair;
  curator: PublicKey;
  reentrant: ReentrantHandles;
  /** Caller-provided vault keypair — needed because the PT/YT mint
   *  PDAs (which must appear in the ALT) are derived from the vault
   *  account. Pass a fresh keypair per vault. */
  vaultKeypair: Keypair;
  /** The depositor whose signer slot will flow into the adapter's
   *  reentrancy CPI. We must bake their pubkey into the vault ALT
   *  because deposit_sy's AccountMeta list references it by ALT index. */
  depositor: PublicKey;
  /** Depositor's SY ATA — also baked into the ALT (sy_src of strip). */
  depositorSyAta: PublicKey;
  /** Depositor's PT/YT ATAs (pt_dst / yt_dst of strip; pt_src / yt_src of merge). */
  depositorPtAta: PublicKey;
  depositorYtAta: PublicKey;
  startTimestamp: number;
  duration: number;
  interestBpsFee: number;
  creatorFeeBps: number;
  maxPySupply: anchor.BN;
  minOpSizeStrip: anchor.BN;
  minOpSizeMerge: anchor.BN;
}

/**
 * Stands up a vault over the reentrant mock. Unlike setupVault, the
 * ALT + CpiAccounts must pre-bake every account that the *inner* core
 * re-invocation will need — the reentrant adapter has no other source
 * of truth for those accounts.
 */
export async function setupVaultOverReentrant(
  params: SetupVaultOverReentrantParams
): Promise<VaultHandles> {
  const {
    core,
    reentrantProgram,
    connection,
    payer,
    curator,
    reentrant,
    vaultKeypair,
    depositor,
    depositorSyAta,
    depositorPtAta,
    depositorYtAta,
    startTimestamp,
    duration,
    interestBpsFee,
    creatorFeeBps,
    maxPySupply,
    minOpSizeStrip,
    minOpSizeMerge,
  } = params;
  void reentrantProgram;

  const corePid = core.programId;
  const vault = vaultKeypair;
  const [authority] = findVaultAuthority(vault.publicKey, corePid);
  const [mintPt] = findMintPt(vault.publicKey, corePid);
  const [mintYt] = findMintYt(vault.publicKey, corePid);
  const [escrowYt] = findEscrowYt(vault.publicKey, corePid);
  const [yieldPosition] = findYieldPosition(vault.publicKey, authority, corePid);
  const [ptMetadata] = findPtMetadata(mintPt);
  const escrowSy = getAssociatedTokenAddressSync(reentrant.syMint, authority, true);

  // Vault's position in the reentrant adapter (keyed by authority).
  const [vaultPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("personal_position"), reentrant.syMarket.toBuffer(), authority.toBuffer()],
    reentrant.programId
  );

  const treasuryAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      reentrant.syMint,
      payer.publicKey
    )
  ).address;

  // #[event_cpi] adds an event_authority PDA to every event-emitting ix.
  // It's derived as seeds = [b"__event_authority"], program = core.
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    corePid
  );

  // ALT — every pubkey the inner-core re-invocation needs must be here.
  // We pre-compute the alt address so we can include the ALT's own
  // pubkey in the extend list (needed because strip's
  // `address_lookup_table` account is the ALT itself).
  const slot = await connection.getSlot("finalized");
  const [createIx, alt] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  const altAddresses = [
    reentrant.syMarket, //  0  adapter's sy_market
    corePid,            //  1  core program (invoke target + event_cpi program)
    depositor,          //  2  depositor (outer strip's signer, mut)
    authority,          //  3  vault authority PDA
    vault.publicKey,    //  4  vault account
    depositorSyAta,     //  5  sy_src / sy_dst
    escrowSy,           //  6  vault escrow_sy
    depositorYtAta,     //  7  yt_dst / yt_src
    depositorPtAta,     //  8  pt_dst / pt_src
    mintYt,             //  9
    mintPt,             // 10
    TOKEN_PROGRAM_ID,   // 11
    alt,                // 12  ALT-self (strip's address_lookup_table)
    reentrant.programId,// 13  sy_program (adapter)
    yieldPosition,      // 14
    eventAuthority,     // 15
  ];
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    lookupTable: alt,
    addresses: altAddresses,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createIx, extendIx),
    [payer],
    { commitment: "confirmed" }
  );
  // Wait past the creation slot so the ALT is usable.
  for (let i = 0; i < 40; i++) {
    const current = await connection.getSlot("confirmed");
    if (current > slot + 1) break;
    await sleep(100);
  }
  const ALT_INDEX_OF_SELF = 12;

  const ctx = (altIndex: number, writable: boolean, signer = false) => ({
    altIndex,
    isSigner: signer,
    isWritable: writable,
  });

  // CpiAccounts.deposit_sy: adapter's first typed slot (sy_market) +
  // everything core.strip needs in the strip account order +
  // core_program as slot-1 of adapter's remaining_accounts so
  // reinvoke_u64 can pull it off.
  const depositSyList = [
    ctx(0, false),                 // sy_market (adapter typed field)
    ctx(1, false),                 // core_program (invoke target, first of rem_accounts)
    // vvv core.strip account list vvv
    ctx(2, true, true),            // depositor (signer, mut)
    ctx(3, true),                  // authority (mut)
    ctx(4, true),                  // vault (mut)
    ctx(5, true),                  // sy_src (mut)
    ctx(6, true),                  // escrow_sy (mut)
    ctx(7, true),                  // yt_dst (mut)
    ctx(8, true),                  // pt_dst (mut)
    ctx(9, true),                  // mint_yt (mut)
    ctx(10, true),                 // mint_pt (mut)
    ctx(11, false),                // token_program
    ctx(ALT_INDEX_OF_SELF, false), // address_lookup_table
    ctx(13, false),                // sy_program (the adapter itself)
    ctx(14, true),                 // yield_position (mut)
    ctx(15, false),                // event_authority
    ctx(1, false),                 // program (event_cpi "program" field = core)
  ];

  // CpiAccounts.withdraw_sy: adapter's first slot + core.merge accounts.
  // merge's order differs slightly from strip — see merge.rs:
  //   owner, authority, vault, sy_dst, escrow_sy, yt_src, pt_src,
  //   mint_yt, mint_pt, token_program, sy_program, address_lookup_table,
  //   yield_position, event_authority, program
  const withdrawSyList = [
    ctx(0, false),                 // sy_market
    ctx(1, false),                 // core_program (invoke target)
    ctx(2, true, true),            // owner (signer, mut)
    ctx(3, true),                  // authority (mut)
    ctx(4, true),                  // vault (mut)
    ctx(5, true),                  // sy_dst (= same ATA as sy_src)
    ctx(6, true),                  // escrow_sy (mut)
    ctx(7, true),                  // yt_src (mut)
    ctx(8, true),                  // pt_src (mut)
    ctx(9, true),                  // mint_yt (mut)
    ctx(10, true),                 // mint_pt (mut)
    ctx(11, false),                // token_program
    ctx(13, false),                // sy_program
    ctx(ALT_INDEX_OF_SELF, false), // address_lookup_table
    ctx(14, true),                 // yield_position (mut)
    ctx(15, false),                // event_authority
    ctx(1, false),                 // program
  ];

  // Minimal get_sy_state list (just sy_market; adapter's NoOpSyMarket
  // only has one typed field).
  const getSyStateList = [ctx(0, false)];

  const cpiAccounts = {
    getSyState: getSyStateList,
    depositSy: depositSyList,
    withdrawSy: withdrawSyList,
    claimEmission: [] as any[][],
    getPositionState: [ctx(0, false)],
  };

  // init_personal_account remaining_accounts for the adapter.
  const remainingAccounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: reentrant.syMarket, isSigner: false, isWritable: false },
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
      "PT REENTRANT",
      "tPTr",
      "https://example.com/pt.json",
      curator,
      creatorFeeBps,
      maxPySupply
    )
    .accounts({
      payer: payer.publicKey,
      authority,
      vault: vault.publicKey,
      mintPt,
      mintYt,
      escrowYt,
      escrowSy,
      mintSy: reentrant.syMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      treasuryTokenAccount: treasuryAta,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      syProgram: reentrant.programId,
      addressLookupTable: alt,
      yieldPosition,
      metadata: ptMetadata,
      tokenMetadataProgram: METADATA_PROGRAM_ID,
    } as any)
    .remainingAccounts(remainingAccounts)
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

// ===== Convenience =====

export interface FullStack {
  syHandles: SyMarketHandles;
  vault: VaultHandles;
  market: MarketHandles;
}

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID };

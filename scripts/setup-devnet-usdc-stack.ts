// scripts/setup-devnet-usdc-stack.ts — stand up a USDC PT/YT vault + market +
// curator allocation on devnet using `generic_exchange_rate_sy` as the SY
// adapter (Kamino path is blocked on the adapter-vs-real-klend CPI mismatch;
// see deployments/devnet-vault-init.md "blocker" notes).
//
// Picks up the already-initialized curator vault at
//   curator=AhKNm, base=USDC(2tboZ672z…) → vault=Fv8WuFXp…
// (created by clearstone-finance/scripts/setup-devnet-curator-vault.ts) and
// wires a fresh SY/PT/YT/market underneath it, then sets allocations.
//
// Idempotent on the SY market (the [sy_market, base_mint] PDA is keyed by
// base mint; if it already exists, skip the init). Vault + market always
// fresh because they're keyed on a generated `vault` keypair / a `seedId`.
//
// Run:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=$HOME/.config/solana/id.json \
//   yarn run tsx scripts/setup-devnet-usdc-stack.ts

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import {
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { ClearstoneCurator } from "../target/types/clearstone_curator";
import type { ClearstoneRouter } from "../target/types/clearstone_router";
import type { GenericExchangeRateSy } from "../target/types/generic_exchange_rate_sy";
import {
  createSyMarket,
  mintSyForUser,
  setupVault,
  setupMarket,
  stripWithGenericAdapter,
  findSyMarket,
  findSyMint,
  findBaseVault,
  findSyPoolEscrow,
  findCuratorVault,
  findBaseEscrow,
  findUserPos,
  CU_LIMIT_IX,
} from "../tests/fixtures";

// ---------- config ----------

// USDC mint the live curator vault is bound to (klend reserve's liquidity
// mint per clearstone-finance/.../market-deployed.json). 6 decimals; mint
// authority is the deployer wallet (AhKNm…).
const USDC_MINT = new PublicKey("2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G");

// Demo seeding amounts (all 6dp).
const SEED_USDC = 200_000_000n;          // 200 USDC total minted to payer if balance < this
const SY_SEED = new BN(50_000_000);      // 50 USDC → SY for vault + market seed
const STRIP_AMOUNT = new BN(20_000_000); // 20 SY stripped → 20 PT + 20 YT
const PT_INIT = new BN(2_000_000);       // 2 PT into AMM
const SY_INIT = new BN(2_000_000);       // 2 SY into AMM
const CURATOR_DEPOSIT = new BN(100_000_000); // 100 USDC into the curator vault
const CURATOR_REALLOC = new BN(20_000_000);  // 20 USDC into the market via the curator
const ALLOC_CAP = new BN(1_000_000_000);     // 1k USDC cap

// ---------- provider ----------

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;

const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const adapter = anchor.workspace
  .genericExchangeRateSy as Program<GenericExchangeRateSy>;
const curator = anchor.workspace.clearstoneCurator as Program<ClearstoneCurator>;
const router = anchor.workspace.clearstoneRouter as Program<ClearstoneRouter>;

function banner(msg: string) {
  console.log(`\n=== ${msg} ===`);
}
function log(label: string, val: PublicKey | string | number | bigint) {
  console.log(`  ${label.padEnd(28)} ${val.toString()}`);
}

async function readClockTs(connection: Connection): Promise<number> {
  const acc = await connection.getAccountInfo(
    anchor.web3.SYSVAR_CLOCK_PUBKEY,
    "confirmed"
  );
  if (!acc) throw new Error("Clock sysvar missing");
  return Number(acc.data.readBigInt64LE(32));
}

async function ensureUsdcBalance(): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    USDC_MINT,
    payer.publicKey
  );
  if (ata.amount < SEED_USDC) {
    const need = SEED_USDC - ata.amount;
    log("minting test USDC", need);
    await mintTo(provider.connection, payer, USDC_MINT, ata.address, payer, need);
  }
  return ata.address;
}

// ---------- main ----------

async function main() {
  banner("0. context");
  log("payer", payer.publicKey);
  log("rpc", provider.connection.rpcEndpoint);
  log("base mint (USDC)", USDC_MINT);
  const bal = await provider.connection.getBalance(payer.publicKey);
  log("payer SOL", bal / LAMPORTS_PER_SOL);

  // (1) USDC balance for payer
  banner("1. USDC balance");
  const payerUsdcAta = await ensureUsdcBalance();
  const usdcInfo = await getAccount(provider.connection, payerUsdcAta);
  log("payer USDC ATA", payerUsdcAta);
  log("payer USDC balance", usdcInfo.amount);

  // (2) SY market over USDC (generic_exchange_rate_sy) — idempotent
  banner("2. SY market (generic_exchange_rate_sy over USDC)");
  const [syMarketPda] = findSyMarket(USDC_MINT, adapter.programId);
  const [syMintPda] = findSyMint(syMarketPda, adapter.programId);
  const [baseVaultPda] = findBaseVault(syMarketPda, USDC_MINT, adapter.programId);
  const [poolEscrowPda] = findSyPoolEscrow(syMarketPda, syMintPda, adapter.programId);

  let sy: {
    syMarket: PublicKey;
    syMint: PublicKey;
    baseVault: PublicKey;
    poolEscrow: PublicKey;
    baseMint: PublicKey;
    authority: PublicKey;
  };
  const existing = await provider.connection.getAccountInfo(syMarketPda);
  if (existing) {
    log("sy_market", `${syMarketPda.toBase58()} (reusing existing)`);
    sy = {
      syMarket: syMarketPda,
      syMint: syMintPda,
      baseVault: baseVaultPda,
      poolEscrow: poolEscrowPda,
      baseMint: USDC_MINT,
      authority: payer.publicKey,
    };
  } else {
    sy = await createSyMarket({
      program: adapter,
      payer,
      authority: payer,
      baseMint: USDC_MINT,
      initialExchangeRate: new BN(1),
    });
    log("sy_market (new)", sy.syMarket);
  }
  log("sy_mint", sy.syMint);
  log("sy_base_vault", sy.baseVault);
  log("sy_pool_escrow", sy.poolEscrow);

  const payerSyAta = await mintSyForUser({
    program: adapter,
    connection: provider.connection,
    user: payer,
    handles: sy,
    amountBase: SY_SEED,
  });
  log("payer SY ATA", payerSyAta);

  // (3) core PT/YT vault over the SY
  banner("3. core PT/YT vault (clearstone_core)");
  const now = await readClockTs(provider.connection);
  const vault = await setupVault({
    core,
    adapter,
    connection: provider.connection,
    payer,
    curator: payer.publicKey,
    syHandles: sy,
    startTimestamp: now,
    duration: 86_400 * 30, // 30 days
    interestBpsFee: 100,
    creatorFeeBps: 500,
    maxPySupply: new BN("1000000000000"),
    minOpSizeStrip: new BN(1),
    minOpSizeMerge: new BN(1),
  });
  log("vault", vault.vault.publicKey);
  log("mint_pt", vault.mintPt);
  log("mint_yt", vault.mintYt);

  // (4) strip seed PT
  banner("4. strip seed PT");
  const payerPtAta = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, vault.mintPt, payer.publicKey
  );
  const payerYtAta = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, vault.mintYt, payer.publicKey
  );
  await stripWithGenericAdapter({
    core, adapter,
    depositor: payer, sy, vault,
    sySrc: payerSyAta,
    ptDst: payerPtAta.address,
    ytDst: payerYtAta.address,
    amount: STRIP_AMOUNT,
  });
  log("payer PT", (await getAccount(provider.connection, payerPtAta.address)).amount);
  log("payer YT", (await getAccount(provider.connection, payerYtAta.address)).amount);

  // (5) AMM market
  banner("5. core PT/SY market");
  const market = await setupMarket({
    core, adapter,
    connection: provider.connection,
    payer,
    curator: payer.publicKey,
    vaultHandles: vault,
    syHandles: sy,
    seedId: 1,
    ptInit: PT_INIT,
    syInit: SY_INIT,
    syExchangeRate: new BN(1),
    lnFeeRateRoot: 0.001,
    rateScalarRoot: 1.0,
    initRateAnchor: 1.05,
    feeTreasurySyBps: 200,
    creatorFeeBps: 500,
    ptSrc: payerPtAta.address,
    sySrc: payerSyAta,
  });
  log("market", market.market);
  log("mint_lp", market.mintLp);
  log("market_alt", market.alt);

  // (6) wire the existing curator vault: deposit + set_allocations + reallocate
  banner("6. existing curator vault → set_allocations + reallocate");
  const [curatorVault] = findCuratorVault(payer.publicKey, USDC_MINT, curator.programId);
  const [curatorBaseEscrow] = findBaseEscrow(curatorVault, curator.programId);
  log("curator_vault", curatorVault);
  log("base_escrow", curatorBaseEscrow);

  const cvExisting = await provider.connection.getAccountInfo(curatorVault);
  if (!cvExisting) {
    throw new Error(
      `Curator vault ${curatorVault.toBase58()} not found — run ` +
        `clearstone-finance/scripts/setup-devnet-curator-vault.ts first.`
    );
  }

  // 6a. Deposit
  const [depositorPos] = findUserPos(curatorVault, payer.publicKey, curator.programId);
  const posExisting = await provider.connection.getAccountInfo(depositorPos);
  if (!posExisting) {
    await curator.methods
      .deposit(CURATOR_DEPOSIT)
      .accounts({
        owner: payer.publicKey,
        vault: curatorVault,
        baseMint: USDC_MINT,
        baseSrc: payerUsdcAta,
        baseEscrow: curatorBaseEscrow,
        position: depositorPos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .rpc();
    log("deposit", `${CURATOR_DEPOSIT.toString()} (USDC microunits)`);
  } else {
    log("position", "already exists, skipping deposit");
  }

  // 6b. set_allocations
  await curator.methods
    .setAllocations([
      {
        market: market.market,
        weightBps: 10_000,
        capBase: ALLOC_CAP,
        deployedBase: new BN(0),
      },
    ])
    .accounts({
      curator: payer.publicKey,
      vault: curatorVault,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  log("set_allocations", "1 entry, weight=10000bps");

  // 6c. reallocate_to_market — push 20 USDC from idle escrow into the market
  const vaultSyAta = getAssociatedTokenAddressSync(sy.syMint, curatorVault, true);
  const vaultPtAta = getAssociatedTokenAddressSync(vault.mintPt, curatorVault, true);
  const vaultLpAta = getAssociatedTokenAddressSync(market.mintLp, curatorVault, true);

  const [coreEventAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    core.programId
  );

  await curator.methods
    .reallocateToMarket(
      0,                       // allocation_index
      CURATOR_REALLOC,         // base_in
      new BN(10_000),          // min_pt_out (loose; only seed)
      CURATOR_REALLOC.neg(),   // sy_constraint
      new BN(10_000),          // min_lp_out
      new BN(10_000),          // min_pt_into_amm
      new BN(1)                // min_sy_into_amm
    )
    .accounts({
      curator: payer.publicKey,
      vault: curatorVault,
      baseMint: USDC_MINT,
      baseEscrow: curatorBaseEscrow,
      syMarket: sy.syMarket,
      syMint: sy.syMint,
      adapterBaseVault: sy.baseVault,
      vaultSyAta,
      market: market.market,
      marketEscrowPt: market.escrowPt,
      marketEscrowSy: market.escrowSy,
      tokenFeeTreasurySy: market.tokenTreasuryFeeSy,
      marketAlt: market.alt,
      mintPt: vault.mintPt,
      mintLp: market.mintLp,
      vaultPtAta,
      vaultLpAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      syProgram: adapter.programId,
      coreProgram: core.programId,
      coreEventAuthority: coreEventAuth,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .remainingAccounts([
      { pubkey: sy.syMarket, isSigner: false, isWritable: false },
      { pubkey: sy.syMint, isSigner: false, isWritable: true },
      { pubkey: sy.poolEscrow, isSigner: false, isWritable: true },
      { pubkey: market.marketPosition, isSigner: false, isWritable: true },
    ])
    .preInstructions([CU_LIMIT_IX])
    .rpc();

  // 6d. mark_to_market so deployed_base reflects on-chain value
  await curator.methods
    .markToMarket(0)
    .accounts({
      vault: curatorVault,
      baseEscrow: curatorBaseEscrow,
      market: market.market,
      coreVault: vault.vault.publicKey,
      marketEscrowPt: market.escrowPt,
      marketEscrowSy: market.escrowSy,
      mintLp: market.mintLp,
      mintPt: vault.mintPt,
      vaultPtAta,
      syMint: sy.syMint,
      vaultSyAta,
      vaultLpAta,
    } as any)
    .rpc();

  const cvAcct = await curator.account.curatorVault.fetch(curatorVault);
  log("curator deployed_base[0]", cvAcct.allocations[0].deployedBase.toString());
  log("curator total_assets", cvAcct.totalAssets.toString());
  log("curator total_shares", cvAcct.totalShares.toString());

  // (7) summary — paste into devnet.json canonicalStack
  banner("7. canonical handles (USDC stack)");
  console.log(JSON.stringify({
    baseMint: USDC_MINT.toBase58(),
    syMarket: sy.syMarket.toBase58(),
    syMint: sy.syMint.toBase58(),
    syBaseVault: sy.baseVault.toBase58(),
    syPoolEscrow: sy.poolEscrow.toBase58(),
    vault: vault.vault.publicKey.toBase58(),
    vaultAuthority: vault.authority.toBase58(),
    mintPt: vault.mintPt.toBase58(),
    mintYt: vault.mintYt.toBase58(),
    market: market.market.toBase58(),
    mintLp: market.mintLp.toBase58(),
    marketEscrowPt: market.escrowPt.toBase58(),
    marketEscrowSy: market.escrowSy.toBase58(),
    marketAlt: market.alt.toBase58(),
    curatorVault: curatorVault.toBase58(),
    curatorBaseEscrow: curatorBaseEscrow.toBase58(),
    deployedBase: cvAcct.allocations[0].deployedBase.toString(),
    totalAssets: cvAcct.totalAssets.toString(),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

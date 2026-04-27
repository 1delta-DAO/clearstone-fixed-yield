// scripts/setup-devnet-usdc-stack-kamino.ts — Kamino-SY variant of the
// USDC stack. Hooks into the LIVE kamino_sy_adapter SY metadata
// (initialized by clearstone-finance/scripts/setup-devnet-curator-vault.ts
// against Solstice USDC + reserve AYhwFL…) and stands up:
//   1. PT/YT vault over the Kamino SY (setupVaultOverKamino)
//   2. PT/SY AMM (setupMarketOverKamino)
//   3. set_allocations on the live curator vault BDe2V5Ux…
//
// Runs idempotent-ish — re-issuing tx for the vault/market is fresh each
// run (vault keypair generated; market seedId is auto-incremented by
// trying seedId=1 first and bumping if it already exists). The kamino
// SY handles are loaded from the live metadata PDA.
//
// Skips reallocate_to_market — that path requires the curator program
// to forward the 8 new real-klend optional accounts in its mint_sy CPI.
// The currently-deployed curator predates the kamino adapter upgrade
// and doesn't forward them; addressing that is a separate followup.
//
// Run:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=$HOME/.config/solana/id.json \
//   yarn run tsx scripts/setup-devnet-usdc-stack-kamino.ts

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Connection,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { ClearstoneCurator } from "../target/types/clearstone_curator";
import type { KaminoSyAdapter } from "../target/types/kamino_sy_adapter";
import {
  setupVaultOverKamino,
  setupMarketOverKamino,
  kaminoAdapterExtraAccountsForVault,
  KaminoSyHandles,
} from "../tests/kamino_fixtures";
import {
  strip,
  findCuratorVault,
  findBaseEscrow,
  CU_LIMIT_IX,
} from "../tests/fixtures";

// ---------- live config ----------

const USDC_MINT = new PublicKey("8iBux2LRja1PhVZph8Rw4Hi45pgkaufNEiaZma5nTD5g");
const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const KLEND_RESERVE = new PublicKey("AYhwFLgzxWwqznhxv6Bg1NVnNeoDNu9SBGLzM1W3hSfb");
const PYTH = new PublicKey("EN2FsFZFdpiFAWpKDZqeJ2PY8EyE7xzz9Ew8ZQVhtHCJ");

// PDAs initialized by setup-devnet-curator-vault.ts.
const SY_METADATA = new PublicKey("7F6vSabYg9eke3iPbzsBigX9FL2e9JZS2rZN57V9Sja2");
const SY_MINT = new PublicKey("2vyiNved2xwKortbH1fERsWPjZLijtiJBaqoqT96EsGX");
const COLL_VAULT = new PublicKey("DVaaxn11tDrVXuAYBfqfuRtnRVEH6RJFEmVg68eJp6Ac");
const POOL_ESCROW = new PublicKey("8cubBJT1WYyEUSfPWEcoy84EptgoCsjdy5uKqJt5S4VY");
const KUSDC = new PublicKey("74Wcd7VSUjK4wABMF15Kc4fYqiPDNj4NmE9MMSUR3AJv");
const CURATOR_VAULT = new PublicKey("BDe2V5UxMEpJjb4H5UbLPK5UAsi1jUaUs2zx62YiCrZo");

// Seed amounts.
const SY_SEED = 5_000_000n;            // 5 USDC → SY for vault + market
const STRIP_AMOUNT = new BN(2_000_000); // 2 SY → 2 PT + 2 YT
const PT_INIT = new BN(500_000);        // 0.5 PT into AMM
const SY_INIT = new BN(500_000);        // 0.5 SY into AMM
const ALLOC_CAP = new BN(1_000_000_000);

// ---------- provider ----------

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;

const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const adapter = anchor.workspace.kaminoSyAdapter as Program<KaminoSyAdapter>;
const curator = anchor.workspace.clearstoneCurator as Program<ClearstoneCurator>;

function banner(msg: string) {
  console.log(`\n=== ${msg} ===`);
}
function log(label: string, val: PublicKey | string | number | bigint) {
  console.log(`  ${label.padEnd(28)} ${val.toString()}`);
}

// ---------- real-klend mint_sy (hand-rolled) ----------
// adapter.mintSy via Anchor builder doesn't currently know about the 8 new
// optional klend accounts — fixture's `mintSyKamino` passes them as null,
// which forces the mock-klend code path. For real klend, we hand-build.

async function mintSyRealKlend(amountUnderlying: bigint): Promise<{ syAta: PublicKey }> {
  const reserveInfo = (await provider.connection.getAccountInfo(KLEND_RESERVE))!;
  const lendingMarket = new PublicKey(reserveInfo.data.subarray(32, 64));
  const liquiditySupply = new PublicKey(reserveInfo.data.subarray(160, 192));
  const [lma] = PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), lendingMarket.toBuffer()],
    KLEND
  );

  const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, payer.publicKey);
  const userSy = getAssociatedTokenAddressSync(SY_MINT, payer.publicKey);

  // mint_sy disc = [1] (override)
  const data = Buffer.alloc(9);
  data[0] = 1;
  data.writeBigUInt64LE(amountUnderlying, 1);

  const ix = new TransactionInstruction({
    programId: adapter.programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SY_METADATA, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SY_MINT, isSigner: false, isWritable: true },
      { pubkey: userUsdc, isSigner: false, isWritable: true },
      { pubkey: userSy, isSigner: false, isWritable: true },
      { pubkey: COLL_VAULT, isSigner: false, isWritable: true },
      { pubkey: KLEND_RESERVE, isSigner: false, isWritable: true },
      { pubkey: liquiditySupply, isSigner: false, isWritable: true },
      { pubkey: KUSDC, isSigner: false, isWritable: true },
      { pubkey: KLEND, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // 8 new optional accounts:
      { pubkey: lendingMarket, isSigner: false, isWritable: false },
      { pubkey: lma, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PYTH, isSigner: false, isWritable: false },
      { pubkey: KLEND, isSigner: false, isWritable: false }, // sb_price sentinel
      { pubkey: KLEND, isSigner: false, isWritable: false }, // sb_twap sentinel
      { pubkey: KLEND, isSigner: false, isWritable: false }, // scope sentinel
    ],
    data,
  });

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      userSy,
      payer.publicKey,
      SY_MINT
    ),
    ix
  );
  await sendAndConfirmTransaction(provider.connection, tx, [payer], {
    commitment: "confirmed",
  });
  return { syAta: userSy };
}

async function readClockTs(connection: Connection): Promise<number> {
  const acc = await connection.getAccountInfo(
    anchor.web3.SYSVAR_CLOCK_PUBKEY,
    "confirmed"
  );
  if (!acc) throw new Error("Clock sysvar missing");
  return Number(acc.data.readBigInt64LE(32));
}

// ---------- main ----------

async function main() {
  banner("0. context");
  log("payer", payer.publicKey);
  log("rpc", provider.connection.rpcEndpoint);
  const bal = await provider.connection.getBalance(payer.publicKey);
  log("payer SOL", bal / LAMPORTS_PER_SOL);
  log("base mint (Solstice USDC)", USDC_MINT);
  log("klend reserve", KLEND_RESERVE);
  log("kamino sy_metadata", SY_METADATA);
  log("kamino sy_mint", SY_MINT);
  log("curator_vault (live)", CURATOR_VAULT);

  // Construct KaminoSyHandles from live state.
  const reserveInfo = (await provider.connection.getAccountInfo(KLEND_RESERVE))!;
  const klendLendingMarket = new PublicKey(reserveInfo.data.subarray(32, 64));
  const klendLiquiditySupply = new PublicKey(reserveInfo.data.subarray(160, 192));
  const kaminoHandles: KaminoSyHandles = {
    syMetadata: SY_METADATA,
    syMint: SY_MINT,
    collateralVault: COLL_VAULT,
    poolEscrow: POOL_ESCROW,
    underlyingMint: USDC_MINT,
    klendReserve: KLEND_RESERVE,
    klendLendingMarket,
    klendCollateralMint: KUSDC,
    klendLiquiditySupply,
    klendProgramId: KLEND,
    adapterProgramId: adapter.programId,
    curator: payer.publicKey,
  };

  // (1) Mint SY for the seed.
  banner("1. mint SY (real-klend mint_sy)");
  const userUsdcAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    USDC_MINT,
    payer.publicKey
  );
  const usdcBefore = userUsdcAta.amount;
  log("USDC before", usdcBefore);
  const { syAta: payerSyAta } = await mintSyRealKlend(SY_SEED);
  const sy = await getAccount(provider.connection, payerSyAta);
  log("payer SY", sy.amount);

  // (2) Core PT/YT vault over Kamino SY.
  banner("2. core PT/YT vault (setupVaultOverKamino)");
  const now = await readClockTs(provider.connection);
  const vault = await setupVaultOverKamino({
    core,
    adapter,
    connection: provider.connection,
    payer,
    curator: payer.publicKey,
    kaminoHandles,
    startTimestamp: now,
    duration: 86_400 * 30,
    interestBpsFee: 100,
    creatorFeeBps: 500,
    maxPySupply: new BN("1000000000000"),
    minOpSizeStrip: new BN(1),
    minOpSizeMerge: new BN(1),
  });
  log("vault", vault.vault.publicKey);
  log("mint_pt", vault.mintPt);
  log("mint_yt", vault.mintYt);
  log("alt", vault.alt);

  // (3) Strip seed PT.
  banner("3. strip seed PT (kamino-flavored)");
  const payerPtAta = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, vault.mintPt, payer.publicKey
  );
  const payerYtAta = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, vault.mintYt, payer.publicKey
  );
  await strip({
    core,
    syProgram: adapter.programId,
    depositor: payer,
    vault,
    sySrc: payerSyAta,
    ptDst: payerPtAta.address,
    ytDst: payerYtAta.address,
    mintSy: kaminoHandles.syMint,
    amount: STRIP_AMOUNT,
    extraAccounts: kaminoAdapterExtraAccountsForVault(
      kaminoHandles,
      vault.vaultPosition
    ),
  });
  const ptBal = (await getAccount(provider.connection, payerPtAta.address)).amount;
  const ytBal = (await getAccount(provider.connection, payerYtAta.address)).amount;
  log("payer PT", ptBal);
  log("payer YT", ytBal);

  // (4) AMM market.
  banner("4. core PT/SY market (setupMarketOverKamino)");
  const market = await setupMarketOverKamino({
    core,
    adapter,
    connection: provider.connection,
    payer,
    curator: payer.publicKey,
    vaultHandles: vault,
    kaminoHandles,
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

  // (5) Curator allocation — set_allocations is idempotent for our case
  // (the existing vault already has 1 entry from a prior run; this re-issues
  // it with the new market PDA — order matters for downstream reallocate).
  banner("5. set_allocations on live curator vault");
  const cvBefore = await curator.account.curatorVault.fetch(CURATOR_VAULT);
  if (
    cvBefore.allocations.length !== 1 ||
    cvBefore.allocations[0].market.toBase58() !== market.market.toBase58()
  ) {
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
        vault: CURATOR_VAULT,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    log("set_allocations", "1 entry, weight=10000bps");
  } else {
    log("set_allocations", "already has the right market — skipping");
  }
  const cvAcct = await curator.account.curatorVault.fetch(CURATOR_VAULT);
  log("allocations", cvAcct.allocations.length);
  log("alloc[0].market", cvAcct.allocations[0].market);
  log("alloc[0].cap_base", cvAcct.allocations[0].capBase.toString());

  // (6) reallocate_to_market — push USDC from idle escrow into the kamino-backed
  // PT/AMM via the curator's mint_sy → trade_pt buy → deposit_liquidity flow.
  // This exercises the curator's NEW kamino-dispatch CPI path (curator program
  // upgraded 2026-04-26 to forward the 8 new real-klend optional accounts).
  banner("6. reallocate_to_market (kamino path)");
  const REALLOC_AMOUNT = new BN(2_000_000); // 2 USDC
  const userUsdcAtaInfo = await getAccount(provider.connection, userUsdcAta.address);
  // Need 2 USDC in the curator vault's base_escrow first. Top up via deposit
  // if vault's escrow is short.
  const baseEscrow = new PublicKey("8iSKQBGTKWahoRoTvbpKqb1U1BdS88rmMLiP37h5pLKW");
  const escrowInfo = await getAccount(provider.connection, baseEscrow);
  const need = REALLOC_AMOUNT.toNumber();
  if (escrowInfo.amount < BigInt(need)) {
    const { findUserPos } = await import("../tests/fixtures");
    const [userPos] = findUserPos(CURATOR_VAULT, payer.publicKey, curator.programId);
    log("topping up curator base_escrow with", need - Number(escrowInfo.amount));
    await curator.methods
      .deposit(new BN(need - Number(escrowInfo.amount)))
      .accounts({
        owner: payer.publicKey,
        vault: CURATOR_VAULT,
        baseMint: USDC_MINT,
        baseSrc: userUsdcAta.address,
        baseEscrow,
        position: userPos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .rpc();
  }

  const reserveInfo2 = (await provider.connection.getAccountInfo(KLEND_RESERVE))!;
  const klendLM = new PublicKey(reserveInfo2.data.subarray(32, 64));
  const klendLiqSupply = new PublicKey(reserveInfo2.data.subarray(160, 192));
  const [klendLMA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), klendLM.toBuffer()],
    KLEND
  );

  const vaultSyAta = getAssociatedTokenAddressSync(SY_MINT, CURATOR_VAULT, true);
  const vaultPtAta = getAssociatedTokenAddressSync(vault.mintPt, CURATOR_VAULT, true);
  const vaultLpAta = getAssociatedTokenAddressSync(market.mintLp, CURATOR_VAULT, true);

  const [coreEventAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    core.programId
  );

  const reallocIx = await curator.methods
    .reallocateToMarket(
      0,
      REALLOC_AMOUNT,
      new BN(10_000),
      REALLOC_AMOUNT.neg(),
      new BN(10_000),
      new BN(10_000),
      new BN(1)
    )
    .accounts({
      curator: payer.publicKey,
      vault: CURATOR_VAULT,
      baseMint: USDC_MINT,
      baseEscrow,
      syMarket: SY_METADATA,
      syMint: SY_MINT,
      adapterBaseVault: COLL_VAULT,
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
      kaminoKlendProgram: KLEND,
      kaminoKlendReserve: KLEND_RESERVE,
      kaminoKlendLiquiditySupply: klendLiqSupply,
      kaminoKlendCollateralMint: KUSDC,
      kaminoKlendLendingMarket: klendLM,
      kaminoKlendLendingMarketAuthority: klendLMA,
      kaminoKlendInstructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      kaminoKlendLiquidityTokenProgram: TOKEN_PROGRAM_ID,
      kaminoKlendPythOracle: PYTH,
      kaminoKlendSwitchboardPrice: KLEND,
      kaminoKlendSwitchboardTwap: KLEND,
      kaminoKlendScopePrices: KLEND,
    } as any)
    // remaining_accounts forwarded to core's trade_pt + deposit_liquidity,
    // which CPI into the kamino adapter's deposit_sy. Position is the
    // MARKET's personal_position (the market is the SY holder during
    // trade_pt + deposit_liquidity), not the vault's.
    .remainingAccounts([
      { pubkey: SY_METADATA, isSigner: false, isWritable: false },
      { pubkey: SY_MINT, isSigner: false, isWritable: true },
      { pubkey: POOL_ESCROW, isSigner: false, isWritable: true },
      { pubkey: market.marketPosition, isSigner: false, isWritable: true },
      { pubkey: KLEND_RESERVE, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ])
    .instruction();

  // Pack into v0 tx with both ALTs (vault + market) to fit under 1232 bytes.
  const altLookups = await Promise.all(
    [vault.alt, market.alt].map((pk) =>
      provider.connection.getAddressLookupTable(pk).then((r) => r.value!)
    )
  );
  const { blockhash } = await provider.connection.getLatestBlockhash();
  const messageV0 = new anchor.web3.TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      reallocIx,
    ],
  }).compileToV0Message(altLookups);
  const v0tx = new anchor.web3.VersionedTransaction(messageV0);
  v0tx.sign([payer]);
  const reallocSig = await provider.connection.sendTransaction(v0tx, {
    skipPreflight: false,
  });
  await provider.connection.confirmTransaction(reallocSig, "confirmed");
  log("reallocate_to_market tx", reallocSig);

  const cvAfter = await curator.account.curatorVault.fetch(CURATOR_VAULT);
  log("alloc[0].deployed_base", cvAfter.allocations[0].deployedBase.toString());
  log("vault.total_assets", cvAfter.totalAssets.toString());

  // (6) Summary.
  banner("6. canonical Kamino stack handles");
  console.log(JSON.stringify({
    baseMint: USDC_MINT.toBase58(),
    syAdapter: "kamino_sy_adapter",
    syMetadata: SY_METADATA.toBase58(),
    syMint: SY_MINT.toBase58(),
    collateralVault: COLL_VAULT.toBase58(),
    poolEscrow: POOL_ESCROW.toBase58(),
    klendReserve: KLEND_RESERVE.toBase58(),
    klendCollateralMint: KUSDC.toBase58(),
    vault: vault.vault.publicKey.toBase58(),
    vaultAuthority: vault.authority.toBase58(),
    mintPt: vault.mintPt.toBase58(),
    mintYt: vault.mintYt.toBase58(),
    market: market.market.toBase58(),
    mintLp: market.mintLp.toBase58(),
    marketAlt: market.alt.toBase58(),
    curatorVault: CURATOR_VAULT.toBase58(),
    allocationCount: cvAcct.allocations.length,
  }, null, 2));
  console.log("\nNEXT: reallocate_to_market is currently blocked because the");
  console.log("on-chain curator program predates the kamino_sy_adapter upgrade");
  console.log("and doesn't forward the 8 new real-klend optional accounts in");
  console.log("its mint_sy CPI. Tracked separately.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

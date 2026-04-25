// scripts/devnet-e2e.ts — end-to-end sanity run against devnet.
//
// Run with:
//   source .env.devnet
//   yarn run tsx scripts/devnet-e2e.ts
//
// Exercises every program Step 3 deploys, using the same fixture
// helpers the Step 2 test suites use. On a green run, prints a
// ready-to-paste block of canonical handles for DEPLOY_IDS.md.
//
// Idempotent-ish: each run creates a *new* SY base mint, vault,
// market, curator vault, and farm state — same deployer, but fresh
// PDAs. The previous run's handles stay live on-chain; nothing here
// overwrites them.
//
// NOTE: expects `anchor deploy --provider.cluster devnet` has already
// landed all 5 programs. If a program is missing, the first Anchor
// builder will fail loudly at tx-send time.

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
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { ClearstoneCurator } from "../target/types/clearstone_curator";
import type { ClearstoneRewards } from "../target/types/clearstone_rewards";
import type { ClearstoneRouter } from "../target/types/clearstone_router";
import type { GenericExchangeRateSy } from "../target/types/generic_exchange_rate_sy";
import {
  createBaseMint,
  createSyMarket,
  mintSyForUser,
  setupVault,
  setupMarket,
  stripWithGenericAdapter,
  findCuratorVault,
  findBaseEscrow,
  findUserPos,
  findFarmState,
  findLpEscrow,
  CU_LIMIT_IX,
} from "../tests/fixtures";

// ---------- provider ----------

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;

if (!process.env.ANCHOR_PROVIDER_URL?.includes("devnet")) {
  console.warn(
    `[warn] ANCHOR_PROVIDER_URL=${process.env.ANCHOR_PROVIDER_URL ?? "(unset)"} — ` +
      "this script is meant for devnet. Continuing anyway."
  );
}

const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const adapter = anchor.workspace
  .genericExchangeRateSy as Program<GenericExchangeRateSy>;
const curator = anchor.workspace.clearstoneCurator as Program<ClearstoneCurator>;
const rewards = anchor.workspace.clearstoneRewards as Program<ClearstoneRewards>;
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

// ---------- main ----------

async function main() {
  banner("devnet deployer + RPC");
  log("deployer", payer.publicKey);
  log("rpc", provider.connection.rpcEndpoint);
  const bal = await provider.connection.getBalance(payer.publicKey);
  log("deployer SOL", bal / LAMPORTS_PER_SOL);

  // (1) base mint + initial deployer balance
  banner("1. base mint + seed balances");
  const baseMint = await createBaseMint(provider.connection, payer, 6);
  log("base_mint", baseMint);
  const payerBaseAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      baseMint,
      payer.publicKey
    )
  ).address;
  await mintTo(
    provider.connection,
    payer,
    baseMint,
    payerBaseAta,
    payer,
    10_000_000_000n // 10k base (6 decimals)
  );
  log("payer base ATA", payerBaseAta);

  // (2) SY market over base
  banner("2. SY market (generic_exchange_rate_sy)");
  const sy = await createSyMarket({
    program: adapter,
    payer,
    authority: payer,
    baseMint,
    initialExchangeRate: new BN(1),
  });
  log("sy_market", sy.syMarket);
  log("sy_mint", sy.syMint);
  log("sy_base_vault", sy.baseVault);
  log("sy_pool_escrow", sy.poolEscrow);

  const payerSyAta = await mintSyForUser({
    program: adapter,
    connection: provider.connection,
    user: payer,
    handles: sy,
    amountBase: new BN(5_000_000_000), // half to SY for vault + market seeding
  });
  log("payer sy ATA", payerSyAta);

  // (3) core vault over SY
  banner("3. core vault (clearstone_core)");
  const now = await readClockTs(provider.connection);
  const vault = await setupVault({
    core,
    adapter,
    connection: provider.connection,
    payer,
    curator: payer.publicKey,
    syHandles: sy,
    startTimestamp: now,
    duration: 86_400 * 30,
    interestBpsFee: 100,
    creatorFeeBps: 500,
    maxPySupply: new BN("1000000000000"),
    minOpSizeStrip: new BN(1),
    minOpSizeMerge: new BN(1),
  });
  log("vault", vault.vault.publicKey);
  log("vault authority", vault.authority);
  log("mint_pt", vault.mintPt);
  log("mint_yt", vault.mintYt);
  log("yield_position", vault.yieldPosition);

  // (4) strip seed so we have PT for the market + integrator demo
  banner("4. strip seed (payer)");
  const payerPtAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    vault.mintPt,
    payer.publicKey
  );
  const payerYtAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    vault.mintYt,
    payer.publicKey
  );
  await stripWithGenericAdapter({
    core,
    adapter,
    depositor: payer,
    sy,
    vault,
    sySrc: payerSyAta,
    ptDst: payerPtAta.address,
    ytDst: payerYtAta.address,
    amount: new BN(20_000_000),
  });
  const ptBal = (await getAccount(provider.connection, payerPtAta.address)).amount;
  const ytBal = (await getAccount(provider.connection, payerYtAta.address)).amount;
  log("payer PT after strip", ptBal);
  log("payer YT after strip", ytBal);

  // (5) core market seed_id=1
  banner("5. core market seed=1");
  const market = await setupMarket({
    core,
    adapter,
    connection: provider.connection,
    payer,
    curator: payer.publicKey,
    vaultHandles: vault,
    syHandles: sy,
    seedId: 1,
    ptInit: new BN(1_000_000),
    syInit: new BN(1_000_000),
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
  log("market_escrow_pt", market.escrowPt);
  log("market_escrow_sy", market.escrowSy);
  log("market_alt", market.alt);

  // (6) router.wrapper_buy_pt — prove the full wrapper path works on devnet
  banner("6. router.wrapper_buy_pt (small PT buy through router)");
  const userForBuy = Keypair.generate();
  // Fund user via SOL airdrop on devnet — if throttled, re-use payer.
  try {
    const sig = await provider.connection.requestAirdrop(
      userForBuy.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  } catch {
    console.warn("  airdrop throttled; using payer as the router demo user");
  }
  const buyer = (await provider.connection.getBalance(userForBuy.publicKey)) >
    0.5 * LAMPORTS_PER_SOL
    ? userForBuy
    : payer;
  const buyerBaseAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      baseMint,
      buyer.publicKey
    )
  ).address;
  if (buyer !== payer) {
    await mintTo(
      provider.connection,
      payer,
      baseMint,
      buyerBaseAta,
      payer,
      500_000n
    );
  }
  const buyerSyAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      sy.syMint,
      buyer.publicKey
    )
  ).address;
  const buyerPtAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      vault.mintPt,
      buyer.publicKey
    )
  ).address;
  const [coreEventAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    core.programId
  );
  await router.methods
    .wrapperBuyPt(new BN(5_000), new BN(200_000), new BN(-200_000))
    .accounts({
      user: buyer.publicKey,
      syMarket: sy.syMarket,
      baseMint,
      syMint: sy.syMint,
      baseSrc: buyerBaseAta,
      baseVault: sy.baseVault,
      market: market.market,
      sySrc: buyerSyAta,
      ptDst: buyerPtAta,
      marketEscrowSy: market.escrowSy,
      marketEscrowPt: market.escrowPt,
      marketAlt: market.alt,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenFeeTreasurySy: market.tokenTreasuryFeeSy,
      syProgram: adapter.programId,
      coreProgram: core.programId,
      coreEventAuthority: coreEventAuth,
    } as any)
    .remainingAccounts([
      { pubkey: sy.syMarket, isSigner: false, isWritable: false },
      { pubkey: sy.syMint, isSigner: false, isWritable: true },
      { pubkey: sy.poolEscrow, isSigner: false, isWritable: true },
      { pubkey: market.marketPosition, isSigner: false, isWritable: true },
    ])
    .preInstructions([CU_LIMIT_IX])
    .signers([buyer])
    .rpc();
  const buyerPtBal = (await getAccount(provider.connection, buyerPtAta)).amount;
  log("buyer PT after wrapper_buy_pt", buyerPtBal);

  // (7) curator vault + allocation + reallocate_to_market
  banner("7. curator vault + one allocation + reallocate_to_market");
  const [curatorVault] = findCuratorVault(
    payer.publicKey,
    baseMint,
    curator.programId
  );
  const [curatorBaseEscrow] = findBaseEscrow(curatorVault, curator.programId);

  await curator.methods
    .initializeVault(500) // 5% perf fee
    .accounts({
      payer: payer.publicKey,
      curator: payer.publicKey,
      baseMint,
      vault: curatorVault,
      baseEscrow: curatorBaseEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .rpc();
  log("curator_vault", curatorVault);
  log("curator_base_escrow", curatorBaseEscrow);

  // Seed the curator vault with 100k base via deposit.
  const [depositorPos] = findUserPos(
    curatorVault,
    payer.publicKey,
    curator.programId
  );
  await curator.methods
    .deposit(new BN(100_000_000))
    .accounts({
      owner: payer.publicKey,
      vault: curatorVault,
      baseMint,
      baseSrc: payerBaseAta,
      baseEscrow: curatorBaseEscrow,
      position: depositorPos,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .rpc();

  await curator.methods
    .setAllocations([
      {
        market: market.market,
        weightBps: 10_000,
        capBase: new BN(1_000_000_000),
        deployedBase: new BN(0),
      },
    ])
    .accounts({
      curator: payer.publicKey,
      vault: curatorVault,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();

  const vaultSyAta = getAssociatedTokenAddressSync(
    sy.syMint,
    curatorVault,
    true
  );
  const vaultPtAta = getAssociatedTokenAddressSync(
    vault.mintPt,
    curatorVault,
    true
  );
  const vaultLpAta = getAssociatedTokenAddressSync(
    market.mintLp,
    curatorVault,
    true
  );

  await curator.methods
    .reallocateToMarket(
      0,
      new BN(200_000),
      new BN(10_000),
      new BN(-200_000),
      new BN(10_000),
      new BN(10_000),
      new BN(1)
    )
    .accounts({
      curator: payer.publicKey,
      vault: curatorVault,
      baseMint,
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

  // mark_to_market so deployed_base reflects real on-chain value
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

  const curAcct = await curator.account.curatorVault.fetch(curatorVault);
  log("curator deployed_base[0]", curAcct.allocations[0].deployedBase.toNumber());
  log("curator total_assets", curAcct.totalAssets.toNumber());

  // harvest_fees with a tiny reported mark to prove the path works end-to-end
  await curator.methods
    .harvestFees(new BN(curAcct.totalAssets.toNumber()))
    .accounts({
      curator: payer.publicKey,
      vault: curatorVault,
      curatorPosition: depositorPos,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .rpc();
  log("curator harvest_fees", "green");

  // (8) rewards farm over the market's LP mint
  banner("8. rewards farm_state");
  const [farmState] = findFarmState(market.market, rewards.programId);
  const [lpEscrow] = findLpEscrow(market.market, rewards.programId);
  // Use base_mint as the reward mint for the demo (keeps us off new
  // mints). Integrators would spin up their own reward mint.
  const rewardMint = baseMint;
  const farmRewardEscrow = getAssociatedTokenAddressSync(
    rewardMint,
    farmState,
    true
  );

  await rewards.methods
    .initializeFarmState()
    .accounts({
      payer: payer.publicKey,
      curator: payer.publicKey,
      market: market.market,
      lpMint: market.mintLp,
      farmState,
      lpEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .rpc();
  log("farm_state", farmState);
  log("lp_escrow", lpEscrow);
  log("reward_escrow (base as reward)", farmRewardEscrow);

  // (9) summary
  banner("9. canonical handles — paste into DEPLOY_IDS.md E2E section");
  console.log(`- SY base mint:                     \`${baseMint.toBase58()}\``);
  console.log(`- SY market (generic adapter):      \`${sy.syMarket.toBase58()}\``);
  console.log(`- Core vault:                       \`${vault.vault.publicKey.toBase58()}\``);
  console.log(`- Core market (seed=1):             \`${market.market.toBase58()}\``);
  console.log(`- Curator vault:                    \`${curatorVault.toBase58()}\``);
  console.log(`- Farm state:                       \`${farmState.toBase58()}\``);
  console.log();
  console.log("e2e: green");
}

main().catch((err) => {
  console.error("e2e failed:", err);
  process.exit(1);
});

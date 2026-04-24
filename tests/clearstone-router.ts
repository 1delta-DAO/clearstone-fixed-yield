// Clearstone Router smoke tests.
//
// Run with: `anchor test` (or `yarn mocha tests/clearstone-router.ts`).
//
// Scope:
//   - The 12 exported wrapper methods each type-check via the IDL. This
//     catches IDL-drift regressions (a renamed account, a dropped arg)
//     without needing to stand up a full vault+market stack per wrapper.
//   - A handful of wrappers are exercised end-to-end against a freshStack:
//     wrapper_strip → wrapper_merge (roundtrip), wrapper_buy_pt →
//     wrapper_sell_pt (base in → base out within slippage),
//     wrapper_provide_liquidity_classic + wrapper_withdraw_liquidity_classic.
//
// Notes:
//   - Full-stack wrappers depend on setupVault + setupMarket working end
//     to end (see clearstone-core.ts for the status). If those regress,
//     the type-check suite below still provides value.

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";

import type { ClearstoneRouter } from "../target/types/clearstone_router";
import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { GenericExchangeRateSy } from "../target/types/generic_exchange_rate_sy";
import {
  createBaseMint,
  createSyMarket,
  mintSyForUser,
  setupVault,
  setupMarket,
  stripWithGenericAdapter,
  SyMarketHandles,
  VaultHandles,
  MarketHandles,
  CU_LIMIT_IX,
} from "./fixtures";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;
const router = anchor.workspace.clearstoneRouter as Program<ClearstoneRouter>;
const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const adapter = anchor.workspace.genericExchangeRateSy as Program<GenericExchangeRateSy>;

// ===== Helpers shared by the full-stack wrapper suites =====

async function fundedUser(amountSol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey,
    amountSol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
}

interface RouterStack {
  sy: SyMarketHandles;
  vault: VaultHandles;
  market: MarketHandles;
  user: Keypair;
  userBaseAta: PublicKey;
  userSyAta: PublicKey;
  userPtAta: PublicKey;
  userYtAta: PublicKey;
  userLpAta: PublicKey;
  coreEventAuth: PublicKey;
}

async function buildRouterStack(): Promise<RouterStack> {
  const baseMint = await createBaseMint(provider.connection, payer, 6);
  const sy = await createSyMarket({
    program: adapter,
    payer,
    authority: payer,
    baseMint,
    initialExchangeRate: new BN(1),
  });

  // Seed payer with base + SY for vault/market bootstrapping.
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
    10_000_000_000n
  );
  const payerSyAta = await mintSyForUser({
    program: adapter,
    connection: provider.connection,
    user: payer,
    handles: sy,
    amountBase: new BN(5_000_000_000),
  });

  const clockAcct = await provider.connection.getAccountInfo(
    anchor.web3.SYSVAR_CLOCK_PUBKEY
  );
  const onchainNow = Number(clockAcct!.data.readBigInt64LE(32));

  const vault = await setupVault({
    core,
    adapter,
    connection: provider.connection,
    payer,
    curator: payer.publicKey,
    syHandles: sy,
    startTimestamp: onchainNow,
    duration: 86_400 * 30,
    interestBpsFee: 100,
    creatorFeeBps: 500,
    maxPySupply: new BN("1000000000000"),
    minOpSizeStrip: new BN(1),
    minOpSizeMerge: new BN(1),
  });

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
    amount: new BN(10_000_000),
  });

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

  // Fresh end user with base + pre-created ATAs.
  const user = await fundedUser();
  const userBaseAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      baseMint,
      user.publicKey
    )
  ).address;
  await mintTo(
    provider.connection,
    payer,
    baseMint,
    userBaseAta,
    payer,
    1_000_000_000n
  );
  const userSyAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      sy.syMint,
      user.publicKey
    )
  ).address;
  const userPtAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      vault.mintPt,
      user.publicKey
    )
  ).address;
  const userYtAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      vault.mintYt,
      user.publicKey
    )
  ).address;
  const userLpAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      market.mintLp,
      user.publicKey
    )
  ).address;

  const [coreEventAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    core.programId
  );

  return {
    sy,
    vault,
    market,
    user,
    userBaseAta,
    userSyAta,
    userPtAta,
    userYtAta,
    userLpAta,
    coreEventAuth,
  };
}

// `remaining_accounts` for wrappers that cascade into core.strip /
// core.merge / core.trade_pt — these are the adapter's deposit_sy /
// withdraw_sy extras keyed off (sy_market, sy_mint, pool_escrow,
// vaultPosition / marketPosition).
function vaultExtras(sy: SyMarketHandles, vault: VaultHandles) {
  return [
    { pubkey: sy.syMarket, isSigner: false, isWritable: false },
    { pubkey: sy.syMint, isSigner: false, isWritable: true },
    { pubkey: sy.poolEscrow, isSigner: false, isWritable: true },
    { pubkey: vault.vaultPosition, isSigner: false, isWritable: true },
  ];
}

function marketExtras(sy: SyMarketHandles, market: MarketHandles) {
  return [
    { pubkey: sy.syMarket, isSigner: false, isWritable: false },
    { pubkey: sy.syMint, isSigner: false, isWritable: true },
    { pubkey: sy.poolEscrow, isSigner: false, isWritable: true },
    { pubkey: market.marketPosition, isSigner: false, isWritable: true },
  ];
}

describe("clearstone-router :: IDL shape", () => {
  // Per PLAN.md M4: the wrapper set is a stability surface for
  // integrators. If a method gets renamed or dropped, this breaks loudly.
  const EXPECTED_WRAPPERS: Array<keyof Program<ClearstoneRouter>["methods"]> = [
    "wrapperStrip",
    "wrapperMerge",
    "wrapperBuyPt",
    "wrapperSellPt",
    "wrapperBuyYt",
    "wrapperSellYt",
    "wrapperCollectInterest",
    "wrapperProvideLiquidity",
    "wrapperProvideLiquidityClassic",
    "wrapperProvideLiquidityBase",
    "wrapperWithdrawLiquidity",
    "wrapperWithdrawLiquidityClassic",
  ];

  it("exposes all 12 wrapper methods", () => {
    for (const name of EXPECTED_WRAPPERS) {
      // Each should resolve to a callable method builder on the Program.
      expect(typeof (router.methods as any)[name]).to.equal(
        "function",
        `missing router method: ${String(name)}`
      );
    }
    expect(Object.keys(router.methods).sort()).to.include.members(
      EXPECTED_WRAPPERS.map(String).sort()
    );
  });

  it("each wrapper appears in the IDL with the expected arg count", () => {
    // The IDL is the canonical surface for integrators — if an arg is
    // silently added or dropped, downstream builds break. These counts
    // come from periphery/clearstone_router/src/lib.rs signatures.
    // Anchor 0.31 may camelCase names client-side; accept either form.
    const EXPECTED_ARG_COUNTS: Record<string, number> = {
      wrapper_strip: 1,
      wrapper_merge: 1,
      wrapper_buy_pt: 3,
      wrapper_sell_pt: 2,
      wrapper_buy_yt: 3,
      wrapper_sell_yt: 2,
      wrapper_collect_interest: 1,
      wrapper_provide_liquidity: 4,
      wrapper_provide_liquidity_classic: 3,
      wrapper_provide_liquidity_base: 5,
      wrapper_withdraw_liquidity: 3,
      wrapper_withdraw_liquidity_classic: 3,
    };

    const snakeToCamel = (s: string) =>
      s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    const idlIxs = (router.idl as any).instructions ?? [];
    for (const [name, expected] of Object.entries(EXPECTED_ARG_COUNTS)) {
      const camel = snakeToCamel(name);
      const ix = idlIxs.find(
        (i: any) => i.name === name || i.name === camel
      );
      expect(ix, `missing IDL instruction: ${name}`).to.not.equal(undefined);
      expect(ix.args.length).to.equal(
        expected,
        `arg count mismatch for ${name}: expected ${expected}, got ${ix.args.length}`
      );
    }
  });

  it("IDL error codes include MissingReturnData", () => {
    const errCodes = (router.idl as any).errors ?? [];
    const names = new Set(errCodes.map((e: any) => e.name));
    // MissingReturnData backs wrapper_strip's return-data read path.
    // If the enum gets renamed, downstream consumers catching it break.
    expect(
      names.has("MissingReturnData") || names.has("missingReturnData")
    ).to.equal(true);
  });
});

describe("clearstone-router :: strip/merge roundtrip via wrappers", () => {
  it("wrapper_strip → wrapper_merge gives base → PT+YT → back to base", async () => {
    const s = await buildRouterStack();

    const baseIn = new BN(1_000_000);
    const baseBefore = (await getAccount(provider.connection, s.userBaseAta)).amount;

    await router.methods
      .wrapperStrip(baseIn)
      .accounts({
        user: s.user.publicKey,
        syMarket: s.sy.syMarket,
        baseMint: s.sy.baseMint,
        syMint: s.sy.syMint,
        baseSrc: s.userBaseAta,
        baseVault: s.sy.baseVault,
        authority: s.vault.authority,
        vault: s.vault.vault.publicKey,
        sySrc: s.userSyAta,
        escrowSy: s.vault.escrowSy,
        ytDst: s.userYtAta,
        ptDst: s.userPtAta,
        mintYt: s.vault.mintYt,
        mintPt: s.vault.mintPt,
        tokenProgram: TOKEN_PROGRAM_ID,
        addressLookupTable: s.vault.alt,
        syProgram: adapter.programId,
        coreProgram: core.programId,
        yieldPosition: s.vault.yieldPosition,
        coreEventAuthority: s.coreEventAuth,
      } as any)
      .remainingAccounts(vaultExtras(s.sy, s.vault))
      .preInstructions([CU_LIMIT_IX])
      .signers([s.user])
      .rpc();

    const ptBal = (await getAccount(provider.connection, s.userPtAta)).amount;
    const ytBal = (await getAccount(provider.connection, s.userYtAta)).amount;
    expect(Number(ptBal)).to.be.greaterThan(0);
    expect(Number(ytBal)).to.be.greaterThan(0);
    expect(ptBal).to.equal(ytBal); // PT == YT after strip

    // Merge every PT+YT pair back; the wrapper then redeems all SY
    // currently in sy_src to base_dst.
    await router.methods
      .wrapperMerge(new BN(ptBal.toString()))
      .accounts({
        user: s.user.publicKey,
        syMarket: s.sy.syMarket,
        baseMint: s.sy.baseMint,
        syMint: s.sy.syMint,
        baseDst: s.userBaseAta,
        baseVault: s.sy.baseVault,
        authority: s.vault.authority,
        vault: s.vault.vault.publicKey,
        sySrc: s.userSyAta,
        escrowSy: s.vault.escrowSy,
        ytSrc: s.userYtAta,
        ptSrc: s.userPtAta,
        mintYt: s.vault.mintYt,
        mintPt: s.vault.mintPt,
        tokenProgram: TOKEN_PROGRAM_ID,
        addressLookupTable: s.vault.alt,
        syProgram: adapter.programId,
        coreProgram: core.programId,
        yieldPosition: s.vault.yieldPosition,
        coreEventAuthority: s.coreEventAuth,
      } as any)
      .remainingAccounts(vaultExtras(s.sy, s.vault))
      .preInstructions([CU_LIMIT_IX])
      .signers([s.user])
      .rpc();

    const baseAfter = (await getAccount(provider.connection, s.userBaseAta)).amount;
    // Round-trip: final base ≤ initial (no free-mint, I-M2). Any fee leg
    // trims the tail; with exchange_rate=1 and no yield accrual, the
    // delta is rounding-only.
    expect(baseAfter <= baseBefore).to.equal(true);
    // PT and YT drained to zero (we merged everything we had).
    const ptAfter = (await getAccount(provider.connection, s.userPtAta)).amount;
    const ytAfter = (await getAccount(provider.connection, s.userYtAta)).amount;
    expect(ptAfter).to.equal(0n);
    expect(ytAfter).to.equal(0n);
  });
});

describe("clearstone-router :: buy/sell PT via wrappers", () => {
  it("wrapper_buy_pt then wrapper_sell_pt keeps base within slippage", async () => {
    const s = await buildRouterStack();
    const baseBefore = (await getAccount(provider.connection, s.userBaseAta)).amount;

    // Buy a modest PT amount. max_sy_in is negative because SY leaves
    // the user when buying PT (core/trade_pt sign convention).
    const ptTarget = new BN(100_000);
    const maxBase = new BN(500_000);
    const maxSyIn = new BN(-500_000); // conservative lower-bound
    await router.methods
      .wrapperBuyPt(ptTarget, maxBase, maxSyIn)
      .accounts({
        user: s.user.publicKey,
        syMarket: s.sy.syMarket,
        baseMint: s.sy.baseMint,
        syMint: s.sy.syMint,
        baseSrc: s.userBaseAta,
        baseVault: s.sy.baseVault,
        market: s.market.market,
        sySrc: s.userSyAta,
        ptDst: s.userPtAta,
        marketEscrowSy: s.market.escrowSy,
        marketEscrowPt: s.market.escrowPt,
        marketAlt: s.market.alt,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenFeeTreasurySy: s.market.tokenTreasuryFeeSy,
        syProgram: adapter.programId,
        coreProgram: core.programId,
        coreEventAuthority: s.coreEventAuth,
      } as any)
      .remainingAccounts(marketExtras(s.sy, s.market))
      .preInstructions([CU_LIMIT_IX])
      .signers([s.user])
      .rpc();

    const ptAfterBuy = (await getAccount(provider.connection, s.userPtAta)).amount;
    expect(Number(ptAfterBuy)).to.be.greaterThanOrEqual(Number(ptTarget.toString()));

    // Sell the PT back to base. min_sy_out is positive because SY enters
    // the user when selling PT.
    await router.methods
      .wrapperSellPt(new BN(ptAfterBuy.toString()), new BN(1))
      .accounts({
        user: s.user.publicKey,
        market: s.market.market,
        sySrc: s.userSyAta,
        ptSrc: s.userPtAta,
        marketEscrowSy: s.market.escrowSy,
        marketEscrowPt: s.market.escrowPt,
        marketAlt: s.market.alt,
        tokenFeeTreasurySy: s.market.tokenTreasuryFeeSy,
        syMarket: s.sy.syMarket,
        baseMint: s.sy.baseMint,
        syMint: s.sy.syMint,
        baseVault: s.sy.baseVault,
        baseDst: s.userBaseAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        syProgram: adapter.programId,
        coreProgram: core.programId,
        coreEventAuthority: s.coreEventAuth,
      } as any)
      .remainingAccounts(marketExtras(s.sy, s.market))
      .preInstructions([CU_LIMIT_IX])
      .signers([s.user])
      .rpc();

    const baseAfter = (await getAccount(provider.connection, s.userBaseAta)).amount;
    // Round-trip bound: final base ≤ initial (fees trim both legs).
    expect(baseAfter <= baseBefore).to.equal(true);
    // Slippage sanity: lost less than 10% of base to round-trip fees on a
    // fresh market with exchange_rate=1. Anything tighter is AMM-parameter
    // dependent so we don't pin it here.
    const lost = baseBefore - baseAfter;
    expect(lost < baseBefore / 10n).to.equal(true);
  });
});

describe("clearstone-router :: liquidity wrappers (classic)", () => {
  it("wrapper_provide_liquidity_classic + wrapper_withdraw_liquidity_classic", async () => {
    const s = await buildRouterStack();

    // Pre-strip some PT/SY into the user so they have something to deposit.
    // (`classic` does NOT mint_sy — user must hold SY already.)
    await mintSyForUser({
      program: adapter,
      connection: provider.connection,
      user: s.user,
      handles: s.sy,
      amountBase: new BN(500_000),
    });
    await stripWithGenericAdapter({
      core,
      adapter,
      depositor: s.user,
      sy: s.sy,
      vault: s.vault,
      sySrc: s.userSyAta,
      ptDst: s.userPtAta,
      ytDst: s.userYtAta,
      amount: new BN(200_000),
    });

    const ptAvail = (await getAccount(provider.connection, s.userPtAta)).amount;
    const syAvail = (await getAccount(provider.connection, s.userSyAta)).amount;
    expect(Number(ptAvail)).to.be.greaterThan(0);
    expect(Number(syAvail)).to.be.greaterThan(0);

    // Deposit half the PT, half the SY (both >0, pro-rata handled by core).
    const ptIntent = new BN((ptAvail / 2n).toString());
    const syIntent = new BN((syAvail / 2n).toString());

    await router.methods
      .wrapperProvideLiquidityClassic(ptIntent, syIntent, new BN(1))
      .accounts({
        user: s.user.publicKey,
        syMarket: s.sy.syMarket,
        baseMint: s.sy.baseMint,
        syMint: s.sy.syMint,
        baseSrc: s.userBaseAta,
        baseVault: s.sy.baseVault,
        market: s.market.market,
        ptSrc: s.userPtAta,
        sySrc: s.userSyAta,
        escrowPt: s.market.escrowPt,
        escrowSy: s.market.escrowSy,
        lpDst: s.userLpAta,
        mintLp: s.market.mintLp,
        addressLookupTable: s.market.alt,
        tokenProgram: TOKEN_PROGRAM_ID,
        syProgram: adapter.programId,
        coreProgram: core.programId,
        coreEventAuthority: s.coreEventAuth,
      } as any)
      .remainingAccounts(marketExtras(s.sy, s.market))
      .preInstructions([CU_LIMIT_IX])
      .signers([s.user])
      .rpc();

    const lpAfterDep = (await getAccount(provider.connection, s.userLpAta)).amount;
    expect(Number(lpAfterDep)).to.be.greaterThan(0);

    // Withdraw every LP back. classic variant does NOT redeem to base — PT
    // and SY land directly in the user's token accounts.
    await router.methods
      .wrapperWithdrawLiquidityClassic(
        new BN(lpAfterDep.toString()),
        new BN(1),
        new BN(1)
      )
      .accounts({
        user: s.user.publicKey,
        market: s.market.market,
        ptDst: s.userPtAta,
        sySrc: s.userSyAta,
        escrowPt: s.market.escrowPt,
        escrowSy: s.market.escrowSy,
        lpSrc: s.userLpAta,
        mintLp: s.market.mintLp,
        addressLookupTable: s.market.alt,
        syMarket: s.sy.syMarket,
        baseMint: s.sy.baseMint,
        syMint: s.sy.syMint,
        baseVault: s.sy.baseVault,
        baseDst: s.userBaseAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        syProgram: adapter.programId,
        coreProgram: core.programId,
        coreEventAuthority: s.coreEventAuth,
      } as any)
      .remainingAccounts(marketExtras(s.sy, s.market))
      .preInstructions([CU_LIMIT_IX])
      .signers([s.user])
      .rpc();

    const lpAfterWd = (await getAccount(provider.connection, s.userLpAta)).amount;
    expect(lpAfterWd).to.equal(0n);
    // PT & SY came back — balances grew above what was NOT deposited.
    const ptAfterWd = (await getAccount(provider.connection, s.userPtAta)).amount;
    const syAfterWd = (await getAccount(provider.connection, s.userSyAta)).amount;
    expect(Number(ptAfterWd)).to.be.greaterThan(
      Number(ptAvail - BigInt(ptIntent.toString()))
    );
    expect(Number(syAfterWd)).to.be.greaterThan(
      Number(syAvail - BigInt(syIntent.toString()))
    );
  });
});

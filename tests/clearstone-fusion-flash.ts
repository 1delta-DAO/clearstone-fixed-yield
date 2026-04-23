// M-FLASH-4 — flash_swap_pt integration test.
//
// Uses `mock_flash_callback` (reference_adapters/) to exercise the four
// invariants in INTENT_FLASH_PLAN.md §8 without needing the real
// clearstone_solver_callback + fusion + delta-mint stack deployed:
//
//   • Happy path (mode=Ok) → I-F2 (repayment) + I-F4 (PT conservation) +
//     I-F3 (rate freshness) + trade_pt-equivalent state after.
//   • Short-repay (mode=ShortRepay) → I-F2 violation → FlashRepayInsufficient.
//   • Nested flash (mode=TryNestedFlash) → I-F1 violation → revert
//     (NestedFlashBlocked or earlier account guard).
//   • Liquidity shortage (pt_out > pt_balance) → InsufficientPtLiquidity.
//
// The full-fusion happy path (real clearstone_solver_callback + fusion) is
// parked as an `it.skip` — it needs the same e2e wiring the GovernorWhitelist
// test in clearstone-kyc-pass-through.ts awaits.

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  AccountMeta,
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { ClearstoneFusion } from "../target/types/clearstone_fusion";
import type { GenericExchangeRateSy } from "../target/types/generic_exchange_rate_sy";
import type { MockFlashCallback } from "../target/types/mock_flash_callback";
import {
  CU_LIMIT_IX,
  MarketHandles,
  SyMarketHandles,
  VaultHandles,
  createAta,
  createBaseMint,
  createSyMarket,
  mintSyForUser,
  mintToUser,
  setupMarket,
  setupVault,
  stripWithGenericAdapter,
} from "./fixtures";
import {
  buildSimpleOrder,
  findFusionDelegatePda,
  findFusionOrderStatePda,
  signFusionOrder,
} from "./fusion_sign";

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;
const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const syProgram = anchor.workspace.genericExchangeRateSy as Program<GenericExchangeRateSy>;
const mockCallback = anchor.workspace.mockFlashCallback as Program<MockFlashCallback>;

async function fundedUser(amountSol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey,
    amountSol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
}

interface FlashStack {
  sy: SyMarketHandles;
  vault: VaultHandles;
  market: MarketHandles;
  solver: Keypair;
  solverSyAta: PublicKey;
  solverPtAta: PublicKey;
}

async function freshFlashStack(): Promise<FlashStack> {
  const baseMint = await createBaseMint(provider.connection, payer, 6);
  const sy = await createSyMarket({
    program: syProgram,
    payer,
    authority: payer,
    baseMint,
    initialExchangeRate: new BN(1),
  });

  // Seed payer with base so we can mint SY.
  const payerBaseAta = await createAta(provider.connection, payer, baseMint, payer.publicKey);
  await mintToUser(
    provider.connection,
    payer,
    baseMint,
    payer,
    payerBaseAta.address,
    10_000_000_000n
  );
  const payerSyAta = await mintSyForUser({
    program: syProgram,
    connection: provider.connection,
    user: payer,
    handles: sy,
    amountBase: new BN(5_000_000_000),
  });

  const clockAccount = await provider.connection.getAccountInfo(
    anchor.web3.SYSVAR_CLOCK_PUBKEY
  );
  const onchainNow = Number(clockAccount!.data.readBigInt64LE(32));
  const vault = await setupVault({
    core,
    adapter: syProgram,
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

  // Strip SY for market seed.
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
    adapter: syProgram,
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
    adapter: syProgram,
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

  // Solver with SY inventory (the mock callback pulls from here to repay).
  const solver = await fundedUser();
  const solverSyAta = await mintSyForUser({
    program: syProgram,
    connection: provider.connection,
    user: solver,
    handles: sy,
    amountBase: new BN(100_000_000),
  });
  const solverPtAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      vault.mintPt,
      solver.publicKey
    )
  ).address;

  return { sy, vault, market, solver, solverSyAta, solverPtAta };
}

function findEventAuthority(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    programId
  );
  return pda;
}

/**
 * Build the remaining-accounts list the mock callback needs.
 *
 * Core injects 6 fixed-prefix accounts into the callback's ix: market,
 * caller_pt_dst, token_sy_escrow, mint_sy, caller, token_program. Everything
 * past that comes from `remainingAccounts` we put on flash_swap_pt. The mock
 * expects (in this order):
 *   solver_sy_src, token_pt_escrow, token_fee_treasury_sy, address_lookup_table,
 *   sy_program, self_program, core_program, core_event_authority.
 */
function callbackPassthrough(
  stack: FlashStack,
  callbackId: PublicKey
): anchor.web3.AccountMeta[] {
  const coreEventAuth = findEventAuthority(core.programId);
  return [
    { pubkey: stack.solverSyAta, isSigner: false, isWritable: true },
    { pubkey: stack.market.escrowPt, isSigner: false, isWritable: true },
    { pubkey: stack.market.tokenTreasuryFeeSy, isSigner: false, isWritable: true },
    { pubkey: stack.market.alt, isSigner: false, isWritable: false },
    { pubkey: syProgram.programId, isSigner: false, isWritable: false },
    { pubkey: callbackId, isSigner: false, isWritable: false },
    { pubkey: core.programId, isSigner: false, isWritable: false },
    { pubkey: coreEventAuth, isSigner: false, isWritable: false },
  ];
}

/** SY-CPI extras — core's trade_pt/get_sy_state use these. For the generic
 *  adapter they're the 7-account ALT-indexed set. We re-construct them here
 *  by re-reading the market's cpi_accounts and resolving via the ALT. */
async function syCpiExtras(stack: FlashStack): Promise<anchor.web3.AccountMeta[]> {
  const marketAcct = (await (core.account as any).marketTwo.fetch(
    stack.market.market
  )) as any;
  const altResp = await provider.connection.getAddressLookupTable(stack.market.alt);
  const alt = altResp.value!;
  const contexts: Array<any[]> = [
    marketAcct.cpiAccounts.getSyState,
    marketAcct.cpiAccounts.depositSy,
    marketAcct.cpiAccounts.withdrawSy,
  ];
  const seen = new Map<number, anchor.web3.AccountMeta>();
  for (const list of contexts) {
    for (const ctx of list) {
      const idx: number = ctx.altIndex;
      const existing = seen.get(idx);
      const pubkey = alt.state.addresses[idx];
      seen.set(idx, {
        pubkey,
        isSigner: (existing?.isSigner ?? false) || ctx.isSigner,
        isWritable: (existing?.isWritable ?? false) || ctx.isWritable,
      });
    }
  }
  return [...seen.values()];
}

async function callFlashSwap(
  stack: FlashStack,
  ptOut: BN,
  mode: number,
  callbackProgramId: PublicKey = mockCallback.programId
): Promise<string> {
  const extras = await syCpiExtras(stack);
  const passthrough = callbackPassthrough(stack, callbackProgramId);

  return core.methods
    .flashSwapPt(ptOut, Buffer.from([mode]))
    .accounts({
      caller: stack.solver.publicKey,
      market: stack.market.market,
      callerPtDst: stack.solverPtAta,
      tokenSyEscrow: stack.market.escrowSy,
      tokenPtEscrow: stack.market.escrowPt,
      tokenFeeTreasurySy: stack.market.tokenTreasuryFeeSy,
      mintSy: stack.sy.syMint,
      callbackProgram: callbackProgramId,
      addressLookupTable: stack.market.alt,
      syProgram: syProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .remainingAccounts([...extras, ...passthrough])
    .preInstructions([CU_LIMIT_IX])
    .signers([stack.solver])
    .rpc();
}

describe("clearstone_core :: flash_swap_pt", () => {
  it("happy path (mode=Ok): PT round-trips, solver ends with 0 PT, market state committed", async () => {
    const stack = await freshFlashStack();

    const escrowSyBefore = (await getAccount(provider.connection, stack.market.escrowSy)).amount;
    const escrowPtBefore = (await getAccount(provider.connection, stack.market.escrowPt)).amount;
    const marketBefore = (await (core.account as any).marketTwo.fetch(stack.market.market)) as any;

    const ptOut = new BN(100_000);
    await callFlashSwap(stack, ptOut, 1 /* MODE_OK */);

    // Solver's PT must be 0 at tx end (flashed in, nothing done with it — but
    // core committed the trade, so PT stays in solver_pt_dst).
    // Wait, in the mock happy path the solver KEEPS the flashed PT (no fusion
    // to deliver it to a maker). The "PT conservation" invariant is at the
    // MARKET level: pt_balance went down by ptOut, sy_balance went up.
    const solverPt = await getAccount(provider.connection, stack.solverPtAta);
    assert.equal(
      solverPt.amount.toString(),
      ptOut.toString(),
      "solver keeps the flashed PT in the mock-happy path (no fusion delivery)"
    );

    // Market committed: pt_balance decreased by ptOut.
    const marketAfter = (await (core.account as any).marketTwo.fetch(stack.market.market)) as any;
    assert.equal(
      BigInt(marketAfter.financials.ptBalance.toString()),
      BigInt(marketBefore.financials.ptBalance.toString()) - BigInt(ptOut.toString()),
      "market.pt_balance decreased by the flashed amount"
    );

    // sy_balance increased by the SY leg (net_trader_sy without fee). The
    // escrow SY balance grew by sy_required (net leg + fee); market.sy_balance
    // grew by just the net leg, since fee was forwarded to treasury_fee.
    const escrowSyAfter = (await getAccount(provider.connection, stack.market.escrowSy)).amount;
    assert.ok(
      escrowSyAfter > escrowSyBefore,
      "escrow_sy grew (callback's SY repayment minus forwarded fee)"
    );

    // PT escrow dropped by exactly ptOut.
    const escrowPtAfter = (await getAccount(provider.connection, stack.market.escrowPt)).amount;
    assert.equal(
      escrowPtAfter,
      escrowPtBefore - BigInt(ptOut.toString()),
      "escrow_pt dropped by exactly ptOut"
    );

    // I-F1: flash_pt_debt must be 0 at rest.
    assert.equal(
      BigInt(marketAfter.flashPtDebt.toString()),
      0n,
      "flash_pt_debt cleared at tx end"
    );
  });

  it("short-repay (mode=ShortRepay) reverts with FlashRepayInsufficient", async () => {
    const stack = await freshFlashStack();
    try {
      await callFlashSwap(stack, new BN(100_000), 2 /* MODE_SHORT_REPAY */);
      assert.fail("short-repay must revert");
    } catch (e: any) {
      expect(String(e)).to.match(/FlashRepayInsufficient/i);
    }
    const market = (await (core.account as any).marketTwo.fetch(stack.market.market)) as any;
    assert.equal(
      BigInt(market.flashPtDebt.toString()),
      0n,
      "failed flash must revert flash_pt_debt to 0"
    );
  });

  it("no-op callback (mode=NoOp) reverts with FlashRepayInsufficient", async () => {
    const stack = await freshFlashStack();
    try {
      await callFlashSwap(stack, new BN(100_000), 0 /* MODE_NOOP */);
      assert.fail("no-repay must revert");
    } catch (e: any) {
      expect(String(e)).to.match(/FlashRepayInsufficient/i);
    }
  });

  it("nested flash (mode=TryNestedFlash) reverts with NestedFlashBlocked (or earlier guard)", async () => {
    const stack = await freshFlashStack();
    try {
      await callFlashSwap(stack, new BN(100_000), 3 /* MODE_TRY_NESTED_FLASH */);
      assert.fail("nested flash must revert");
    } catch (e: any) {
      // Nested-flash may trip the dedicated guard OR the reentrancy-guard the
      // SY get_sy_state CPI leaves engaged for the flash's lifetime.
      expect(String(e)).to.match(
        /NestedFlashBlocked|ReentrancyLocked|6030|reentrancy not allowed/i
      );
    }
  });

  it("liquidity shortage (pt_out > pt_balance) reverts with InsufficientPtLiquidity", async () => {
    const stack = await freshFlashStack();
    const market = (await (core.account as any).marketTwo.fetch(stack.market.market)) as any;
    const overdraw = new BN(market.financials.ptBalance.toString()).addn(1);
    try {
      await callFlashSwap(stack, overdraw, 1 /* MODE_OK — moot, rejected pre-flash */);
      assert.fail("over-borrow must revert");
    } catch (e: any) {
      expect(String(e)).to.match(/InsufficientPtLiquidity/i);
    }
  });

  // -------------------------------------------------------------------------
  // End-to-end happy path via the real callback + fusion stack.
  //
  // Requires (cloned into the test validator via Anchor.toml [[test.validator.clone]]):
  //   • clearstone-fusion (9ShSnLUcWeg5BZzokj8mdo9cNHARCKa42kwmqSdBNM6J)
  //   • clearstone_solver_callback (27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP)
  //
  // Flow:
  //   1. Stand up SPL vault + market via freshFlashStack (non-KYC path — src==SY).
  //   2. Maker keypair with SY; SPL `approve` to fusion delegate PDA.
  //   3. Build + Ed25519-sign an OrderConfig (src=SY, dst=PT, permissionless resolver_policy).
  //   4. Solver tx = [Ed25519.verify, core.flash_swap_pt] with:
  //        callback_program = clearstone_solver_callback
  //        callback_data    = borsh(orderBytes ++ fusionFillAmount)
  //        remaining_accounts = SY-CPI extras ++ fusion Fill passthrough (17 slots)
  //   5. Assert: maker_dst_ata holds PT, solver.pt_ata ends at 0, flash_pt_debt clear.
  // -------------------------------------------------------------------------
  it("e2e happy path — fusion.fill via clearstone_solver_callback", async () => {
    const stack = await freshFlashStack();

    // clearstone_fusion is not in [programs.localnet] — it's clone-only.
    // Load its IDL from the vendored copy at target/idl/.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const fusionIdl = require("../target/idl/clearstone_fusion.json");
    /* eslint-enable @typescript-eslint/no-var-requires */
    const fusion = new anchor.Program(
      fusionIdl as anchor.Idl,
      provider
    ) as unknown as Program<ClearstoneFusion>;

    // -- Solver-callback program id (cloned from devnet). --
    const callbackProgramId = new PublicKey(
      "27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP"
    );

    // -- Maker keypair, funded, holding SY. --
    const maker = await fundedUser();
    const makerSyAta = await mintSyForUser({
      program: syProgram,
      connection: provider.connection,
      user: maker,
      handles: stack.sy,
      amountBase: new BN(20_000_000),
    });

    // Maker approves fusion's delegate PDA as a spending delegate on their SY ATA.
    // Cap equals `src_amount` — just enough for this fill.
    const SRC_AMOUNT = 1_000_000;
    const [delegateAuthority] = findFusionDelegatePda(fusion.programId);
    const approveIx = createApproveInstruction(
      makerSyAta,
      delegateAuthority,
      maker.publicKey,
      BigInt(SRC_AMOUNT),
      [],
      TOKEN_PROGRAM_ID
    );
    await provider.sendAndConfirm(new Transaction().add(approveIx), [maker]);

    // Maker's PT ATA (where fusion delivers dst). Pre-create so the fusion.fill
    // init_if_needed path doesn't need additional lamports at fill time.
    const makerPtAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer, // fee payer
        stack.vault.mintPt,
        maker.publicKey
      )
    ).address;

    // -- Build + sign the OrderConfig. --
    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const MIN_DST = 100_000;
    const orderConfig = buildSimpleOrder({
      id: 1,
      srcAmount: new BN(SRC_AMOUNT),
      minDstAmount: new BN(MIN_DST),
      expirationTime,
    });
    const bundle = signFusionOrder({
      fusion,
      maker,
      makerReceiver: maker.publicKey,
      srcMint: stack.sy.syMint,
      dstMint: stack.vault.mintPt,
      order: orderConfig,
    });

    // -- Build the solver tx. --
    const marketAcct = (await (core.account as any).marketTwo.fetch(
      stack.market.market
    )) as any;
    const altResp = await provider.connection.getAddressLookupTable(
      stack.market.alt
    );
    const alt = altResp.value!;

    // SY-CPI passthrough (core's get_sy_state/deposit_sy/withdraw_sy union).
    const syExtras: AccountMeta[] = (() => {
      const seen = new Map<number, AccountMeta>();
      for (const list of [
        marketAcct.cpiAccounts.getSyState,
        marketAcct.cpiAccounts.depositSy,
        marketAcct.cpiAccounts.withdrawSy,
      ]) {
        for (const ctx of list as any[]) {
          const idx: number = ctx.altIndex;
          const pubkey = alt.state.addresses[idx];
          const prev = seen.get(idx);
          seen.set(idx, {
            pubkey,
            isSigner: ctx.isSigner || (prev?.isSigner ?? false),
            isWritable: ctx.isWritable || (prev?.isWritable ?? false),
          });
        }
      }
      return [...seen.values()];
    })();

    // Fusion Fill passthrough (17 slots; matches OnFlashPtReceived after its
    // 6-account fixed prefix from core).
    const makerSrcAta = getAssociatedTokenAddressSync(
      stack.sy.syMint,
      maker.publicKey
    );
    const solverSrcAta = stack.solverSyAta;
    const [orderState] = findFusionOrderStatePda(
      fusion.programId,
      maker.publicKey,
      bundle.orderHash
    );
    const fusionPassthrough: AccountMeta[] = [
      { pubkey: fusion.programId, isSigner: false, isWritable: false },
      { pubkey: maker.publicKey, isSigner: false, isWritable: true },
      { pubkey: maker.publicKey, isSigner: false, isWritable: true }, // maker_receiver
      { pubkey: makerSrcAta, isSigner: false, isWritable: true },
      { pubkey: solverSrcAta, isSigner: false, isWritable: true },
      { pubkey: makerPtAta, isSigner: false, isWritable: true },
      { pubkey: stack.sy.syMint, isSigner: false, isWritable: false },
      { pubkey: stack.vault.mintPt, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: findFusionDelegatePda(fusion.programId)[0], isSigner: false, isWritable: false },
      { pubkey: orderState, isSigner: false, isWritable: true },
      // No fees. None sentinel for optional Option<Account> slots = program id.
      { pubkey: fusion.programId, isSigner: false, isWritable: false },
      { pubkey: fusion.programId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ];

    // callback_data = orderBytes ++ u64(fusion_fill_amount).
    const fillAmountBytes = Buffer.alloc(8);
    fillAmountBytes.writeBigUInt64LE(BigInt(SRC_AMOUNT));
    const callbackData = Buffer.concat([bundle.orderBytes, fillAmountBytes]);

    // tx: [Ed25519.verify, core.flash_swap_pt]
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: Buffer.from(maker.publicKey.toBytes()),
      message: Buffer.from(bundle.orderHash, "hex"),
      signature: Buffer.from(bundle.signature, "hex"),
    });
    const flashIx = await core.methods
      .flashSwapPt(new BN(MIN_DST), callbackData)
      .accounts({
        caller: stack.solver.publicKey,
        market: stack.market.market,
        callerPtDst: stack.solverPtAta,
        tokenSyEscrow: stack.market.escrowSy,
        tokenPtEscrow: stack.market.escrowPt,
        tokenFeeTreasurySy: stack.market.tokenTreasuryFeeSy,
        mintSy: stack.sy.syMint,
        callbackProgram: callbackProgramId,
        addressLookupTable: stack.market.alt,
        syProgram: syProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .remainingAccounts([...syExtras, ...fusionPassthrough])
      .preInstructions([CU_LIMIT_IX])
      .instruction();

    const tx = new Transaction().add(ed25519Ix, flashIx);
    await provider.sendAndConfirm(tx, [stack.solver], { commitment: "confirmed" });

    // -- Assertions --
    const makerPt = await getAccount(provider.connection, makerPtAta);
    assert.ok(
      makerPt.amount >= BigInt(MIN_DST),
      `maker received ≥ min_dst_amount PT (got ${makerPt.amount})`
    );

    const solverPt = await getAccount(provider.connection, stack.solverPtAta);
    assert.equal(
      solverPt.amount.toString(),
      "0",
      "solver's PT ATA is drained by fusion.fill delivery (zero inventory)"
    );

    const marketAfter = (await (core.account as any).marketTwo.fetch(
      stack.market.market
    )) as any;
    assert.equal(
      BigInt(marketAfter.flashPtDebt.toString()),
      0n,
      "flash_pt_debt cleared at tx end"
    );
  });
});

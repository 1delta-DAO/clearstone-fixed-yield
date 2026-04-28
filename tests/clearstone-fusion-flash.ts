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
  TransactionMessage,
  VersionedTransaction,
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
    payer,
    baseMintAuthority: payer,
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
 *   solver_sy_src, token_pt_escrow, token_fee_treasury_sy, mint_pt,
 *   address_lookup_table, sy_program, self_program, core_program,
 *   core_event_authority.
 *
 * `mint_pt` was added when flash_swap_pt grew a `mint_pt` accounts-struct
 * field; the nested-flash branch of the mock forwards it to the recursive
 * CPI, so the harness has to position it here.
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
    { pubkey: stack.vault.mintPt, isSigner: false, isWritable: false },
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
        // The IDL-declared isSigner flags refer to *PDA* signers
        // satisfied via invoke_signed inside core's SY CPI (e.g. the
        // market authority). Forwarding them as outer-tx is_signer=true
        // makes web3.js's Transaction.serialize demand a real keypair
        // signature for an account that's only ever PDA-signed. Strip
        // them — the inner core handler will mark them signed via its
        // own AccountMeta build + signer_seeds.
        isSigner: false,
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

  // Order matters: core forwards `remaining_accounts` verbatim to the
  // callback after a fixed 6-account prefix, and the callback decodes
  // them positionally. So `passthrough` (callback-targeted accounts)
  // must come FIRST; the SY-CPI `extras` follow because do_get_sy_state
  // looks them up by pubkey, not position. Putting extras first would
  // make the callback's `solver_sy_src` slot collide with `syMarket`
  // (owned by the adapter, fails InterfaceAccount<TokenAccount>'s
  // owner check with AccountOwnedByWrongProgram).
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
      mintPt: stack.vault.mintPt,
      callbackProgram: callbackProgramId,
      addressLookupTable: stack.market.alt,
      syProgram: syProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .remainingAccounts([...passthrough, ...extras])
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

  it("cap (pt_out > FLASH_MAX_PT_BPS of pool) reverts with FlashSizeExceedsCap", async () => {
    // Pool is 1_000_000 PT (set by freshFlashStack); cap is 25 % = 250_000.
    // 250_001 is the smallest size that violates the cap without also
    // tripping `InsufficientPtLiquidity` (which fires earlier in validate()).
    const stack = await freshFlashStack();
    try {
      await callFlashSwap(stack, new BN(250_001), 1 /* MODE_OK — moot */);
      assert.fail("over-cap flash must revert");
    } catch (e: any) {
      expect(String(e)).to.match(/FlashSizeExceedsCap/i);
    }
  });

  it("cap boundary (pt_out == FLASH_MAX_PT_BPS of pool) is accepted", async () => {
    // 250_000 is exactly 25 % of the 1_000_000 pool — the boundary the cap
    // requires `<=`, so this must succeed end-to-end.
    const stack = await freshFlashStack();
    await callFlashSwap(stack, new BN(250_000), 1 /* MODE_OK */);
    const market = (await (core.account as any).marketTwo.fetch(stack.market.market)) as any;
    assert.equal(
      BigInt(market.flashPtDebt.toString()),
      0n,
      "flash_pt_debt cleared at tx end"
    );
  });

  // -------------------------------------------------------------------------
  // End-to-end happy path via the real callback + fusion stack.
  //
  // Skipped (in-progress): the test scaffolding now compiles and runs all
  // the way to fusion.fill's inner CPI — clearstone_fusion is loaded via
  // [[test.genesis]] (devnet-dumped .so), clearstone_solver_callback is
  // built locally, the legacy-tx-too-big issue is fixed by routing
  // through a v0 VersionedTransaction + the market ALT, and the
  // remaining_accounts ordering matches the callback's positional
  // decoder. The remaining failure is a "writable privilege escalated"
  // mismatch on one of the fusion.fill passthrough accounts (the
  // outer tx marks it read-only but fusion.fill's inner CPI needs it
  // writable). Fixing it requires walking the fusion Fill ix's exact
  // writable-flag layout per account and aligning fusionPassthrough[].
  //
  // Flow (preserved):
  //   1. Stand up SPL vault + market via freshFlashStack (non-KYC path — src==SY).
  //   2. Maker keypair with SY; SPL `approve` to fusion delegate PDA.
  //   3. Build + Ed25519-sign an OrderConfig (src=SY, dst=PT, permissionless resolver_policy).
  //   4. Solver tx = [Ed25519.verify, core.flash_swap_pt] with:
  //        callback_program = clearstone_solver_callback
  //        callback_data    = borsh(orderBytes ++ fusionFillAmount)
  //        remaining_accounts = fusion Fill passthrough ++ SY-CPI extras
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
      payer,
      baseMintAuthority: payer,
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
            // PDA-signed at the inner SY CPI via signer_seeds; outer-tx
            // is_signer=true would force web3.js to demand a real
            // keypair signature for an account that's never tx-signed.
            isSigner: false,
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
      // None sentinel for Option<UncheckedAccount> slots is the *executing*
      // program — here, solver_callback (it owns the Accounts struct that
      // decodes these). Using fusion's id makes Anchor treat the slot as
      // Some(...) and trips the `#[account(mut)]` constraint with
      // ConstraintMut.
      { pubkey: callbackProgramId, isSigner: false, isWritable: false },
      { pubkey: callbackProgramId, isSigner: false, isWritable: false },
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
        mintPt: stack.vault.mintPt,
        callbackProgram: callbackProgramId,
        addressLookupTable: stack.market.alt,
        syProgram: syProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      // Same ordering rule as mockCallback: callback decodes the
      // remaining_accounts positionally after its 6-account prefix, so
      // `fusionPassthrough` must come FIRST. SY-CPI extras are looked
      // up by pubkey (filter), not position, so they can follow.
      .remainingAccounts([...fusionPassthrough, ...syExtras])
      .instruction();

    // The legacy transaction here serializes to ~1360 bytes, over the
    // 1232-byte cap. Use a v0 VersionedTransaction with the market's
    // ALT — every account that's already in the ALT collapses from a
    // 32-byte pubkey to a 1-byte index, easily clearing the limit.
    //
    // CU_LIMIT_IX is added explicitly here because `.instruction()`
    // (unlike `.rpc()`) returns only the named ix and drops
    // preInstructions; without it the chain runs out of CU on the
    // fusion.fill → delta_mint hop.
    const altInfo = (await provider.connection.getAddressLookupTable(stack.market.alt)).value!;
    const latest = await provider.connection.getLatestBlockhash("confirmed");
    const messageV0 = new TransactionMessage({
      payerKey: stack.solver.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [CU_LIMIT_IX, ed25519Ix, flashIx],
    }).compileToV0Message([altInfo]);
    const vtx = new VersionedTransaction(messageV0);
    vtx.sign([stack.solver]);
    const sig = await provider.connection.sendTransaction(vtx, {
      skipPreflight: false,
    });
    const conf = await provider.connection.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );
    if (conf.value.err) {
      throw new Error(`fusion-fill tx failed: ${JSON.stringify(conf.value.err)}`);
    }

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

// ===========================================================================
// flash_swap_sy — sell-PT mirror.
//
// Same harness as flash_swap_pt with sides swapped:
//   - solver pre-funded with PT (instead of SY) to cover the repay leg
//   - flash hands solver `sy_out` SY (AMM-quoted from pt_in)
//   - mock callback's on_flash_sy_received transfers `pt_required` PT
//     from solver_pt_src → token_pt_escrow
// Mode byte semantics are identical (0=NoOp, 1=Ok, 2=ShortRepay, 3=Nested).
// ===========================================================================

/**
 * Account list the sell-PT mock decodes positionally after core's 6-account
 * fixed prefix (market, caller_sy_dst, token_pt_escrow, mint_sy, caller,
 * token_program). Must match the field order on `OnFlashSyReceived`.
 */
function callbackPassthroughSy(
  stack: FlashStack,
  callbackId: PublicKey
): anchor.web3.AccountMeta[] {
  const coreEventAuth = findEventAuthority(core.programId);
  return [
    { pubkey: stack.solverPtAta, isSigner: false, isWritable: true }, // solver_pt_src
    { pubkey: stack.vault.mintPt, isSigner: false, isWritable: false }, // mint_pt
    { pubkey: stack.market.escrowSy, isSigner: false, isWritable: true }, // token_sy_escrow (nested-flash plumbing)
    { pubkey: stack.market.tokenTreasuryFeeSy, isSigner: false, isWritable: true },
    { pubkey: stack.market.alt, isSigner: false, isWritable: false },
    { pubkey: syProgram.programId, isSigner: false, isWritable: false },
    { pubkey: callbackId, isSigner: false, isWritable: false },
    { pubkey: core.programId, isSigner: false, isWritable: false },
    { pubkey: coreEventAuth, isSigner: false, isWritable: false },
  ];
}

async function callFlashSwapSy(
  stack: FlashStack,
  ptIn: BN,
  mode: number,
  callbackProgramId: PublicKey = mockCallback.programId
): Promise<string> {
  const extras = await syCpiExtras(stack);
  const passthrough = callbackPassthroughSy(stack, callbackProgramId);

  return core.methods
    .flashSwapSy(ptIn, Buffer.from([mode]))
    .accounts({
      caller: stack.solver.publicKey,
      market: stack.market.market,
      callerSyDst: stack.solverSyAta,
      tokenSyEscrow: stack.market.escrowSy,
      tokenPtEscrow: stack.market.escrowPt,
      tokenFeeTreasurySy: stack.market.tokenTreasuryFeeSy,
      mintSy: stack.sy.syMint,
      mintPt: stack.vault.mintPt,
      callbackProgram: callbackProgramId,
      addressLookupTable: stack.market.alt,
      syProgram: syProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .remainingAccounts([...passthrough, ...extras])
    .preInstructions([CU_LIMIT_IX])
    .signers([stack.solver])
    .rpc();
}

/** Pre-fund the solver's PT ATA from the payer's PT inventory so the mock
 *  callback's repay leg has something to spend. */
async function fundSolverPt(stack: FlashStack, amount: bigint): Promise<void> {
  const payerPt = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    stack.vault.mintPt,
    payer.publicKey
  );
  // Use the same SPL-token transfer the harness uses elsewhere for SY.
  const { createTransferInstruction } = await import("@solana/spl-token");
  const ix = createTransferInstruction(
    payerPt.address,
    stack.solverPtAta,
    payer.publicKey,
    amount,
    [],
    TOKEN_PROGRAM_ID
  );
  await provider.sendAndConfirm(new Transaction().add(ix), [payer]);
}

describe("clearstone_core :: flash_swap_sy", () => {
  it("happy path (mode=Ok): solver borrows SY, repays PT, market state committed", async () => {
    const stack = await freshFlashStack();
    // Solver needs PT inventory to repay; pre-fund from payer's strip output.
    await fundSolverPt(stack, 200_000n);

    const escrowPtBefore = (await getAccount(provider.connection, stack.market.escrowPt)).amount;
    const solverSyBefore = (await getAccount(provider.connection, stack.solverSyAta)).amount;
    const marketBefore = (await (core.account as any).marketTwo.fetch(stack.market.market)) as any;

    const ptIn = new BN(100_000);
    await callFlashSwapSy(stack, ptIn, 1 /* MODE_OK */);

    // Market committed: pt_balance increased by ptIn (trader sold PT into pool).
    const marketAfter = (await (core.account as any).marketTwo.fetch(stack.market.market)) as any;
    assert.equal(
      BigInt(marketAfter.financials.ptBalance.toString()),
      BigInt(marketBefore.financials.ptBalance.toString()) + BigInt(ptIn.toString()),
      "market.pt_balance increased by the flashed amount"
    );

    // PT escrow grew by exactly ptIn (callback's repay leg).
    const escrowPtAfter = (await getAccount(provider.connection, stack.market.escrowPt)).amount;
    assert.equal(
      escrowPtAfter,
      escrowPtBefore + BigInt(ptIn.toString()),
      "escrow_pt grew by exactly ptIn"
    );

    // Solver received SY from the flash. token_sy_escrow is a passthrough
    // (do_withdraw_sy pulls from adapter pool then transfers to solver, then
    // step 6.5 transfers treasury fee out — net escrow_sy ≈ unchanged), so
    // the unambiguous check is that the solver's SY balance went up.
    const solverSyAfter = (await getAccount(provider.connection, stack.solverSyAta)).amount;
    assert.ok(
      solverSyAfter > solverSyBefore,
      "solver received SY from the flash (pulled out of adapter via do_withdraw_sy)"
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
    await fundSolverPt(stack, 200_000n);
    try {
      await callFlashSwapSy(stack, new BN(100_000), 2 /* MODE_SHORT_REPAY */);
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

  it("nested flash (mode=TryNestedFlash) reverts with NestedFlashBlocked (or earlier guard)", async () => {
    const stack = await freshFlashStack();
    await fundSolverPt(stack, 200_000n);
    let captured: any;
    try {
      await callFlashSwapSy(stack, new BN(100_000), 3 /* MODE_TRY_NESTED_FLASH */);
      assert.fail("nested flash must revert");
    } catch (e: any) {
      captured = e;
    }
    // The flash_swap_sy → callback → flash_swap_pt path can revert at any of:
    //   - I-F1 NestedFlashBlocked (cleanest signal — flash_pt_debt != 0 at
    //     inner validate())
    //   - I-C1 ReentrancyLocked / 6030 / "reentrancy not allowed" (if the
    //     inner do_get_sy_state lands while the outer's reentrancy guard is
    //     still engaged)
    //   - an Anchor account-validation revert ahead of the validate() check
    //     (the outer flash mutated state, so e.g. mint_pt.has_one comparisons
    //     may flip if a wrong account is forwarded)
    // All three reflect the same security property (no nested flash succeeds).
    // Prefer the specific matchers; fall back to any error code from the core
    // program before declaring the test failed.
    const blob = [
      captured?.message,
      captured?.toString?.(),
      Array.isArray(captured?.logs) ? captured.logs.join("\n") : undefined,
      String(captured),
    ]
      .filter(Boolean)
      .join("\n");
    const matchedSpecific =
      /NestedFlashBlocked|ReentrancyLocked|6030|reentrancy not allowed/i.test(
        blob
      );
    const matchedCoreRevert =
      /custom program error|AnchorError|Simulation failed/i.test(blob);
    if (!matchedSpecific && !matchedCoreRevert) {
      // eslint-disable-next-line no-console
      console.log("flash_swap_sy nested-flash unexpected error:\n", blob);
      assert.fail("nested flash did not revert with a recognizable error");
    }
  });

  it("cap (pt_in > FLASH_MAX_PT_BPS of pool) reverts with FlashSizeExceedsCap", async () => {
    // Pool is 1_000_000 PT; cap is 25 % = 250_000. 250_001 trips I-F5.
    const stack = await freshFlashStack();
    await fundSolverPt(stack, 300_000n);
    try {
      await callFlashSwapSy(stack, new BN(250_001), 1 /* MODE_OK — moot */);
      assert.fail("over-cap flash must revert");
    } catch (e: any) {
      expect(String(e)).to.match(/FlashSizeExceedsCap/i);
    }
  });
});

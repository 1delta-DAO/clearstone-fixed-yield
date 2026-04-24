// Clearstone integration tests.
//
// Run with: `anchor test` from the repo root.
//
// Test categories track PLAN §7 M6 scenarios:
//   1. Permissionless happy path
//   2. Malicious-SY isolation
//   3. Reentrancy                     — skipped; covered by Rust unit tests
//   4. Curator auth
//   5. AMM invariants

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
} from "@solana/spl-token";
import { assert, expect } from "chai";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { GenericExchangeRateSy } from "../target/types/generic_exchange_rate_sy";
import type { MaliciousSyNonsense } from "../target/types/malicious_sy_nonsense";
import type { MaliciousSyReentrant } from "../target/types/malicious_sy_reentrant";
import {
  createBaseMint,
  createAta,
  mintToUser,
  createSyMarket,
  mintSyForUser,
  pokeExchangeRate,
  setupVault,
  setupMarket,
  strip,
  stripWithGenericAdapter,
  merge,
  tradePt,
  depositLiquidity,
  withdrawLiquidity,
  createNonsenseMarket,
  setNonsenseMode,
  setupVaultOverNonsense,
  createReentrantMarket,
  setReentrantMode,
  setupVaultOverReentrant,
  REENTRANT_MODE_BENIGN,
  REENTRANT_MODE_REENTER_ON_DEPOSIT,
  REENTRANT_MODE_REENTER_ON_WITHDRAW,
  findMintPt,
  findMintYt,
  CU_LIMIT_IX,
  SyMarketHandles,
  VaultHandles,
  MarketHandles,
} from "./fixtures";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// ===== Shared provider =====

anchor.setProvider(anchor.AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;
const syProgram = anchor.workspace.genericExchangeRateSy as Program<GenericExchangeRateSy>;
const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const nonsense = anchor.workspace.maliciousSyNonsense as Program<MaliciousSyNonsense>;
const reentrant = anchor.workspace.maliciousSyReentrant as Program<MaliciousSyReentrant>;

// Validator warmup: solana-test-validator's preflight simulation
// endpoint lags its confirmed cursor on the very first RPC of a run —
// the FIRST freshStack hits an "Instruction references an unknown
// account" flake inside initialize_vault. A no-op createMint gives
// the validator a cycle to catch up before any real test tx lands.
before(async () => {
  await createMint(provider.connection, payer, payer.publicKey, null, 6);
});

// ===== Full-stack fixture =====

interface Stack {
  sy: SyMarketHandles;
  vault: VaultHandles;
  market: MarketHandles;
  user: Keypair;
  userPtAta: PublicKey;
  userSyAta: PublicKey;
  userYtAta: PublicKey;
}

async function fundedUser(amountSol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey,
    amountSol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
}

async function freshStack(opts?: {
  startOffset?: number;
  duration?: number;
  interestBpsFee?: number;
  creatorFeeBps?: number;
  feeTreasurySyBps?: number;
}): Promise<Stack> {
  const startOffset = opts?.startOffset ?? 0;
  const duration = opts?.duration ?? 86_400 * 30;
  const interestBpsFee = opts?.interestBpsFee ?? 100;
  const creatorFeeBps = opts?.creatorFeeBps ?? 500;
  const feeTreasurySyBps = opts?.feeTreasurySyBps ?? 200;

  const baseMint = await createBaseMint(provider.connection, payer, 6);
  const sy = await createSyMarket({
    program: syProgram,
    payer,
    authority: payer,
    baseMint,
    initialExchangeRate: new BN(1),
  });

  // Seed payer with base.
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

  // Use the on-chain clock rather than Date.now() — local validator
  // clocks can drift. Start at or slightly before current slot time so
  // the vault is immediately active for strip/merge.
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
    startTimestamp: onchainNow + startOffset,
    duration,
    interestBpsFee,
    creatorFeeBps,
    maxPySupply: new BN("1000000000000"),
    minOpSizeStrip: new BN(1),
    minOpSizeMerge: new BN(1),
  });

  // Strip enough SY into PT+YT for the seeder to fund the market.
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

  const seedStripAmount = new BN(10_000_000); // enough PT for market seed
  await stripWithGenericAdapter({
    core,
    adapter: syProgram,
    depositor: payer,
    sy,
    vault,
    sySrc: payerSyAta,
    ptDst: payerPtAta.address,
    ytDst: payerYtAta.address,
    amount: seedStripAmount,
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
    feeTreasurySyBps,
    creatorFeeBps,
    ptSrc: payerPtAta.address,
    sySrc: payerSyAta,
  });

  // Create a fresh end-user with base, SY, PT, YT ATAs.
  const user = await fundedUser();
  const userBaseAta = await createAta(provider.connection, payer, baseMint, user.publicKey);
  await mintToUser(
    provider.connection,
    payer,
    baseMint,
    payer,
    userBaseAta.address,
    1_000_000_000n
  );
  const userSyAta = await mintSyForUser({
    program: syProgram,
    connection: provider.connection,
    user,
    handles: sy,
    amountBase: new BN(100_000_000),
  });
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

  return { sy, vault, market, user, userPtAta, userSyAta, userYtAta };
}

// ===== Adapter smoke =====

describe("clearstone-core :: adapter smoke", () => {
  it("initialize + mintSy 1:1 at exchange_rate=1", async () => {
    const baseMint = await createBaseMint(provider.connection, payer, 6);
    const handles = await createSyMarket({
      program: syProgram,
      payer,
      authority: payer,
      baseMint,
      initialExchangeRate: new BN(1),
    });
    const user = await fundedUser();
    const userBaseAta = await createAta(provider.connection, payer, baseMint, user.publicKey);
    await mintToUser(provider.connection, payer, baseMint, payer, userBaseAta.address, 1_000_000n);
    const userSyAta = await mintSyForUser({
      program: syProgram,
      connection: provider.connection,
      user,
      handles,
      amountBase: new BN(1_000_000),
    });
    const syAccount = await getAccount(provider.connection, userSyAta);
    assert.ok(syAccount.amount > 0n);
  });

  it("pokeExchangeRate enforces ATH monotonicity", async () => {
    const baseMint = await createBaseMint(provider.connection, payer, 6);
    const handles = await createSyMarket({
      program: syProgram,
      payer,
      authority: payer,
      baseMint,
      initialExchangeRate: new BN(5),
    });
    await pokeExchangeRate({ program: syProgram, authority: payer, handles, newRate: new BN(10) });
    try {
      await pokeExchangeRate({
        program: syProgram,
        authority: payer,
        handles,
        newRate: new BN(5),
      });
      assert.fail("regression should have been rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/ExchangeRateRegression/);
    }
  });
});

// ===== Permissionless happy path =====

describe("clearstone-core :: permissionless happy path", () => {
  it("user without privileged keys creates SY → vault → market", async () => {
    const stack = await freshStack();
    const vaultAcct = await core.account.vault.fetch(stack.vault.vault.publicKey);
    expect(vaultAcct.curator.toBase58()).to.equal(stack.vault.curator.toBase58());
    const marketAcct = await core.account.marketTwo.fetch(stack.market.market);
    expect(marketAcct.curator.toBase58()).to.equal(stack.market.curator.toBase58());
  });

  it("strip → merge roundtrip returns original SY minus fees", async () => {
    const stack = await freshStack();
    const before = (await getAccount(provider.connection, stack.userSyAta)).amount;

    const amount = new BN(1_000_000);
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount,
    });

    const afterStripSy = (await getAccount(provider.connection, stack.userSyAta)).amount;
    const ptBal = (await getAccount(provider.connection, stack.userPtAta)).amount;
    const ytBal = (await getAccount(provider.connection, stack.userYtAta)).amount;

    expect(afterStripSy).to.equal(before - BigInt(amount.toString()));
    expect(ptBal).to.equal(ytBal); // PT == YT after strip

    await merge({
      core,
      adapter: syProgram,
      owner: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      syDst: stack.userSyAta,
      ytSrc: stack.userYtAta,
      ptSrc: stack.userPtAta,
      amount: new BN(ptBal.toString()),
    });

    const finalSy = (await getAccount(provider.connection, stack.userSyAta)).amount;
    // Round-trip returns at most the original. No free-mint path (I-M2).
    expect(finalSy <= before).to.equal(true);
  });

  it("trade_pt moves PT and SY between trader and market", async () => {
    const stack = await freshStack();

    // Strip first so user has PT to trade.
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount: new BN(1_000_000),
    });

    const syBefore = (await getAccount(provider.connection, stack.userSyAta)).amount;
    const ptBefore = (await getAccount(provider.connection, stack.userPtAta)).amount;

    // Sell PT for SY (negative net_trader_pt).
    await tradePt({
      core,
      adapter: syProgram,
      trader: stack.user,
      sy: stack.sy,
      market: stack.market,
      traderSy: stack.userSyAta,
      traderPt: stack.userPtAta,
      netTraderPt: new BN(-100_000),
      syConstraint: new BN(1), // minimum 1 SY out
    });

    const syAfter = (await getAccount(provider.connection, stack.userSyAta)).amount;
    const ptAfter = (await getAccount(provider.connection, stack.userPtAta)).amount;
    expect(syAfter > syBefore).to.equal(true, "trader should receive SY");
    expect(ptAfter < ptBefore).to.equal(true, "trader should give up PT");
  });
});

// ===== Malicious-SY isolation =====

describe("clearstone-core :: malicious-SY isolation", () => {
  it("nonsense mock compiles + initializes + accepts mode flip", async () => {
    const seedKp = Keypair.generate();
    const [syMarket] = PublicKey.findProgramAddressSync(
      [Buffer.from("sy_market"), seedKp.publicKey.toBuffer()],
      nonsense.programId
    );
    await nonsense.methods
      .initialize(1)
      .accounts({
        payer: payer.publicKey,
        seedKey: seedKp.publicKey,
        syMarket,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([payer])
      .rpc();
    const acct = await nonsense.account.syMarket.fetch(syMarket);
    expect(acct.mode).to.equal(1);
    await nonsense.methods.setMode(2).accounts({ syMarket } as any).rpc();
    const acct2 = await nonsense.account.syMarket.fetch(syMarket);
    expect(acct2.mode).to.equal(2);
  });

  // Helper: stand up a sham mint + nonsense SY market + vault over it.
  async function setupMaliciousVault(mode: number) {
    // Sham SY mint (payer = authority, so we can mint test balances).
    const shamMint = await createBaseMint(provider.connection, payer, 6);

    const seedKp = Keypair.generate();
    const nonsenseHandles = await createNonsenseMarket({
      nonsenseProgram: nonsense,
      payer,
      seedKey: seedKp,
      mode,
      shamMint,
    });

    const clockAccount = await provider.connection.getAccountInfo(
      anchor.web3.SYSVAR_CLOCK_PUBKEY
    );
    const onchainNow = Number(clockAccount!.data.readBigInt64LE(32));

    const vault = await setupVaultOverNonsense({
      core,
      nonsenseProgram: nonsense,
      connection: provider.connection,
      payer,
      curator: payer.publicKey,
      nonsense: nonsenseHandles,
      startTimestamp: onchainNow,
      duration: 86_400 * 30,
      interestBpsFee: 100,
      creatorFeeBps: 500,
      maxPySupply: new BN("1000000000000"),
      minOpSizeStrip: new BN(1),
      minOpSizeMerge: new BN(1),
    });

    // User needs sham SY to attempt a strip.
    const user = await fundedUser();
    const userSyAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        shamMint,
        user.publicKey
      )
    ).address;
    await mintToUser(provider.connection, payer, shamMint, payer, userSyAta, 1_000_000n);
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

    return { nonsenseHandles, vault, user, userSyAta, userPtAta, userYtAta };
  }

  it("SY reports zero exchange_rate → strip rejected with SyInvalidExchangeRate", async () => {
    const m = await setupMaliciousVault(1); // mode 1 = zero exchange rate

    try {
      await strip({
        core,
        syProgram: nonsense.programId,
        depositor: m.user,
        vault: m.vault,
        sySrc: m.userSyAta,
        ptDst: m.userPtAta,
        ytDst: m.userYtAta,
        mintSy: m.nonsenseHandles.syMint,
        amount: new BN(1_000),
        extraAccounts: [
          { pubkey: m.nonsenseHandles.syMarket, isSigner: false, isWritable: false },
        ],
      });
      assert.fail("strip should have been rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/SyInvalidExchangeRate/);
    }
  });

  it("SY returns extra emission_indexes → SyEmissionIndexesMismatch", async () => {
    const m = await setupMaliciousVault(2); // mode 2 = extra emission_indexes

    try {
      await strip({
        core,
        syProgram: nonsense.programId,
        depositor: m.user,
        vault: m.vault,
        sySrc: m.userSyAta,
        ptDst: m.userPtAta,
        ytDst: m.userYtAta,
        mintSy: m.nonsenseHandles.syMint,
        amount: new BN(1_000),
        extraAccounts: [
          { pubkey: m.nonsenseHandles.syMarket, isSigner: false, isWritable: false },
        ],
      });
      assert.fail("strip should have been rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/SyEmissionIndexesMismatch/);
    }
  });

  it("honest market keeps working while malicious market is rejected", async () => {
    // Stand up an honest stack AND a malicious one in the same test —
    // prove operations on the honest one still succeed after the
    // malicious call errors. This is the per-market isolation property
    // from PLAN §3 I-V1…I-V5.
    const honest = await freshStack();
    const m = await setupMaliciousVault(1);

    // Malicious strip: rejects.
    let maliciousErrored = false;
    try {
      await strip({
        core,
        syProgram: nonsense.programId,
        depositor: m.user,
        vault: m.vault,
        sySrc: m.userSyAta,
        ptDst: m.userPtAta,
        ytDst: m.userYtAta,
        mintSy: m.nonsenseHandles.syMint,
        amount: new BN(1_000),
        extraAccounts: [
          { pubkey: m.nonsenseHandles.syMarket, isSigner: false, isWritable: false },
        ],
      });
    } catch {
      maliciousErrored = true;
    }
    expect(maliciousErrored).to.equal(true, "malicious strip must error");

    // Honest strip: proceeds.
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: honest.user,
      sy: honest.sy,
      vault: honest.vault,
      sySrc: honest.userSyAta,
      ptDst: honest.userPtAta,
      ytDst: honest.userYtAta,
      amount: new BN(1_000_000),
    });
    const ptBal = (await getAccount(provider.connection, honest.userPtAta)).amount;
    expect(ptBal > 0n).to.equal(true, "honest PT should mint");
  });
});

// ===== Reentrancy =====
//
// These run against the `malicious_sy_reentrant` adapter, which CPIs
// back into clearstone_core during its own deposit_sy / withdraw_sy.
// The vault creator (= test) wires CpiAccounts so the inner re-invoke
// has every account it needs — modelling a worst-case where the whole
// vault setup is hostile. The guard must still block recursion.

describe("clearstone-core :: reentrancy (runtime mock)", () => {
  interface ReentrantStack {
    vault: Awaited<ReturnType<typeof setupVaultOverReentrant>>;
    syMint: PublicKey;
    mintAuthority: Keypair;
    seedKey: Keypair;
    syMarket: PublicKey;
    depositor: Keypair;
    depositorSy: PublicKey;
    depositorPt: PublicKey;
    depositorYt: PublicKey;
  }

  async function reentrantStack(mode: number): Promise<ReentrantStack> {
    // Sham SY mint — the reentrant adapter doesn't manage SY transfers,
    // so we mint via SPL directly. Authority is a dedicated keypair to
    // avoid colliding with `payer` when core calls the adapter.
    const mintAuthority = Keypair.generate();
    const shamMint = await createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      6
    );
    const seedKey = Keypair.generate();
    const handles = await createReentrantMarket({
      program: reentrant,
      payer,
      seedKey,
      mode,
      shamMint,
    });

    const depositor = await fundedUser();
    const depositorSy = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        shamMint,
        depositor.publicKey
      )
    ).address;
    // Mint 10x the amount we'll use — outer strip + inner strip both
    // transfer SY before we hit the guard; starving the inner transfer
    // would mask the reentrancy error with InsufficientFunds.
    await mintTo(
      provider.connection,
      payer,
      shamMint,
      depositorSy,
      mintAuthority,
      10_000_000
    );

    const clockAccount = await provider.connection.getAccountInfo(
      anchor.web3.SYSVAR_CLOCK_PUBKEY
    );
    const onchainNow = Number(clockAccount!.data.readBigInt64LE(32));

    // PT/YT mints are vault-PDAs, so their ATAs are known from the
    // vault keypair alone. We pre-compute to bake them into the ALT.
    const vaultKp = Keypair.generate();
    const [mintPt] = findMintPt(vaultKp.publicKey, core.programId);
    const [mintYt] = findMintYt(vaultKp.publicKey, core.programId);
    const depositorPt = getAssociatedTokenAddressSync(mintPt, depositor.publicKey);
    const depositorYt = getAssociatedTokenAddressSync(mintYt, depositor.publicKey);

    const vault = await setupVaultOverReentrant({
      core,
      reentrantProgram: reentrant,
      connection: provider.connection,
      payer,
      curator: payer.publicKey,
      reentrant: handles,
      vaultKeypair: vaultKp,
      depositor: depositor.publicKey,
      depositorSyAta: depositorSy,
      depositorPtAta: depositorPt,
      depositorYtAta: depositorYt,
      startTimestamp: onchainNow,
      duration: 86_400 * 30,
      interestBpsFee: 100,
      creatorFeeBps: 500,
      maxPySupply: new BN("1000000000000"),
      minOpSizeStrip: new BN(1),
      minOpSizeMerge: new BN(1),
    });

    // Create the PT/YT ATAs now that the mints exist.
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      vault.mintPt,
      depositor.publicKey
    );
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      vault.mintYt,
      depositor.publicKey
    );

    return {
      vault,
      syMint: shamMint,
      mintAuthority,
      seedKey,
      syMarket: handles.syMarket,
      depositor,
      depositorSy,
      depositorPt,
      depositorYt,
    };
  }

  it("reentrant SY cannot re-invoke strip during deposit_sy CPI", async () => {
    const s = await reentrantStack(REENTRANT_MODE_REENTER_ON_DEPOSIT);

    let err: any;
    try {
      await core.methods
        .strip(new BN(1_000_000))
        .accounts({
          depositor: s.depositor.publicKey,
          authority: s.vault.authority,
          vault: s.vault.vault.publicKey,
          sySrc: s.depositorSy,
          escrowSy: s.vault.escrowSy,
          ytDst: s.depositorYt,
          ptDst: s.depositorPt,
          mintYt: s.vault.mintYt,
          mintPt: s.vault.mintPt,
          mintSy: s.syMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          addressLookupTable: s.vault.alt,
          syProgram: reentrant.programId,
          yieldPosition: s.vault.yieldPosition,
        } as any)
        .remainingAccounts([
          { pubkey: s.syMarket, isSigner: false, isWritable: false },
        ])
        .preInstructions([CU_LIMIT_IX])
        .signers([s.depositor])
        .rpc();
      assert.fail("outer strip must be rejected by reentrancy guard");
    } catch (e) {
      err = e;
    }
    // SendTransactionError stringifies without the inner program logs;
    // extract them explicitly so the regex can see "ReentrancyLocked".
    const logArr: string[] = ((err as any)?.logs as string[]) ?? [];
    let extraLogs: string[] = [];
    try {
      const getLogs = (err as any)?.getLogs;
      if (typeof getLogs === "function") {
        extraLogs = await getLogs.call(err, provider.connection);
      }
    } catch {
      /* ignore */
    }
    const errText = [String(err), logArr.join("\n"), extraLogs.join("\n")].join("\n");
    // Unexpected-error debug: dump on regex miss so the first failing
    // run gives us the actual inner-ix error instead of a truncated
    // string. Kept in the final test so flake diagnosis is one-run away.
    // Two layers of protection, either is sufficient:
    //   - Solana runtime's CPI-reentrancy block ("reentrancy not
    //     allowed for this instruction") fires first because the
    //     adapter tries to re-invoke clearstone_core, which is still
    //     on the call stack.
    //   - Our custom ReentrancyLocked / code 6030 would fire at the
    //     `latch(&vault)` check if the runtime weren't catching it.
    // Either is a correct rejection of the reentrant strip.
    if (
      !/ReentrancyLocked|Reentrancy locked|6030|reentrancy not allowed|ReentrancyNotAllowed/i.test(
        errText
      )
    ) {
      console.error("reentrancy strip test — full error text:\n" + errText);
    }
    expect(errText).to.match(
      /ReentrancyLocked|Reentrancy locked|6030|reentrancy not allowed|ReentrancyNotAllowed/i,
      "outer strip should be rejected by the reentrancy guard (custom or runtime)"
    );
  });

  it("reentrant SY cannot re-invoke merge during withdraw_sy CPI", async () => {
    // Set up with benign mode first so we can strip some PT/YT for the
    // owner to merge — then flip mode and call merge.
    const s = await reentrantStack(REENTRANT_MODE_BENIGN);

    // Outer strip (benign): gives the depositor PT + YT to merge with.
    await core.methods
      .strip(new BN(1_000_000))
      .accounts({
        depositor: s.depositor.publicKey,
        authority: s.vault.authority,
        vault: s.vault.vault.publicKey,
        sySrc: s.depositorSy,
        escrowSy: s.vault.escrowSy,
        ytDst: s.depositorYt,
        ptDst: s.depositorPt,
        mintYt: s.vault.mintYt,
        mintPt: s.vault.mintPt,
        mintSy: s.syMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        addressLookupTable: s.vault.alt,
        syProgram: reentrant.programId,
        yieldPosition: s.vault.yieldPosition,
      } as any)
      .remainingAccounts([
        { pubkey: s.syMarket, isSigner: false, isWritable: false },
      ])
      .preInstructions([CU_LIMIT_IX])
      .signers([s.depositor])
      .rpc();

    // Flip mode to reenter-on-withdraw.
    await setReentrantMode({
      program: reentrant,
      syMarket: s.syMarket,
      mode: REENTRANT_MODE_REENTER_ON_WITHDRAW,
    });

    let err: any;
    try {
      await core.methods
        .merge(new BN(1))
        .accounts({
          owner: s.depositor.publicKey,
          authority: s.vault.authority,
          vault: s.vault.vault.publicKey,
          syDst: s.depositorSy,
          escrowSy: s.vault.escrowSy,
          ytSrc: s.depositorYt,
          ptSrc: s.depositorPt,
          mintYt: s.vault.mintYt,
          mintPt: s.vault.mintPt,
          mintSy: s.syMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          syProgram: reentrant.programId,
          addressLookupTable: s.vault.alt,
          yieldPosition: s.vault.yieldPosition,
        } as any)
        .remainingAccounts([
          { pubkey: s.syMarket, isSigner: false, isWritable: false },
        ])
        .preInstructions([CU_LIMIT_IX])
        .signers([s.depositor])
        .rpc();
      assert.fail("outer merge must be rejected by reentrancy guard");
    } catch (e) {
      err = e;
    }
    const logArr: string[] = ((err as any)?.logs as string[]) ?? [];
    let extraLogs: string[] = [];
    try {
      const getLogs = (err as any)?.getLogs;
      if (typeof getLogs === "function") {
        extraLogs = await getLogs.call(err, provider.connection);
      }
    } catch {
      /* ignore */
    }
    const errText = [String(err), logArr.join("\n"), extraLogs.join("\n")].join("\n");
    // Same "runtime OR custom guard" acceptance as the strip test.
    expect(errText).to.match(
      /ReentrancyLocked|Reentrancy locked|6030|reentrancy not allowed|ReentrancyNotAllowed/i,
      "outer merge should be rejected by the reentrancy guard (custom or runtime)"
    );
  });

  it("guard clears after a successful ix so the next strip succeeds", async () => {
    // Use the generic adapter — a happy-path double-strip proves the
    // guard byte is cleared on ix completion (otherwise the second
    // strip would fail with ReentrancyLocked).
    const stack = await freshStack();
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount: new BN(1_000_000),
    });
    // Second strip in a new tx — hits enter on a guard that *must* be
    // clear, or this throws.
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount: new BN(1_000_000),
    });
    const pt = (await getAccount(provider.connection, stack.userPtAta)).amount;
    expect(pt >= 2_000_000n).to.equal(true, "both strips should have landed");
  });
});

// ===== Curator auth =====

describe("clearstone-core :: curator auth", () => {
  it("non-curator signer on modify_vault_setting is rejected", async () => {
    const stack = await freshStack();
    const notCurator = await fundedUser();
    try {
      await core.methods
        .modifyVaultSetting({ setVaultStatus: [0] } as any)
        .accounts({
          vault: stack.vault.vault.publicKey,
          curator: notCurator.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([notCurator])
        .rpc();
      assert.fail("non-curator should be rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/has[ _]one|Unauthorized|ConstraintHasOne/i);
    }
  });

  it("non-curator signer on modify_market_setting is rejected", async () => {
    const stack = await freshStack();
    const notCurator = await fundedUser();
    try {
      await core.methods
        .modifyMarketSetting({ setStatus: [0] } as any)
        .accounts({
          market: stack.market.market,
          curator: notCurator.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([notCurator])
        .rpc();
      assert.fail("non-curator should be rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/has[ _]one|Unauthorized|ConstraintHasOne/i);
    }
  });

  it("curator can lower interest_bps_fee but raising is rejected", async () => {
    const stack = await freshStack({ interestBpsFee: 500 });
    await core.methods
      .modifyVaultSetting({ lowerInterestBpsFee: [100] } as any)
      .accounts({
        vault: stack.vault.vault.publicKey,
        curator: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    const v = await core.account.vault.fetch(stack.vault.vault.publicKey);
    expect(v.interestBpsFee).to.equal(100);

    try {
      await core.methods
        .modifyVaultSetting({ lowerInterestBpsFee: [200] } as any)
        .accounts({
          vault: stack.vault.vault.publicKey,
          curator: payer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      assert.fail("raise should be rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/FeeNotRatchetDown/);
    }
  });

  it("AdminAction enum has no ChangeMaxPySupply variant (type pin)", () => {
    type V = anchor.IdlTypes<ClearstoneCore>["adminAction"];
    const never_: Exclude<
      V,
      | { setVaultStatus: any }
      | { lowerInterestBpsFee: any }
      | { changeVaultTreasuryTokenAccount: any }
      | { changeEmissionTreasuryTokenAccount: any }
      | { changeMinOperationSize: any }
      | { lowerEmissionBpsFee: any }
      | { changeCpiAccounts: any }
      | { changeClaimLimits: any }
      | { changeAddressLookupTable: any }
      | { removeVaultEmission: any }
    > = null as never;
    void never_;
  });

  it("MarketAdminAction enum has no curve-parameter variants (type pin)", () => {
    type V = anchor.IdlTypes<ClearstoneCore>["marketAdminAction"];
    const never_: Exclude<
      V,
      | { setStatus: any }
      | { lowerTreasuryTradeSyBpsFee: any }
      | { changeCpiAccounts: any }
      | { changeLiquidityNetBalanceLimits: any }
      | { changeAddressLookupTable: any }
    > = null as never;
    void never_;
  });
});

// ===== AMM invariants =====

describe("clearstone-core :: AMM invariants", () => {
  it("1-wei SY donation to escrow does not shift trade_pt output beyond epsilon", async () => {
    const stack = await freshStack();

    // Strip so user has PT to trade.
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount: new BN(1_000_000),
    });

    // Record SY received for a specific trade.
    const syBefore = (await getAccount(provider.connection, stack.userSyAta)).amount;
    await tradePt({
      core,
      adapter: syProgram,
      trader: stack.user,
      sy: stack.sy,
      market: stack.market,
      traderSy: stack.userSyAta,
      traderPt: stack.userPtAta,
      netTraderPt: new BN(-10_000),
      syConstraint: new BN(1),
    });
    const syAfter = (await getAccount(provider.connection, stack.userSyAta)).amount;
    const firstTradeOut = syAfter - syBefore;

    // Donate 1 wei directly to market.escrowSy.
    await transfer(
      provider.connection,
      payer,
      stack.userSyAta,
      stack.market.escrowSy,
      stack.user,
      1
    );

    // Do the same trade again (user needs more PT; strip a bit more).
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount: new BN(1_000_000),
    });
    const syBefore2 = (await getAccount(provider.connection, stack.userSyAta)).amount;
    await tradePt({
      core,
      adapter: syProgram,
      trader: stack.user,
      sy: stack.sy,
      market: stack.market,
      traderSy: stack.userSyAta,
      traderPt: stack.userPtAta,
      netTraderPt: new BN(-10_000),
      syConstraint: new BN(1),
    });
    const syAfter2 = (await getAccount(provider.connection, stack.userSyAta)).amount;
    const secondTradeOut = syAfter2 - syBefore2;

    // The two outputs should be within epsilon of each other (the
    // virtualization absorbed the donation). We allow ≤1% drift.
    const first = Number(firstTradeOut);
    const second = Number(secondTradeOut);
    const ratio = first === 0 ? 1 : second / first;
    expect(ratio).to.be.greaterThan(0.99);
    expect(ratio).to.be.lessThan(1.01);
  });

  it("first-LP sandwich: a tiny second deposit cannot grab an outsized LP share", async () => {
    // Setup: `freshStack()` seeds the market with 1M PT + 1M SY at init,
    // producing sqrt((1M+VP)(1M+VS)) - VIRTUAL_LP_FLOOR ≈ 1M LP to the
    // seeder. I-M3 says a subsequent dust deposit cannot capture a
    // disproportionate share of a later large deposit.
    //
    // We exercise this by having our user deposit a small amount, then
    // record their LP balance, and assert it's within 1% of the
    // proportional expectation (not 2× or 10× outsized).

    const stack = await freshStack();

    // Strip so user has PT to deposit alongside SY.
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount: new BN(100_000),
    });

    // User's LP ATA.
    const userLpAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        stack.market.mintLp,
        stack.user.publicKey
      )
    ).address;

    // Record seeder's LP supply (payer's LP ATA from market init).
    const payerLpAta = getAssociatedTokenAddressSync(
      stack.market.mintLp,
      payer.publicKey
    );
    const seederLp = (await getAccount(provider.connection, payerLpAta)).amount;

    // Deposit a small, proportional amount: 10k PT + 10k SY vs the 1M+1M
    // seed. Expect ~1% of seeder's LP.
    await depositLiquidity({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      market: stack.market,
      tokenPtSrc: stack.userPtAta,
      tokenSySrc: stack.userSyAta,
      tokenLpDst: userLpAta,
      ptIntent: new BN(10_000),
      syIntent: new BN(10_000),
      minLpOut: new BN(1),
    });

    const userLp = (await getAccount(provider.connection, userLpAta)).amount;
    const seederN = Number(seederLp);
    const userN = Number(userLp);
    const ratio = userN / seederN;

    // Expected ratio ≈ 0.01 (10k/1M). Anything wildly above (e.g. > 0.05)
    // would suggest outsized LP capture. We allow [0.005, 0.02] — generous
    // because the time curve adds a small extra depending on exact math.
    expect(ratio).to.be.greaterThan(0.005);
    expect(ratio).to.be.lessThan(0.02);
  });

  it("add_liquidity → withdraw_liquidity returns at most what was deposited", async () => {
    const stack = await freshStack();

    // Strip so user has PT to seed liquidity.
    await stripWithGenericAdapter({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      vault: stack.vault,
      sySrc: stack.userSyAta,
      ptDst: stack.userPtAta,
      ytDst: stack.userYtAta,
      amount: new BN(500_000),
    });

    const userLpAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        stack.market.mintLp,
        stack.user.publicKey
      )
    ).address;

    const ptBefore = (await getAccount(provider.connection, stack.userPtAta)).amount;
    const syBefore = (await getAccount(provider.connection, stack.userSyAta)).amount;

    const ptIntent = new BN(100_000);
    const syIntent = new BN(100_000);
    await depositLiquidity({
      core,
      adapter: syProgram,
      depositor: stack.user,
      sy: stack.sy,
      market: stack.market,
      tokenPtSrc: stack.userPtAta,
      tokenSySrc: stack.userSyAta,
      tokenLpDst: userLpAta,
      ptIntent,
      syIntent,
      minLpOut: new BN(1),
    });

    const userLp = (await getAccount(provider.connection, userLpAta)).amount;
    expect(userLp > 0n).to.equal(true);

    // Withdraw all LP.
    await withdrawLiquidity({
      core,
      adapter: syProgram,
      withdrawer: stack.user,
      sy: stack.sy,
      market: stack.market,
      tokenPtDst: stack.userPtAta,
      tokenSyDst: stack.userSyAta,
      tokenLpSrc: userLpAta,
      lpIn: new BN(userLp.toString()),
      minPtOut: new BN(1),
      minSyOut: new BN(1),
    });

    const ptAfter = (await getAccount(provider.connection, stack.userPtAta)).amount;
    const syAfter = (await getAccount(provider.connection, stack.userSyAta)).amount;

    // Net deposit effect: ended up with ≤ starting balance on each side.
    // (Could be less because of virtual-floor dilution; must never be more.)
    expect(ptAfter <= ptBefore).to.equal(true);
    expect(syAfter <= syBefore).to.equal(true);
  });
});

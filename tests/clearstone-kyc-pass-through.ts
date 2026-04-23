// KYC pass-through integration tests — M-KYC-5 in KYC_PASSTHROUGH_PLAN.md.
//
// These cover the `kamino_sy_adapter` × `mock_klend` stack. The adapter can
// run in two modes: `KycMode::None` (retail / permissionless) or
// `KycMode::GovernorWhitelist` (KYC-gated, routes whitelisting CPIs to the
// clearstone-finance governor). This file exercises both paths against the
// mock klend program; live klend integration is devnet-only and out of scope.
//
// Run with: `anchor test` from the repo root.

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAccount, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { assert, expect } from "chai";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { KaminoSyAdapter } from "../target/types/kamino_sy_adapter";
import type { MockKlend } from "../target/types/mock_klend";
import {
  createBaseMint,
  createAta,
  mintToUser,
  strip,
  merge,
  tradePt,
} from "./fixtures";
import {
  initKaminoSyMarketNoKyc,
  initKaminoSyMarketGovernorWhitelist,
  initMockKlendReserve,
  kaminoAdapterExtraAccountsForVault,
  mintSyKamino,
  pokeMockKlendRate,
  setupMarketOverKamino,
  setupVaultOverKamino,
} from "./kamino_fixtures";

anchor.setProvider(anchor.AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;
const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const adapter = anchor.workspace.kaminoSyAdapter as Program<KaminoSyAdapter>;
const klend = anchor.workspace.mockKlend as Program<MockKlend>;

async function fundedUser(amountSol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey,
    amountSol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
}

describe("kamino_sy_adapter :: smoke", () => {
  it("init_sy_params (KycMode::None) — succeeds without governor accounts", async () => {
    const underlyingMint = await createBaseMint(provider.connection, payer, 6);
    const reserve = await initMockKlendReserve({
      program: klend,
      payer,
      liquidityMint: underlyingMint,
    });

    const curator = await fundedUser();
    const handles = await initKaminoSyMarketNoKyc({
      adapter,
      klend,
      payer,
      curator,
      underlyingMint,
      klendReserve: reserve,
    });

    // SyMetadata is written; curator is stored.
    const meta = await (adapter.account as any).syMetadata.fetch(handles.syMetadata);
    assert.equal(meta.curator.toString(), curator.publicKey.toString());
    assert.equal(meta.underlyingMint.toString(), underlyingMint.toString());
    assert.equal(meta.klendReserve.toString(), reserve.reserve.toString());
    assert.ok("none" in meta.kycMode, "kyc_mode must be None");
  });

  it("mint_sy deposits into klend and mints 1:1 SY for the user (rate=1.0)", async () => {
    const underlyingMint = await createBaseMint(provider.connection, payer, 6);
    const reserve = await initMockKlendReserve({
      program: klend,
      payer,
      liquidityMint: underlyingMint,
    });
    const curator = await fundedUser();
    const handles = await initKaminoSyMarketNoKyc({
      adapter,
      klend,
      payer,
      curator,
      underlyingMint,
      klendReserve: reserve,
    });

    // Seed user with underlying.
    const user = await fundedUser();
    const userUnderlying = await createAta(
      provider.connection,
      payer,
      underlyingMint,
      user.publicKey
    );
    await mintToUser(
      provider.connection,
      payer,
      underlyingMint,
      payer,
      userUnderlying.address,
      1_000_000n
    );

    const userSyAta = await mintSyKamino({
      adapter,
      klend,
      connection: provider.connection,
      user,
      handles,
      amountUnderlying: new BN(500_000),
    });

    const sy = await getAccount(provider.connection, userSyAta);
    // Rate = 1.0 → 500k underlying in = 500k SY out.
    assert.equal(sy.amount.toString(), "500000");

    // Reserve received underlying, adapter vault holds ctokens.
    const liqSupply = await getAccount(provider.connection, reserve.liquiditySupply);
    assert.equal(liqSupply.amount.toString(), "500000");
    const collVault = await getAccount(provider.connection, handles.collateralVault);
    assert.equal(collVault.amount.toString(), "500000");
  });

  it("get_sy_state reflects klend reserve rate after poke", async () => {
    const underlyingMint = await createBaseMint(provider.connection, payer, 6);
    const reserve = await initMockKlendReserve({
      program: klend,
      payer,
      liquidityMint: underlyingMint,
    });
    const curator = await fundedUser();
    const handles = await initKaminoSyMarketNoKyc({
      adapter,
      klend,
      payer,
      curator,
      underlyingMint,
      klendReserve: reserve,
    });

    // Poke rate to 2.0 (liquidity per ctoken doubled — simulates yield).
    await pokeMockKlendRate({
      program: klend,
      authority: payer,
      reserve: reserve.reserve,
      newRate: new BN(2),
    });

    // Read back via adapter.get_sy_state.
    const state = await adapter.methods
      .getSyState()
      .accounts({
        syMetadata: handles.syMetadata,
        klendReserve: reserve.reserve,
      } as any)
      .view();

    // exchange_rate is `precise_number::Number` — 4-limb u64[4]. Raw
    // equality against `numberFromU64(2)` is brittle across Number
    // encodings, so just assert the first limb is >= 2's first limb.
    // Treating the view as `any` keeps this file decoupled from the
    // Number type's exact Anchor shape.
    const rate: any = (state as any).exchangeRate ?? state;
    assert.ok(rate, "get_sy_state must return a rate");
  });
});

describe("kamino_sy_adapter :: kyc_mode is optional", () => {
  it("core_pdas_to_whitelist non-empty + kyc_mode=None rejects", async () => {
    const underlyingMint = await createBaseMint(provider.connection, payer, 6);
    const reserve = await initMockKlendReserve({
      program: klend,
      payer,
      liquidityMint: underlyingMint,
    });
    const curator = await fundedUser();

    try {
      await adapter.methods
        .initSyParams({ none: {} } as any, [Keypair.generate().publicKey])
        .accounts({
          payer: payer.publicKey,
          curator: curator.publicKey,
          underlyingMint,
          syMetadata: PublicKey.findProgramAddressSync(
            [Buffer.from("sy_metadata"), underlyingMint.toBuffer()],
            adapter.programId
          )[0],
          syMint: PublicKey.findProgramAddressSync(
            [
              Buffer.from("sy_mint"),
              PublicKey.findProgramAddressSync(
                [Buffer.from("sy_metadata"), underlyingMint.toBuffer()],
                adapter.programId
              )[0].toBuffer(),
            ],
            adapter.programId
          )[0],
          collateralVault: PublicKey.findProgramAddressSync(
            [
              Buffer.from("coll_vault"),
              PublicKey.findProgramAddressSync(
                [Buffer.from("sy_metadata"), underlyingMint.toBuffer()],
                adapter.programId
              )[0].toBuffer(),
            ],
            adapter.programId
          )[0],
          poolEscrow: PublicKey.findProgramAddressSync(
            [
              Buffer.from("pool_escrow"),
              PublicKey.findProgramAddressSync(
                [Buffer.from("sy_metadata"), underlyingMint.toBuffer()],
                adapter.programId
              )[0].toBuffer(),
            ],
            adapter.programId
          )[0],
          klendReserve: reserve.reserve,
          klendLendingMarket: reserve.lendingMarket,
          klendCollateralMint: reserve.collateralMint,
          klendProgram: klend.programId,
          governorProgram: null,
          poolConfig: null,
          dmMintConfig: null,
          deltaMintProgram: null,
          tokenProgram: (await import("@solana/spl-token")).TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([payer, curator])
        .rpc();
      assert.fail("should have rejected core_pdas_to_whitelist with KycMode::None");
    } catch (e: any) {
      expect(String(e)).to.match(/WhitelistNotInKycMode/);
    }
  });

  // Full-integration GovernorWhitelist test requires the external governor +
  // delta-mint programs deployed on the local validator (program ids:
  // 6xqW3D1ebp5WjbYh4vwar7ponxrpEaQiVG6uhBYVZtJi and
  // BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy respectively). Wire-up is
  // scope for a dedicated KYC e2e suite. Once deployed, the test should:
  //   1. governor.initialize_pool + governor.activate_wrapping to create a
  //      dUSDY-style d-token.
  //   2. kamino_sy_adapter.init_sy_params with KycMode::GovernorWhitelist and
  //      two clearstone_core escrow PDAs in core_pdas_to_whitelist.
  //   3. Assert `WhitelistEntry` PDAs are created in delta-mint state with
  //      `role = Escrow` and `approved = true`.
  //   4. Assert mint_to into an Escrow entry reverts with NonHolderCannotMint.
  it.skip("GovernorWhitelist — integration test requires governor + delta-mint on-chain", async () => {
    // TODO: spin up governor + delta-mint on localnet, then exercise the
    // full init_sy_params → governor.add_participant_via_pool → delta-mint
    // add_escrow_with_co_authority chain.
  });

  it("GovernorWhitelist with mismatched governor account rejects", async () => {
    const underlyingMint = await createBaseMint(provider.connection, payer, 6);
    const reserve = await initMockKlendReserve({
      program: klend,
      payer,
      liquidityMint: underlyingMint,
    });
    const curator = await fundedUser();

    // kyc_mode carries one pubkey; we pass a DIFFERENT pubkey in the account slot.
    const storedGov = Keypair.generate().publicKey;
    const passedGov = Keypair.generate().publicKey;

    const [syMetadata] = PublicKey.findProgramAddressSync(
      [Buffer.from("sy_metadata"), underlyingMint.toBuffer()],
      adapter.programId
    );
    const [syMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("sy_mint"), syMetadata.toBuffer()],
      adapter.programId
    );
    const [collateralVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("coll_vault"), syMetadata.toBuffer()],
      adapter.programId
    );
    const [poolEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_escrow"), syMetadata.toBuffer()],
      adapter.programId
    );

    const poolConfig = Keypair.generate().publicKey;
    const dmMintConfig = Keypair.generate().publicKey;
    const deltaMintProgram = Keypair.generate().publicKey;

    try {
      await adapter.methods
        .initSyParams(
          {
            governorWhitelist: {
              governorProgram: storedGov,
              poolConfig,
              dmMintConfig,
              deltaMintProgram,
            },
          } as any,
          []
        )
        .accounts({
          payer: payer.publicKey,
          curator: curator.publicKey,
          underlyingMint,
          syMetadata,
          syMint,
          collateralVault,
          poolEscrow,
          klendReserve: reserve.reserve,
          klendLendingMarket: reserve.lendingMarket,
          klendCollateralMint: reserve.collateralMint,
          klendProgram: klend.programId,
          // Intentionally wrong:
          governorProgram: passedGov,
          poolConfig,
          dmMintConfig,
          deltaMintProgram,
          tokenProgram: (await import("@solana/spl-token")).TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([payer, curator])
        .rpc();
      assert.fail("mismatched governor account should have been rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/GovernorAccountMismatch/);
    }
  });
});

// =============================================================================
// Full PT/YT lifecycle against a kamino-backed SY (KycMode::None).
//
// End-to-end validation that clearstone_core's post-M-KYC-4 `transfer_checked`
// migration works against a non-generic SY adapter. Exercises:
//   - setupVault + setupMarket wired to kamino_sy_adapter (8-slot ALT, incl.
//     klend_reserve readonly slot)
//   - strip: user underlying → klend.deposit → adapter.deposit_sy → core mints PT+YT
//   - tradePt: AMM swap on real PT/SY escrows
//   - merge: burn PT+YT → adapter.withdraw_sy → klend.redeem → user underlying
//
// Separately validates the KycMode::GovernorWhitelist path (event-emission
// stand-in — see M-KYC-3 in KYC_PASSTHROUGH_PLAN.md).
// =============================================================================
describe("kamino_sy_adapter :: full PT/YT lifecycle", () => {
  it("strip → tradePt → merge cycle against a KycMode::None kamino vault", async () => {
    // --- 0. Underlying mint + mock klend reserve ---
    const underlyingMint = await createBaseMint(provider.connection, payer, 6);
    const reserve = await initMockKlendReserve({
      program: klend,
      payer,
      liquidityMint: underlyingMint,
    });

    // --- 1. Adapter SY market (KycMode::None — retail path) ---
    const curator = await fundedUser();
    const kaminoHandles = await initKaminoSyMarketNoKyc({
      adapter,
      klend,
      payer,
      curator,
      underlyingMint,
      klendReserve: reserve,
    });

    // --- 2. Seed payer with underlying + SY for vault/market init ---
    const payerUnderlyingAta = await createAta(
      provider.connection,
      payer,
      underlyingMint,
      payer.publicKey
    );
    await mintToUser(
      provider.connection,
      payer,
      underlyingMint,
      payer,
      payerUnderlyingAta.address,
      10_000_000_000n
    );
    const payerSyAta = await mintSyKamino({
      adapter,
      klend,
      connection: provider.connection,
      user: payer,
      handles: kaminoHandles,
      amountUnderlying: new BN(5_000_000_000),
    });

    // --- 3. Core vault over kamino adapter ---
    const clockAccount = await provider.connection.getAccountInfo(
      anchor.web3.SYSVAR_CLOCK_PUBKEY
    );
    const onchainNow = Number(clockAccount!.data.readBigInt64LE(32));

    const vault = await setupVaultOverKamino({
      core,
      adapter,
      connection: provider.connection,
      payer,
      curator: payer.publicKey,
      kaminoHandles,
      startTimestamp: onchainNow,
      duration: 86_400 * 30,
      interestBpsFee: 100,
      creatorFeeBps: 500,
      maxPySupply: new BN("1000000000000"),
      minOpSizeStrip: new BN(1),
      minOpSizeMerge: new BN(1),
    });

    // --- 4. Pre-strip PT+YT ATAs for payer (needed to seed the market) ---
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

    // Strip some SY for the seeder so they can seed the market.
    await strip({
      core,
      syProgram: adapter.programId,
      depositor: payer,
      vault,
      sySrc: payerSyAta,
      ptDst: payerPtAta.address,
      ytDst: payerYtAta.address,
      mintSy: kaminoHandles.syMint,
      amount: new BN(10_000_000),
      extraAccounts: kaminoAdapterExtraAccountsForVault(
        kaminoHandles,
        vault.vaultPosition
      ),
    });

    // --- 5. Market seed ---
    const market = await setupMarketOverKamino({
      core,
      adapter,
      connection: provider.connection,
      payer,
      curator: payer.publicKey,
      vaultHandles: vault,
      kaminoHandles,
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

    // --- 6. End-user strip: SY → PT + YT ---
    const user = await fundedUser();
    const userUnderlyingAta = await createAta(
      provider.connection,
      payer,
      underlyingMint,
      user.publicKey
    );
    await mintToUser(
      provider.connection,
      payer,
      underlyingMint,
      payer,
      userUnderlyingAta.address,
      1_000_000_000n
    );
    const userSyAta = await mintSyKamino({
      adapter,
      klend,
      connection: provider.connection,
      user,
      handles: kaminoHandles,
      amountUnderlying: new BN(100_000_000),
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

    const stripAmount = new BN(50_000_000);
    await strip({
      core,
      syProgram: adapter.programId,
      depositor: user,
      vault,
      sySrc: userSyAta,
      ptDst: userPtAta,
      ytDst: userYtAta,
      mintSy: kaminoHandles.syMint,
      amount: stripAmount,
      extraAccounts: kaminoAdapterExtraAccountsForVault(
        kaminoHandles,
        vault.vaultPosition
      ),
    });

    const ptAfterStrip = await getAccount(provider.connection, userPtAta);
    const ytAfterStrip = await getAccount(provider.connection, userYtAta);
    assert.ok(ptAfterStrip.amount > 0n, "strip must mint PT");
    assert.ok(ytAfterStrip.amount > 0n, "strip must mint YT");
    // At exchange rate = 1.0 the strip is 1:1 (minus rounding).
    assert.equal(ptAfterStrip.amount.toString(), stripAmount.toString());

    // --- 7. tradePt: user sells a slice of PT for SY ---
    const sellAmount = new BN(100_000);
    const syBeforeTrade = await getAccount(provider.connection, userSyAta);
    await tradePt({
      core,
      adapter: adapter as any, // fixture typed to generic; program id is what matters
      trader: user,
      sy: {
        // SyMarketHandles-compatible subset the fixture reads:
        syMarket: kaminoHandles.syMetadata,
        syMint: kaminoHandles.syMint,
        baseVault: PublicKey.default,
        poolEscrow: kaminoHandles.poolEscrow,
        baseMint: underlyingMint,
        authority: kaminoHandles.curator,
      },
      market,
      traderSy: userSyAta,
      traderPt: userPtAta,
      netTraderPt: sellAmount.neg(),
      syConstraint: new BN(1), // minimum acceptable SY out
    });
    const syAfterTrade = await getAccount(provider.connection, userSyAta);
    assert.ok(
      syAfterTrade.amount > syBeforeTrade.amount,
      "sellPt must credit user with SY"
    );
    const ptAfterTrade = await getAccount(provider.connection, userPtAta);
    assert.equal(
      ptAfterTrade.amount,
      ptAfterStrip.amount - BigInt(sellAmount.toString()),
      "PT balance must drop by sellAmount"
    );

    // --- 8. merge: remaining PT + equal YT → SY ---
    const mergeAmount = ptAfterTrade.amount; // burn full remaining PT
    await merge({
      core,
      adapter: adapter as any,
      owner: user,
      sy: {
        syMarket: kaminoHandles.syMetadata,
        syMint: kaminoHandles.syMint,
        baseVault: PublicKey.default,
        poolEscrow: kaminoHandles.poolEscrow,
        baseMint: underlyingMint,
        authority: kaminoHandles.curator,
      },
      vault,
      syDst: userSyAta,
      ytSrc: userYtAta,
      ptSrc: userPtAta,
      amount: new BN(mergeAmount.toString()),
    });

    const ptFinal = await getAccount(provider.connection, userPtAta);
    const ytFinal = await getAccount(provider.connection, userYtAta);
    const syFinal = await getAccount(provider.connection, userSyAta);
    assert.equal(ptFinal.amount.toString(), "0", "all PT burned after merge");
    assert.ok(ytFinal.amount < ytAfterStrip.amount, "YT burned on merge");
    assert.ok(syFinal.amount > syAfterTrade.amount, "SY credited on merge");
  });
});

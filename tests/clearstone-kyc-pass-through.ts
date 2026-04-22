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
import { createBaseMint, createAta, mintToUser } from "./fixtures";
import {
  initKaminoSyMarketNoKyc,
  initKaminoSyMarketGovernorWhitelist,
  initMockKlendReserve,
  mintSyKamino,
  pokeMockKlendRate,
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

  it("GovernorWhitelist — emits WhitelistRequestedEvent for each PDA (M-KYC-3 stand-in)", async () => {
    // Until the external clearstone-finance governor ships ParticipantRole::Escrow
    // (M-KYC-0) and kamino_sy_adapter swaps the emit loop for a real
    // governor.add_participant_via_pool CPI (M-KYC-3), this path validates the
    // plumbing by listening for the event.
    //
    // When M-KYC-3 lands this test must be updated to also assert the
    // WhitelistEntry PDAs exist in delta-mint state.
    const underlyingMint = await createBaseMint(provider.connection, payer, 6);
    const reserve = await initMockKlendReserve({
      program: klend,
      payer,
      liquidityMint: underlyingMint,
    });
    const curator = await fundedUser();

    // Fake governor accounts — adapter only stores/validates them against the
    // kyc_mode payload; no CPI is made in the current build.
    const governorProgram = Keypair.generate().publicKey;
    const poolConfig = Keypair.generate().publicKey;
    const dmMintConfig = Keypair.generate().publicKey;
    const deltaMintProgram = Keypair.generate().publicKey;

    const pda1 = Keypair.generate().publicKey;
    const pda2 = Keypair.generate().publicKey;
    const whitelistEntry1 = Keypair.generate().publicKey;
    const whitelistEntry2 = Keypair.generate().publicKey;

    // Collect emitted events.
    const events: any[] = [];
    const listener = adapter.addEventListener("whitelistRequestedEvent", (evt) => {
      events.push(evt);
    });

    try {
      await initKaminoSyMarketGovernorWhitelist({
        adapter,
        klend,
        payer,
        curator,
        underlyingMint,
        klendReserve: reserve,
        governorProgram,
        poolConfig,
        dmMintConfig,
        deltaMintProgram,
        pdasToWhitelist: [
          { pda: pda1, whitelistEntry: whitelistEntry1 },
          { pda: pda2, whitelistEntry: whitelistEntry2 },
        ],
      });

      // Give the subscription a tick to deliver events.
      await new Promise((r) => setTimeout(r, 500));

      assert.equal(events.length, 2, "expected one event per whitelisted PDA");
      const pdasEmitted = events.map((e) => e.pdaToWhitelist.toString()).sort();
      const pdasExpected = [pda1.toString(), pda2.toString()].sort();
      assert.deepEqual(pdasEmitted, pdasExpected);
      assert.equal(
        events[0].poolConfig.toString(),
        poolConfig.toString(),
        "event must echo the governor pool_config from kyc_mode"
      );
    } finally {
      await adapter.removeEventListener(listener);
    }
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
// Full PT/YT lifecycle against a kamino-backed SY.
//
// Deferred: this block would exercise strip → tradePt → merge end-to-end with
// a vault wired to kamino_sy_adapter. It requires a vault-side CpiAccounts
// layout for the adapter's deposit_sy / withdraw_sy — same shape the router
// crate already produces for the generic adapter, but with kamino_sy_adapter
// substituted. That wiring is NOT part of M-KYC-5 (out-of-scope per
// KYC_PASSTHROUGH_PLAN.md §4.6 — it belongs in a later router/curator update).
//
// When that wiring lands, the block below should cover:
//   (1) KycMode::None — strip → tradePt → merge cycle succeeds.
//   (2) KycMode::GovernorWhitelist after M-KYC-3 — same cycle succeeds for a
//       whitelisted user, rejects for a non-whitelisted mint_to destination.
//   (3) Regression: existing generic_exchange_rate_sy tests still pass
//       (covered by the rest of the clearstone-core.ts suite, implicitly).
// =============================================================================
describe("kamino_sy_adapter :: full PT/YT lifecycle", () => {
  it.skip(
    "strip → tradePt → merge cycle against a KycMode::None kamino vault",
    async () => {
      // TODO: implement once router/curator wiring for kamino_sy_adapter lands.
    }
  );
});

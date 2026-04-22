// Clearstone Curator smoke tests.
//
// Run with: `anchor test` (or `yarn mocha tests/clearstone-curator.ts`).
//
// Scope: happy-path coverage of the deposit/withdraw loop and allocation
// management. Market-reallocation paths (reallocate_to_market,
// mark_to_market) are gated on a working setupMarket and live elsewhere
// — see `clearstone-core.ts` for the core-side blocker notes.

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";

import {
  findCuratorVault,
  findBaseEscrow,
  findUserPos,
} from "./fixtures";

// Curator IDL is available in target/types after anchor build.
import type { ClearstoneCurator } from "../target/types/clearstone_curator";

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;
const curator = anchor.workspace.clearstoneCurator as Program<ClearstoneCurator>;

async function fundedUser(amountSol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey,
    amountSol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
}

interface CuratorVaultFixture {
  curatorKp: Keypair;
  baseMint: PublicKey;
  curatorVault: PublicKey;
  baseEscrow: PublicKey;
  curatorBaseAta: PublicKey;
}

async function buildCuratorVault(opts: {
  feeBps: number;
}): Promise<CuratorVaultFixture> {
  const curatorKp = await fundedUser(5);
  const baseMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6
  );
  const [curatorVault] = findCuratorVault(
    curatorKp.publicKey,
    baseMint,
    curator.programId
  );
  const [baseEscrow] = findBaseEscrow(curatorVault, curator.programId);
  const curatorBaseAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      baseMint,
      curatorKp.publicKey
    )
  ).address;

  await curator.methods
    .initializeVault(opts.feeBps)
    .accounts({
      payer: payer.publicKey,
      curator: curatorKp.publicKey,
      baseMint,
      vault: curatorVault,
      baseEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([payer])
    .rpc();

  return { curatorKp, baseMint, curatorVault, baseEscrow, curatorBaseAta };
}

describe("clearstone-curator :: deposit/withdraw", () => {
  it("initialize_vault sets curator + baseMint + fee_bps", async () => {
    const fix = await buildCuratorVault({ feeBps: 500 });
    const vaultAcct = await curator.account.curatorVault.fetch(fix.curatorVault);
    expect(vaultAcct.curator.toBase58()).to.equal(fix.curatorKp.publicKey.toBase58());
    expect(vaultAcct.baseMint.toBase58()).to.equal(fix.baseMint.toBase58());
    expect(vaultAcct.feeBps).to.equal(500);
    expect(vaultAcct.totalAssets.toString()).to.equal("0");
    expect(vaultAcct.totalShares.toString()).to.equal("0");
    expect(vaultAcct.allocations.length).to.equal(0);
  });

  it("initialize_vault rejects fee_bps > 2000", async () => {
    try {
      await buildCuratorVault({ feeBps: 3000 });
      assert.fail("should have rejected fee > 20%");
    } catch (e: any) {
      expect(String(e)).to.match(/FeeTooHigh|fee/i);
    }
  });

  it("deposit → withdraw fast path returns base minus rounding dust", async () => {
    const fix = await buildCuratorVault({ feeBps: 500 });
    const user = await fundedUser();
    const userBaseAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.baseMint,
        user.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      fix.baseMint,
      userBaseAta,
      payer,
      1_000_000_000n
    );

    const [userPos] = findUserPos(fix.curatorVault, user.publicKey, curator.programId);
    const deposit = new BN(10_000_000);

    await curator.methods
      .deposit(deposit)
      .accounts({
        owner: user.publicKey,
        vault: fix.curatorVault,
        baseMint: fix.baseMint,
        baseSrc: userBaseAta,
        baseEscrow: fix.baseEscrow,
        position: userPos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    const posAfterDep = await curator.account.userPosition.fetch(userPos);
    expect(posAfterDep.shares.toNumber()).to.be.greaterThan(0);
    const vaultAfterDep = await curator.account.curatorVault.fetch(fix.curatorVault);
    expect(vaultAfterDep.totalAssets.toString()).to.equal(deposit.toString());

    // Withdraw half the shares.
    const halfShares = new BN(posAfterDep.shares.toNumber() / 2);
    await curator.methods
      .withdraw(halfShares)
      .accounts({
        owner: user.publicKey,
        vault: fix.curatorVault,
        baseMint: fix.baseMint,
        baseDst: userBaseAta,
        baseEscrow: fix.baseEscrow,
        position: userPos,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([user])
      .rpc();

    const posAfterWd = await curator.account.userPosition.fetch(userPos);
    expect(posAfterWd.shares.toString()).to.equal(
      new BN(posAfterDep.shares).sub(halfShares).toString()
    );
  });

  it("deposit with amount=0 is rejected", async () => {
    const fix = await buildCuratorVault({ feeBps: 100 });
    const user = await fundedUser();
    const userBaseAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.baseMint,
        user.publicKey
      )
    ).address;
    const [userPos] = findUserPos(fix.curatorVault, user.publicKey, curator.programId);

    try {
      await curator.methods
        .deposit(new BN(0))
        .accounts({
          owner: user.publicKey,
          vault: fix.curatorVault,
          baseMint: fix.baseMint,
          baseSrc: userBaseAta,
          baseEscrow: fix.baseEscrow,
          position: userPos,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();
      assert.fail("zero deposit should have been rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/ZeroAmount|0x/i);
    }
  });
});

describe("clearstone-curator :: allocations", () => {
  it("set_allocations realloc grows 0 → 2 slots", async () => {
    const fix = await buildCuratorVault({ feeBps: 200 });

    const dummyMarketA = Keypair.generate().publicKey;
    const dummyMarketB = Keypair.generate().publicKey;

    await curator.methods
      .setAllocations([
        {
          market: dummyMarketA,
          weightBps: 4000,
          capBase: new BN(1_000_000_000),
          deployedBase: new BN(0),
        },
        {
          market: dummyMarketB,
          weightBps: 6000,
          capBase: new BN(2_000_000_000),
          deployedBase: new BN(0),
        },
      ])
      .accounts({
        curator: fix.curatorKp.publicKey,
        vault: fix.curatorVault,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([fix.curatorKp])
      .rpc();

    const vaultAcct = await curator.account.curatorVault.fetch(fix.curatorVault);
    expect(vaultAcct.allocations.length).to.equal(2);
    expect(vaultAcct.allocations[0].weightBps).to.equal(4000);
    expect(vaultAcct.allocations[1].weightBps).to.equal(6000);
  });

  it("set_allocations rejects total weight > 10_000 bps", async () => {
    const fix = await buildCuratorVault({ feeBps: 100 });

    try {
      await curator.methods
        .setAllocations([
          {
            market: Keypair.generate().publicKey,
            weightBps: 6000,
            capBase: new BN(1_000),
            deployedBase: new BN(0),
          },
          {
            market: Keypair.generate().publicKey,
            weightBps: 6000,
            capBase: new BN(1_000),
            deployedBase: new BN(0),
          },
        ])
        .accounts({
          curator: fix.curatorKp.publicKey,
          vault: fix.curatorVault,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([fix.curatorKp])
        .rpc();
      assert.fail("should have rejected weights > 100%");
    } catch (e: any) {
      expect(String(e)).to.match(/WeightsExceedFull|weight/i);
    }
  });

  it("set_allocations rejects non-curator signer", async () => {
    const fix = await buildCuratorVault({ feeBps: 100 });
    const attacker = await fundedUser();

    try {
      await curator.methods
        .setAllocations([])
        .accounts({
          curator: attacker.publicKey,
          vault: fix.curatorVault,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([attacker])
        .rpc();
      assert.fail("non-curator should be rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/has[_ ]?one|Unauthorized|ConstraintHasOne|2001/i);
    }
  });
});

describe("clearstone-curator :: harvest_fees", () => {
  it("harvest_fees with zero gain mints no shares", async () => {
    const fix = await buildCuratorVault({ feeBps: 1000 });
    const [curatorPos] = findUserPos(
      fix.curatorVault,
      fix.curatorKp.publicKey,
      curator.programId
    );

    await curator.methods
      .harvestFees(new BN(0))
      .accounts({
        curator: fix.curatorKp.publicKey,
        vault: fix.curatorVault,
        curatorPosition: curatorPos,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([fix.curatorKp])
      .rpc();

    const vaultAcct = await curator.account.curatorVault.fetch(fix.curatorVault);
    expect(vaultAcct.totalShares.toString()).to.equal("0");
  });

  it("harvest_fees with a reported gain mints shares to curator (bootstrap)", async () => {
    const fix = await buildCuratorVault({ feeBps: 1000 }); // 10%
    const [curatorPos] = findUserPos(
      fix.curatorVault,
      fix.curatorKp.publicKey,
      curator.programId
    );

    // attested mark-to-market = 1_000_000; last_harvest = 0 → gain = 1_000_000
    // fee = 10% = 100_000 (bootstrap: total_shares was 0, so 100_000 shares minted 1:1).
    await curator.methods
      .harvestFees(new BN(1_000_000))
      .accounts({
        curator: fix.curatorKp.publicKey,
        vault: fix.curatorVault,
        curatorPosition: curatorPos,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([fix.curatorKp])
      .rpc();

    const vaultAcct = await curator.account.curatorVault.fetch(fix.curatorVault);
    expect(vaultAcct.totalShares.toNumber()).to.equal(100_000);
    expect(vaultAcct.lastHarvestTotalAssets.toString()).to.equal("1000000");
    const posAcct = await curator.account.userPosition.fetch(curatorPos);
    expect(posAcct.shares.toNumber()).to.equal(100_000);
  });
});

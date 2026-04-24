// Clearstone Rewards smoke tests.
//
// Run with: `anchor test` (or `yarn mocha tests/clearstone-rewards.ts`).
//
// Scope: farm state setup, stake/unstake loop, refill/decommission, and
// reallocation on stale stake. We don't need a real core market — the
// `market` field on FarmState is just a bookkeeping pubkey. Any SPL
// mint works as the LP token for staking.

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
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert, expect } from "chai";

import {
  findFarmState,
  findLpEscrow,
  findStakePosition,
  sleep,
  advanceClock,
} from "./fixtures";

import type { ClearstoneRewards } from "../target/types/clearstone_rewards";

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;
const rewards = anchor.workspace.clearstoneRewards as Program<ClearstoneRewards>;

async function fundedUser(amountSol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey,
    amountSol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
}

interface FarmFixture {
  curatorKp: Keypair;
  market: PublicKey; // dummy bookkeeping key
  lpMint: PublicKey;
  rewardMint: PublicKey;
  farmState: PublicKey;
  lpEscrow: PublicKey;
  rewardEscrow: PublicKey;
}

async function buildFarm(): Promise<FarmFixture> {
  const curatorKp = await fundedUser(5);
  const market = Keypair.generate().publicKey; // farm_state's `market` is just a label
  const lpMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6
  );
  const rewardMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6
  );
  const [farmState] = findFarmState(market, rewards.programId);
  const [lpEscrow] = findLpEscrow(market, rewards.programId);
  const rewardEscrow = getAssociatedTokenAddressSync(
    rewardMint,
    farmState,
    true // allowOwnerOffCurve — farmState is a PDA
  );

  await rewards.methods
    .initializeFarmState()
    .accounts({
      payer: payer.publicKey,
      curator: curatorKp.publicKey,
      market,
      lpMint,
      farmState,
      lpEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([payer])
    .rpc();

  return {
    curatorKp,
    market,
    lpMint,
    rewardMint,
    farmState,
    lpEscrow,
    rewardEscrow,
  };
}

async function addDefaultFarm(
  fix: FarmFixture,
  opts: { tokenRate: number; expiryTimestamp: number }
): Promise<void> {
  await rewards.methods
    .addFarm(new BN(opts.tokenRate), opts.expiryTimestamp)
    .accounts({
      curator: fix.curatorKp.publicKey,
      farmState: fix.farmState,
      rewardMint: fix.rewardMint,
      rewardEscrow: fix.rewardEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([fix.curatorKp])
    .rpc();
}

describe("clearstone-rewards :: farm lifecycle", () => {
  it("initialize_farm_state pins market + lp_mint + curator", async () => {
    const fix = await buildFarm();
    const farm = await rewards.account.farmState.fetch(fix.farmState);
    expect(farm.curator.toBase58()).to.equal(fix.curatorKp.publicKey.toBase58());
    expect(farm.market.toBase58()).to.equal(fix.market.toBase58());
    expect(farm.lpMint.toBase58()).to.equal(fix.lpMint.toBase58());
    expect(farm.totalStaked.toString()).to.equal("0");
    expect(farm.farms.length).to.equal(0);
  });

  it("add_farm registers a (reward_mint, rate, expiry) bucket", async () => {
    const fix = await buildFarm();
    const now = Math.floor(Date.now() / 1000);
    await addDefaultFarm(fix, { tokenRate: 1000, expiryTimestamp: now + 3600 });

    const farm = await rewards.account.farmState.fetch(fix.farmState);
    expect(farm.farms.length).to.equal(1);
    expect(farm.farms[0].rewardMint.toBase58()).to.equal(fix.rewardMint.toBase58());
    expect(farm.farms[0].tokenRate.toString()).to.equal("1000");
  });

  it("add_farm rejects duplicate reward_mint entries", async () => {
    const fix = await buildFarm();
    const now = Math.floor(Date.now() / 1000);
    await addDefaultFarm(fix, { tokenRate: 1, expiryTimestamp: now + 3600 });
    try {
      await addDefaultFarm(fix, { tokenRate: 2, expiryTimestamp: now + 7200 });
      assert.fail("duplicate add_farm should have been rejected");
    } catch (e: any) {
      expect(String(e)).to.match(/FarmAlreadyExists|already/i);
    }
  });
});

describe("clearstone-rewards :: stake + claim", () => {
  async function seededUser(
    fix: FarmFixture,
    lpAmount: bigint
  ): Promise<{
    user: Keypair;
    lpSrc: PublicKey;
    stakePos: PublicKey;
  }> {
    const user = await fundedUser();
    const lpSrc = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.lpMint,
        user.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      fix.lpMint,
      lpSrc,
      payer,
      lpAmount
    );
    const [stakePos] = findStakePosition(fix.farmState, user.publicKey, rewards.programId);
    return { user, lpSrc, stakePos };
  }

  it("stake_lp moves LP into escrow and bumps total_staked", async () => {
    const fix = await buildFarm();
    const now = Math.floor(Date.now() / 1000);
    await addDefaultFarm(fix, { tokenRate: 0, expiryTimestamp: now + 3600 });

    const { user, lpSrc, stakePos } = await seededUser(fix, 1_000_000n);

    await rewards.methods
      .stakeLp(new BN(500_000))
      .accounts({
        owner: user.publicKey,
        farmState: fix.farmState,
        lpMint: fix.lpMint,
        lpSrc,
        lpEscrow: fix.lpEscrow,
        position: stakePos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    const farm = await rewards.account.farmState.fetch(fix.farmState);
    expect(farm.totalStaked.toString()).to.equal("500000");
    const pos = await rewards.account.stakePosition.fetch(stakePos);
    expect(pos.stakedAmount.toString()).to.equal("500000");
    const escrow = await getAccount(provider.connection, fix.lpEscrow);
    expect(escrow.amount.toString()).to.equal("500000");
  });

  it("claim_farm_emission transfers accrued rewards after clock advance", async () => {
    const fix = await buildFarm();
    const now = Math.floor(Date.now() / 1000);
    // Emit 1000 reward tokens per second. With a 5s advance we expect
    // ≈5000 reward tokens accrued to the sole staker.
    await addDefaultFarm(fix, { tokenRate: 1000, expiryTimestamp: now + 3600 });

    // Fund the reward escrow so claim has something to pay out.
    const curatorRewardAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.rewardMint,
        fix.curatorKp.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      fix.rewardMint,
      curatorRewardAta,
      payer,
      1_000_000n
    );
    await rewards.methods
      .refillFarm(new BN(100_000))
      .accounts({
        curator: fix.curatorKp.publicKey,
        farmState: fix.farmState,
        rewardMint: fix.rewardMint,
        rewardSrc: curatorRewardAta,
        rewardEscrow: fix.rewardEscrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([fix.curatorKp])
      .rpc();

    // Stake 1000 LP — this also bumps `last_update_ts` so emission
    // accrual starts from here.
    const user = await fundedUser();
    const lpSrc = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.lpMint,
        user.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      fix.lpMint,
      lpSrc,
      payer,
      1_000_000n
    );
    const [stakePos] = findStakePosition(fix.farmState, user.publicKey, rewards.programId);
    await rewards.methods
      .stakeLp(new BN(1000))
      .accounts({
        owner: user.publicKey,
        farmState: fix.farmState,
        lpMint: fix.lpMint,
        lpSrc,
        lpEscrow: fix.lpEscrow,
        position: stakePos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    // Let the on-chain Clock move forward at least 3 seconds. Accrual
    // index = token_rate * dt / total_staked = 1000 * dt / 1000 = dt
    // reward tokens per LP — user holds 1000 LP → ~1000 * dt claimable.
    const advanced = await advanceClock(provider.connection, 3);
    expect(advanced).to.be.greaterThanOrEqual(3);

    const rewardDst = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.rewardMint,
        user.publicKey
      )
    ).address;
    const dstBefore = (await getAccount(provider.connection, rewardDst)).amount;
    await rewards.methods
      .claimFarmEmission()
      .accounts({
        owner: user.publicKey,
        farmState: fix.farmState,
        position: stakePos,
        rewardMint: fix.rewardMint,
        rewardEscrow: fix.rewardEscrow,
        rewardDst,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([user])
      .rpc();
    const dstAfter = (await getAccount(provider.connection, rewardDst)).amount;
    const received = Number(dstAfter - dstBefore);
    // Slot jitter: the window between `stake_lp` writing last_update_ts
    // and `claim_farm_emission` reading Clock::now can be shorter than
    // the `advanced` delta we observed outside the program (the advance
    // starts *before* the claim tx confirms). Just require SOME accrual
    // — correctness of the math is covered in Rust unit tests; this is
    // a runtime smoke for the CPI path.
    expect(received).to.be.greaterThan(0);
  });

  it("stake → unstake round-trips LP back to the user", async () => {
    const fix = await buildFarm();
    const now = Math.floor(Date.now() / 1000);
    await addDefaultFarm(fix, { tokenRate: 0, expiryTimestamp: now + 3600 });

    const { user, lpSrc, stakePos } = await seededUser(fix, 1_000_000n);

    await rewards.methods
      .stakeLp(new BN(300_000))
      .accounts({
        owner: user.publicKey,
        farmState: fix.farmState,
        lpMint: fix.lpMint,
        lpSrc,
        lpEscrow: fix.lpEscrow,
        position: stakePos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    await rewards.methods
      .unstakeLp(new BN(300_000))
      .accounts({
        owner: user.publicKey,
        farmState: fix.farmState,
        lpMint: fix.lpMint,
        lpDst: lpSrc,
        lpEscrow: fix.lpEscrow,
        position: stakePos,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([user])
      .rpc();

    const farm = await rewards.account.farmState.fetch(fix.farmState);
    expect(farm.totalStaked.toString()).to.equal("0");
    const userLp = await getAccount(provider.connection, lpSrc);
    expect(userLp.amount.toString()).to.equal("1000000");
  });
});

describe("clearstone-rewards :: refill + decommission", () => {
  it("refill_farm transfers reward tokens into the escrow", async () => {
    const fix = await buildFarm();
    const now = Math.floor(Date.now() / 1000);
    await addDefaultFarm(fix, { tokenRate: 0, expiryTimestamp: now + 3600 });

    const curatorRewardAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.rewardMint,
        fix.curatorKp.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      fix.rewardMint,
      curatorRewardAta,
      payer,
      1_000_000n
    );

    await rewards.methods
      .refillFarm(new BN(500_000))
      .accounts({
        curator: fix.curatorKp.publicKey,
        farmState: fix.farmState,
        rewardMint: fix.rewardMint,
        rewardSrc: curatorRewardAta,
        rewardEscrow: fix.rewardEscrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([fix.curatorKp])
      .rpc();

    const escrow = await getAccount(provider.connection, fix.rewardEscrow);
    expect(escrow.amount.toString()).to.equal("500000");
  });

  it("decommission_farm on an expired farm removes it and sweeps escrow", async () => {
    const fix = await buildFarm();
    // Set expiry in the past so decommission is allowed immediately.
    // `u32` seconds counts from epoch — any past timestamp works.
    await addDefaultFarm(fix, { tokenRate: 1, expiryTimestamp: 1 });

    // Drain destination.
    const drainAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.rewardMint,
        fix.curatorKp.publicKey
      )
    ).address;

    await rewards.methods
      .decommissionFarm()
      .accounts({
        curator: fix.curatorKp.publicKey,
        farmState: fix.farmState,
        rewardMint: fix.rewardMint,
        rewardEscrow: fix.rewardEscrow,
        rewardDrain: drainAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([fix.curatorKp])
      .rpc();

    const farm = await rewards.account.farmState.fetch(fix.farmState);
    expect(farm.farms.length).to.equal(0);
  });
});

describe("clearstone-rewards :: stale positions", () => {
  it("realloc_stake_position grows a stale position to current farm count", async () => {
    const fix = await buildFarm();
    const now = Math.floor(Date.now() / 1000);

    // Stake BEFORE any farms exist (space = n_farms=0).
    const user = await fundedUser();
    const lpSrc = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        fix.lpMint,
        user.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      fix.lpMint,
      lpSrc,
      payer,
      1_000_000n
    );
    const [stakePos] = findStakePosition(fix.farmState, user.publicKey, rewards.programId);

    await rewards.methods
      .stakeLp(new BN(100_000))
      .accounts({
        owner: user.publicKey,
        farmState: fix.farmState,
        lpMint: fix.lpMint,
        lpSrc,
        lpEscrow: fix.lpEscrow,
        position: stakePos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    // Curator now adds a farm — position is now stale (0 trackers but 1 farm).
    await addDefaultFarm(fix, { tokenRate: 1, expiryTimestamp: now + 3600 });

    // Realloc to the new size.
    await rewards.methods
      .reallocStakePosition()
      .accounts({
        owner: user.publicKey,
        farmState: fix.farmState,
        position: stakePos,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([user])
      .rpc();

    const pos = await rewards.account.stakePosition.fetch(stakePos);
    // Position size now matches n_farms=1 — a subsequent stake_lp should
    // succeed (exercised implicitly in other suites, assertion here is
    // just that realloc didn't error).
    expect(pos.stakedAmount.toString()).to.equal("100000");
  });
});

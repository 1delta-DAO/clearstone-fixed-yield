// Clearstone Curator :: Roll-delegation integration tests.
//
// Covers the §9 test matrix from clearstone-finance/CURATOR_ROLL_DELEGATION.md
// that is reachable without the full market-init harness — primarily the
// user-facing create/close lifecycle and the bounds/permissioning
// invariants. The crank tests that require a live MarketTwo (slippage-
// floor post-CPI assertion, allocations-drift-mid-roll, maturity-gated
// crank) are scaffolded as `.skip()` with pointers to the blocker in
// clearstone-curator.ts's existing reallocate tests.
//
// Run: `anchor test` (loads clearstone_curator via anchor.workspace).

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
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";

import {
  findCuratorVault,
  findBaseEscrow,
  findRollDelegation,
} from "./fixtures";

import type { ClearstoneCurator } from "../target/types/clearstone_curator";

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;
const curator = anchor.workspace.clearstoneCurator as Program<ClearstoneCurator>;

// ----------------------------------------------------------------------
// Test-matrix constants — mirror the Rust bounds in roll_delegation.rs.
// ----------------------------------------------------------------------

const MAX_SLIPPAGE_BPS = 1_000;
const MIN_TTL_SLOTS = new BN(216_000);
const MAX_TTL_SLOTS = new BN(21_600_000);

// ----------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------

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
}

async function buildCuratorVault(feeBps: number): Promise<CuratorVaultFixture> {
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

  // Touch the curator's base ATA so the vault PDA can receive the
  // escrow transfer if tests later trigger a deposit.
  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    baseMint,
    curatorKp.publicKey
  );

  await curator.methods
    .initializeVault(feeBps)
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

  return { curatorKp, baseMint, curatorVault, baseEscrow };
}

async function setCuratorAllocations(
  fix: CuratorVaultFixture,
  allocations: Array<{
    market: PublicKey;
    weightBps: number;
    capBase: BN;
    deployedBase?: BN;
  }>
) {
  await curator.methods
    .setAllocations(
      allocations.map((a) => ({
        market: a.market,
        weightBps: a.weightBps,
        capBase: a.capBase,
        deployedBase: a.deployedBase ?? new BN(0),
      }))
    )
    .accounts({
      curator: fix.curatorKp.publicKey,
      vault: fix.curatorVault,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([fix.curatorKp])
    .rpc();
}

async function userCreateDelegation(
  fix: CuratorVaultFixture,
  user: Keypair,
  maxSlippageBps: number,
  ttlSlots: BN
): Promise<PublicKey> {
  const [delegation] = findRollDelegation(
    fix.curatorVault,
    user.publicKey,
    curator.programId
  );
  await curator.methods
    .createDelegation(maxSlippageBps, ttlSlots)
    .accounts({
      user: user.publicKey,
      vault: fix.curatorVault,
      delegation,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([user])
    .rpc();
  return delegation;
}

// ----------------------------------------------------------------------
// create_delegation
// ----------------------------------------------------------------------

describe("clearstone-curator :: create_delegation", () => {
  it("happy path: stores vault, user, bounds, commits current allocations", async () => {
    const fix = await buildCuratorVault(200);
    const marketA = Keypair.generate().publicKey;
    await setCuratorAllocations(fix, [
      { market: marketA, weightBps: 10_000, capBase: new BN(1_000_000) },
    ]);

    const user = await fundedUser();
    const delegation = await userCreateDelegation(
      fix,
      user,
      50, // 0.5%
      MIN_TTL_SLOTS
    );

    const account = await curator.account.rollDelegation.fetch(delegation);
    expect(account.vault.toBase58()).to.equal(fix.curatorVault.toBase58());
    expect(account.user.toBase58()).to.equal(user.publicKey.toBase58());
    expect(account.maxSlippageBps).to.equal(50);
    expect(account.allocationsHash.length).to.equal(32);
    // Hash must be non-zero (we commit to a real allocation).
    expect(account.allocationsHash.some((b: number) => b !== 0)).to.be.true;
  });

  it("rejects slippage > 1000 bps (I-D2)", async () => {
    const fix = await buildCuratorVault(200);
    const user = await fundedUser();
    try {
      await userCreateDelegation(
        fix,
        user,
        MAX_SLIPPAGE_BPS + 1,
        MIN_TTL_SLOTS
      );
      assert.fail("expected SlippageTooWide");
    } catch (e: any) {
      expect(String(e)).to.match(/SlippageTooWide/);
    }
  });

  it("rejects ttl below MIN_TTL_SLOTS (I-D3)", async () => {
    const fix = await buildCuratorVault(200);
    const user = await fundedUser();
    try {
      await userCreateDelegation(
        fix,
        user,
        50,
        MIN_TTL_SLOTS.subn(1)
      );
      assert.fail("expected TtlTooShort");
    } catch (e: any) {
      expect(String(e)).to.match(/TtlTooShort/);
    }
  });

  it("rejects ttl above MAX_TTL_SLOTS (I-D3)", async () => {
    const fix = await buildCuratorVault(200);
    const user = await fundedUser();
    try {
      await userCreateDelegation(
        fix,
        user,
        50,
        MAX_TTL_SLOTS.addn(1)
      );
      assert.fail("expected TtlTooLong");
    } catch (e: any) {
      expect(String(e)).to.match(/TtlTooLong/);
    }
  });

  it("accepts boundary values (max slippage + max ttl)", async () => {
    const fix = await buildCuratorVault(200);
    const user = await fundedUser();
    await userCreateDelegation(
      fix,
      user,
      MAX_SLIPPAGE_BPS,
      MAX_TTL_SLOTS
    );
    // Just asserting no revert; fetch to confirm persistence.
    const [delegation] = findRollDelegation(
      fix.curatorVault,
      user.publicKey,
      curator.programId
    );
    const account = await curator.account.rollDelegation.fetch(delegation);
    expect(account.maxSlippageBps).to.equal(MAX_SLIPPAGE_BPS);
  });

  it("init_if_needed re-binds allocations_hash after set_allocations", async () => {
    // This is the I-D4 refresh flow: user signs, curator changes
    // allocations, user re-signs to re-bind. The second create must
    // overwrite the stored hash.
    const fix = await buildCuratorVault(200);
    const marketA = Keypair.generate().publicKey;
    const marketB = Keypair.generate().publicKey;

    await setCuratorAllocations(fix, [
      { market: marketA, weightBps: 10_000, capBase: new BN(1_000_000) },
    ]);

    const user = await fundedUser();
    const delegation = await userCreateDelegation(
      fix,
      user,
      50,
      MIN_TTL_SLOTS
    );
    const first = await curator.account.rollDelegation.fetch(delegation);

    // Curator replaces the allocation set.
    await setCuratorAllocations(fix, [
      { market: marketA, weightBps: 6000, capBase: new BN(500_000) },
      { market: marketB, weightBps: 4000, capBase: new BN(750_000) },
    ]);

    // User re-signs with the same bounds — ix is init_if_needed so
    // the PDA is overwritten, not re-created.
    await userCreateDelegation(fix, user, 50, MIN_TTL_SLOTS);
    const second = await curator.account.rollDelegation.fetch(delegation);

    expect(
      Buffer.compare(
        Buffer.from(first.allocationsHash as number[]),
        Buffer.from(second.allocationsHash as number[])
      )
    ).to.not.equal(0, "re-bind should change the committed hash");
  });
});

// ----------------------------------------------------------------------
// close_delegation
// ----------------------------------------------------------------------

describe("clearstone-curator :: close_delegation", () => {
  it("happy path: user can close their own delegation, rent refunded", async () => {
    const fix = await buildCuratorVault(200);
    const marketA = Keypair.generate().publicKey;
    await setCuratorAllocations(fix, [
      { market: marketA, weightBps: 10_000, capBase: new BN(1_000_000) },
    ]);

    const user = await fundedUser();
    const delegation = await userCreateDelegation(
      fix,
      user,
      50,
      MIN_TTL_SLOTS
    );

    const balBefore = await provider.connection.getBalance(user.publicKey);

    await curator.methods
      .closeDelegation()
      .accounts({
        user: user.publicKey,
        delegation,
      } as any)
      .signers([user])
      .rpc();

    const acct = await provider.connection.getAccountInfo(delegation);
    expect(acct).to.equal(null, "delegation PDA should be closed");

    const balAfter = await provider.connection.getBalance(user.publicKey);
    expect(balAfter).to.be.greaterThan(
      balBefore,
      "rent must be refunded to user"
    );
  });

  it("rejects a wallet that isn't the delegation's user (has_one)", async () => {
    const fix = await buildCuratorVault(200);
    const marketA = Keypair.generate().publicKey;
    await setCuratorAllocations(fix, [
      { market: marketA, weightBps: 10_000, capBase: new BN(1_000_000) },
    ]);

    const alice = await fundedUser();
    const mallory = await fundedUser();

    const delegation = await userCreateDelegation(
      fix,
      alice,
      50,
      MIN_TTL_SLOTS
    );

    try {
      await curator.methods
        .closeDelegation()
        .accounts({
          user: mallory.publicKey,
          delegation,
        } as any)
        .signers([mallory])
        .rpc();
      assert.fail("mallory closing alice's delegation should fail");
    } catch (e: any) {
      // seeds constraint or has_one — either surfaces; both encode I-D1.
      expect(String(e)).to.match(/VaultMismatch|ConstraintSeeds|has_one|ConstraintHasOne/);
    }
  });

  it("close is idempotent-safe: second close fails with account-not-found", async () => {
    const fix = await buildCuratorVault(200);
    const marketA = Keypair.generate().publicKey;
    await setCuratorAllocations(fix, [
      { market: marketA, weightBps: 10_000, capBase: new BN(1_000_000) },
    ]);

    const user = await fundedUser();
    const delegation = await userCreateDelegation(
      fix,
      user,
      50,
      MIN_TTL_SLOTS
    );

    await curator.methods
      .closeDelegation()
      .accounts({
        user: user.publicKey,
        delegation,
      } as any)
      .signers([user])
      .rpc();

    try {
      await curator.methods
        .closeDelegation()
        .accounts({
          user: user.publicKey,
          delegation,
        } as any)
        .signers([user])
        .rpc();
      assert.fail("second close should fail");
    } catch (e: any) {
      expect(String(e)).to.match(/AccountNotInitialized|does not exist/i);
    }
  });
});

// ----------------------------------------------------------------------
// crank_roll_delegated — invariant reverts
//
// These tests require either (a) real MarketTwo accounts or (b) clock
// warping to simulate maturity. The validator-run anchor harness
// supports neither trivially, so we scaffold them as `.skip()` with
// exact-reproduction notes. When the full integration harness lands
// (mock_klend fixtures + ProgramTest with a custom clock sysvar), flip
// each `.skip()` to `.it()`.
// ----------------------------------------------------------------------

describe("clearstone-curator :: crank_roll_delegated (invariants)", () => {
  it.skip("reverts with AllocationsDrifted when curator changes allocations after user signs", () => {
    // Setup: vault with allocations A+B, user signs (hash = H(A+B)),
    // curator calls set_allocations([A']), then any keeper calls
    // crank_roll_delegated.
    //
    // Expected: reverts with RollDelegationError::AllocationsDrifted.
    //
    // Blocker: needs valid `from_market` MarketTwo to satisfy the
    // Accounts struct deserialization before validate_delegation runs.
  });

  it.skip("reverts with Expired when clock.slot >= delegation.expires_at_slot", () => {
    // Blocker: ProgramTest clock-warp. Not supported by anchor-run
    // validator; needs a dedicated solana-program-test harness.
  });

  it.skip("reverts with FromMarketNotMatured before expiration_ts", () => {
    // Blocker: needs a real MarketTwo + the ability to set its
    // expiration_ts below clock.unix_timestamp.
  });

  it.skip("reverts with NothingToRoll when allocation.deployed_base == 0", () => {
    // Blocker: requires a valid MarketTwo for from_market to pass
    // Accounts deserialization, then hits the deployed == 0 check.
  });

  it.skip("reverts with SlippageBelowDelegationFloor when keeper min_base_out < floor", () => {
    // Blocker: needs real deployed_base > 0 in the allocation, which
    // requires a prior successful reallocate_to_market + real market.
  });

  it.skip("reverts with DeployedBaseDrift when vault_lp_ata.amount < deployed_base", () => {
    // Blocker: requires real LP ATA + ability to drain it out-of-band
    // to simulate the drift. Testable once the setupMarket harness
    // supports direct token-account manipulation.
  });

  it.skip("non-curator keeper can sign and cranks succeed (permissionless path)", () => {
    // The entire point of the v2 design. Blocker is the same real-
    // market setup; once a happy path runs under the curator key, flip
    // the signer to an arbitrary keypair and re-run.
  });

  it.skip("revoked delegation: second crank fails with AccountNotInitialized", () => {
    // After close_delegation, the PDA is gone; the
    // `seeds=[ROLL_DELEGATION_SEED, vault, user]` constraint fails to
    // load.
  });
});

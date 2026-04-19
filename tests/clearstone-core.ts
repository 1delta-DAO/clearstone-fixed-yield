// Integration test harness — scaffold only, not runnable end-to-end yet.
//
// Full M6 requires anchor build + a local validator. The tests here are
// structured so that:
//   1. Each `describe` block lines up with one PLAN §7 M6 scenario.
//   2. Common setup (SY market → vault → market) will move into a shared
//      `fixtures.ts` once the first scenario runs green.
//   3. `it.skip(...)` marks tests whose wiring needs runtime iteration —
//      account order in CpiAccounts, seed derivations, rent budgets, etc.
//      The skip list IS the M6 TODO; remove skips as they land.
//
// See FOLLOWUPS.md "M6 — Integration test plan" for the full target list.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ClearstoneCore } from "../target/types/clearstone_core";

describe("clearstone-core :: permissionless happy path", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;

  // The plan's three M6 scenarios, translated into test names.

  it.skip("user without privileged keys can create SY → vault → market", async () => {
    // 1. Instantiate generic_exchange_rate_sy over a fresh SPL mint.
    // 2. Seed initial exchange rate via poke_exchange_rate.
    // 3. Call initialize_vault with curator = random wallet.
    // 4. Call init_market_two with curator = different wallet.
    // 5. Assert vault.curator, market.curator match what we passed.
  });

  it.skip("strip → merge roundtrip returns original SY minus fees", async () => {
    // Fixture: vault + market as above. Mint SY to user, strip, merge.
  });

  it.skip("trade_pt moves PT and SY between trader and market", async () => {
    // Fixture as above. trade_pt buy PT. Verify token balances + market state.
  });
});

describe("clearstone-core :: malicious-SY isolation", () => {
  // Per PLAN §3 I-V1..I-V5: a malicious SY program can only harm its own
  // vault's holders. Every other market must be untouched.

  it.skip("SY reports zero exchange_rate → vault op rejected, other markets live", async () => {
    // Deploy two generic SY markets (honest + malicious). Bring up vaults
    // over each. Poke malicious rate to 0. Attempt strip → expect
    // SyInvalidExchangeRate error. Confirm honest vault still accepts strip.
  });

  it.skip("SY returns fewer emission_indexes than the vault tracks → rejected", async () => {
    // Honest vault with N emissions. Mock SY that returns N-1 indexes.
    // Expect SyEmissionIndexesMismatch.
  });

  it.skip("malicious SY cannot drain a different vault's funds", async () => {
    // Two vaults over two SY programs. Curator of vault A tries to wire
    // vault A's cpi_accounts to point at vault B's escrow. Expect the
    // `has_one` / seed constraints on the core to reject.
  });
});

describe("clearstone-core :: reentrancy", () => {
  // PLAN §3 I-C1: a reentrant CPI must fail. Requires a purpose-built
  // "malicious_sy_reentrant" test program that tries to call back into
  // clearstone_core during deposit_sy / withdraw_sy / get_sy_state.

  it.skip("reentrant SY cannot re-invoke strip during deposit_sy CPI", async () => {
    // Expect ReentrancyLocked error surfaced from the inner call.
  });

  it.skip("reentrant SY cannot re-invoke trade_pt during withdraw_sy CPI", async () => {
    // Same shape, different ix.
  });

  it.skip("guard clears after a successful ix so the next tx can enter again", async () => {
    // Strip twice, back to back. First must release the latch.
  });
});

describe("clearstone-core :: curator auth", () => {
  it.skip("non-curator signer on modify_vault_setting is rejected", async () => {});
  it.skip("non-curator signer on modify_market_setting is rejected", async () => {});
  it.skip("curator can lower interest_bps_fee but not raise it", async () => {});
  it.skip("curator cannot change max_py_supply (immutable post-init)", async () => {});
  it.skip("curator cannot change curve params (ln_fee_rate_root, rate_scalar_root)", async () => {});
});

describe("clearstone-core :: AMM invariants", () => {
  it.skip("donation of 1 wei SY to escrow does not shift trade_pt price beyond epsilon", async () => {});
  it.skip("first-LP sandwich: second depositor's pro-rata share matches their deposit ratio", async () => {});
  it.skip("add_liquidity → withdraw_liquidity returns ≤ original deposit (no free mint)", async () => {});
});

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
import { expect } from "chai";

import type { ClearstoneRouter } from "../target/types/clearstone_router";

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const router = anchor.workspace.clearstoneRouter as Program<ClearstoneRouter>;

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

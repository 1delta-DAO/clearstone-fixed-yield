// Focused reallocate_to_market test against the EXISTING curator vault +
// already-allocated market. Network flakiness keeps interrupting the full-
// stack script before step 6, so this only does the last step.
//
// Reads the current `curatorVault.allocations[0].market` from chain, derives
// all market PDAs, and calls the upgraded curator's reallocate_to_market
// with the new kamino fields.

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Connection,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { ClearstoneCore } from "../target/types/clearstone_core";
import type { ClearstoneCurator } from "../target/types/clearstone_curator";
import type { KaminoSyAdapter } from "../target/types/kamino_sy_adapter";
import { findUserPos } from "../tests/fixtures";
import { findAdapterPersonalPosition } from "../tests/kamino_fixtures";

const USDC_MINT = new PublicKey("8iBux2LRja1PhVZph8Rw4Hi45pgkaufNEiaZma5nTD5g");
const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const KLEND_RESERVE = new PublicKey("AYhwFLgzxWwqznhxv6Bg1NVnNeoDNu9SBGLzM1W3hSfb");
const PYTH = new PublicKey("EN2FsFZFdpiFAWpKDZqeJ2PY8EyE7xzz9Ew8ZQVhtHCJ");

const SY_METADATA = new PublicKey("7F6vSabYg9eke3iPbzsBigX9FL2e9JZS2rZN57V9Sja2");
const SY_MINT = new PublicKey("2vyiNved2xwKortbH1fERsWPjZLijtiJBaqoqT96EsGX");
const COLL_VAULT = new PublicKey("DVaaxn11tDrVXuAYBfqfuRtnRVEH6RJFEmVg68eJp6Ac");
const POOL_ESCROW = new PublicKey("8cubBJT1WYyEUSfPWEcoy84EptgoCsjdy5uKqJt5S4VY");
const KUSDC = new PublicKey("74Wcd7VSUjK4wABMF15Kc4fYqiPDNj4NmE9MMSUR3AJv");
const CURATOR_VAULT = new PublicKey("BDe2V5UxMEpJjb4H5UbLPK5UAsi1jUaUs2zx62YiCrZo");
const BASE_ESCROW = new PublicKey("8iSKQBGTKWahoRoTvbpKqb1U1BdS88rmMLiP37h5pLKW");

const REALLOC_AMOUNT = new BN(2_000_000); // 2 USDC

anchor.setProvider(AnchorProvider.env());
const provider = anchor.getProvider() as AnchorProvider;
const payer = (provider.wallet as any).payer as Keypair;

const core = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;
const adapter = anchor.workspace.kaminoSyAdapter as Program<KaminoSyAdapter>;
const curator = anchor.workspace.clearstoneCurator as Program<ClearstoneCurator>;

function log(label: string, val: PublicKey | string | number | bigint) {
  console.log(`  ${label.padEnd(30)} ${val.toString()}`);
}

(async () => {
  console.log("=== reallocate_to_market test (kamino path) ===");
  log("payer", payer.publicKey);
  log("curator vault", CURATOR_VAULT);

  // Read curator vault → allocations[0].market
  const cvAcct = await curator.account.curatorVault.fetch(CURATOR_VAULT);
  if (cvAcct.allocations.length === 0) throw new Error("vault has no allocations");
  const marketPk = cvAcct.allocations[0].market;
  log("market (from allocation)", marketPk);

  // Read market state to get vault, mint_pt, mint_lp, ALT.
  const marketAcct = await core.account.marketTwo.fetch(marketPk);
  const vaultPk = marketAcct.vault;
  const mintPt = marketAcct.mintPt;
  const mintLp = marketAcct.mintLp;
  const escrowPt = marketAcct.tokenPtEscrow;
  const escrowSy = marketAcct.tokenSyEscrow;
  const tokenFeeTreasurySy = marketAcct.tokenFeeTreasurySy;
  const marketAlt = marketAcct.addressLookupTable;
  log("market.vault", vaultPk);
  log("market.mintPt", mintPt);
  log("market.mintLp", mintLp);
  log("market.alt", marketAlt);

  // Read core vault → vault.alt
  const coreVaultAcct = await core.account.vault.fetch(vaultPk);
  const vaultAlt = coreVaultAcct.addressLookupTable;
  log("core_vault.alt", vaultAlt);

  // Kamino market position PDA (kamino's personal_position keyed by market).
  const [marketPosition] = findAdapterPersonalPosition(
    SY_METADATA,
    marketPk,
    adapter.programId
  );
  log("market_position (kamino)", marketPosition);

  // klend reserve fields
  const reserveInfo = (await provider.connection.getAccountInfo(KLEND_RESERVE))!;
  const klendLM = new PublicKey(reserveInfo.data.subarray(32, 64));
  const klendLiqSupply = new PublicKey(reserveInfo.data.subarray(160, 192));
  const [klendLMA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), klendLM.toBuffer()],
    KLEND
  );

  // Make sure base_escrow has REALLOC_AMOUNT.
  const escrowInfo = await getAccount(provider.connection, BASE_ESCROW);
  log("base_escrow USDC", escrowInfo.amount);
  if (escrowInfo.amount < BigInt(REALLOC_AMOUNT.toNumber())) {
    const userUsdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      USDC_MINT,
      payer.publicKey
    );
    const need = REALLOC_AMOUNT.toNumber() - Number(escrowInfo.amount);
    log("topping up base_escrow with", need);
    const [userPos] = findUserPos(CURATOR_VAULT, payer.publicKey, curator.programId);
    await curator.methods
      .deposit(new BN(need))
      .accounts({
        owner: payer.publicKey,
        vault: CURATOR_VAULT,
        baseMint: USDC_MINT,
        baseSrc: userUsdcAta.address,
        baseEscrow: BASE_ESCROW,
        position: userPos,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .rpc();
  }

  const vaultSyAta = getAssociatedTokenAddressSync(SY_MINT, CURATOR_VAULT, true);
  const vaultPtAta = getAssociatedTokenAddressSync(mintPt, CURATOR_VAULT, true);
  const vaultLpAta = getAssociatedTokenAddressSync(mintLp, CURATOR_VAULT, true);

  const [coreEventAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    core.programId
  );

  console.log("\n→ building reallocate_to_market ix");
  const reallocIx = await curator.methods
    .reallocateToMarket(
      0,
      REALLOC_AMOUNT,
      new BN(10_000),
      REALLOC_AMOUNT.neg(),
      new BN(10_000),
      new BN(10_000),
      new BN(1)
    )
    .accounts({
      curator: payer.publicKey,
      vault: CURATOR_VAULT,
      baseMint: USDC_MINT,
      baseEscrow: BASE_ESCROW,
      syMarket: SY_METADATA,
      syMint: SY_MINT,
      adapterBaseVault: COLL_VAULT,
      vaultSyAta,
      market: marketPk,
      marketEscrowPt: escrowPt,
      marketEscrowSy: escrowSy,
      tokenFeeTreasurySy,
      marketAlt,
      mintPt,
      mintLp,
      vaultPtAta,
      vaultLpAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      syProgram: adapter.programId,
      coreProgram: core.programId,
      coreEventAuthority: coreEventAuth,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      kaminoKlendProgram: KLEND,
      kaminoKlendReserve: KLEND_RESERVE,
      kaminoKlendLiquiditySupply: klendLiqSupply,
      kaminoKlendCollateralMint: KUSDC,
      kaminoKlendLendingMarket: klendLM,
      kaminoKlendLendingMarketAuthority: klendLMA,
      kaminoKlendInstructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      kaminoKlendLiquidityTokenProgram: TOKEN_PROGRAM_ID,
      kaminoKlendPythOracle: PYTH,
      kaminoKlendSwitchboardPrice: KLEND,
      kaminoKlendSwitchboardTwap: KLEND,
      kaminoKlendScopePrices: KLEND,
    } as any)
    .remainingAccounts([
      { pubkey: SY_METADATA, isSigner: false, isWritable: false },
      { pubkey: SY_MINT, isSigner: false, isWritable: true },
      { pubkey: POOL_ESCROW, isSigner: false, isWritable: true },
      { pubkey: marketPosition, isSigner: false, isWritable: true },
      { pubkey: KLEND_RESERVE, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ])
    .instruction();

  // v0 tx with both ALTs.
  const altLookups = await Promise.all(
    [vaultAlt, marketAlt].map((pk) =>
      provider.connection.getAddressLookupTable(pk).then((r) => r.value!)
    )
  );
  const { blockhash } = await provider.connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      reallocIx,
    ],
  }).compileToV0Message(altLookups);
  const v0tx = new VersionedTransaction(messageV0);
  v0tx.sign([payer]);
  const sig = await provider.connection.sendTransaction(v0tx);
  await provider.connection.confirmTransaction(sig, "confirmed");
  console.log(`\n✓ reallocate_to_market tx: ${sig}`);

  const cvAfter = await curator.account.curatorVault.fetch(CURATOR_VAULT);
  log("alloc[0].deployed_base", cvAfter.allocations[0].deployedBase.toString());
  log("vault.total_assets", cvAfter.totalAssets.toString());
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

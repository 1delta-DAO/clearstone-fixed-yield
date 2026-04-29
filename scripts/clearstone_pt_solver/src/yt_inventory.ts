// YT inventory top-up — Shape A from YT_DELIVERY_PLAN.md.
//
// Solver bots that fill YT-dst fusion orders need YT inventory in their ATA
// because there's no on-chain "flash YT" primitive yet (v2). This module
// exposes:
//
//   - `currentYtBalance(...)` — read solver's YT ATA balance.
//   - `topUpYtInventory(...)` — strip enough SY to bring YT inventory back
//     above a target threshold. Idempotent: returns null when already topped
//     up. Solver keeps the matching PT (and YT) — PT can be sold via
//     wrapper_sell_pt downstream or held as inventory for PT-sell orders.
//
// Run it as a CLI loop (one strip per N minutes) or import the function
// and call it inside the solver's main loop before each `tryRouteOrder`.
//
// Strategy notes.
//   * Stripping is the cheapest source of YT — no AMM curve fee, only
//     SY → PT+YT at exchange_rate.
//   * Buying YT off `core.buy_yt` is the alternative — better when SY is
//     scarce but more expensive (curve fee + AMM impact).
//   * For now we only implement strip; buy_yt fallback is straightforward to
//     add (mirror buildStripIx → buildBuyYtIx).
//
// The PT byproduct of stripping is solver inventory: useful for buy-PT
// fusion orders that route via "tradePt" (already wired). Production
// solvers should track total PT + YT exposure and rebalance accordingly.

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "node:fs";

import type { SolverClients } from "./clients.js";
import { loadClients } from "./clients.js";
import {
  fetchAlt,
  fetchVaultState,
  resolveSyCpiRemainingAccounts,
} from "./state.js";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Read solver's YT-ATA balance. Returns 0n when the ATA hasn't been
 *  created (treated as "no inventory"). */
export async function currentYtBalance(
  connection: Connection,
  ytMint: PublicKey,
  solver: PublicKey
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(ytMint, solver, false, TOKEN_PROGRAM_ID);
  try {
    const acct = await getAccount(connection, ata);
    return acct.amount;
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) return 0n;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Top-up
// ---------------------------------------------------------------------------

export interface TopUpInput {
  clients: SolverClients;
  /** Vault PDA the YT mint belongs to. */
  vault: PublicKey;
  /** Strip enough SY to bring YT inventory ≥ this. */
  targetYtBalance: BN;
  /** Optional CU override (default 600k — strip's CPI chain is ~250k). */
  computeUnits?: number;
}

export interface TopUpOutcome {
  /** Tx signature, or null if no top-up needed. */
  signature: string | null;
  /** Pre-strip YT balance (decimals as on-chain u64). */
  before: bigint;
  /** Post-strip YT balance, or `before` when no strip happened. */
  after: bigint;
}

/**
 * Strip-on-low-balance.
 *
 * If the solver's YT ATA holds < `targetYtBalance` YT, builds + sends one
 * `core.strip` tx that mints (target − current) PT + YT to the solver.
 * No-ops when already at/over target.
 *
 * Assumes the solver's SY ATA holds enough SY to fund the strip. Caller
 * is responsible for upstream sourcing (wallet pre-fund, swap base→SY via
 * adapter, etc.) — this helper does the SY → PT+YT step only.
 */
export async function topUpYtInventory(
  input: TopUpInput
): Promise<TopUpOutcome> {
  const { clients, vault: vaultPk, targetYtBalance } = input;
  const solver = clients.solver.publicKey;

  const vault = await fetchVaultState(clients, vaultPk);
  const before = await currentYtBalance(clients.connection, vault.mintYt, solver);

  if (before >= BigInt(targetYtBalance.toString())) {
    return { signature: null, before, after: before };
  }

  const need = BigInt(targetYtBalance.toString()) - before;
  // Stripping `need` SY mints exactly `need * exchange_rate` of each of
  // PT + YT. For exchange_rate ≈ 1 (most generic adapters at init), this
  // produces `need` YT. Production should read
  // `vault.last_seen_sy_exchange_rate` and divide to size precisely.
  const stripAmount = new BN(need.toString());

  const alt = await fetchAlt(clients, vault.addressLookupTable);
  // strip only invokes get_sy_state + deposit_sy in its inner CPI chain.
  const remaining = resolveSyCpiRemainingAccounts(
    [vault.cpiAccounts.getSyState, vault.cpiAccounts.depositSy],
    alt
  );

  const sySrc = getAssociatedTokenAddressSync(vault.mintSy, solver, false, TOKEN_PROGRAM_ID);
  const ptDst = getAssociatedTokenAddressSync(vault.mintPt, solver, false, TOKEN_PROGRAM_ID);
  const ytDst = getAssociatedTokenAddressSync(vault.mintYt, solver, false, TOKEN_PROGRAM_ID);

  // Idempotent ATA creation for PT+YT — the solver may not have
  // initialised them yet. SY ATA must already exist (caller's funding
  // flow guarantees it).
  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: input.computeUnits ?? 600_000,
    })
  );
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      solver,
      ptDst,
      solver,
      vault.mintPt,
      TOKEN_PROGRAM_ID
    )
  );
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      solver,
      ytDst,
      solver,
      vault.mintYt,
      TOKEN_PROGRAM_ID
    )
  );

  const stripIx = await clients.clearstoneCore.methods
    .strip(stripAmount)
    .accounts({
      depositor: solver,
      authority: vault.authority,
      vault: vault.publicKey,
      sySrc,
      escrowSy: vault.escrowSy,
      ytDst,
      ptDst,
      mintYt: vault.mintYt,
      mintPt: vault.mintPt,
      mintSy: vault.mintSy,
      tokenProgram: TOKEN_PROGRAM_ID,
      addressLookupTable: vault.addressLookupTable,
      syProgram: vault.syProgram,
      yieldPosition: vault.yieldPosition,
    } as any)
    .remainingAccounts(remaining)
    .instruction();
  tx.add(stripIx);

  const signature = await clients.provider.sendAndConfirm(tx, [clients.solver], {
    commitment: "confirmed",
  });

  const after = await currentYtBalance(clients.connection, vault.mintYt, solver);
  return { signature, before, after };
}

// ---------------------------------------------------------------------------
// CLI: one-shot or polling loop
// ---------------------------------------------------------------------------

interface Argv {
  rpc: string;
  keypair: string;
  vault: string;
  target: string; // BN string
  intervalMs: number | null;
}

function parseArgv(): Argv {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string => {
    const idx = args.indexOf(flag);
    if (idx < 0) {
      if (fallback != null) return fallback;
      throw new Error(`missing --${flag.slice(2)} flag`);
    }
    const v = args[idx + 1];
    if (v == null) throw new Error(`--${flag.slice(2)} needs a value`);
    return v;
  };

  const intervalRaw = args.includes("--interval-ms") ? get("--interval-ms") : null;
  return {
    rpc: get("--rpc", process.env.RPC ?? "https://api.devnet.solana.com"),
    keypair: get("--keypair"),
    vault: get("--vault"),
    target: get("--target"),
    intervalMs: intervalRaw == null ? null : Number.parseInt(intervalRaw, 10),
  };
}

function loadKeypair(p: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function once(clients: SolverClients, vault: PublicKey, target: BN): Promise<void> {
  const out = await topUpYtInventory({ clients, vault, targetYtBalance: target });
  if (out.signature == null) {
    console.log(
      `[yt-inventory] ${vault.toBase58()} already topped up: ${out.before} YT`
    );
  } else {
    console.log(
      `[yt-inventory] ${vault.toBase58()} stripped: ${out.before} → ${out.after} YT (sig=${out.signature})`
    );
  }
}

async function main(): Promise<void> {
  const argv = parseArgv();
  const connection = new Connection(argv.rpc, "confirmed");
  const solver = loadKeypair(argv.keypair);
  const clients = await loadClients({ connection, solver });
  const vault = new PublicKey(argv.vault);
  const target = new BN(argv.target);

  if (argv.intervalMs == null) {
    await once(clients, vault, target);
    return;
  }

  // Loop. Caller can also drive this from cron or a systemd timer.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await once(clients, vault, target);
    } catch (e) {
      console.error("[yt-inventory] error:", e);
    }
    await new Promise((r) => setTimeout(r, argv.intervalMs!));
  }
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// Silence unused-import in non-main usage.
const _anchorAvailable = anchor;
void _anchorAvailable;

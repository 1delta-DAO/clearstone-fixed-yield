// On-chain state fetchers used by the fill builder to populate account lists.
//
// Clearstone core's `trade_pt` / `strip` / etc. take their SY-CPI accounts as
// `remainingAccounts` indexed through an Address Lookup Table. The ALT address
// and the `CpiInterfaceContext` index lists (`cpi_accounts.get_sy_state`,
// `cpi_accounts.deposit_sy`, `cpi_accounts.withdraw_sy`) live on each
// Vault / MarketTwo account. Resolving them here means the solver doesn't
// need seed knowledge for any particular adapter — it just reads what the
// core recorded at init.

import * as anchor from "@coral-xyz/anchor";
import { AccountMeta, AddressLookupTableAccount, PublicKey } from "@solana/web3.js";

import type { SolverClients } from "./clients.js";

/** Single entry in a `CpiInterfaceContext` vec. Matches core's Rust struct. */
interface CpiInterfaceContext {
  altIndex: number;
  isSigner: boolean;
  isWritable: boolean;
}

export interface MarketState {
  publicKey: PublicKey;
  vault: PublicKey;
  addressLookupTable: PublicKey;
  syProgram: PublicKey;
  mintSy: PublicKey;
  mintPt: PublicKey;
  mintLp: PublicKey;
  tokenSyEscrow: PublicKey;
  tokenPtEscrow: PublicKey;
  tokenFeeTreasurySy: PublicKey;
  cpiAccounts: {
    getSyState: CpiInterfaceContext[];
    depositSy: CpiInterfaceContext[];
    withdrawSy: CpiInterfaceContext[];
  };
  financials: { ptBalance: anchor.BN; syBalance: anchor.BN };
}

export interface VaultState {
  publicKey: PublicKey;
  authority: PublicKey;
  addressLookupTable: PublicKey;
  syProgram: PublicKey;
  mintSy: PublicKey;
  mintPt: PublicKey;
  mintYt: PublicKey;
  escrowSy: PublicKey;
  yieldPosition: PublicKey;
  treasurySyTokenAccount: PublicKey;
  cpiAccounts: {
    getSyState: CpiInterfaceContext[];
    depositSy: CpiInterfaceContext[];
    withdrawSy: CpiInterfaceContext[];
  };
}

export async function fetchMarketState(
  clients: SolverClients,
  market: PublicKey
): Promise<MarketState> {
  const raw = (await (clients.clearstoneCore.account as any).marketTwo.fetch(market)) as any;
  return {
    publicKey: market,
    vault: raw.vault,
    addressLookupTable: raw.addressLookupTable,
    syProgram: raw.syProgram,
    mintSy: raw.mintSy,
    mintPt: raw.mintPt,
    mintLp: raw.mintLp,
    tokenSyEscrow: raw.tokenSyEscrow,
    tokenPtEscrow: raw.tokenPtEscrow,
    tokenFeeTreasurySy: raw.tokenFeeTreasurySy,
    cpiAccounts: raw.cpiAccounts,
    financials: {
      ptBalance: new anchor.BN(raw.financials.ptBalance),
      syBalance: new anchor.BN(raw.financials.syBalance),
    },
  };
}

export async function fetchVaultState(
  clients: SolverClients,
  vault: PublicKey
): Promise<VaultState> {
  const raw = (await (clients.clearstoneCore.account as any).vault.fetch(vault)) as any;
  return {
    publicKey: vault,
    authority: raw.authority,
    addressLookupTable: raw.addressLookupTable,
    syProgram: raw.syProgram,
    mintSy: raw.mintSy,
    mintPt: raw.mintPt,
    mintYt: raw.mintYt,
    escrowSy: raw.escrowSy,
    yieldPosition: raw.yieldPosition,
    treasurySyTokenAccount: raw.treasurySyTokenAccount,
    cpiAccounts: raw.cpiAccounts,
  };
}

/** Fetch + decode an Address Lookup Table. Caches would be a natural extension. */
export async function fetchAlt(
  clients: SolverClients,
  alt: PublicKey
): Promise<AddressLookupTableAccount> {
  const resp = await clients.connection.getAddressLookupTable(alt);
  if (!resp.value) throw new Error(`ALT ${alt.toBase58()} not found`);
  return resp.value;
}

/**
 * Resolve a `CpiInterfaceContext[]` against an ALT into `AccountMeta[]`.
 * These are the `remainingAccounts` each core ix expects for its SY CPIs.
 *
 * The core passes the *union* of what its in-tree SY CPIs need (some call
 * `get_sy_state` alone, others chain `get_sy_state → deposit_sy` or
 * `get_sy_state → withdraw_sy`). To stay adapter-agnostic, we de-duplicate
 * by alt_index across the three lists and use the most-writable /
 * most-signing variant encountered for each index. The core's sy_cpi.rs
 * consumes only the positions it needs.
 */
export function resolveSyCpiRemainingAccounts(
  contexts: Array<CpiInterfaceContext[]>,
  alt: AddressLookupTableAccount
): AccountMeta[] {
  const byIndex = new Map<
    number,
    { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }
  >();
  for (const list of contexts) {
    for (const ctx of list) {
      const pubkey = alt.state.addresses[ctx.altIndex];
      if (!pubkey) {
        throw new Error(
          `ALT ${alt.key.toBase58()} missing index ${ctx.altIndex} (len ${alt.state.addresses.length})`
        );
      }
      const existing = byIndex.get(ctx.altIndex);
      byIndex.set(ctx.altIndex, {
        pubkey,
        isSigner: ctx.isSigner || (existing?.isSigner ?? false),
        isWritable: ctx.isWritable || (existing?.isWritable ?? false),
      });
    }
  }
  return [...byIndex.values()];
}

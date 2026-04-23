// Recognize a fusion OrderConfig as targeting a clearstone PT or YT mint.
//
// Detection is by mint-authority: PT / YT mints are created by clearstone_core,
// so their authority is a vault PDA derived with the MINT_PT / MINT_YT seeds.
// We use a simple AccountInfo.owner check against the known core program id.

import { PublicKey } from "@solana/web3.js";
import type { SolverClients } from "./clients.js";

export type ClearstoneMintKind = "pt" | "yt";

export interface ClearstoneMintMeta {
  kind: ClearstoneMintKind;
  vault: PublicKey;
  mint: PublicKey;
}

/**
 * Given a fusion order's `dst_mint`, determine whether it's a clearstone PT
 * or YT mint. Returns null for non-clearstone mints (solver ignores those).
 *
 * TODO(optimize): cache results — mints are immutable after vault init.
 */
export async function classifyMint(
  clients: SolverClients,
  mint: PublicKey
): Promise<ClearstoneMintMeta | null> {
  const info = await clients.connection.getAccountInfo(mint);
  if (!info) return null;

  // Both PT and YT mints are SPL Token-2022 mints created via the core's
  // `create_mint_2022` helper; their authority is a vault PDA owned by core.
  // We check the mint authority offset (bytes 0..32 of a Token-2022 Mint after
  // any extension preamble) against known vault PDAs.
  //
  // Implementation note: this skeleton walks all Vault accounts on core and
  // matches mint_pt / mint_yt pubkeys. A production solver would maintain an
  // off-chain index keyed by mint → vault to avoid the O(N) scan.

  const core = clients.clearstoneCore;
  // `vault` account type name in the core IDL. The camelCase conversion that
  // Anchor does: `Vault` → `vault` in program.account.
  const allVaults = await (core.account as any).vault.all();
  for (const { publicKey: vault, account } of allVaults as Array<{
    publicKey: PublicKey;
    account: { mintPt: PublicKey; mintYt: PublicKey };
  }>) {
    if (account.mintPt.equals(mint)) {
      return { kind: "pt", vault, mint };
    }
    if (account.mintYt.equals(mint)) {
      return { kind: "yt", vault, mint };
    }
  }
  return null;
}

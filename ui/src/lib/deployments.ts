// Canonical devnet handles for the demo UI.
//
// Mirrors the live `kaminoStack` block in clearstone-fixed-yield's
// `deployments/devnet.json` (lastUpdated 2026-04-26). If the on-chain
// state moves — e.g., the maturity rolls or a fresh canonical stack is
// stood up — update both files in lockstep. The UI checks staleness
// only via the `lastUpdated` field surfaced in the Setup tab.
//
// Override at runtime: paste a new JSON blob into the Setup tab to swap
// any field. Useful when running against a local validator or a forked
// stack.

import { PublicKey } from "@solana/web3.js";

export interface CanonicalStack {
  cluster: string;
  rpcUrl: string;
  lastUpdated: string;
  programs: {
    clearstone_core: PublicKey;
    clearstone_router: PublicKey;
    clearstone_curator: PublicKey;
    clearstone_solver_callback: PublicKey;
    clearstone_fusion: PublicKey;
    generic_exchange_rate_sy: PublicKey;
    kamino_sy_adapter: PublicKey;
  };
  /** Live Kamino-backed PT/YT stack on Solstice USDC. */
  kaminoStack: {
    baseMint: PublicKey;
    syMetadata: PublicKey;
    syMint: PublicKey;
    klendReserve: PublicKey;
    klendCollateralMint: PublicKey;
    klendPyth: PublicKey;
    poolEscrow: PublicKey;
    collateralVault: PublicKey;
    curatorVault: PublicKey;
    ptVault: PublicKey;
    vaultAuthority: PublicKey;
    mintPt: PublicKey;
    mintYt: PublicKey;
    ammMarket: PublicKey;
    mintLp: PublicKey;
    marketAlt: PublicKey;
  };
}

export const DEVNET_DEFAULT: CanonicalStack = {
  cluster: "devnet",
  rpcUrl: "https://api.devnet.solana.com",
  lastUpdated: "2026-04-26",
  programs: {
    clearstone_core: new PublicKey("DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW"),
    clearstone_router: new PublicKey("DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW"),
    clearstone_curator: new PublicKey("831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm"),
    clearstone_solver_callback: new PublicKey("27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP"),
    clearstone_fusion: new PublicKey("9ShSnLUcWeg5BZzokj8mdo9cNHARCKa42kwmqSdBNM6J"),
    generic_exchange_rate_sy: new PublicKey("HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3"),
    kamino_sy_adapter: new PublicKey("29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd"),
  },
  kaminoStack: {
    baseMint: new PublicKey("8iBux2LRja1PhVZph8Rw4Hi45pgkaufNEiaZma5nTD5g"),
    syMetadata: new PublicKey("7F6vSabYg9eke3iPbzsBigX9FL2e9JZS2rZN57V9Sja2"),
    syMint: new PublicKey("2vyiNved2xwKortbH1fERsWPjZLijtiJBaqoqT96EsGX"),
    klendReserve: new PublicKey("AYhwFLgzxWwqznhxv6Bg1NVnNeoDNu9SBGLzM1W3hSfb"),
    klendCollateralMint: new PublicKey("74Wcd7VSUjK4wABMF15Kc4fYqiPDNj4NmE9MMSUR3AJv"),
    klendPyth: new PublicKey("EN2FsFZFdpiFAWpKDZqeJ2PY8EyE7xzz9Ew8ZQVhtHCJ"),
    poolEscrow: new PublicKey("8cubBJT1WYyEUSfPWEcoy84EptgoCsjdy5uKqJt5S4VY"),
    collateralVault: new PublicKey("DVaaxn11tDrVXuAYBfqfuRtnRVEH6RJFEmVg68eJp6Ac"),
    curatorVault: new PublicKey("BDe2V5UxMEpJjb4H5UbLPK5UAsi1jUaUs2zx62YiCrZo"),
    ptVault: new PublicKey("DJhsAvfH67DRHvZSYMjHMQchVd77zTSCq62BNXEqu8ze"),
    vaultAuthority: new PublicKey("9aVE4b6RasHNN6uzPHqfUVZrbgMpyvu3eGTdUCyebWWA"),
    mintPt: new PublicKey("5yKkeK83FNECQLEr37rQqaWANEkAJSnTQCgigWDCcwvm"),
    mintYt: new PublicKey("FhosjjdpHjYzzkw6swjQC5wc8t3D751txxJgo38ZmBq8"),
    ammMarket: new PublicKey("HJmpC6EK8EfJyEwoSEwwgieKR1uPQbb755zq5gDjouZB"),
    mintLp: new PublicKey("52m4zmeCqY91cBdzMYMLhigVT1yiLTPKHd1NFrSep1Q4"),
    marketAlt: new PublicKey("365QNLt7jPou6v9zT1b2fdR65FwV2j3KeQLNEzvx6Mzv"),
  },
};

const STORAGE_KEY = "clearstone-ui-stack-override";

export function loadStack(): CanonicalStack {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEVNET_DEFAULT;
    const parsed = JSON.parse(raw);
    return inflate(parsed);
  } catch {
    return DEVNET_DEFAULT;
  }
}

export function saveStack(stack: CanonicalStack): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deflate(stack), null, 2));
}

export function clearStackOverride(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function deflate(s: CanonicalStack): unknown {
  const flat = (obj: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k,
        v instanceof PublicKey ? v.toBase58() : v,
      ])
    );
  return {
    cluster: s.cluster,
    rpcUrl: s.rpcUrl,
    lastUpdated: s.lastUpdated,
    programs: flat(s.programs as unknown as Record<string, unknown>),
    kaminoStack: flat(s.kaminoStack as unknown as Record<string, unknown>),
  };
}

function inflate(raw: unknown): CanonicalStack {
  const r = raw as Record<string, unknown>;
  const inflateMap = <T extends Record<string, PublicKey>>(
    section: Record<string, unknown>
  ): T => {
    const out: Record<string, PublicKey> = {};
    for (const [k, v] of Object.entries(section)) {
      out[k] = new PublicKey(v as string);
    }
    return out as T;
  };
  return {
    cluster: r.cluster as string,
    rpcUrl: r.rpcUrl as string,
    lastUpdated: r.lastUpdated as string,
    programs: inflateMap(r.programs as Record<string, unknown>) as CanonicalStack["programs"],
    kaminoStack: inflateMap(r.kaminoStack as Record<string, unknown>) as CanonicalStack["kaminoStack"],
  };
}

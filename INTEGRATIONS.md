# Integrating with Clearstone (devnet)

5-minute setup for someone landing on this repo wanting to point a
client at the live devnet stack.

## What's live

- **Cluster:** devnet (`https://api.devnet.solana.com`)
- **Programs:** 6 live (5 in workspace + Kamino SY adapter). All under
  the same cold upgrade authority (`Hro4y3Xd...`).
- **Canonical demo stack:** stood up by `scripts/devnet-e2e.ts`. Use it
  to read state, derive PDAs, or sanity-check your wiring before
  creating your own.

Full IDs + on-chain hashes + canonical stack: [`deployments/devnet.json`](deployments/devnet.json).

## Quickstart

### 1. Install + grab IDLs

```sh
yarn add @coral-xyz/anchor @solana/web3.js @solana/spl-token
# IDLs are committed in idl/ — copy what you need into your project
cp -r idl ./src/clearstone-idl
```

Or pull from on-chain (set on each first deploy via
`scripts/devnet-idl-init.sh`):

```sh
anchor idl fetch <programId> -o my-idl.json --provider.cluster devnet
```

### 2. Wire up a Program client

```ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import coreIdl from "./clearstone-idl/clearstone_core.json";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const wallet = new anchor.Wallet(Keypair.generate()); // your wallet
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
const core = new Program(
  coreIdl as any,
  new PublicKey("DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW"),
  provider
);
```

Repeat for any of the other live programs:

| Program | Devnet ID |
|---|---|
| `clearstone_core` | `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW` |
| `generic_exchange_rate_sy` | `HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3` |
| `kamino_sy_adapter` | `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd` |
| `clearstone_rewards` | `7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g` |
| `clearstone_curator` | `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm` |
| `clearstone_router` | `DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW` |

### 3. Read the canonical stack

The `canonicalStack` block in `deployments/devnet.json` holds a fully
wired-up vault + market + curator vault + farm. Use it to read state
or run view methods without standing up your own:

```ts
import devnet from "../deployments/devnet.json";

const stack = devnet.canonicalStack;
const vault = await core.account.vault.fetch(new PublicKey(stack.vault));
console.log("vault.last_seen_sy_exchange_rate", vault.lastSeenSyExchangeRate);
console.log("vault.pt_supply", vault.ptSupply.toString());
```

### 4. Build your first tx

Easiest path: use the router. It hides the SY interchange entirely —
you bring base, you get PT/YT/LP.

```ts
import routerIdl from "./clearstone-idl/clearstone_router.json";
const router = new Program(routerIdl as any, new PublicKey(devnet.programs.clearstone_router.programId), provider);

// Strip 1 USDC (devnet) into PT + YT through the router:
await router.methods
  .wrapperStrip(new anchor.BN(1_000_000))
  .accounts({
    user: wallet.publicKey,
    syMarket: new PublicKey(stack.syMarket),
    baseMint: new PublicKey(stack.baseMint),
    syMint: new PublicKey(stack.syMint),
    baseSrc: yourBaseAta,            // your USDC ATA
    baseVault: new PublicKey(stack.syBaseVault),
    authority: new PublicKey(stack.vaultAuthority),
    vault: new PublicKey(stack.vault),
    sySrc: yourSyAta,                // ATA derived for syMint
    escrowSy: derivedFromVault,
    ytDst: yourYtAta,
    ptDst: yourPtAta,
    mintYt: new PublicKey(stack.mintYt),
    mintPt: new PublicKey(stack.mintPt),
    tokenProgram: TOKEN_PROGRAM_ID,
    addressLookupTable: derivedFromVault,
    syProgram: new PublicKey(devnet.programs.generic_exchange_rate_sy.programId),
    yieldPosition: new PublicKey(stack.yieldPosition),
    coreProgram: new PublicKey(devnet.programs.clearstone_core.programId),
    coreEventAuthority: derivedFromCore,
  })
  .rpc();
```

Reference end-to-end recipe: [`scripts/devnet-e2e.ts`](scripts/devnet-e2e.ts) — the
script that built the canonical stack itself. Copy/paste-friendly.

## What's NOT on devnet

These are deliberately absent — they're either test-only mocks or
deferred:

- `malicious_sy_nonsense`, `malicious_sy_reentrant` — test-only SY
  adapters in `reference_adapters/`. Skipped to avoid shipping
  test-only code on-chain. Run them locally via `anchor test`.
- `mock_klend`, `mock_flash_callback` — same: local-only mocks.
- `clearstone_solver_callback` — not yet in `Anchor.toml`'s workspace.
  Ship-or-defer decision pending v1.

The Metaplex Token Metadata program (`metaqbxxU…`) is the **mainnet**
program. We don't deploy it — it's cloned into local test validators
via `[[test.validator.clone]]` in `Anchor.toml`. On devnet it's the
real Metaplex. PT mints get on-chain metadata via Metaplex
`CreateMetadataAccountV3`.

## Health-check before integrating

Before announcing your integration, confirm the live IDs still match
what's in `deployments/devnet.json`:

```sh
yarn run tsx scripts/devnet-health.ts
```

Hits each program account, prints upgrade authority, last update
slot, and the on-chain sha256. If anything diverges from `devnet.json`,
the canonical stack is probably stale — re-run `devnet-e2e.ts`.

## Reporting issues

Open a GitHub issue with: cluster (`devnet`), program ID, ix name,
your tx signature, and the failing log lines. The deploy hashes in
`devnet.json` let us reproduce against the exact program build.

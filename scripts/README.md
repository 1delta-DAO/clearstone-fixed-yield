# scripts/

Devnet deploy + dry-run tooling. Step-3 / Step-4 of DEVNET_PLAN.md.

## Flow

```sh
# one-time setup
scripts/devnet-deploy-init.sh                 # generates hot + cold keypairs
scripts/devnet-fund.sh 50                     # airdrops 50 SOL to the hot deployer

# every deploy
anchor build                                   # build all workspace .so's
source .env.devnet                             # hot deployer + devnet RPC in env
scripts/devnet-deploy.sh                       # deploys 5 programs in DEVNET_PLAN order

# first deploy only
scripts/devnet-idl-init.sh                     # freezes + uploads IDL per program
scripts/devnet-verify-hashes.sh                # prints sha256 table for DEPLOY_IDS.md
scripts/devnet-transfer-upgrade-authority.sh   # hot → cold upgrade authority

# dry-run the full stack
yarn run tsx scripts/devnet-e2e.ts             # SY → vault → market → router/curator/rewards
```

## Script reference

- **`devnet-deploy-init.sh`** — creates `clearstone-devnet.json` (hot
  deployer) and `clearstone-devnet-cold.json` (cold upgrade authority)
  if missing. Idempotent; won't overwrite existing keypairs.
- **`devnet-fund.sh [SOL_TARGET] [WALLET_PATH]`** — airdrops devnet SOL
  in 5-SOL chunks until the target balance is met. Handles the 60s
  rate-limit by sleeping + retrying.
- **`devnet-deploy.sh`** — calls `anchor deploy` for each of the 5
  shipped programs. Skips any whose on-chain upgrade authority isn't
  the hot deployer (i.e. after transfer-upgrade-authority).
  Idempotent: Anchor handles upgrade-vs-first-deploy automatically.
- **`devnet-idl-init.sh`** — copies `target/idl/*.json` → `idl/`
  (frozen snapshot for integrators) and runs `anchor idl init` per
  program so explorers can decode events. Falls back to
  `anchor idl upgrade` if the IDL account already exists.
- **`devnet-verify-hashes.sh`** — runs `solana-verify build
  --library-name <crate>` per program and prints the sha256 table to
  paste into DEPLOY_IDS.md.
- **`devnet-transfer-upgrade-authority.sh`** — moves upgrade authority
  from the hot deployer to the cold key. Run once, right after the
  initial deploy. Idempotent: skips any program already owned by
  cold.
- **`devnet-e2e.ts`** — stands up a complete stack (base mint → SY
  market → core vault → core market → strip → router.wrapper_buy_pt
  → curator vault → allocation → reallocate → mark_to_market →
  harvest_fees → farm_state). Prints canonical handles to paste
  into DEPLOY_IDS.md. Each run creates fresh PDAs; previous handles
  remain live.

## Gotchas

- `anchor idl init` needs hot-deployer signing — run it *before*
  `devnet-transfer-upgrade-authority.sh`, or temporarily transfer
  authority back to the hot key for IDL upgrades.
- `devnet-e2e.ts` reads `ANCHOR_PROVIDER_URL` + `ANCHOR_WALLET` from
  env — always `source .env.devnet` first. The script warns if the
  RPC URL doesn't look like devnet, but doesn't block.
- The `malicious_sy_*` programs are *not* in this flow. They're
  test-only and the plan keeps them off devnet.

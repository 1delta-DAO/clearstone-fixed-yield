# Devnet curator-vault init — USDC base, Kamino-backed yield

Standing up a **clearstone_curator** vault on devnet where:
- `base_mint` = devnet test USDC
- Yield source = a **Kamino Lend** USDC reserve wrapped by the deployed
  `kamino_sy_adapter` (SY = 1:1 claim on kUSDC ctokens)

The vault itself holds only USDC. The "yield asset" wiring happens at
the layer below (SY adapter) and the market above (PT/SY AMM). All
three must exist before the vault can route a deposit into yield.

---

## Cluster / program registry

From [deployments/devnet.json](./devnet.json):

| Role | Program / Address |
|---|---|
| Curator program | `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm` |
| Core program | `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW` |
| Kamino SY adapter | `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd` |
| Upgrade authority | `AhKNmBmaeq6XrrEyGnSQne3WeU4SoN7hSAGieTiqPaJX` |
| RPC | `https://api.devnet.solana.com` |

From the clearstone-finance devnet configs
(`packages/programs/configs/devnet/`):

| Role | Address | Source |
|---|---|---|
| klend program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | `addresses.json` |
| klend lending market | `45FNL648aXgbMoMzLfYE2vCZAtWWDCky2tYLCEUztc98` | `market-deployed.json` |
| klend USDC reserve | `D4qXufDqBjU5iTbVMHfdxDrpYnz31sed1oQCJbWoVGmH` | `market-deployed.json` |
| USDC mint (klend reserve) | `2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G` | `market-deployed.json` |
| USDC collateral mint (kUSDC) | — fetch from reserve account at offset for `collateral.mint_pubkey` | klend Reserve layout |
| USDC mint (other) | `8iBux2LRja1PhVZph8Rw4Hi45pgkaufNEiaZma5nTD5g` | `addresses.json` (unused by klend reserve) |

> ⚠️ Two USDC mints exist on devnet. The klend reserve is wired to
> `2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G` — **that** is the mint
> the vault must use as `base_mint`, since the adapter's
> `mint_sy` / `redeem_sy` CPIs into klend require the reserve's liquidity mint.

---

## Initialization order (full stack)

Bottom-up. Steps 1–3 are one-time prereqs per (asset, maturity);
step 4 is the narrow "curator vault" init; step 5 wires them together.

```
1. kamino_sy_adapter::init_sy_params      → creates SY wrapping kUSDC
2. clearstone_core::initialize_vault      → creates a PT/YT vault with
                                             a maturity date
3. clearstone_core::init_market_two       → creates the PT/SY AMM
4. clearstone_curator::initialize_vault   → creates the USDC savings vault
5. clearstone_curator::set_allocations    → authorizes the market from
                                             step 3 as an allocation
```

---

## Step 1 — `kamino_sy_adapter::init_sy_params`

Creates an SY mint that represents a 1:1 claim on kUSDC ctokens held
in an adapter-owned vault.

- **Program:** `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd`
- **Instruction discriminator:** `[0]` (single byte — see
  `#[instruction(discriminator = [0])]` in
  [reference_adapters/kamino_sy_adapter/src/lib.rs:67](../reference_adapters/kamino_sy_adapter/src/lib.rs#L67))
- **Args:**
  - `kyc_mode: KycMode` — pass `KycMode::None` (USDC is a plain SPL mint)
  - `core_pdas_to_whitelist: Vec<Pubkey>` — empty

- **Accounts** (see `InitSyParams` at
  [reference_adapters/kamino_sy_adapter/src/lib.rs:637](../reference_adapters/kamino_sy_adapter/src/lib.rs#L637)):

  | # | Name | Kind | Value |
  |---|---|---|---|
  | 0 | `payer` | signer, writable | deployer wallet |
  | 1 | `curator` | signer | curator key (same wallet OK for devnet) |
  | 2 | `underlying_mint` | ro | `2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G` (USDC) |
  | 3 | `sy_metadata` | writable, PDA, init | seeds `[b"sy_metadata", underlying_mint]` |
  | 4 | `sy_mint` | writable, PDA, init | seeds `[b"sy_mint", sy_metadata]`, decimals=6 |
  | 5 | `collateral_vault` | writable, PDA, init | seeds `[b"collateral_vault", sy_metadata]`, mint=kUSDC, auth=sy_metadata |
  | 6 | `pool_escrow` | writable, PDA, init | seeds `[b"pool_escrow", sy_metadata]`, mint=sy_mint, auth=sy_metadata |
  | 7 | `klend_reserve` | ro | `D4qXufDqBjU5iTbVMHfdxDrpYnz31sed1oQCJbWoVGmH` |
  | 8 | `klend_lending_market` | ro | `45FNL648aXgbMoMzLfYE2vCZAtWWDCky2tYLCEUztc98` |
  | 9 | `klend_collateral_mint` | ro | fetch kUSDC mint from reserve |
  | 10 | `klend_program` | ro | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |
  | 11–14 | `governor_program`, `pool_config`, `dm_mint_config`, `delta_mint_program` | Option<None> | omit (kyc_mode = None) |
  | 15 | `token_program` | ro | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
  | 16 | `system_program` | ro | `11111111111111111111111111111111` |
  | 17 | `rent` | ro | `SysvarRent111111111111111111111111111111111` |

---

## Step 2 — `clearstone_core::initialize_vault`

Creates a PT/YT vault over the SY from step 1 with a fixed maturity.

- **Program:** `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW`
- **Discriminator:** `[2]` (see
  [programs/clearstone_core/src/lib.rs:42](../programs/clearstone_core/src/lib.rs#L42))
- **Args:** see the full signature at
  [programs/clearstone_core/src/lib.rs:43](../programs/clearstone_core/src/lib.rs#L43):
  - `start_timestamp: u32` — current unix ts
  - `duration: u32` — seconds to maturity (e.g. 90 days = `7_776_000`)
  - `interest_bps_fee: u16` — initial protocol fee (≤ `creator_fee_bps`)
  - `cpi_accounts: CpiAccounts { adapter, sy_mint }` — adapter = kamino adapter program, sy_mint = step 1's `sy_mint` PDA
  - `min_op_size_strip: u64` / `min_op_size_merge: u64` — spam guards, e.g. `1_000_000` (1 USDC)
  - `pt_metadata_name: String` — e.g. `"PT Kamino USDC 2026-07"`
  - `pt_metadata_symbol: String` — e.g. `"PT-kUSDC-JUL26"`
  - `pt_metadata_uri: String`
  - `curator: Pubkey` — curator key
  - `creator_fee_bps: u16` — upper bound on `interest_bps_fee`
  - `max_py_supply: u64` — cap on total PT/YT minted
  - `emissions_seed: Vec<EmissionSeed>` — empty unless bootstrapping incentives
  - `enable_metadata: bool` — `true` to mint PT metadata (requires Metaplex Token-Metadata clone; see `Anchor.toml`)

---

## Step 3 — `clearstone_core::init_market_two`

Creates the PT/SY AMM over the vault from step 2.

- **Program:** `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW`
- **Discriminator:** `[10]` (see
  [programs/clearstone_core/src/lib.rs:129](../programs/clearstone_core/src/lib.rs#L129))
- **Args:** see
  [programs/clearstone_core/src/lib.rs:130](../programs/clearstone_core/src/lib.rs#L130):
  - `ln_fee_rate_root: f64` — e.g. `0.0003`
  - `rate_scalar_root: f64` — e.g. `75.0` (tune per duration)
  - `init_rate_anchor: f64` — starting implied yield, e.g. `0.05`
  - `sy_exchange_rate: Number` — current kUSDC exchange rate (from
    `get_sy_state` read-only query; 60-bit fixed-point)
  - `pt_init: u64`, `sy_init: u64` — seed liquidity
  - `fee_treasury_sy_bps: u16`
  - `cpi_accounts`, `seed_id: u8`, `curator`, `creator_fee_bps`

Exact account list is long (mint_pt, mint_yt, market PDA, LP mint, etc.).
Easiest path: lift the full fixture from
[tests/clearstone-core.ts](../tests/clearstone-core.ts) — it already
wires `init_market_two` for the test harness. Reuse the helper, swap
cluster + addresses.

---

## Step 4 — `clearstone_curator::initialize_vault` (the vault)

**This is the narrow "vault init" ask.** Can run independently of
steps 1–3 — the vault only knows about `base_mint`. The Kamino wiring
only matters once `set_allocations` references the market from step 3.

- **Program:** `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm`
- **Discriminator:** `[48, 191, 163, 44, 71, 129, 63, 164]`
  (sha256("global:initialize_vault")[..8]; Anchor default — no
  `#[instruction(discriminator)]` override on the handler)
- **Args:**
  - `fee_bps: u16` — performance fee charged by the curator on
    realized yield. Must be ≤ `2000` (20% cap). Typical: `1000` (10%).

- **Accounts** (see `InitializeVault` at
  [periphery/clearstone_curator/src/lib.rs:1189](../periphery/clearstone_curator/src/lib.rs#L1189)):

  | # | Name | Kind | Value |
  |---|---|---|---|
  | 0 | `payer` | signer, writable | deployer wallet |
  | 1 | `curator` | ro (stored, not a signer) | curator pubkey |
  | 2 | `base_mint` | ro | `2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G` (USDC) |
  | 3 | `vault` | writable, PDA, init | seeds `[b"curator_vault", curator, base_mint]`, program = curator program |
  | 4 | `base_escrow` | writable, PDA, init | seeds `[b"base_escrow", vault]`, mint=base_mint, authority=vault |
  | 5 | `token_program` | ro | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
  | 6 | `system_program` | ro | `11111111111111111111111111111111` |
  | 7 | `rent` | ro | `SysvarRent111111111111111111111111111111111` |

- **PDA derivations** (TypeScript; `CLEARSTONE_CURATOR_PROGRAM_ID` is
  already exported from
  [packages/calldata-sdk-solana/src/fixed-yield/curator.ts:70](../../clearstone-finance/packages/calldata-sdk-solana/src/fixed-yield/curator.ts#L70)):

  ```ts
  import { curatorVaultPda, curatorBaseEscrowPda }
    from "@clearstone/calldata-sdk-solana/fixed-yield/curator";

  const vault       = curatorVaultPda(curator, baseMint);       // [b"curator_vault", curator, base_mint]
  const baseEscrow  = curatorBaseEscrowPda(vault);              // [b"base_escrow", vault]
  ```

- **Rent cost:** ~0.005 SOL (vault account + token escrow account).

- **Emits:** `VaultInitialized { vault, curator, base_mint, fee_bps }`.

- **Post-init state:**
  - `v.curator = curator`
  - `v.base_mint = 2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G`
  - `v.base_escrow = <PDA>`
  - `v.total_shares = 0`, `v.total_assets = 0`
  - `v.fee_bps = <arg>`
  - `v.allocations = []`  ← step 5 fills this

---

## Step 5 — `clearstone_curator::set_allocations`

Authorizes the market from step 3 as an allocation the curator can
route capital into.

- **Program:** `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm`
- **Discriminator:** `[66, 88, 197, 213, 234, 204, 219, 244]`
  (already in SDK as `CURATOR_ADMIN_DISC.setAllocations` in
  [packages/calldata-sdk-solana/src/fixed-yield/constants.ts:33](../../clearstone-finance/packages/calldata-sdk-solana/src/fixed-yield/constants.ts#L33))
- **Args:**
  - `allocations: Vec<Allocation>` where `Allocation { market: Pubkey, weight_bps: u16, cap_base: u64, deployed_base: u64 = 0 }`
  - For a single-market first pass:
    `[{ market: <step-3 market PDA>, weight_bps: 10_000, cap_base: <large>, deployed_base: 0 }]`
  - Sum of `weight_bps` ≤ `10_000`.
- **Signer:** `curator` (must match `vault.curator`).
- **Accounts:** `vault` (writable, `has_one = curator`), `curator` (signer).

---

## Devnet smoke check (after step 4)

```bash
# Verify the vault exists
solana account $(npx tsx -e "
  import { PublicKey } from '@solana/web3.js';
  import { curatorVaultPda } from '@clearstone/calldata-sdk-solana/fixed-yield/curator';
  console.log(curatorVaultPda(
    new PublicKey('<curator>'),
    new PublicKey('2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G')
  ).toBase58());
") --output json-compact

# Then run the `on-chain-curator-vaults.test.ts` decoder parity suite
# (packages/backend-edge/test/) against this PDA.
```

---

## Notes on running from clearstone-finance

- SDK helpers for steps 4–5 are **not exported** — the curator-auth
  ix builders are deliberately out of SDK scope (see comment in
  [curator.ts:13](../../clearstone-finance/packages/calldata-sdk-solana/src/fixed-yield/curator.ts#L13)).
  Either add the builders to `curator-admin.ts` (mirroring the
  existing `reallocate_to_market` pattern) or hand-roll the
  `TransactionInstruction` in the setup script.
- For step 1 (`init_sy_params`) the kyc_mode is `None`, so the
  `Option<UncheckedAccount>` accounts at positions 11–14 are omitted
  entirely (Anchor serializes as zero presence bytes).
- Existing script to use as a template:
  [packages/programs/scripts/setup-eusx-market.ts](../../clearstone-finance/packages/programs/scripts/setup-eusx-market.ts) —
  wires governor + pool + reserve end-to-end in one script; extend
  the same pattern.
- The kUSDC collateral mint is stored inside the klend `Reserve`
  account at a fixed offset (see the layout walkthrough in
  [reference_adapters/kamino_sy_adapter/src/lib.rs:497](../reference_adapters/kamino_sy_adapter/src/lib.rs#L497)).
  Simplest approach: run the setup script once with a placeholder,
  print the reserve's `collateral.mint_pubkey` field, then wire it
  back in. Or query via `@kamino-finance/klend-sdk`'s `Reserve.load`.

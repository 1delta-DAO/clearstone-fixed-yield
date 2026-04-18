# Exponent Core — Architecture & Market Setup Reference

A reusable reference for how Exponent (the Pendle-style yield-stripping protocol on Solana) works and how a new PT/YT market is created end-to-end.

---

## 1. Executive summary

- **Close to Pendle V2 in design.** PT, YT and LP are standard SPL/Token-2022 tokens. The AMM is the Pendle V2 *log-implied-rate* curve (rate scalar + rate anchor + decaying fee). The SY wrapper exposes the same interface surface as Pendle's `IStandardizedYield`.
- **"Oracle" is derived, not external.** There is no Pyth/Switchboard feed. PT price = function of the SY program's CPI-returned `exchange_rate` + the AMM's `last_ln_implied_rate`. At maturity, PT redeems against `sy_for_pt / pt_supply`. Reliability depends on the trustworthiness of the whitelisted SY programs, which is why vault/market creation is permissioned.
- **Market creation is NOT permissionless.** Vault + market initialization require a signer on the `exponent_admin` program's `exponent_core` principle list. End users LP, strip, merge, buy/sell PT & YT freely once a market exists.
- **Yield source set is curated.** The admin program enumerates supported SY-program families: `MarginfiStandard`, `KaminoLendStandard`, `JitoRestaking`, plus custom `ExponentCore`-managed ones. This bounds the addressable yield universe and realized LP depth.

### Files that define the above

- Vault init + admin gate: [programs/exponent_core/src/instructions/vault/admin/initialize_vault.rs](programs/exponent_core/src/instructions/vault/admin/initialize_vault.rs)
- Market init + admin gate: [programs/exponent_core/src/instructions/market_two/admin/market_two_init.rs](programs/exponent_core/src/instructions/market_two/admin/market_two_init.rs)
- Admin program (principles + whitelist): [programs/exponent_admin/src/lib.rs](programs/exponent_admin/src/lib.rs)
- Vault state (PT backing math, ATH emergency mode, treasury): [programs/exponent_core/src/state/vault.rs](programs/exponent_core/src/state/vault.rs)
- Market state (AMM curve): [programs/exponent_core/src/state/market_two.rs](programs/exponent_core/src/state/market_two.rs)
- SY CPI bindings + conversions: [programs/exponent_core/src/utils/sy_cpi.rs](programs/exponent_core/src/utils/sy_cpi.rs)
- SY-program interface types: [libraries/sy_common/src/lib.rs](libraries/sy_common/src/lib.rs)
- Program entrypoints + instruction discriminators: [programs/exponent_core/src/lib.rs](programs/exponent_core/src/lib.rs)

---

## 2. Deployments

| Network  | Program            | Address                                          | Source            |
| -------- | ------------------ | ------------------------------------------------ | ----------------- |
| Mainnet  | `exponent_core`    | `ExponentnaRg3CQbW6dqQNZKXp7gtZ9DGMp1cwC4HAS7`   | [README.md](README.md#L7), [lib.rs:18](programs/exponent_core/src/lib.rs#L18) |
| Mainnet  | `exponent_admin`   | `3D6ojc8vBfDteLBDTTRznZbZRh7bkEGQaYqNkudoTCBQ`   | [exponent_admin/src/lib.rs:3](programs/exponent_admin/src/lib.rs#L3) |
| Localnet | both (for testing) | Same IDs via `[programs.localnet]`               | [Anchor.toml:8-10](Anchor.toml#L8-L10) |

**There is no devnet or testnet deployment referenced in this repository.** `declare_id!` hard-codes the mainnet program IDs, and the repo's only non-production target is `Localnet` (`cluster = "Localnet"` in Anchor.toml). If you need a devnet deployment for integration testing, you must (a) deploy `exponent_admin` to devnet, (b) deploy `exponent_core` to devnet, and (c) either keep the same IDs (requires the deployer keypair) or patch both `declare_id!` calls and the `Anchor.toml` `[programs.devnet]` block. Note: downstream SY programs (Marginfi, Kamino, Jito) also need devnet deployments that your vault `cpi_accounts` can reference via ALT.

### On-chain build verification (mainnet)

- On-chain program hash: `e584d8035cbe411f6dc3a24bdcd32a29e4bf953569c1c4971b23c03793a16b3c`
- Deployed commit: `7011d1b46b542611543f8ed21836b165f2ab75ac`
- Verify with [solana-verifiable-build](https://github.com/Ellipsis-Labs/solana-verifiable-build), base image `solanafoundation/solana-verifiable-build:2.3.8`.

---

## 3. Component overview

```
 base asset (e.g. SOL, USDC)
        │
        ▼
   [SY program]          ← one per yield source (Kamino / Marginfi / Jito / ...)
        │  mint_sy
        ▼
     [Vault]             ← one per (SY, maturity). Holds SY, mints PT + YT
     ├── mint_pt (SPL, Metaplex metadata)
     ├── mint_yt (SPL)
     ├── escrow_sy (ATA of vault.authority)
     ├── escrow_yt (PDA token account)
     └── yield_position (vault's own position in the SY program)
        │
        ▼
    [MarketTwo]          ← AMM pool (PT ↔ SY) per vault (up to 255 via seed_id)
     ├── mint_lp (Token-2022)
     ├── escrow_pt / escrow_sy (AMM reserves)
     ├── escrow_lp (staked LP for farm + SY emissions)
     └── financials (rate_scalar_root, ln_fee_rate_root, last_ln_implied_rate)
```

### Key PDAs (seeds defined in [seeds.rs](programs/exponent_core/src/seeds.rs))

| PDA               | Seeds                                                     |
| ----------------- | --------------------------------------------------------- |
| `authority`       | `["authority", vault]`                                    |
| `mint_pt`         | `["mint_pt", vault]`                                      |
| `mint_yt`         | `["mint_yt", vault]`                                      |
| `escrow_yt`       | `["escrow_yt", vault]`                                    |
| `yield_position`  | `["yield_position", vault, authority]`                    |
| `market`          | `["market", vault, seed_id]`  *(seed_id u8, must be ≠ 0)* |
| `mint_lp`         | `["mint_lp", market]`                                     |
| `escrow_pt`       | `["escrow_pt", market]`                                   |
| `escrow_sy`       | `["escrow_sy", market]`                                   |
| `escrow_lp`       | `["escrow_lp", market]`                                   |
| `lp_position`     | `["lp_position", market, owner]`                          |

Note: `seed_id == 0` is forbidden at init (`assert!(seed_id != 0)` in [market_two.rs:287](programs/exponent_core/src/state/market_two.rs#L287)); use `1..=255`. Multiple markets per vault are supported via distinct `seed_id` (e.g. to run different curve parameters).

---

## 4. Pricing & oracle model

### PT pricing
- **During life:** PT price in SY is set by the AMM's implied-rate curve. The state stores `last_ln_implied_rate`; trades update it using the Pendle-V2 math in the `exponent_time_curve` library (rate scalar grows as time to expiry shrinks; fee rate decays toward 0).
- **At maturity:** `pt_redemption_rate = sy_for_pt / pt_supply` ([vault.rs:140-142](programs/exponent_core/src/state/vault.rs#L140-L142)). `sy_for_pt` is refreshed on every state touch via `set_sy_for_pt`, which takes `min(pt_supply / sy_exchange_rate, sy_in_escrow)` so backing is always conservative.
- **Emergency mode:** if the SY exchange rate ever dips below the vault's `all_time_high_sy_exchange_rate`, the vault enters emergency mode — staging SY interest is blocked ([vault.rs:119-127](programs/exponent_core/src/state/vault.rs#L119-L127)) until rate recovers.

### YT pricing
- Synthetic. YT value = SY − PT. Bought/sold via flash-swap-style `buy_yt` / `sell_yt` against the market (PT is borrowed/lent from the market's reserves and stripped/merged internally to settle).

### SY exchange rate
- Fetched each operation via CPI to `sy_program.get_sy_state` (discriminator `[7]`) — returns `SyState { exchange_rate, emission_indexes }` (see [sy_common/src/lib.rs:4-8](libraries/sy_common/src/lib.rs#L4-L8)). The vault stores the latest as `last_seen_sy_exchange_rate` and ratchets `all_time_high_sy_exchange_rate`.

### Implications
- No external price oracle is used or required; the chain of trust is `Exponent → whitelisted SY program → underlying yield protocol`.
- There is no on-chain PT TWAP surfaced for third-party lending protocols. Anyone consuming PT as collateral must build their own TWAP over `last_ln_implied_rate`.

---

## 5. Permission model

The `exponent_admin` program stores an `Admin` account with a `Principles` struct (see [exponent_admin/src/lib.rs:293-325](programs/exponent_admin/src/lib.rs#L293-L325)):

```rust
pub struct Principles {
    pub marginfi_standard:    PrincipleDetails,
    pub collect_treasury:     PrincipleDetails,
    pub kamino_lend_standard: PrincipleDetails,
    pub exponent_core:        PrincipleDetails,
    pub change_status_flags:  PrincipleDetails,
    pub jito_restaking:       PrincipleDetails,
}
```

Each principle holds a `Vec<Pubkey>` of administrators. Vault creation and market creation both gate on the `exponent_core` principle:

- Vault: [initialize_vault.rs:204-211](programs/exponent_core/src/instructions/vault/admin/initialize_vault.rs#L204-L211)
- Market: [market_two_init.rs:261-266](programs/exponent_core/src/instructions/market_two/admin/market_two_init.rs#L261-L266)

Other principles gate orthogonal admin surface (e.g. `ChangeStatusFlags` toggles market/vault pause flags; `CollectTreasury` drains treasury balances). Becoming an admin requires the `uber_admin` of `exponent_admin` to call `add_principle_admin`.

**`sy_program` is not verified at vault init** — the instruction has an explicit comment marking it a *"high-trust function"* ([initialize_vault.rs:98-99](programs/exponent_core/src/instructions/vault/admin/initialize_vault.rs#L98-L99)). The only thing preventing a malicious SY program from being plugged in is the admin whitelist itself.

---

## 6. Prerequisites for creating a market

1. **Be whitelisted.** Admin signer must appear in `Admin.principles.exponent_core.administrators`. Added by the uber-admin via `exponent_admin::add_principle_admin` with `principle = ExponentCore`.
2. **Deployed SY program.** It must implement the discriminator-based SY interface that Exponent CPIs into (see [utils/sy_cpi.rs](programs/exponent_core/src/utils/sy_cpi.rs)):

   | Disc | Ix                            | Returns                |
   | ---- | ----------------------------- | ---------------------- |
   | `1`  | `mint_sy(amount_base)`        | `MintSyReturnData`     |
   | `2`  | `redeem_sy(amount_sy)`        | `RedeemSyReturnData`   |
   | `3`  | `init_personal_account()`     | —                      |
   | `5`  | `deposit_sy(amount)`          | `SyState`              |
   | `6`  | `withdraw_sy(amount)`         | `SyState`              |
   | `7`  | `get_sy_state()`              | `SyState`              |
   | `8`  | `claim_emission(amount)`      | —                      |
   | `10` | `get_position_state()`        | `PositionState`        |

3. **Address Lookup Table (ALT).** Populated with *every* account pubkey referenced by the SY program's `get_sy_state`, `deposit_sy`, `withdraw_sy`, `get_position_state`, and each `claim_emission` call. `CpiAccounts.alt_index` is a `u8` into this table. One ALT per vault+market; order matters.
4. **Treasury SPL token accounts** (one per fee/emission stream):
   - SY treasury (for interest fees and trade fees, one each).
   - An emission-specific treasury per reward mint added via `add_emission`.
5. **Admin signer balances** of (a) base asset for seeding SY, and (b) PT plus SY once you want to bootstrap the AMM.

---

## 7. Full setup flow

Instruction numbers below are the Anchor discriminators declared in [lib.rs](programs/exponent_core/src/lib.rs).

### Step 1 — Initialize the vault (ix `#2 initialize_vault`)

Creates the PT & YT mints, escrows, the vault's own yield position in the SY program, and the PT Metaplex metadata.

```rust
initialize_vault(
    start_timestamp:    u32,      // when stripping/merging opens
    duration:           u32,      // seconds until maturity (expiration_ts = start + duration)
    interest_bps_fee:   u16,      // protocol fee on YT interest collection
    cpi_accounts:       CpiAccounts,   // ALT-indexed metas for SY CPIs
    min_op_size_strip:  u64,      // dust guard for strip
    min_op_size_merge:  u64,      // dust guard for merge
    pt_metadata_name:   String,   // e.g. "PT kSOL-27DEC25"
    pt_metadata_symbol: String,   // e.g. "PT-kSOL-DEC25"
    pt_metadata_uri:    String,   // JSON metadata URI
)
```

Accounts ([InitializeVault](programs/exponent_core/src/instructions/vault/admin/initialize_vault.rs#L17-L136)):

| Field                   | Kind                   | Notes                                                      |
| ----------------------- | ---------------------- | ---------------------------------------------------------- |
| `payer`                 | Signer, mut            | Must be in `exponent_core` admin list                      |
| `admin`                 | `Admin` account        | `exponent_admin` global account                            |
| `authority`             | PDA `["authority", vault]` | Vault signer                                           |
| `vault`                 | init, fresh keypair    | Space = static + CpiAccounts.size_of()                     |
| `mint_pt`               | PDA mint, init         | `["mint_pt", vault]`, decimals = mint_sy.decimals          |
| `mint_yt`               | PDA mint, init         | `["mint_yt", vault]`                                       |
| `escrow_yt`             | PDA token account      | `["escrow_yt", vault]`, created in handler                 |
| `escrow_sy`             | ATA of authority       | For `mint_sy`, created in handler (ATA-2022)               |
| `mint_sy`               | Mint                   | The SY mint from the SY program                            |
| `treasury_token_account`| TokenAccount for SY    | Receives interest fees                                     |
| `sy_program`            | UncheckedAccount       | **Not verified** — admin trust                             |
| `address_lookup_table`  | UncheckedAccount       | Stored on vault for later CPIs                             |
| `yield_position`        | PDA, init              | `["yield_position", vault, authority]`                     |
| `metadata`              | Metaplex PDA           | For PT mint                                                |
| `token_metadata_program`| `mpl_token_metadata::ID` |                                                          |
| `token_program`         | Token (legacy)         |                                                            |
| `associated_token_program` | AToken program      |                                                            |
| `system_program`        | System program         |                                                            |

`remaining_accounts`: the exact list required by the SY program's `init_personal_account` (disc `[3]`). These are passed straight through by `cpi_init_sy_personal_account` ([sy_cpi.rs:46-67](programs/exponent_core/src/utils/sy_cpi.rs#L46-L67)).

Default flags after init (all on): `STATUS_CAN_STRIP | STATUS_CAN_MERGE | STATUS_CAN_DEPOSIT_YT | STATUS_CAN_WITHDRAW_YT | STATUS_CAN_COLLECT_INTEREST | STATUS_CAN_COLLECT_EMISSIONS`. `max_py_supply = u64::MAX`, `ClaimLimits.max_claim_amount_per_window = u64::MAX`.

### Step 2 — (Optional) register each SY emission stream (ix `#18 add_emission`)

```rust
add_emission(cpi_accounts: CpiAccounts, treasury_fee_bps: u16)
```

Call **once per reward token the SY program emits** (MNDE, JTO, PYTH, …) before any LP or YT holder needs to claim — the initial index snapshot is taken at call time ([vault.rs:369-384](programs/exponent_core/src/state/vault.rs#L369-L384)). `cpi_accounts.get_sy_state` must be populated so the vault can fetch the index list.

### Step 3 — Seed SY liquidity and strip initial PT

Before market init the admin signer needs balances in both `mint_pt` and `mint_sy`. Typical flow:

1. Mint SY from base asset: CPI `sy_program::mint_sy(amount_base)` — you need the SY program's mint accounts.
2. Call `strip(amount)` (ix `#4`) on the vault — converts SY → (PT + YT). The admin keeps the YT (it is the initial YT holder and will earn the opening interest).

### Step 4 — Initialize the market (ix `#10 init_market_two`)

```rust
init_market_two(
    ln_fee_rate_root:    f64,    // ln(1 + initial_fee_rate_per_year); decays to 0
    rate_scalar_root:    f64,    // AMM convexity. Higher = tighter curve around anchor
    init_rate_anchor:    f64,    // initial implied APY (e.g. 0.06 for 6%)
    sy_exchange_rate:    Number, // current SY exchange rate (snapshot)
    pt_init:             u64,    // PT seed liquidity (from Step 3)
    sy_init:             u64,    // SY seed liquidity
    fee_treasury_sy_bps: u16,    // must be < 10_000
    cpi_accounts:        CpiAccounts,
    seed_id:             u8,     // MUST be non-zero
)
```

Accounts ([MarketTwoInit](programs/exponent_core/src/instructions/market_two/admin/market_two_init.rs#L18-L113)):

| Field                      | Kind                        | Notes                                                     |
| -------------------------- | --------------------------- | --------------------------------------------------------- |
| `payer`                    | Signer, mut                 |                                                           |
| `admin_signer`             | Signer                      | Must be on `exponent_core` principle                      |
| `market`                   | init, PDA                   | `["market", vault, seed_id]`                              |
| `vault`                    | `Vault` (has_one for sy/pt) |                                                           |
| `mint_sy`, `mint_pt`       | Mint                        |                                                           |
| `mint_lp`                  | UncheckedAccount, mut       | PDA `["mint_lp", market]`, Token-2022 created in handler  |
| `escrow_pt`                | UncheckedAccount, mut       | PDA `["escrow_pt", market]`                               |
| `escrow_sy`                | UncheckedAccount, mut       | PDA `["escrow_sy", market]` (pass-through to SY program)  |
| `escrow_lp`                | UncheckedAccount, mut       | PDA `["escrow_lp", market]` (staked LP)                   |
| `pt_src`, `sy_src`         | TokenAccount, mut           | Admin's PT/SY sources                                     |
| `lp_dst`                   | UncheckedAccount, mut       | Admin's LP ATA — created in handler                       |
| `token_treasury_fee_sy`    | TokenAccount                | Receives trade fees (SY)                                  |
| `sy_program`               | UncheckedAccount            | Must match vault's `sy_program` (via `has_one`)           |
| `address_lookup_table`     | UncheckedAccount            |                                                           |
| `admin`                    | `Admin` account             |                                                           |
| `token_program`            | Token (legacy)              | LP mint uses Token-2022 internally                        |
| `associated_token_program` |                             |                                                           |
| `system_program`           |                             |                                                           |

`remaining_accounts`: accounts required by two sequential CPIs — (a) `init_personal_account` for the *market* PDA on the SY program, (b) `deposit_sy` (sy_init) on the SY program. The handler filters `remaining_accounts` down to each CPI's metas via `filter_rem_accounts` ([sy_cpi.rs:18-30](programs/exponent_core/src/utils/sy_cpi.rs#L18-L30)), so you can simply pass the union.

Seeder receives `sqrt(pt_init * sy_init)` LP tokens (handler's `calc_lp_tokens_out`). No lock-up, no donation minimum — but round-trip fees prevent a classic 0-supply exploit.

### Step 5 — (Optional) add an LP farm (ix `#22 add_farm`)

```rust
add_farm(token_rate: u64, until_timestamp: u32)
```

Distributes a native reward mint to staked LPs at `token_rate` units per second until `until_timestamp`. Fund the escrow account created by the instruction with the reward mint. Modify later via `modify_farm` (ix `#23`).

### Step 6 — (Optional) tighten or adjust limits

- `modify_vault_setting` (ix `#26`) — change status flags, claim limits, `max_py_supply`, `interest_bps_fee`, `min_op_size_strip`, `min_op_size_merge`.
- `modify_market_setting` (ix `#27`) — change status flags, `max_lp_supply`, `fee_treasury_sy_bps`, `liquidity_net_balance_limits`.

Defaults are intentionally permissive; most production deployments will tighten at least `liquidity_net_balance_limits` (rate-limit on LP-driven reserve shifts) and `max_lp_supply`.

### Step 7 — Add LP Metaplex metadata (ix `#41 add_lp_tokens_metadata`)

```rust
add_lp_tokens_metadata(name: String, symbol: String, uri: String)
```

Attaches Metaplex metadata to `mint_lp` so wallets display it correctly. Only the PT mint gets metadata automatically in Step 1; the LP mint is a separate call.

---

## 8. Post-launch operations (user-facing, permissionless)

| Action                              | Instruction                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Strip SY → PT + YT                  | `#4 strip` (or `#38 wrapper_strip` to enter with base asset)                                             |
| Merge PT + YT → SY                  | `#5 merge` (or `#39 wrapper_merge`)                                                                      |
| Open YT yield position              | `#3 initialize_yield_position`                                                                           |
| Deposit / withdraw YT to earn       | `#7 deposit_yt` / `#8 withdraw_yt`                                                                       |
| Collect YT interest                 | `#6 collect_interest` (or `#33 wrapper_collect_interest` to exit to base asset)                          |
| Stage YT interest (keeper)          | `#9 stage_yt_yield`                                                                                      |
| Collect SY emissions                | `#19 collect_emission`                                                                                   |
| Add liquidity                       | `#11 market_two_deposit_liquidity` (or `#28 / #36 / #37` wrappers)                                       |
| Remove liquidity                    | `#12 market_two_withdraw_liquidity` (or `#34 / #35` wrappers)                                            |
| Stake LP for farm + emissions       | `#13 init_lp_position` + `#14 market_deposit_lp`                                                         |
| Unstake LP                          | `#15 market_withdraw_lp`                                                                                 |
| Collect market emissions            | `#16 market_collect_emission`                                                                            |
| Claim farm rewards                  | `#24 claim_farm_emissions`                                                                               |
| Trade PT                            | `#17 trade_pt` (or `#29 wrapper_buy_pt` / `#30 wrapper_sell_pt`)                                         |
| Trade YT (flash-swap style)         | `#0 buy_yt` / `#1 sell_yt` (or `#31 wrapper_buy_yt` / `#32 wrapper_sell_yt`)                             |

At maturity (`start_ts + duration`):
- PT redeems 1:1 base via the vault's frozen `final_sy_exchange_rate`.
- YT stops accruing new yield.
- Post-maturity SY appreciation (above `all_time_high_sy_exchange_rate`) is captured to the treasury "lambo fund" ([vault.rs:256-297](programs/exponent_core/src/state/vault.rs#L256-L297)).

---

## 9. Parameter tuning cheat-sheet

| Parameter              | Effect                                                                                 | Starting value heuristic                                   |
| ---------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `init_rate_anchor`     | Initial implied APY the curve is centred on.                                           | Best estimate of underlying SY yield at launch.            |
| `rate_scalar_root`     | Convexity. Higher = tighter curve around anchor (less slippage, fails at the edges).   | Tune from Pendle-V2 defaults; test with expected liquidity.|
| `ln_fee_rate_root`     | `ln(1 + annual_fee_rate)`; decays linearly to 0 at expiry.                             | `ln(1 + 0.001)` ≈ 0.001 for 10 bps/yr at open.             |
| `fee_treasury_sy_bps`  | Share of trading fees routed to `token_treasury_fee_sy`.                               | 2000–5000 (20–50%).                                        |
| `interest_bps_fee`     | Protocol cut on YT interest collection.                                                | 300–1000 (3–10%).                                          |
| `max_py_supply`        | Hard cap on PT (== YT) supply.                                                         | Set proportional to expected SY TVL.                       |
| `max_lp_supply`        | Hard cap on LP supply.                                                                 | Set during bootstrap, raise as TVL grows.                  |
| `liquidity_net_balance_limits` | Per-window % cap on net reserve change (anti-flash-drain).                       | `max_net_balance_change_negative_percentage` ~5000 (50%), short window. |
| `min_op_size_strip/merge` | Dust floor for strip/merge operations.                                               | 1–100 SY smallest units.                                   |

---

## 10. Operational checklist for a new market

- [ ] Admin signer added to `exponent_core` principle.
- [ ] SY program deployed, audited, ABI-verified.
- [ ] ALT populated and frozen (one per vault).
- [ ] `cpi_accounts` structured correctly for `get_sy_state`, `deposit_sy`, `withdraw_sy`, `claim_emission`, `get_position_state`.
- [ ] Treasury SPL accounts created for SY + every expected emission mint.
- [ ] `initialize_vault` called; PT mint metadata visible.
- [ ] `add_emission` called for each SY emission stream.
- [ ] Admin SY balance acquired; `strip` called to produce seed PT.
- [ ] `init_market_two` called with non-zero `seed_id`, curve params chosen.
- [ ] `add_lp_tokens_metadata` called.
- [ ] (Optional) `add_farm` funded and configured.
- [ ] `liquidity_net_balance_limits` set to sane values via `modify_market_setting`.
- [ ] Frontend / integrators notified of the new `vault`, `market`, `mint_pt`, `mint_yt`, `mint_lp`, ALT, and SY program IDs.

---

## 11. Failure modes & gotchas

- **Unverified `sy_program`.** Admin must ensure the pointed-to program cannot be upgraded into a malicious state — prefer programs with frozen upgrade authority or a trusted multisig.
- **`seed_id == 0`.** `init_market_two` panics. Always use `1..=255`.
- **ALT mismatch.** `to_account_metas` panics with unwrap on missing index — every `alt_index` in `CpiAccounts` must exist in the ALT exactly when the CPI runs.
- **Emission added late.** `add_emission` uses *current* index as the initial snapshot; add emissions before users stake or they will not receive rewards accrued prior.
- **Emergency mode.** If `last_seen_sy_exchange_rate` drops below `all_time_high_sy_exchange_rate`, `stage_yt_yield` is blocked until recovery ([vault.rs:125-127](programs/exponent_core/src/state/vault.rs#L125-L127)).
- **Post-maturity math.** `final_sy_exchange_rate` is frozen on the last active call; if nobody touches the vault before maturity, the redemption rate may lag reality until the first post-maturity operation refreshes it.
- **Not permissionless.** Third-party integrators who want "their own" market must onboard through the Exponent team.

---

## 12. References

- Protocol docs: <https://docs.exponent.finance>
- Audits:
  - OtterSec — [exponent_core_admin_ottersec_audit.pdf](https://github.com/exponent-finance/exponent-audits/blob/main/exponent_core_admin_ottersec_audit.pdf)
  - Offside Labs — [Exponent-ExponentCore-Oct-2024-OffsideLabs.pdf](https://github.com/exponent-finance/exponent-audits/blob/main/Exponent-ExponentCore-Oct-2024-OffsideLabs.pdf)
  - Certora — [Exponent_Core_Certora_Audit_June_2025.pdf](https://github.com/exponent-finance/exponent-audits/blob/main/Exponent_Core_Certora_Audit_June_2025.pdf)
- Pendle V2 whitepaper (for the AMM math this mirrors): <https://github.com/pendle-finance/pendle-v2-resources>

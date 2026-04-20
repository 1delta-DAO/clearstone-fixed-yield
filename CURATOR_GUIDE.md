# Curator's Guide — Creating and Running a Market

Step-by-step for anyone standing up a new Clearstone market. Assumes
you've read [ARCHITECTURE.md](ARCHITECTURE.md) and understand the
core/adapter split.

**Scope.** Once created, anyone can use your market (strip/merge/trade).
The only ongoing curator powers are: pause flags, ratchet-down fees,
claim limits, LUT updates. **You cannot** raise fees, change the curve
parameters, or bump `max_py_supply` — those are frozen at init.

---

## Phase 0 — Decide your parameters

These choices are **permanent** unless noted:

| Parameter              | Picks one | What you commit to                             |
|------------------------|-----------|------------------------------------------------|
| SY program             | ✋ permanent | The yield source users will trust             |
| `curator`              | ✋ permanent | Key that can later modify settings            |
| `creator_fee_bps`      | ✋ permanent | Ceiling on `interest_bps_fee` (max 2500)      |
| `duration`             | ✋ permanent | Market lifetime in seconds [1 day, 5 years]   |
| `start_timestamp`      | ✋ permanent | When stripping opens                           |
| `max_py_supply`        | ✋ permanent | Hard cap on PT/YT supply                      |
| `min_op_size_{strip,merge}` | ✋ permanent | Dust floor                                |
| `interest_bps_fee`     | 🔽 ratchet down | Protocol cut on YT interest (≤ creator_fee_bps)|
| `ln_fee_rate_root`     | ✋ permanent | Initial trading-fee log rate                  |
| `rate_scalar_root`     | ✋ permanent | AMM convexity                                 |
| `init_rate_anchor`     | ✋ permanent | Opening implied APY                           |
| `fee_treasury_sy_bps`  | 🔽 ratchet down | Treasury cut on trade fees                 |
| `liquidity_net_balance_limits` | 🔄 curator tunable | Rate-limit on LP-driven reserve shifts  |
| status flags (pause)   | 🔄 curator tunable | Turn strip/merge/trade on/off individually |

**Auditor red flags.** Picking an SY program you can't personally
audit and signing up PT/YT holders to depend on it. The
permissionless-creation model puts this entirely on you —
clearstone_core cannot protect downstream users from a buggy SY
program beyond invariant I-V1..5 (per-vault isolation) and I-C1..3
(reentrancy + return-data validation).

---

## Phase 1 — Pick or deploy an SY program

Clearstone doesn't care *which* SY program you use as long as it
implements the 10-discriminator interface (see
[generic_exchange_rate_sy lib.rs](reference_adapters/generic_exchange_rate_sy/src/lib.rs)
header comment).

Three realistic paths:

1. **Use an existing deployed adapter.** e.g. a Marginfi / Kamino /
   Jito SY. You need its program ID, and your ALT (Phase 4) needs to
   include every account that adapter touches across its CPIs.

2. **Use `generic_exchange_rate_sy`** — the reference adapter in this
   repo. It wraps any SPL mint behind a pokable exchange rate.
   Simplest to reason about; no real yield accrual.

3. **Deploy your own.** Mirror `generic_exchange_rate_sy` and point
   `exchange_rate` at an oracle read (Pyth, Switchboard, etc.). Must
   enforce ATH monotonicity (see
   [poke_exchange_rate](reference_adapters/generic_exchange_rate_sy/src/lib.rs)
   for the pattern).

For the generic adapter the command is:

```typescript
import { createSyMarket } from "./tests/fixtures";

const sy = await createSyMarket({
  program: syProgram,
  payer,
  authority: myOracleKey,   // who can pokeExchangeRate later
  baseMint,
  initialExchangeRate: new BN(1_000_000),
});
// → sy.syMarket, sy.syMint, sy.baseVault, sy.poolEscrow
```

---

## Phase 2 — Choose vault parameters + call `initialize_vault`

Instruction: `core.methods.initializeVault(...)` —
[full signature here](INTERFACE.md#init-instructions-permissionless-creator-defines-curator).

**What gets created in this call:**

- Vault account (stores all curator settings, SY-program link, escrow
  pubkeys, curve-free state).
- `mint_pt` (PDA of `["mint_pt", vault]`) with Metaplex metadata.
- `mint_yt` (PDA of `["mint_yt", vault]`).
- `escrow_yt` (vault-owned YT escrow).
- `escrow_sy` (ATA of the vault's authority PDA).
- `yield_position` (vault's own SY position).
- A CPI into the SY program's `init_personal_account` to set up
  the vault's position in the SY program.

**Accounts you need to supply** (see
[test fixture](tests/fixtures.ts) `setupVault`):

| Account                     | Role                                     |
|-----------------------------|------------------------------------------|
| `payer`                     | Funds the rent for new accounts          |
| `authority` (PDA)           | Vault's authority — derived, not your key|
| `vault`                     | Fresh keypair                            |
| `mint_pt` / `mint_yt` (PDA) | Created by the instruction               |
| `escrow_yt`, `escrow_sy`    | PDAs of vault                            |
| `mint_sy`                   | The SY program's mint                    |
| `treasury_token_account`    | Where interest fees land (your key)      |
| `sy_program`                | **Not validated.** Trust boundary.       |
| `address_lookup_table`      | The ALT from Phase 4                     |
| `yield_position` (PDA)      | Vault's position in the SY program       |
| `metadata`                  | PT's Metaplex metadata PDA               |

Plus **`remaining_accounts`** for the SY program's
`init_personal_account` CPI. For `generic_exchange_rate_sy` the 5
positional accounts are:

```
[payer, owner=authority, sy_market, position_pda, system_program]
```

`position_pda` is derived from `["personal_position", sy_market, authority]`
under the adapter's program ID.

---

## Phase 3 — (Optional) Seed emissions

**If** the SY program emits reward tokens (e.g. MNDE, JTO), you need
to register each one so the vault can accrue them for YT holders.

**Current state:** the admin-side `add_emission` ixn was deleted in M4.
Emissions need to be seeded *at init* (via an init-time parameter) or
via a new `modify_vault_setting` variant. Neither is wired yet — see
FOLLOWUPS.md §M4 "Vault-level emissions". **For yield sources with no
extra emissions (common), this phase is a no-op.**

---

## Phase 4 — Build the Address Lookup Table (ALT)

The core doesn't pass SY accounts by name — it looks them up in an
ALT by index. You build the ALT once per vault and store its
address on the vault record.

**The ALT must contain** (for the generic adapter):

```
Index  Account
  0    Vault authority PDA          (acts as "owner" for SY CPIs)
  1    sy_market                    (adapter's market PDA)
  2    sy_mint                      (adapter's SY mint)
  3    vault's escrow_sy            (ATA of authority)
  4    sy_market's pool_escrow      (adapter's SY pool)
  5    vault's position             (adapter's position for vault)
  6    TOKEN_PROGRAM_ID
```

Order matters — it's referenced by `CpiAccounts.alt_index`. See
`setupVault` in fixtures for the exact build step.

ALTs have a **one-slot cooldown** before use. The fixture waits for
`slot > creation_slot + 1` with a short poll loop.

---

## Phase 5 — `CpiAccounts` — tell the core how to call the SY program

The core's CPI dispatcher needs to know which ALT indices to pass for
each SY operation and what flags each gets:

```
deposit_sy → [owner(signer), sy_market, sy_mint(mut), escrow_sy(mut),
              pool_escrow(mut), position(mut), token_program]
withdraw_sy → (same shape as deposit_sy)
get_sy_state → [sy_market]
claim_emission → (empty, this adapter has no emissions)
get_position_state → [sy_market, position]
```

See `buildAdapterCpiAccounts()` in
[tests/fixtures.ts](tests/fixtures.ts) for the exact builder.

**If you swap the SY program**, this struct must match that program's
Accounts constraints. A mismatch surfaces as the SY CPI failing
mid-ix with a cryptic "AccountNotSigner" or "NotEnoughAccountKeys" —
iterate from there.

---

## Phase 6 — Strip seed PT

Before `init_market_two`, you need to hold both PT and SY to seed
the AMM. Path:

1. `adapter.mint_sy(amount_base)` → you get SY.
2. `core.strip(amount_sy)` → you get PT + YT.

The `strip` helper in fixtures automates this with the right account
layout.

---

## Phase 7 — `init_market_two`

Creates the AMM pool. One market per `(vault, seed_id)` where
`seed_id` is a non-zero u8 you pick. Up to 255 markets per vault if
you want to offer different curve params.

**What gets created:**

- Market account (PDA of `["market", vault, seed_id]`).
- `mint_lp` (Token-2022) with your LP token.
- Market escrows: `escrow_pt`, `escrow_sy`.
- Your initial LP balance (you're the seeder; you get
  `sqrt((pt+VP)(sy+VS)) - VIRTUAL_LP_FLOOR` LP tokens).
- A second ALT + CpiAccounts set — this one where `owner` = the
  *market* PDA (not the vault's authority), and positions are keyed
  by market PDA.

See `setupMarket` in [tests/fixtures.ts](tests/fixtures.ts).

---

## Phase 8 — Add LP token metadata (optional)

`core.methods.addLpTokensMetadata(name, symbol, uri)` attaches
Metaplex metadata to `mint_lp` so wallets display it correctly.
Curator-gated; one-shot.

---

## Phase 9 — Tighten limits before announcing

Most production deployments will, before pointing a frontend at the
market:

- `modifyMarketSetting({ changeLiquidityNetBalanceLimits: ... })` —
  rate-limit LP-driven reserve shifts. Defaults are permissive.
- `modifyMarketSetting({ lowerTreasuryTradeSyBpsFee })` — ratchet
  down from the opening fee as liquidity comes in.
- `modifyVaultSetting({ changeClaimLimits })` — cap per-user SY
  claim volume per window.

---

## Ongoing operations

Post-launch your curator key can:

| Action                              | Call                                      |
|-------------------------------------|-------------------------------------------|
| Pause strip / merge / trade         | `modifyVaultSetting({setVaultStatus})` or `modifyMarketSetting({setStatus})` |
| Ratchet-down interest fee           | `modifyVaultSetting({lowerInterestBpsFee})` |
| Ratchet-down treasury trade fee     | `modifyMarketSetting({lowerTreasuryTradeSyBpsFee})` |
| Collect treasury emissions / interest | `collectTreasury{Emission,Interest}(…)` |
| Change treasury destination         | `modifyVaultSetting({changeVaultTreasuryTokenAccount})` |
| Adjust liquidity rate-limit window  | `modifyMarketSetting({changeLiquidityNetBalanceLimits})` |
| Update claim limits                 | `modifyVaultSetting({changeClaimLimits})` |
| Update LUT (rare)                   | `modifyVaultSetting({changeAddressLookupTable})` |

All fail with `ConstraintHasOne` if signed by any key other than the
curator you committed at init.

---

## At maturity

`start_timestamp + duration` is the expiry. After that:

- **PT** redeems at the frozen `final_sy_exchange_rate` (I-V4).
- **YT** stops earning new yield; YT holders should
  `collect_interest` to drain whatever accrued.
- Post-maturity SY appreciation above `all_time_high_sy_exchange_rate`
  is captured to the treasury "lambo fund"
  ([vault.rs](programs/clearstone_core/src/state/vault.rs)), drainable
  via `collect_treasury_interest(TreasuryInterest)`.

The vault remains usable for PT redemption; the AMM does too, though
trades converge toward 1:1 as implied rate decays to zero.

---

## Checklist

Copy this into your market-launch runbook:

- [ ] SY program picked + audited.
- [ ] Vault params decided (durations, fees, sizes).
- [ ] Curator key is a multisig, not an EOA.
- [ ] ALT built with correct account ordering.
- [ ] `CpiAccounts` struct matches adapter's Accounts layout.
- [ ] Treasury SPL account created.
- [ ] Vault initialized; PT mint metadata shows up.
- [ ] Emissions seeded (if applicable — follow-up).
- [ ] Seeder holds PT + SY.
- [ ] Market initialized with chosen curve params.
- [ ] LP mint metadata attached.
- [ ] Rate-limit + claim-limit parameters set.
- [ ] Frontend notified of addresses (vault, market, mint_pt/yt/lp,
      ALT, SY program).

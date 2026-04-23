# KYC Pass-Through Plan — clearstone_core × clearstone-finance governor × Kamino Lend V2

> **Working doc.** Implementation blueprint for adding KYC pass-through to clearstone-fixed-yield by
> composing with the existing `clearstone-finance` governor + `delta-mint` stack, and wiring a
> Kamino-aware SY adapter. Companion to [PLAN.md](PLAN.md).

---

## 1. What this unlocks

Clearstone today accepts any SPL or Token-2022 mint as the "base" a vault wraps into SY. This plan
makes the following flow permissionless end-to-end, without asking Kamino or the underlying RWA
issuer for a carve-out:

```
  KYC'd user ──▶ delta-mint.wrap(tUSDY → dUSDY)        [governor's existing flow]
                 │
                 ▼
  dUSDY (T2022, KYC-gated at mint-layer via delta-mint whitelist)
                 │
                 ├──▶ Kamino Lend V2 reserve (existing, permissionless)
                 │
                 └──▶ clearstone_core Vault + MarketTwo (THIS PLAN)
                         │
                         ├── strip → PT + YT (regular SPL mints, not KYC-gated)
                         ├── trade_pt on AMM
                         └── merge → dUSDY back to a whitelisted wallet
```

The competitive gap vs. upstream Exponent: Exponent would need every Kamino reserve to sit behind
their admin whitelist. Clearstone is permissionless per-market — any curator can spin up a
PT/YT market on top of any delta-mint d-token + Kamino reserve combo. The KYC compliance story
is inherited from delta-mint; clearstone adds no new KYC surface.

---

## 2. What already exists (do NOT rebuild)

Verified from `https://github.com/1delta-DAO/clearstone-finance` (cloned to
`/tmp/clearstone-finance-ref/` during planning).

| Component | Where | Role |
|---|---|---|
| `governor` program | `packages/programs/programs/governor/` (id `BrZYcbPBt9nW4b6xUSodwXRfAfRNZTCzthp1ywMG3KJh`) | Pool lifecycle, admin management, CPI-wrapper around delta-mint, klend reserve config |
| `delta-mint` program | `packages/programs/programs/delta-mint/` | KYC-gated Token-2022 mint with **ConfidentialTransfer** extension. Owns whitelist PDAs. |
| `klend` (Kamino Lend V2) | external, program id `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | Permissionless lending market. Reserve pairs (dUSDY ↔ USDC). |
| KYC token standard | Token-2022 + ConfidentialTransfer extension. **No TransferHook.** | Whitelist enforced at **mint_to** time by delta-mint; any subsequent transfer of an existing balance is not hook-gated. |
| Roles | `ParticipantRole::Holder`, `ParticipantRole::Liquidator` | Holder = can receive newly-minted d-tokens. Liquidator = can receive d-tokens from liquidations. |

**Key correction to earlier thinking.** The original ask mentioned a `sy_transfer_hook` program
and `spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi`. That would be
required only if d-tokens used the TransferHook extension. They **don't** — they use
ConfidentialTransfer. Consequence: **no hook program to write**, and core doesn't need the
extra-account-metas plumbing. Simpler and lower-risk.

**What we do still need from T2022:** `transfer_checked` (with `mint` + `decimals`) is mandatory
for mints carrying CT, because the basic `transfer` is deprecated on extensions and ignores some
extension-specific checks. That's the core's only real code change on the transfer side.

---

## 3. Design

### 3.1 Trust model

```
           ┌────────────────────────────────────────────────┐
           │ clearstone-finance (governor + delta-mint)     │
           │  • Owns d-token mints                          │
           │  • Owns whitelist PDAs                         │
           │  • Root/admin authority = clearstone ops key   │
           └───────────────────────┬────────────────────────┘
                                   │ CPI (add_participant)
                                   ▼
           ┌────────────────────────────────────────────────┐
           │ kamino_sy_adapter (THIS PLAN, new program)     │
           │  • SY interface on top of Kamino Lend V2       │
           │  • At init: CPIs governor to whitelist caller- │
           │    supplied PDAs (escrow_sy, treasury, robot)  │
           │  • On deposit/withdraw: CPIs klend             │
           │  • On get_sy_state: reads klend collateral     │
           │    exchange rate                               │
           └───────────────────────┬────────────────────────┘
                                   │ standard SY interface (unchanged)
                                   ▼
           ┌────────────────────────────────────────────────┐
           │ clearstone_core (MODIFIED)                     │
           │  • transfer_checked everywhere SY moves        │
           │  • Accounts structs carry sy_mint              │
           │  • No governor awareness; no new logic         │
           └────────────────────────────────────────────────┘
```

Clearstone_core stays **governor-agnostic**. All KYC plumbing is in the adapter. This keeps the
audit-scoped core minimal (PLAN.md §5) and lets other KYC backends (non-governor pools) slot in
later by swapping adapters.

### 3.2 Single-path upgrade (Q1 answered: option a)

Every SY transfer site in core switches to `transfer_checked` unconditionally. Works for both
regular SPL mints and T2022 mints. Breaking IDL change — OK per user direction.

Consequence: every Accounts struct that touches SY gains a `sy_mint: InterfaceAccount<'info, Mint>`
field. The token_program slot stays `Program<'info, Token>` when the mint is SPL, or
`Program<'info, Token2022>` when T2022. We already use `anchor_spl::token_2022::transfer`
everywhere; `transfer_checked` dispatches to either program correctly via the `token_interface`
crate.

### 3.3 Whitelisting flow (Q3 answered: adapter does it)

At adapter init:

```
curator tx: kamino_sy_adapter.init_sy_params(
  kyc_mode: GovernorWhitelist {
    governor_program,
    pool_config,               // PDA from governor, ["pool", underlying_mint]
    dm_mint_config,            // delta-mint's MintConfig
    delta_mint_program,
    klend_program,
    klend_lending_market,
    klend_collateral_reserve,
  },
  core_pdas_to_whitelist: [
    escrow_sy,                 // Vault.escrow_sy (derived by caller)
    token_fee_treasury_sy,     // Vault.token_fee_treasury_sy
    market_escrow_sy,          // MarketTwo.token_sy_escrow
    market_treasury_sy,        // MarketTwo.token_fee_treasury_sy
    robot,                     // Vault.yield_position's SY ATA if distinct
  ],
)
```

The adapter enforces that `signer == governor pool.authority OR signer in governor admin_entries`
by inspecting `admin_entry` (matches the governor's `is_authorized` helper). It then CPIs into
governor `add_participant_via_pool` once per PDA in the list with role `Holder`.

This requires the caller to already be a governor admin — that's fine; deploying an institutional
PT/YT market is not permissionless relative to KYC, only relative to Kamino. A retail
permissionless path (no KYC) simply uses `kyc_mode: None` and the adapter skips the whitelist CPIs.

### 3.4 Governor extension (Q2 answered: extend, don't replace)

The existing governor already exposes:
- `add_participant` — non-activated pools (authority hasn't transferred)
- `add_participant_via_pool` — activated pools (authority transferred to pool PDA)

Both accept an arbitrary `wallet: UncheckedAccount`, so a PDA works today — no schema change
needed there. Two extensions we add to make the flow ergonomic:

1. **New role variant** `ParticipantRole::Escrow` (optional, soft-typed).
   - Today `Holder` vs `Liquidator` decide whether `mint_to` is permitted.
   - `Escrow` semantics: can hold, cannot mint. Equivalent to `Liquidator` for now, but
     documents intent. Keeps the role enum future-proof.
   - Changes in `delta-mint`: `mint_to` handler already rejects non-`Holder`. Add `Escrow` to the
     same rejection branch. One-line change.
   - Changes in governor: add variant to `ParticipantRole`, add match arm in
     `add_participant` / `add_participant_via_pool` that calls delta-mint's
     `add_to_whitelist` (same CPI as `Liquidator` today).

2. **Batch whitelist instruction** `add_participants_batch(role, pdas: Vec<Pubkey>)`.
   - Takes N `WhitelistEntry` accounts via `remaining_accounts`.
   - Reduces clearstone adapter init from 5 separate txs to one.
   - Purely ergonomic; v1 can skip this and do 5 sequential `add_participant_via_pool` calls.
   - **Recommendation: defer to v2.** Not on the critical path.

Decision: `ParticipantRole::Escrow` in v1, batch instruction in v2.

### 3.5 Kamino wiring inside the adapter

The adapter implements the SY discriminator interface (`mint_sy`, `redeem_sy`, `deposit_sy`,
`withdraw_sy`, `get_sy_state`, etc. — exactly the shape `generic_exchange_rate_sy` already
implements). Under the hood:

- `mint_sy(amount)` — user deposits `amount` dUSDY into the reserve's supply. CPIs
  `klend::deposit_reserve_liquidity`. Receives `ctokens` (the Kamino collateral token). The
  adapter's "SY" is the ctoken; exchange rate is `klend_reserve.total_liquidity / ctoken_supply`.
- `redeem_sy(amount)` — reverse: `klend::redeem_reserve_collateral`. Returns dUSDY.
- `deposit_sy` / `withdraw_sy` — called by clearstone_core for escrow management. Internal
  ctoken transfers, no klend CPI; these keep escrow accounting synced. (Same shape as
  `generic_exchange_rate_sy`.)
- `get_sy_state` — reads `klend_reserve.collateral_exchange_rate` from the reserve account and
  returns it in the standard `SyState` shape. Validated by clearstone_core's
  `validate_sy_state`.

**Oracle-free from clearstone's POV.** The adapter returns an exchange rate; clearstone doesn't
touch Pyth / Switchboard. Kamino's reserve handles the liquidity price; we only consume the
reserve's internal ctoken rate.

**What SY is on-chain.** The SY mint is a **new T2022 mint created by the adapter at
`init_sy_params` time**, with ConfidentialTransfer extension inherited from dUSDY (or None if
`kyc_mode == None`). The SY mint's authority is a PDA of the adapter. Users never see ctokens
directly; they see SY tokens minted 1:1 with the ctokens the adapter holds in its reserve.

Open question: alternatively, **SY = ctoken itself** and the adapter is a thin wrapper that only
reports `get_sy_state`. Skips a mint. Downsides: ctoken isn't KYC-gated (Kamino doesn't enforce
our whitelist on ctokens), so the KYC gate leaks. **Reject this option.** SY must be a new mint
we control, or the KYC story breaks.

---

## 4. File-level changes

### 4.1 New crate: `reference_adapters/kamino_sy_adapter/`

```
reference_adapters/kamino_sy_adapter/
├── Cargo.toml
├── src/
│   ├── lib.rs                        # program entrypoints
│   ├── instructions/
│   │   ├── mod.rs
│   │   ├── init_sy_params.rs         # create SY mint, CPI governor, store SyMetadata
│   │   ├── mint_sy.rs                # dUSDY → klend deposit → SY mint
│   │   ├── redeem_sy.rs              # burn SY → klend redeem → dUSDY
│   │   ├── deposit_sy.rs             # user → escrow (internal ATA move)
│   │   ├── withdraw_sy.rs            # escrow → user
│   │   ├── get_sy_state.rs           # read klend reserve exchange rate
│   │   ├── init_personal_account.rs  # per-user ctoken position (matches SY iface)
│   │   └── claim_emission.rs         # no-op for MVP (klend doesn't emit via this path)
│   ├── state/
│   │   ├── mod.rs
│   │   ├── sy_metadata.rs            # SyMetadata { underlying_mint, klend_*, kyc_mode, ... }
│   │   └── kyc_mode.rs               # enum KycMode { None, GovernorWhitelist { ... } }
│   └── cpi/
│       ├── mod.rs
│       ├── klend.rs                  # thin CPIs into klend for deposit/redeem/refresh
│       └── governor.rs               # CPIs into governor.add_participant_via_pool
└── README.md                         # adapter-specific docs + test notes
```

**Cargo.toml deps (key ones):**
- `clearstone-finance` governor + delta-mint via git dep with `features = ["cpi", "no-entrypoint"]`.
- `sy_common` (existing, in clearstone-fixed-yield) for `SyState` and discriminator conventions.
- No `anchor-spl-transfer-hook-interface` (not needed).

**Program id:** placeholder; generate vanity before mainnet.

### 4.2 New instruction set details

#### `init_sy_params.rs`

```
Accounts:
  payer: Signer
  curator: Signer                       // must equal governor pool authority or admin
  sy_metadata: init PDA, seeds = ["sy_metadata", underlying_mint]
  sy_mint: init, authority = sy_metadata PDA, decimals = underlying_mint.decimals
  underlying_mint: InterfaceAccount<Mint>   // the delta-mint d-token, e.g. dUSDY
  token_program: Token-2022 program
  system_program
  // KYC-mode accounts (only if kyc_mode == GovernorWhitelist):
  governor_program: UncheckedAccount
  governor_pool_config: UncheckedAccount
  governor_admin_entry: Option<UncheckedAccount>
  dm_mint_config: UncheckedAccount
  delta_mint_program: UncheckedAccount
  // Kamino accounts:
  klend_program: UncheckedAccount
  klend_lending_market: UncheckedAccount
  klend_reserve: UncheckedAccount
  // Remaining accounts = list of [wallet, whitelist_entry] pairs for each PDA to whitelist.

Args:
  kyc_mode: KycMode
  core_pdas_to_whitelist: Vec<Pubkey>   // max 8; bounded

Handler:
  1. Validate: if kyc_mode == GovernorWhitelist, all governor accounts present.
  2. Create sy_mint (T2022 w/ CT extension if kyc'd, plain otherwise).
  3. Write SyMetadata: { underlying_mint, sy_mint, kyc_mode, klend_*, bump }.
  4. For each PDA in core_pdas_to_whitelist:
       CPI governor::add_participant_via_pool(role=Holder)
     with the paired whitelist_entry from remaining_accounts.
  5. Emit InitSyParamsEvent.
```

#### `mint_sy.rs`

```
Accounts: payer, user_sy_dst, user_underlying_src, sy_mint, sy_metadata,
          klend_reserve, klend_lending_market, klend_reserve_liquidity_supply,
          klend_reserve_collateral_mint, klend_reserve_collateral_supply,
          klend_program, token_program, token_program_2022
Args: amount_underlying
Handler:
  1. Transfer amount_underlying from user_underlying_src → reserve liquidity supply (klend does this via its own CPI).
  2. CPI klend::deposit_reserve_liquidity(amount_underlying) — returns amount_ctoken.
  3. Hold the ctoken in an adapter-owned ATA (sy_metadata PDA).
  4. Mint amount_ctoken of SY to user_sy_dst. (1:1 SY↔ctoken makes get_sy_state easy.)
```

#### `get_sy_state.rs`

```
Accounts: sy_metadata, klend_reserve (readonly)
Returns: SyState { exchange_rate, emissions_indexes: vec![] }
Handler:
  let reserve = klend_reserve::deserialize(...);
  let exchange_rate = reserve.collateral_exchange_rate();  // from klend SDK
  SyState { exchange_rate, emissions_indexes: vec![] }
```

Rest follow the same shape as `generic_exchange_rate_sy`.

### 4.3 Modifications to clearstone_core

Every site that moves SY tokens must switch `token_2022::transfer` →
`anchor_spl::token_interface::transfer_checked`. Sites:

| File | Transfer | Need `sy_mint` in Accounts? |
|---|---|---|
| `instructions/vault/strip.rs` | sy_src → escrow_sy | **Add** |
| `instructions/vault/merge.rs` | escrow_sy → sy_dst | **Add** (via `vault.underlying_mint`, store on Vault) |
| `instructions/vault/collect_interest.rs` | escrow_sy → treasury_sy | Add |
| `instructions/vault/admin/treasury/*.rs` | treasury → destination | Add |
| `instructions/market_two/trade_pt.rs` | trader↔escrow, escrow↔treasury (×2) | Add |
| `instructions/market_two/buy_yt.rs` | trader → escrow | Add |
| `instructions/market_two/sell_yt.rs` | escrow → trader | Add |
| `instructions/market_two/deposit_liquidity.rs` | trader → escrow | Add |
| `instructions/market_two/withdraw_liquidity.rs` | escrow → trader | Add |
| `instructions/market_two/admin/market_two_init.rs` | seeds escrow_sy from payer | Add |

Current `token_transfer` helper in `instructions/util.rs`:

```rust
pub fn token_transfer<'i>(
    ctx: CpiContext<'_, '_, '_, 'i, Transfer<'i>>,
    amount: u64,
) -> Result<()> {
    #[allow(deprecated)]
    token_2022::transfer(ctx, amount)
}
```

Replace with:

```rust
use anchor_spl::token_interface::{self, TransferChecked};

pub fn sy_transfer_checked<'i>(
    ctx: CpiContext<'_, '_, '_, 'i, TransferChecked<'i>>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    token_interface::transfer_checked(ctx, amount, decimals)
}
```

Each caller pulls `decimals` from the `sy_mint: InterfaceAccount<Mint>` on the Accounts struct.

**Vault struct addition.** Store `sy_mint: Pubkey` on the Vault so `merge.rs` and other paths
that already have the vault can validate via `has_one = sy_mint` without trusting the caller.
Set at `initialize_vault` from the adapter's `SyMetadata.sy_mint`. (Today Vault only stores
`cpi_accounts`, which is the adapter's set — sufficient structurally but not ergonomic.)

**MarketTwo struct addition.** Same: add `sy_mint: Pubkey` to MarketTwo. Already implicitly
fixed by the vault's sy_mint; explicitly storing it avoids cross-account joins in the hot path.

### 4.4 Modifications to `clearstone-finance/.../governor/src/lib.rs`

Touch in the external repo (separate PR / coordination needed):

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ParticipantRole {
    Holder,
    Liquidator,
    Escrow,            // NEW — can hold, cannot be minted-to, treated as Holder for whitelist
}
```

Handler changes in `add_participant` / `add_participant_via_pool`:

```rust
match role {
    ParticipantRole::Holder | ParticipantRole::Escrow => {
        delta_cpi::add_to_whitelist(CpiContext::new(cpi_program, cpi_accounts))?;
    }
    ParticipantRole::Liquidator => {
        delta_cpi::add_liquidator(CpiContext::new(cpi_program, cpi_accounts))?;
    }
}
```

In `delta-mint`'s `mint_to` handler, add `Escrow` to the rejection list alongside `Liquidator`
(so we don't accidentally mint freshly-created d-tokens directly into a PT/YT escrow).

**Scope boundary.** This plan treats the governor repo as a dependency we coordinate with. The
clearstone-fixed-yield PR is landable against either (a) the published governor crate once
`Escrow` is added, or (b) an interim feature flag that reuses `Holder` semantics under a new
name in the adapter. **Recommendation:** land `Escrow` in governor first (small, contained PR),
then this core PR picks up the updated crate via Cargo.lock bump.

### 4.5 Test fixtures

`tests/fixtures.ts` additions:
- `spinUpGovernorEnv()` — deploys delta-mint + governor into the local validator, creates a
  pool + dUSDY mint, adds the test payer as root authority.
- `createKaminoMock()` — deploys a minimal `mock_klend` program implementing
  `deposit_reserve_liquidity`, `redeem_reserve_collateral`, and exposing a
  `collateral_exchange_rate` field on the reserve account. ~200 LOC. Lives in
  `reference_adapters/mock_klend/` and is test-only (never deployed).
- `spinUpKaminoSyAdapter(governor_env, mock_klend)` — glues the two together and returns the
  SyMetadata PDA.

New test files:
- `tests/clearstone-kyc-pass-through.ts` covering:
  1. **Happy path.** Create KYC'd vault + market. Whitelist escrows. Strip → trade → merge works.
  2. **Non-whitelisted escrow is rejected by delta-mint.** Try to mint SY directly to a core
     escrow that was *not* added to the whitelist → CPI fails with delta-mint's
     `NotWhitelisted` error. (This verifies the gate is live.)
  3. **Unwhitelisted trader cannot receive PT/YT's SY payout.** `merge` attempts
     transfer_checked from escrow → non-whitelisted `sy_dst`. Since the d-token mint has CT but
     no TransferHook, the transfer itself actually *succeeds* (KYC gate is at mint-time only).
     **This is the semantic limitation of the ConfidentialTransfer-only model.** The test
     documents it and asserts the on-chain behavior matches. UI-layer responsibility to block
     unwhitelisted destinations; protocol doesn't enforce.
  4. **SPL (non-KYC) path still works.** Same vault/market against
     `generic_exchange_rate_sy` — regression check that `transfer_checked` didn't break the
     SPL code path.
  5. **Reentrancy guard still active with T2022 mint.** Existing reentrancy harness rerun
     against the KYC'd vault.

### 4.6 Follow-ups (out of scope for this plan)

- `periphery/clearstone_router/` — base ↔ SY UX wrapper. Needs identical `transfer_checked`
  switch. Small additive PR after core lands.
- `periphery/clearstone_rewards/` — LP staking. If LP rewards are paid in the KYC'd d-token,
  rewards ATAs need whitelisting too. Defer.
- `periphery/clearstone_curator/` — MetaMorpho-style router across markets. Same deal. Defer.
- Batch whitelist instruction on governor (§3.4 v2).
- Transfer-hook variant. If a stricter per-transfer KYC gate becomes necessary later, add a
  `sy_transfer_hook` program + extras plumbing on top of what we build here. Don't build it
  speculatively.

---

## 5. Milestones (8 working days end-to-end)

Each milestone ends with a green test suite on its own branch.

### M-KYC-0 — Governor extension (DONE)
- Merged upstream on `1delta-DAO/clearstone-finance@a414ff6` (ParticipantRole::Escrow
  landed in governor; `add_escrow_with_co_authority` / `add_escrow_to_whitelist`
  landed in delta-mint).
- Published program ids:
  - `delta_mint`: `BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy`
  - `governor`:   `6xqW3D1ebp5WjbYh4vwar7ponxrpEaQiVG6uhBYVZtJi`
- Pinned into this repo via `reference_adapters/kamino_sy_adapter/Cargo.toml`
  (`rev = "a414ff6c1477d2338cd9e945aa06f8c93ca8a590"`). Swap to a proper tag
  when clearstone-finance cuts one.

### M-KYC-1 — Kamino mock + adapter skeleton (1 day)
- `reference_adapters/mock_klend/`: minimal klend program emulating the accounts and ixs we CPI
  into. ~200 LOC. Test-only.
- `reference_adapters/kamino_sy_adapter/`: crate skeleton, `SyMetadata`, `KycMode`, empty
  instruction handlers. Compiles.

### M-KYC-2 — Adapter SY interface (1.5 days)
- Implement `init_sy_params`, `mint_sy`, `redeem_sy`, `deposit_sy`, `withdraw_sy`,
  `get_sy_state`. CPIs into `mock_klend`.
- Unit tests: adapter in isolation produces valid `SyState`, mint/redeem math is 1:1.

### M-KYC-3 — Adapter × governor wiring (DONE)
- `init_sy_params` CPIs into governor `add_participant_via_pool(role: Escrow)`
  once per PDA in `core_pdas_to_whitelist`. Implementation:
  [whitelist_pdas_via_governor](reference_adapters/kamino_sy_adapter/src/lib.rs).
- `WhitelistRequestedEvent` stand-in struct removed from the adapter. The
  delta-mint `WhitelistEvent` already emits for each created entry.
- Full-integration test parked as `it.skip` pending a local-validator setup
  that deploys governor + delta-mint (see
  [tests/clearstone-kyc-pass-through.ts](tests/clearstone-kyc-pass-through.ts)).
  Error-path tests (mismatched governor accounts, `WhitelistNotInKycMode`)
  still run against fake governor pubkeys and pass without external deploy.

### M-KYC-4 — Core `transfer_checked` migration (1.5 days)
- Replace `token_transfer` helper. Add `sy_mint` to every Accounts struct listed in §4.3.
- Add `sy_mint: Pubkey` to `Vault` and `MarketTwo`. `has_one = sy_mint` constraints.
- Rebuild IDL. Update TS types.
- Existing tests (SPL path) pass.

### M-KYC-5 — Integration tests (1.5 days)
- `tests/clearstone-kyc-pass-through.ts` covering §4.5.1–§4.5.5.
- `tests/fixtures.ts` helpers (`spinUpGovernorEnv`, `spinUpKaminoSyAdapter`).
- Reentrancy harness rerun on KYC'd vault.

### M-KYC-6 — Documentation + audit prep (1 day)
- Update [ARCHITECTURE.md](ARCHITECTURE.md) with the KYC diagram from §1.
- Add "KYC pass-through" section to [INTERFACE.md](INTERFACE.md) listing which ixs now carry
  `sy_mint` in their accounts.
- Update [AUDIT_SCOPE.md](AUDIT_SCOPE.md) to include the adapter (scope-boundary note: adapter
  is permissionless-selectable by curators, so its audit status matters).
- Add [INVARIANTS.md](INVARIANTS.md) entries:
  - **I-KYC1.** `transfer_checked` is used exclusively for SY movements. No plain `transfer`.
  - **I-KYC2.** No clearstone_core instruction creates a whitelist entry; only the adapter does.
  - **I-KYC3.** clearstone_core makes no assumption about the SY mint's owner program beyond
    "implements Token-2022 interface."

**Total estimate: 8 working days** (was 2 in the original ask — that estimate assumed the
transfer-hook path, which we're not taking; on the flip side we're adding real Kamino wiring +
mock + governor extension that weren't originally scoped).

---

## 6. Invariants added / preserved

Additions:
- **I-KYC1** (§5.M-KYC-6).
- **I-KYC2** (§5.M-KYC-6).
- **I-KYC3** (§5.M-KYC-6).

Preserved (no regression):
- **I-C1** reentrancy — unchanged; `transfer_checked` is synchronous and doesn't reenter.
- **I-M1** reserve accounting — unchanged; `transfer_checked` moves the same `amount`.
- **I-V1..V5** vault invariants — unchanged; SY amount semantics unchanged.

Deliberately NOT added:
- "KYC enforced on every SY transfer." The ConfidentialTransfer-only model doesn't support this
  claim; only mint-time is gated. Documentation must say so (§4.5.3). Upgrading to a
  TransferHook d-token is a future option (§4.6) that would let us add this invariant.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Governor repo changes drift before we land this | Coordinate via M-KYC-0 PR; freeze a semver tag. |
| Kamino devnet reserve state not reproducible in local tests | Mock klend (§4.5). Accept that "real Kamino" integration is a devnet-only check. |
| ConfidentialTransfer escrow accounting surprises | Keep escrow accounts non-CT. Test: escrow balance read from `spl_token_2022::state::Account::amount` matches `MarketFinancials.sy_balance` after every op (existing I-M1 property test). |
| Permissionless markets minting SY against a non-whitelisted d-token mint configuration | Adapter validates `underlying_mint.owner == delta_mint_program_id` when `kyc_mode == GovernorWhitelist`. |
| Audit surface creep | Adapter is permissionless-selectable, so a malicious adapter is a curator-selected risk, same as any other SY program. Document in AUDIT_SCOPE.md. |
| TS IDL break for existing integrators | Changelog entry. Bump major version. |

---

## 8. Decisions locked in

From Q&A with user 2026-04-22:
- **(Q1)** Option (a), single-path `transfer_checked` migration. Breaking IDL accepted.
- **(Q2)** Extend existing governor (clearstone-finance repo). No new governor program.
- **(Q3)** Adapter does the whitelisting CPI, not core. Core stays governor-agnostic.
- **(Q4)** Real Kamino wiring is in scope. (Implemented against a mock klend for tests;
  real klend works on devnet.)
- **(Q5)** All tests except live-Kamino-devnet. Mock klend used.

Still open:
- SY mint CT extension inherited from underlying? **Recommended: yes if underlying has CT,
  else plain.** Simple match on `underlying_mint.try_borrow_data()?` extension list.
- Per-user `personal_account` in the adapter — is it a separate PDA per user, or per
  (user, market) pair? Existing `generic_exchange_rate_sy` has one per user; adopt same.
- Naming: `kamino_sy_adapter` vs `delta_kamino_sy_adapter`. Former if we expect the adapter
  to work against vanilla (non-KYC'd) Kamino reserves via `kyc_mode: None`. **Recommended:
  former** — the kyc_mode enum makes the adapter dual-use.

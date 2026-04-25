# Deploy IDs

Canonical program IDs + (future) verify hashes for the Clearstone Fixed
Yield stack. These are the pubkeys devnet and mainnet deployments use —
they match `declare_id!()` in the Rust source and `[programs.localnet]`
in `Anchor.toml`.

**ID strategy (decided 2026-04-24):** keep the current
`target/deploy/*-keypair.json` files. They are gitignored (private keys
stay local), but the **pubkeys below are the on-chain IDs for every
cluster**. If we ever rotate a program ID, update here + the four
places that reference it: `declare_id!(..)` in the crate's `lib.rs`,
`[programs.localnet]` / `[programs.devnet]` in `Anchor.toml`, and any
TypeScript fixtures that hard-code it.

## Programs

| Crate | Program ID | Status (devnet) | Upgrade authority (devnet) |
|-------|-----------|-----------------|----------------------------|
| `clearstone_core`             | `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW` | **deployed 2026-04-25 (rotated), IDL on-chain** | `Hro4y3Xd3g82YzLoKDV3uyJoQCVSqLE8nYDRdutLXhdU` (cold) |
| `generic_exchange_rate_sy`    | `HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3` | **deployed 2026-04-25 (rotated), IDL on-chain** | `Hro4y3Xd3g82YzLoKDV3uyJoQCVSqLE8nYDRdutLXhdU` (cold) |
| `clearstone_rewards`          | `7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g` | **deployed 2026-04-24, IDL on-chain** | `Hro4y3Xd3g82YzLoKDV3uyJoQCVSqLE8nYDRdutLXhdU` (cold) |
| `clearstone_curator`          | `831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm` | **upgraded 2026-04-25 (new core ID), IDL on-chain** | `Hro4y3Xd3g82YzLoKDV3uyJoQCVSqLE8nYDRdutLXhdU` (cold) |
| `clearstone_router`           | `DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW` | **upgraded 2026-04-25 (new core ID), IDL on-chain** | `Hro4y3Xd3g82YzLoKDV3uyJoQCVSqLE8nYDRdutLXhdU` (cold) |
| `malicious_sy_nonsense`       | `jEsn9RSpNmmG8tFTo6TjYM8WxVyP9p6sBVGLbHZxZJs`  | not deployed (test-only) | — |
| `malicious_sy_reentrant`      | `FNh2bhq9exxygNfJTd2ZCmUubB5Tdk51D5od2NLKCsv8` | not deployed (test-only) | — |

**Rotation notes (2026-04-25):**

- `clearstone_core` was previously pinned to
  `EKpLcVc6rky1ah28NMZFoT2oSXkAKWcEsr6nbZziTWbC` and that ID is still
  on-chain under foreign authority
  `AhKNmBmaeq6XrrEyGnSQne3WeU4SoN7hSAGieTiqPaJX` running a pre-fix
  build (the `TradePt::try_accounts` BPF stack overflow we fixed in
  this session is still live there). We rotated to
  `DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW` and rebuilt+upgraded
  `clearstone_curator` and `clearstone_router` to point at the new
  core's CPI ID. The old core's program account remains live but
  unused by our stack.
- `generic_exchange_rate_sy` was also rotated on 2026-04-25 from
  `DZEqpkctMmB1Xq6foy1KnP3VayVFgJfykzi49fpWZ8M6` (foreign
  `AhKNmB…`) to `HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3` under
  our cold authority. The old foreign ID remains live on devnet but is
  no longer referenced by our stack. `clearstone_curator` and
  `clearstone_router` were upgraded again to pick up the new adapter
  CPI ID (cold-key signed, hot-paid).

All 5 shipped programs are now under cold authority
`Hro4y3Xd3g82YzLoKDV3uyJoQCVSqLE8nYDRdutLXhdU`. Hot deployer
`DiDbnkw2tYL8K1M5ndLdSHWaeXr53kcKyDyS7SiuDcFn` retains a small SOL
balance for paying transaction fees on future upgrades; the cold key
signs upgrade authority but never holds value.
| `malicious_sy_nonsense`       | `jEsn9RSpNmmG8tFTo6TjYM8WxVyP9p6sBVGLbHZxZJs`  | — | — |
| `malicious_sy_reentrant`      | `FNh2bhq9exxygNfJTd2ZCmUubB5Tdk51D5od2NLKCsv8` | — | — |

**Test-only (likely not deployed to devnet):** `malicious_sy_nonsense`,
`malicious_sy_reentrant`. These back the runtime-isolation tests in
`clearstone-core.ts`; deploying them to devnet would expose mock code
to integrators, which we don't want. Decision: keep off devnet unless
an integration test needs them.

**Reference adapters and mocks (may or may not go to devnet):**

| Crate | Program ID | Role |
|-------|-----------|------|
| `kamino_sy_adapter`      | `29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd` | SY adapter wrapping a Kamino yield vault |
| `mock_klend`             | `AKeo9L8sGnMABrsUs7gJAk8WLye62hSJ7ikZ6yytCGkv` | Kamino klend stub used by the adapter's tests |
| `mock_flash_callback`    | `9AduMJSRv79G5UBrj3WZCK1KzpzmZ4zAKV4Mud4Z4hvF` | Flash-fill reference used by clearstone-fusion-flash tests |
| `clearstone_solver_callback` | `27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP` | Signed solver fill callback (currently *not* on devnet — clone disabled in Anchor.toml) |

## Verify hashes

**On-chain hashes (devnet, captured 2026-04-25 via
`solana-verify get-program-hash <PID>`):**

| Crate | On-chain sha256 | Local .so sha256 | Pinned commit |
|-------|-----------------|------------------|---------------|
| `clearstone_core`          | `cd3e80daa2f9085603131c87e1f3919733e256f517499928cc645ae3ad0bce42` | `69fee8dbd9ea2cb54a83c1a49ce23967e8ecf8371580cbd7b3e924e4658244b8` | `8175ec3` |
| `generic_exchange_rate_sy` | `725b0b886873d1a7c2e329717b0848599119c40ba6695886925ed4d5540e7799` | `5c3911bd51b284f921a56978ba679edbdfd184d62ff469db6b1902064ac1ab38` | `8175ec3` |
| `clearstone_rewards`       | `295f42af77adefad5bf9b7a34d3be5b6fca1d10af2c062acdaae0856106f1c81` | `d84cfe281744ac7af0c5afedfe346ab59f5eb57f5baf3973e8afc6c65f54ced2` | `8175ec3` |
| `clearstone_curator`       | `9f4d619a7e016b6691c9156df325545f9c437e4b2176e5f7ffc42edd8ec76662` | `29874e7021f4fb61807be7c57736d3742ffeef21f905d70e126084465c9e2f82` | `8175ec3` |
| `clearstone_router`        | `efea62f6ece1d5cd3f5d8f78adc5d4ca82c7c565ee15ca400575188bd42e38b5` | `73178ca9d65b381d4a674252794876d543b7ad07f74d79706b36c100be0be542` | `8175ec3` |

Local .so sha256 is what `cargo build-sbf` produced on the deploying
machine; the on-chain hash is what `solana-verify get-program-hash`
sees in the program's data account. The two **legitimately differ**
because the on-chain hash is computed over the trimmed program bytes
(`solana program show`'s `Data Length`), excluding header/padding,
and uses a different normalization than raw sha256 of the .so file.

**Reproducible-build hashes are still TODO.** They need
`solana-verify build --library-name <crate>` which spins up a Docker
container with a pinned rust toolchain and produces a hash that
matches the on-chain hash bit-for-bit (so anyone can verify the
on-chain bytes came from this exact commit). Docker isn't installed
on the current deployer machine; once it is, run
`scripts/devnet-verify-hashes.sh` to fill these in alongside the
on-chain hashes — they should match.

## Deployer keys

These are **paths on the local deployer machine**, not committed to
git. Named here so everyone knows where to look.

- `~/.config/solana/clearstone-devnet.json` — the devnet deployer (pays
  for uploads, initial upgrade authority). Funded via
  `scripts/devnet-fund.sh`.
- `~/.config/solana/clearstone-devnet-cold.json` — cold upgrade
  authority. Generated offline; the devnet deployer's only job is to
  transfer each program's upgrade authority to this key after a
  successful deploy. Practices the mainnet flow without the audit
  stakes.

## On-chain IDL accounts (devnet)

Anchor's IDL is mirrored on-chain at a deterministic per-program PDA
so explorers and clients can fetch+decode without needing the repo's
`idl/` folder. The local `idl/*.json` snapshot in this repo is what
downstream consumers should pin against (the IDL account is mutable
via `anchor idl upgrade`).

| Crate | IDL account pubkey |
|-------|--------------------|
| `clearstone_core`           | `95TVVsUf4ZmnGT1qDjWhhAw27CejdMmFshn3b3gYM8VX` |
| `generic_exchange_rate_sy`  | `3CdrDCQo9Nnnr8kPWzbXHqJBzjuK7tWvvhVU7j8SLfN3` |
| `clearstone_rewards`        | `8tGgw2nvMtY6YBgm5GMRYmBMq4c6BvtqLi9zr7CMh946` |
| `clearstone_curator`        | `BwSysi1fDUas4K85AALSehpstUkTFh89N378ZMR8MbGe` |
| `clearstone_router`         | `7CHS9yw49mEULVvG4NMWJEhi1N2vraP8fSJSCtnuanR7` |

## E2E canonical handles

Populated by `scripts/devnet-e2e.ts` on its first green run. These
are the public pubkeys of the SY market, core vault, core market,
curator vault, and farm state that the dry-run sets up. Integrators
can hit them directly once they're listed here.

- SY base mint:                     `HB53jKnvSMPuet6sD6EDFjbJFPTZd4hKVQrQEc7cbUmk`
- SY market (generic adapter):      `BqZyWeRKWQMqsF9ZFceqv6JHzSpUi6DJEiGsPyXmQyKB`
- Core vault:                       `2BoJ5hFjp2vyExUw1TYsgr5ePmU4nL7LPKLwPkCCZXPZ`
- Core market (seed=1):             `6AMmLUY9ZY5ebkgVEWrwnwketvf4jZ2CWCmaybXcs7uk`
- Curator vault:                    `76JEbposPiTCbKj2eUTy33V6VnsT3Sh76PF2BKXA3SU1`
- Farm state:                       `HJ39cLfz3RJiknL8o54rdcrSfsSPBAhxYAGuxQhRHoPW`

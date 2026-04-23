/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearstone_curator.json`.
 */
export type ClearstoneCurator = {
  "address": "831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm",
  "metadata": {
    "name": "clearstoneCurator",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clearstone periphery: MetaMorpho-style vault that routes base deposits across a curator-selected set of core markets."
  },
  "instructions": [
    {
      "name": "closeDelegation",
      "discriminator": [
        41,
        110,
        46,
        165,
        0,
        109,
        193,
        193
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "delegation",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "crankRollDelegated",
      "docs": [
        "Permissionless keeper crank — performs matured → next rebalance",
        "under a user-signed RollDelegation. Keeper signs the outer tx;",
        "vault PDA signs the inner CPIs.",
        "",
        "Invariants enforced (see CURATOR_ROLL_DELEGATION.md §4):",
        "I-D4 allocation hash matches delegation",
        "I-D5 from_market past expiration",
        "I-D6 min_base_out ≥ delegation's slippage floor",
        "I-D7 atomic — single instruction = single failure domain",
        "",
        "NOTE: CPI composition duplicates the three-step pattern from",
        "`reallocate_from_market` (withdraw_liquidity → trade_pt sell →",
        "redeem_sy) and `reallocate_to_market` (mint_sy → trade_pt buy →",
        "deposit_liquidity). Extracting shared `_inner` fns is tracked in",
        "FOLLOWUPS.md under `CURATOR_REALLOCATE_DEDUP`; the refactor is",
        "deferred so this ticket ships without touching the audited",
        "curator-signed path."
      ],
      "discriminator": [
        58,
        80,
        60,
        46,
        104,
        49,
        78,
        112
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "Pays gas. Zero privilege; the handler never reads `keeper.key()`",
            "for authorization."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "delegation",
          "docs": [
            "User-signed delegation authorizing this roll. Constraint binds",
            "it to the vault; handler re-checks hash + expiry + slippage."
          ]
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "baseMint"
        },
        {
          "name": "baseEscrow",
          "docs": [
            "base_escrow: typed because the handler reloads + reads .amount",
            "to compute the min_base_out post-check."
          ],
          "writable": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "adapterBaseVault",
          "writable": true
        },
        {
          "name": "vaultSyAta",
          "docs": [
            "vault_sy_ata: typed because we reload + read .amount between",
            "redeem/mint CPIs."
          ],
          "writable": true
        },
        {
          "name": "fromMarket",
          "docs": [
            "from_market: typed because handler reads `.financials.expiration_ts`",
            "for the maturity gate (I-D5)."
          ],
          "writable": true
        },
        {
          "name": "fromMarketEscrowPt",
          "writable": true
        },
        {
          "name": "fromMarketEscrowSy",
          "writable": true
        },
        {
          "name": "fromTokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "fromMarketAlt"
        },
        {
          "name": "fromMintPt"
        },
        {
          "name": "fromMintLp",
          "writable": true
        },
        {
          "name": "fromVaultPtAta",
          "docs": [
            "from_vault_pt_ata: typed; handler reloads + reads .amount after",
            "`withdraw_liquidity` to size the subsequent trade_pt sell."
          ],
          "writable": true
        },
        {
          "name": "fromVaultLpAta",
          "docs": [
            "from_vault_lp_ata: typed; handler reads .amount to enforce",
            "`DeployedBaseDrift` (vault_lp_ata.amount >= deployed_base)."
          ],
          "writable": true
        },
        {
          "name": "toMarket",
          "writable": true
        },
        {
          "name": "toMarketEscrowPt",
          "writable": true
        },
        {
          "name": "toMarketEscrowSy",
          "writable": true
        },
        {
          "name": "toTokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "toMarketAlt"
        },
        {
          "name": "toMintPt"
        },
        {
          "name": "toMintLp",
          "writable": true
        },
        {
          "name": "toVaultPtAta",
          "docs": [
            "via SPL associated-token-program idempotent init before the crank."
          ],
          "writable": true
        },
        {
          "name": "toVaultLpAta",
          "docs": [
            "requirement as to_vault_pt_ata."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "fromIndex",
          "type": "u16"
        },
        {
          "name": "toIndex",
          "type": "u16"
        },
        {
          "name": "minBaseOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createDelegation",
      "discriminator": [
        177,
        165,
        93,
        55,
        227,
        163,
        61,
        175
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "docs": [
            "The vault this delegation authorizes rolls for. Read-only — the",
            "handler just reads `allocations` for the commitment."
          ]
        },
        {
          "name": "delegation",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "maxSlippageBps",
          "type": "u16"
        },
        {
          "name": "ttlSlots",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "User deposits `amount_base`, receives shares. Pro-rata against",
        "(total_assets + VIRTUAL_ASSETS, total_shares + VIRTUAL_SHARES) to",
        "preserve the Blue-style anti-inflation property on shares too.",
        "",
        "TODO(deploys-a-share-mint): this scaffold stores share balances on",
        "a `UserPosition` PDA. A cleaner future version mints an SPL share",
        "token so positions are composable with other protocols."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "baseMint",
          "writable": true
        },
        {
          "name": "baseSrc",
          "writable": true
        },
        {
          "name": "baseEscrow",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "rent"
        }
      ],
      "args": [
        {
          "name": "amountBase",
          "type": "u64"
        }
      ]
    },
    {
      "name": "harvestFees",
      "docs": [
        "Mint performance-fee shares to the curator's UserPosition.",
        "",
        "`current_total_assets` is the curator's attested mark-to-market",
        "value of (idle_base + Σ deployed allocations). The ix:",
        "1. Updates `vault.total_assets = current_total_assets`.",
        "2. Computes `gain = max(0, current - last_harvest_total_assets)`.",
        "3. Fee in asset terms = `gain * fee_bps / 10_000`.",
        "4. Converts to shares via the Blue-standard formula",
        "`X = S * fee / (A - fee)` — mints X shares to the curator's",
        "UserPosition, bumping `total_shares` by X but not",
        "`total_assets` (other holders' real claim is diluted by",
        "exactly `fee`).",
        "5. Snapshots `last_harvest_total_assets = current_total_assets`.",
        "",
        "Trust: curator vouches for `current_total_assets`. Mark-to-market",
        "reconciliation from on-chain market state is tracked separately",
        "in FOLLOWUPS.md."
      ],
      "discriminator": [
        90,
        149,
        158,
        241,
        163,
        186,
        155,
        202
      ],
      "accounts": [
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "curatorPosition",
          "docs": [
            "Curator's UserPosition, init_if_needed so the first harvest on a",
            "fresh vault doesn't require an out-of-band init. Shares from the",
            "fee land here."
          ],
          "writable": true
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "rent"
        }
      ],
      "args": [
        {
          "name": "currentTotalAssets",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeVault",
      "docs": [
        "Stand up a new CuratorVault over `base_mint`. Anyone can call this;",
        "`curator` is the key that can later modify the market whitelist and",
        "trigger rebalances."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "curator"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "baseEscrow",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "rent"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "markToMarket",
      "docs": [
        "Re-read one allocation's market + the vault's holdings and",
        "recompute `allocations[i].deployed_base` + `total_assets` from",
        "on-chain state. Permissionless — anyone can call this to refresh",
        "the stored mark before `harvest_fees` reads it.",
        "",
        "Base-equivalent formula, per allocation:",
        "vault_pt      * pt_redemption * sy_rate",
        "+ vault_sy      * sy_rate",
        "+ lp_share      * (pool_pt * pt_redemption + pool_sy) * sy_rate",
        "where",
        "pt_redemption = core_vault.pt_redemption_rate()       // SY per PT",
        "sy_rate       = core_vault.last_seen_sy_exchange_rate  // base per SY",
        "lp_share      = vault_lp / market_lp_supply",
        "",
        "Stale inputs: `last_seen_sy_exchange_rate` only refreshes on a",
        "vault-touching ix (strip/merge/stage_yt_yield/collect_interest).",
        "Callers who need a current mark should run `stage_yt_yield` on",
        "the vault before mark_to_market."
      ],
      "discriminator": [
        150,
        137,
        227,
        92,
        96,
        30,
        124,
        221
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "baseEscrow"
        },
        {
          "name": "market"
        },
        {
          "name": "coreVault",
          "docs": [
            "Core vault backing this market — source of the SY exchange rate",
            "and PT redemption rate used in the mark."
          ]
        },
        {
          "name": "marketEscrowPt"
        },
        {
          "name": "marketEscrowSy"
        },
        {
          "name": "mintLp"
        },
        {
          "name": "mintPt"
        },
        {
          "name": "vaultPtAta"
        },
        {
          "name": "syMint",
          "docs": [
            "SY mint for this market — used to derive the vault's SY ATA."
          ]
        },
        {
          "name": "vaultSyAta"
        },
        {
          "name": "vaultLpAta"
        }
      ],
      "args": [
        {
          "name": "allocationIndex",
          "type": "u16"
        }
      ]
    },
    {
      "name": "reallocateFromMarket",
      "docs": [
        "Pull one allocation back out of its market into idle base.",
        "Three inner CPIs symmetric to `reallocate_to_market`:",
        "(1) withdraw_liquidity (LP → PT + SY), (2) trade_pt sell (PT → SY),",
        "(3) adapter.redeem_sy (SY → base_escrow). Vault PDA signs.",
        "",
        "`base_out_expected` is the curator's accounting of how much base",
        "comes back. We use it to decrement `deployed_base` and",
        "`total_assets` — the caller should set it from the actual",
        "post-CPI balance delta on `base_escrow` (curator reads off-chain",
        "and passes the value in). A stricter reconciliation would read",
        "`base_escrow.amount` before and after; we skip that to keep the",
        "CU budget manageable."
      ],
      "discriminator": [
        174,
        224,
        195,
        119,
        241,
        134,
        149,
        235
      ],
      "accounts": [
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "baseMint"
        },
        {
          "name": "baseEscrow",
          "writable": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "adapterBaseVault",
          "writable": true
        },
        {
          "name": "vaultSyAta",
          "writable": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "marketEscrowPt",
          "writable": true
        },
        {
          "name": "marketEscrowSy",
          "writable": true
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "marketAlt"
        },
        {
          "name": "mintPt"
        },
        {
          "name": "mintLp",
          "writable": true
        },
        {
          "name": "vaultPtAta",
          "writable": true
        },
        {
          "name": "vaultLpAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "allocationIndex",
          "type": "u16"
        },
        {
          "name": "lpIn",
          "type": "u64"
        },
        {
          "name": "minPtOut",
          "type": "u64"
        },
        {
          "name": "minSyOut",
          "type": "u64"
        },
        {
          "name": "ptSellAmount",
          "type": "u64"
        },
        {
          "name": "minSyForPt",
          "type": "i64"
        },
        {
          "name": "syRedeemAmount",
          "type": "u64"
        },
        {
          "name": "baseOutExpected",
          "type": "u64"
        }
      ]
    },
    {
      "name": "reallocateToMarket",
      "docs": [
        "Deploy idle base into one allocation's market as LP.",
        "",
        "Three inner CPIs: (1) adapter.mint_sy pulls base from base_escrow",
        "and mints SY to the vault's SY ATA; (2) core.trade_pt spends part",
        "of that SY on PT (landing in vault's PT ATA); (3) core.deposit_liquidity",
        "pairs (PT + SY) into LP. The vault PDA is the signer for all three",
        "via its cached bump; the curator authorizes the outer ix.",
        "",
        "`deployed_base` tracks the base the vault committed — not",
        "mark-to-market. Use `harvest_fees` (with a curator-attested total)",
        "to fold appreciation back into `total_assets`. See FOLLOWUPS.md for",
        "the full mark-to-market reconciliation story."
      ],
      "discriminator": [
        130,
        80,
        205,
        204,
        74,
        164,
        33,
        99
      ],
      "accounts": [
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "baseMint"
        },
        {
          "name": "baseEscrow",
          "docs": [
            "Vault's base escrow — mint_sy pulls base from here."
          ],
          "writable": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "adapterBaseVault",
          "docs": [
            "Adapter's base pool for the SY market."
          ],
          "writable": true
        },
        {
          "name": "vaultSyAta",
          "docs": [
            "Vault-PDA-owned SY ATA."
          ],
          "writable": true
        },
        {
          "name": "market",
          "docs": [
            "allocation entry by pubkey in the handler."
          ],
          "writable": true
        },
        {
          "name": "marketEscrowPt",
          "writable": true
        },
        {
          "name": "marketEscrowSy",
          "writable": true
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "marketAlt"
        },
        {
          "name": "mintPt"
        },
        {
          "name": "mintLp",
          "writable": true
        },
        {
          "name": "vaultPtAta",
          "docs": [
            "Vault-PDA-owned PT ATA."
          ],
          "writable": true
        },
        {
          "name": "vaultLpAta",
          "docs": [
            "Vault-PDA-owned LP ATA."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "allocationIndex",
          "type": "u16"
        },
        {
          "name": "baseIn",
          "type": "u64"
        },
        {
          "name": "ptBuyAmount",
          "type": "u64"
        },
        {
          "name": "maxSyIn",
          "type": "i64"
        },
        {
          "name": "ptIntent",
          "type": "u64"
        },
        {
          "name": "syIntent",
          "type": "u64"
        },
        {
          "name": "minLpOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setAllocations",
      "docs": [
        "Curator updates the target allocation weights. Does NOT move funds",
        "immediately — a separate `rebalance` (also TODO) actually moves",
        "base between the core markets' vaults."
      ],
      "discriminator": [
        66,
        88,
        197,
        213,
        234,
        204,
        219,
        244
      ],
      "accounts": [
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "allocations",
          "type": {
            "vec": {
              "defined": {
                "name": "allocation"
              }
            }
          }
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "User burns `shares` and receives pro-rata base from escrow.",
        "",
        "Fast path only — pays out exclusively from `base_escrow`. If the",
        "escrow is short because most base is deployed into core markets",
        "(via `rebalance` — TODO), this will fail and the user must wait",
        "for the curator to rebalance liquidity back in, or a future",
        "`withdraw_with_pull` path has to land."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "baseMint",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "baseEscrow",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "curatorVault",
      "discriminator": [
        105,
        211,
        15,
        118,
        12,
        32,
        121,
        71
      ]
    },
    {
      "name": "marketTwo",
      "discriminator": [
        212,
        4,
        132,
        126,
        169,
        121,
        121,
        20
      ]
    },
    {
      "name": "rollDelegation",
      "discriminator": [
        138,
        158,
        170,
        187,
        76,
        104,
        230,
        238
      ]
    },
    {
      "name": "userPosition",
      "discriminator": [
        251,
        248,
        209,
        245,
        83,
        234,
        17,
        27
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "allocationsSet",
      "discriminator": [
        166,
        149,
        35,
        205,
        236,
        62,
        151,
        230
      ]
    },
    {
      "name": "delegatedRollCompleted",
      "discriminator": [
        132,
        205,
        244,
        26,
        104,
        40,
        237,
        162
      ]
    },
    {
      "name": "delegationClosed",
      "discriminator": [
        225,
        66,
        187,
        107,
        192,
        71,
        85,
        138
      ]
    },
    {
      "name": "delegationCreated",
      "discriminator": [
        20,
        93,
        12,
        34,
        227,
        63,
        100,
        136
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "feesHarvested",
      "discriminator": [
        30,
        236,
        182,
        190,
        77,
        254,
        76,
        10
      ]
    },
    {
      "name": "markedToMarket",
      "discriminator": [
        160,
        241,
        140,
        180,
        132,
        42,
        189,
        241
      ]
    },
    {
      "name": "reallocatedFromMarket",
      "discriminator": [
        165,
        106,
        81,
        210,
        155,
        61,
        230,
        5
      ]
    },
    {
      "name": "reallocatedToMarket",
      "discriminator": [
        173,
        251,
        254,
        54,
        222,
        96,
        45,
        14
      ]
    },
    {
      "name": "vaultInitialized",
      "discriminator": [
        180,
        43,
        207,
        2,
        18,
        71,
        3,
        75
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6002,
      "name": "feeTooHigh",
      "msg": "Performance fee exceeds 20% cap"
    },
    {
      "code": 6003,
      "name": "weightsExceedFull",
      "msg": "Allocation weights exceed 100%"
    },
    {
      "code": 6004,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6005,
      "name": "notYetImplemented",
      "msg": "Not yet implemented"
    },
    {
      "code": 6006,
      "name": "insufficientShares",
      "msg": "Position has fewer shares than requested"
    },
    {
      "code": 6007,
      "name": "insufficientAssets",
      "msg": "Vault escrow has insufficient base liquid; curator must rebalance"
    },
    {
      "code": 6008,
      "name": "allocationIndexOutOfRange",
      "msg": "Allocation index out of range for this vault"
    },
    {
      "code": 6009,
      "name": "allocationMarketMismatch",
      "msg": "Market passed does not match the allocation entry"
    },
    {
      "code": 6010,
      "name": "allocationCapExceeded",
      "msg": "Allocation cap would be exceeded"
    }
  ],
  "types": [
    {
      "name": "allocation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "docs": [
              "Target market in clearstone_core."
            ],
            "type": "pubkey"
          },
          {
            "name": "weightBps",
            "docs": [
              "Target weight in bps of total_assets. Sum of all weights <= 10_000."
            ],
            "type": "u16"
          },
          {
            "name": "capBase",
            "docs": [
              "Hard cap on how much base this allocation will ever hold (risk limit)."
            ],
            "type": "u64"
          },
          {
            "name": "deployedBase",
            "docs": [
              "Tracking: how much of total_assets is currently deployed here."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "allocationsSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "curator",
            "type": "pubkey"
          },
          {
            "name": "nAllocations",
            "type": "u16"
          },
          {
            "name": "totalWeightBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "claimLimits",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "claimWindowStartTimestamp",
            "type": "u32"
          },
          {
            "name": "totalClaimAmountInWindow",
            "type": "u64"
          },
          {
            "name": "maxClaimAmountPerWindow",
            "type": "u64"
          },
          {
            "name": "claimWindowDurationSeconds",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "cpiAccounts",
      "docs": [
        "Account lists for validating CPI calls to the SY program"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "getSyState",
            "docs": [
              "Fetch SY state"
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "cpiInterfaceContext"
                }
              }
            }
          },
          {
            "name": "depositSy",
            "docs": [
              "Deposit SY into personal account owned by vault"
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "cpiInterfaceContext"
                }
              }
            }
          },
          {
            "name": "withdrawSy",
            "docs": [
              "Withdraw SY from personal account owned by vault"
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "cpiInterfaceContext"
                }
              }
            }
          },
          {
            "name": "claimEmission",
            "docs": [
              "Settle rewards for vault to accounts owned by the vault"
            ],
            "type": {
              "vec": {
                "vec": {
                  "defined": {
                    "name": "cpiInterfaceContext"
                  }
                }
              }
            }
          },
          {
            "name": "getPositionState",
            "docs": [
              "Get personal yield position"
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "cpiInterfaceContext"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "cpiInterfaceContext",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "altIndex",
            "docs": [
              "Address-lookup-table index"
            ],
            "type": "u8"
          },
          {
            "name": "isSigner",
            "type": "bool"
          },
          {
            "name": "isWritable",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "curatorVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "curator",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "baseEscrow",
            "type": "pubkey"
          },
          {
            "name": "totalAssets",
            "docs": [
              "Accounting totals. `total_assets` tracks base tokens held across",
              "`base_escrow` (idle) + each allocation's `deployed_base` (deployed",
              "into core markets). Updated by deposit/withdraw/reallocate_* and",
              "— when PT/LP valuations change — by `harvest_fees` (curator-",
              "supplied mark-to-market; see FOLLOWUPS.md total_assets",
              "reconciliation caveat)."
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Performance fee (bps), on realized yield. 2000 bps (20%) max."
            ],
            "type": "u16"
          },
          {
            "name": "lastHarvestTotalAssets",
            "docs": [
              "Snapshot of `total_assets` at the last `harvest_fees`. Gain since",
              "this snapshot is what the fee applies to."
            ],
            "type": "u64"
          },
          {
            "name": "allocations",
            "type": {
              "vec": {
                "defined": {
                  "name": "allocation"
                }
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "Bump cache — needed because vault PDA signs every inner CPI in",
              "reallocate_to_market / reallocate_from_market."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "delegatedRollCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "fromMarket",
            "type": "pubkey"
          },
          {
            "name": "toMarket",
            "type": "pubkey"
          },
          {
            "name": "fromIndex",
            "type": "u16"
          },
          {
            "name": "toIndex",
            "type": "u16"
          },
          {
            "name": "baseRolled",
            "type": "u64"
          },
          {
            "name": "minBaseOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "delegationClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "delegationCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "maxSlippageBps",
            "type": "u16"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          },
          {
            "name": "allocationsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountBase",
            "type": "u64"
          },
          {
            "name": "sharesOut",
            "type": "u64"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "emissionInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenAccount",
            "docs": [
              "The token account for the emission where the vault authority is the authority"
            ],
            "type": "pubkey"
          },
          {
            "name": "initialIndex",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "lastSeenIndex",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "finalIndex",
            "docs": [
              "The final index is used to track the last claimable index after the vault expires"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "treasuryTokenAccount",
            "docs": [
              "The treasury token account for this reward"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "The fee taken from emission collecting"
            ],
            "type": "u16"
          },
          {
            "name": "treasuryEmission",
            "docs": [
              "The lambo fund"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "feesHarvested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "curator",
            "type": "pubkey"
          },
          {
            "name": "gain",
            "type": "u64"
          },
          {
            "name": "feeInAssets",
            "type": "u64"
          },
          {
            "name": "sharesMinted",
            "type": "u64"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityNetBalanceLimits",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "windowStartTimestamp",
            "type": "u32"
          },
          {
            "name": "windowStartNetBalance",
            "type": "u64"
          },
          {
            "name": "maxNetBalanceChangeNegativePercentage",
            "docs": [
              "Maximum allowed negative change in basis points (10000 = 100%)"
            ],
            "type": "u16"
          },
          {
            "name": "maxNetBalanceChangePositivePercentage",
            "docs": [
              "Maximum allowed positive change in basis points (10000 = 100%)",
              "Using u32 to allow for very large increases (up to ~429,496%)"
            ],
            "type": "u32"
          },
          {
            "name": "windowDurationSeconds",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "markedToMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "allocationIndex",
            "type": "u16"
          },
          {
            "name": "deployedBase",
            "type": "u64"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketFinancials",
      "docs": [
        "Financial parameters for the market"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "expirationTs",
            "docs": [
              "Expiration timestamp, which is copied from the vault associated with the PT"
            ],
            "type": "u64"
          },
          {
            "name": "ptBalance",
            "docs": [
              "Balance of PT in the market",
              "This amount is tracked separately to prevent bugs from token transfers directly to the market"
            ],
            "type": "u64"
          },
          {
            "name": "syBalance",
            "docs": [
              "Balance of SY in the market",
              "This amount is tracked separately to prevent bugs from token transfers directly to the market"
            ],
            "type": "u64"
          },
          {
            "name": "lnFeeRateRoot",
            "docs": [
              "Initial log of fee rate, which decreases over time"
            ],
            "type": "f64"
          },
          {
            "name": "lastLnImpliedRate",
            "docs": [
              "Last seen log of implied rate (APY) for PT",
              "Used to maintain continuity of the APY between trades over time"
            ],
            "type": "f64"
          },
          {
            "name": "rateScalarRoot",
            "docs": [
              "Initial rate scalar, which increases over time"
            ],
            "type": "f64"
          }
        ]
      }
    },
    {
      "name": "marketTwo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "curator",
            "docs": [
              "Curator authorized to modify this market's mutable settings.",
              "Set at init; replaces the global admin-principle whitelist."
            ],
            "type": "pubkey"
          },
          {
            "name": "creatorFeeBps",
            "docs": [
              "Ceiling committed at init for this market's treasury SY fee.",
              "Bounded by PROTOCOL_FEE_MAX_BPS at creation, immutable after."
            ],
            "type": "u16"
          },
          {
            "name": "reentrancyGuard",
            "docs": [
              "Non-reentrancy latch. Same semantics as Vault.reentrancy_guard."
            ],
            "type": "bool"
          },
          {
            "name": "addressLookupTable",
            "docs": [
              "Address to ALT"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "docs": [
              "Mint of the vault's PT token"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintSy",
            "docs": [
              "Mint of the SY program's SY token"
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Link to yield-stripping vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintLp",
            "docs": [
              "Mint for the market's LP tokens"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "docs": [
              "Token account that holds PT liquidity"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "docs": [
              "Pass-through token account for SY moving from the depositor to the SY program"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenFeeTreasurySy",
            "docs": [
              "Token account that holds SY fees from trade_pt"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeTreasurySyBps",
            "docs": [
              "Fee treasury SY BPS"
            ],
            "type": "u16"
          },
          {
            "name": "selfAddress",
            "docs": [
              "Authority for CPI calls owned by the market struct"
            ],
            "type": "pubkey"
          },
          {
            "name": "signerBump",
            "docs": [
              "Bump for signing the PDA"
            ],
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "statusFlags",
            "type": "u8"
          },
          {
            "name": "syProgram",
            "docs": [
              "Link to the SY program ID"
            ],
            "type": "pubkey"
          },
          {
            "name": "financials",
            "type": {
              "defined": {
                "name": "marketFinancials"
              }
            }
          },
          {
            "name": "maxLpSupply",
            "type": "u64"
          },
          {
            "name": "cpiAccounts",
            "docs": [
              "Record of CPI accounts"
            ],
            "type": {
              "defined": {
                "name": "cpiAccounts"
              }
            }
          },
          {
            "name": "isCurrentFlashSwap",
            "type": "bool"
          },
          {
            "name": "liquidityNetBalanceLimits",
            "type": {
              "defined": {
                "name": "liquidityNetBalanceLimits"
              }
            }
          },
          {
            "name": "seedId",
            "docs": [
              "Unique seed id for the market"
            ],
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "flashPtDebt",
            "docs": [
              "Pending PT owed back to this market by an in-flight `flash_swap_pt`.",
              "Zero at rest. Non-zero means: (a) a flash callback is currently",
              "executing and (b) no other `flash_swap_pt` may enter (blocks nested",
              "flash reentry). See INTENT_FLASH_PLAN.md §5.3 and I-F1 in",
              "INVARIANTS.md.",
              "",
              "Appended at the end of the struct so existing markets' layouts are",
              "not disturbed — the realloc_market ix grows them to include this",
              "field on-demand. Markets without the appended bytes must not call",
              "`flash_swap_pt` (guarded at handler entry)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "number",
      "docs": [
        "High precision number, stored as 4 u64 words in little endian"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "array": [
              "u64",
              4
            ]
          }
        ]
      }
    },
    {
      "name": "reallocatedFromMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "allocationIndex",
            "type": "u16"
          },
          {
            "name": "baseOut",
            "type": "u64"
          },
          {
            "name": "deployedBase",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "reallocatedToMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "allocationIndex",
            "type": "u16"
          },
          {
            "name": "baseIn",
            "type": "u64"
          },
          {
            "name": "deployedBase",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rollDelegation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "docs": [
              "The curator vault this delegation authorizes rolls for."
            ],
            "type": "pubkey"
          },
          {
            "name": "user",
            "docs": [
              "The user wallet that signed the delegation."
            ],
            "type": "pubkey"
          },
          {
            "name": "maxSlippageBps",
            "docs": [
              "Ceiling on per-roll slippage, in bps of notional."
            ],
            "type": "u16"
          },
          {
            "name": "expiresAtSlot",
            "docs": [
              "Expiry slot; once `Clock::slot >= this`, the delegation is dead."
            ],
            "type": "u64"
          },
          {
            "name": "allocationsHash",
            "docs": [
              "Commitment over the curator's allocation whitelist at signing",
              "time. If the curator changes allocations, this hash drifts and",
              "the delegation becomes unusable until the user re-signs."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAtSlot",
            "docs": [
              "Slot at creation — audit / stale-position detection."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "userPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "curator",
            "docs": [
              "Curator authorized to modify this vault's mutable settings.",
              "Set at init; replaces the global admin-principle whitelist."
            ],
            "type": "pubkey"
          },
          {
            "name": "creatorFeeBps",
            "docs": [
              "Ceiling committed at init for this vault's interest fee.",
              "Bounded by PROTOCOL_FEE_MAX_BPS at creation, immutable after.",
              "See I-E1 / I-E2 in PLAN.md §3."
            ],
            "type": "u16"
          },
          {
            "name": "reentrancyGuard",
            "docs": [
              "Non-reentrancy latch. Set to true before any untrusted SY CPI and",
              "cleared on the way out. User-facing entrypoints must assert it is",
              "false on entry. See I-C1 in PLAN.md §3."
            ],
            "type": "bool"
          },
          {
            "name": "syProgram",
            "docs": [
              "Link to SY program"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintSy",
            "docs": [
              "Mint for SY token"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintYt",
            "docs": [
              "Mint for the vault-specific YT token"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "docs": [
              "Mint for the vault-specific PT token"
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowYt",
            "docs": [
              "Escrow account for holding deposited YT"
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowSy",
            "docs": [
              "Escrow account that holds temporary SY tokens",
              "As an interchange between users and the SY program"
            ],
            "type": "pubkey"
          },
          {
            "name": "yieldPosition",
            "docs": [
              "Link to a vault-owned YT position",
              "This account collects yield from all \"unstaked\" YT"
            ],
            "type": "pubkey"
          },
          {
            "name": "addressLookupTable",
            "docs": [
              "Address lookup table key for vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "startTs",
            "docs": [
              "start timestamp"
            ],
            "type": "u32"
          },
          {
            "name": "duration",
            "docs": [
              "seconds duration"
            ],
            "type": "u32"
          },
          {
            "name": "signerSeed",
            "docs": [
              "Seed for CPI signing"
            ],
            "type": "pubkey"
          },
          {
            "name": "authority",
            "docs": [
              "Authority for CPI signing"
            ],
            "type": "pubkey"
          },
          {
            "name": "signerBump",
            "docs": [
              "bump for signer authority PDA"
            ],
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "lastSeenSyExchangeRate",
            "docs": [
              "Last seen SY exchange rate",
              "This continues to be updated even after vault maturity to track SY appreciation for treasury collection"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "allTimeHighSyExchangeRate",
            "docs": [
              "This is the all time high exchange rate for SY"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "finalSyExchangeRate",
            "docs": [
              "This is the exchange rate for SY when the vault expires"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "totalSyInEscrow",
            "docs": [
              "How much SY is held in escrow"
            ],
            "type": "u64"
          },
          {
            "name": "syForPt",
            "docs": [
              "The total SY set aside to back the PT holders",
              "This value is updated on every operation that touches the PT supply or the last seen exchange rate"
            ],
            "type": "u64"
          },
          {
            "name": "ptSupply",
            "docs": [
              "Total supply of PT"
            ],
            "type": "u64"
          },
          {
            "name": "treasurySy",
            "docs": [
              "Amount of SY staged for the treasury"
            ],
            "type": "u64"
          },
          {
            "name": "uncollectedSy",
            "docs": [
              "SY that has been earned by YT, but not yet collected"
            ],
            "type": "u64"
          },
          {
            "name": "treasurySyTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "interestBpsFee",
            "type": "u16"
          },
          {
            "name": "minOpSizeStrip",
            "type": "u64"
          },
          {
            "name": "minOpSizeMerge",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "emissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "emissionInfo"
                }
              }
            }
          },
          {
            "name": "cpiAccounts",
            "type": {
              "defined": {
                "name": "cpiAccounts"
              }
            }
          },
          {
            "name": "claimLimits",
            "type": {
              "defined": {
                "name": "claimLimits"
              }
            }
          },
          {
            "name": "maxPySupply",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "curator",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "sharesIn",
            "type": "u64"
          },
          {
            "name": "assetsOut",
            "type": "u64"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

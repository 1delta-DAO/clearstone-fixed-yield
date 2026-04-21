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

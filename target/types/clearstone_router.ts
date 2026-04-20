/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearstone_router.json`.
 */
export type ClearstoneRouter = {
  "address": "DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW",
  "metadata": {
    "name": "clearstoneRouter",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clearstone periphery router: base-asset UX for core. Wraps base↔SY mint/redeem around clearstone_core primitives so users never handle raw SY."
  },
  "instructions": [
    {
      "name": "wrapperBuyPt",
      "docs": [
        "Base → PT via (adapter.mint_sy → core.trade_pt buy).",
        "",
        "Caller specifies the exact PT out they want (`pt_amount`) and",
        "their maximum base spend. The wrapper mints enough SY to cover",
        "and trades SY → PT. Leftover SY stays in the user's SY ATA."
      ],
      "discriminator": [
        6,
        127,
        6,
        136,
        226,
        194,
        250,
        168
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "baseSrc",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "ptDst",
          "writable": true
        },
        {
          "name": "marketEscrowSy",
          "writable": true
        },
        {
          "name": "marketEscrowPt",
          "writable": true
        },
        {
          "name": "marketAlt"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
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
          "name": "ptAmount",
          "type": "u64"
        },
        {
          "name": "maxBase",
          "type": "u64"
        },
        {
          "name": "maxSyIn",
          "type": "i64"
        }
      ]
    },
    {
      "name": "wrapperMerge",
      "docs": [
        "PT + YT → base via (core.merge → adapter.redeem_sy)."
      ],
      "discriminator": [
        177,
        36,
        171,
        125,
        89,
        198,
        144,
        219
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "ytSrc",
          "writable": true
        },
        {
          "name": "ptSrc",
          "writable": true
        },
        {
          "name": "mintYt",
          "writable": true
        },
        {
          "name": "mintPt",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "amountPy",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrapperStrip",
      "docs": [
        "Base → PT + YT via (adapter.mint_sy → core.strip)."
      ],
      "discriminator": [
        59,
        87,
        87,
        160,
        141,
        112,
        198,
        132
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "baseSrc",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "ytDst",
          "writable": true
        },
        {
          "name": "ptDst",
          "writable": true
        },
        {
          "name": "mintYt",
          "writable": true
        },
        {
          "name": "mintPt",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "amountBase",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
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
  "errors": [
    {
      "code": 6000,
      "name": "missingReturnData",
      "msg": "Missing return data from inner CPI"
    }
  ],
  "types": [
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
    }
  ]
};

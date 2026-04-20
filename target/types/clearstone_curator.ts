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
      "name": "rebalance",
      "discriminator": [
        108,
        158,
        77,
        9,
        210,
        52,
        88,
        62
      ],
      "accounts": [
        {
          "name": "curator",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        }
      ],
      "args": []
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
              "Accounting totals. These track base tokens held by the curator —",
              "which may be split between `base_escrow` (idle) and the underlying",
              "core markets (deployed). `rebalance` keeps them reconciled."
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
    }
  ]
};

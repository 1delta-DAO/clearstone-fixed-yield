/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearstone_rewards.json`.
 */
export type ClearstoneRewards = {
  "address": "7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g",
  "metadata": {
    "name": "clearstoneRewards",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clearstone periphery: LP staking + farm emissions router. Separate from core — plugs in via SPL transfers."
  },
  "instructions": [
    {
      "name": "addFarm",
      "docs": [
        "Curator adds a new emission bucket: (reward_mint, rate per second,",
        "expiry timestamp). Seed tokens must be transferred separately into",
        "the program-owned emission escrow (see refill_farm)."
      ],
      "discriminator": [
        107,
        69,
        222,
        47,
        134,
        55,
        234,
        78
      ],
      "accounts": [
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "farmState",
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardEscrow",
          "docs": [
            "Reward escrow — ATA owned by farm_state PDA for this reward mint.",
            "Init_if_needed so curators can rewire a previously-existing ATA.",
            "The claim ixn signs transfers out of this with the farm_state seed."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
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
          "name": "tokenRate",
          "type": "u64"
        },
        {
          "name": "expiryTimestamp",
          "type": "u32"
        }
      ]
    },
    {
      "name": "claimFarmEmission",
      "docs": [
        "Move accrued rewards for the given reward mint from the",
        "farm_state-owned ATA to the user's destination account.",
        "",
        "Semantics:",
        "- Runs update_indexes + settle_user so all buckets are current.",
        "- Finds the matching farm entry by mint.",
        "- Pays out `per_farm.claimable` for that farm.",
        "- Zeros the claimable slot.",
        "",
        "Reward escrow authority is `farm_state` (set at add_farm via an",
        "ATA constraint) so the transfer is program-signed with farm_state",
        "seeds. If the escrow is short (i.e., nobody refilled), the",
        "transfer fails; accrual state remains untouched because the",
        "mutation happens before the transfer."
      ],
      "discriminator": [
        95,
        76,
        227,
        108,
        157,
        11,
        183,
        145
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "farmState",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardEscrow",
          "docs": [
            "Must be the ATA of farm_state for reward_mint — the same account",
            "that `add_farm` wrote into the matching `Farm` entry."
          ],
          "writable": true
        },
        {
          "name": "rewardDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "initializeFarmState",
      "docs": [
        "Create a FarmState for a specific market's LP mint. Permissionless —",
        "anyone can spin up a rewards surface for any market. `curator` is",
        "who may later call `add_farm` / `refill_farm`."
      ],
      "discriminator": [
        144,
        6,
        143,
        6,
        125,
        219,
        246,
        114
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
          "name": "market",
          "docs": [
            "so the market<->farm mapping is queryable on-chain."
          ]
        },
        {
          "name": "lpMint"
        },
        {
          "name": "farmState",
          "writable": true
        },
        {
          "name": "lpEscrow",
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
      "args": []
    },
    {
      "name": "stakeLp",
      "docs": [
        "Transfer LP into the program's escrow and bump the staker's balance.",
        "Before the balance changes, update_indexes brings each farm's",
        "`accrued_index` up to now."
      ],
      "discriminator": [
        48,
        168,
        125,
        78,
        82,
        71,
        152,
        117
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "farmState",
          "writable": true
        },
        {
          "name": "lpMint",
          "writable": true
        },
        {
          "name": "lpSrc",
          "writable": true
        },
        {
          "name": "lpEscrow",
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
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unstakeLp",
      "docs": [
        "Reverse of stake_lp. Unstake forces an index update and settle so",
        "the user's claimable buckets are credited before their share drops."
      ],
      "discriminator": [
        114,
        4,
        7,
        206,
        251,
        176,
        233,
        119
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "farmState",
          "writable": true
        },
        {
          "name": "lpMint",
          "writable": true
        },
        {
          "name": "lpDst",
          "writable": true
        },
        {
          "name": "lpEscrow",
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
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "farmState",
      "discriminator": [
        198,
        102,
        216,
        74,
        63,
        66,
        163,
        190
      ]
    },
    {
      "name": "stakePosition",
      "discriminator": [
        78,
        165,
        30,
        111,
        171,
        125,
        11,
        220
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
      "name": "farmAlreadyExists",
      "msg": "Farm already exists for this reward mint"
    },
    {
      "code": 6002,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6003,
      "name": "insufficientStake",
      "msg": "Insufficient stake"
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
      "name": "farmNotFound",
      "msg": "Farm not found for the given reward mint"
    }
  ],
  "types": [
    {
      "name": "farm",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rewardMint",
            "type": "pubkey"
          },
          {
            "name": "rewardEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenRate",
            "type": "u64"
          },
          {
            "name": "expiryTimestamp",
            "type": "u32"
          },
          {
            "name": "accruedIndex",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          }
        ]
      }
    },
    {
      "name": "farmState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "curator",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "lpEscrow",
            "type": "pubkey"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "lastUpdateTs",
            "type": "u32"
          },
          {
            "name": "farms",
            "type": {
              "vec": {
                "defined": {
                  "name": "farm"
                }
              }
            }
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
      "name": "perFarmTracker",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastSeenIndex",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "claimable",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "stakePosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "farmState",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "stakedAmount",
            "type": "u64"
          },
          {
            "name": "perFarm",
            "type": {
              "vec": {
                "defined": {
                  "name": "perFarmTracker"
                }
              }
            }
          }
        ]
      }
    }
  ]
};

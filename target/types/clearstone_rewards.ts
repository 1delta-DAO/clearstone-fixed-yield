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
      "name": "decommissionFarm",
      "docs": [
        "Grow a stake position to fit the current farm count.",
        "",
        "Stake positions are sized at first-stake for whatever `farms.len()`",
        "is at that moment. When the curator adds new farms afterwards the",
        "position is too small to hold the extra per-farm trackers, and",
        "stake_lp / unstake_lp / claim_farm_emission would panic on",
        "serialization. This ix lets the owner re-size first; the handler",
        "body is empty because Anchor's `realloc` attribute does the work",
        "(and tops up rent from `owner`).",
        "Curator-only: remove a fully-expired farm entry.",
        "",
        "Only callable when `now >= expiry_timestamp` — prevents the",
        "curator from yanking a live emission stream out from under",
        "stakers. Any leftover tokens in the reward_escrow ATA are",
        "swept back to `reward_drain` (curator's destination) before",
        "the Farm slot is removed from the vec. Shrinks `FarmState` by",
        "one `Farm` entry — Anchor realloc keeps the account size tight.",
        "",
        "Stakers whose `per_farm` vec is longer than the new farm count",
        "keep their trailing claimable buckets untouched but they're now",
        "orphaned (no Farm to resolve). The existing `realloc_stake_position`",
        "ix doesn't shrink; that's a deliberate choice — don't wipe",
        "user-visible data in a curator-triggered flow."
      ],
      "discriminator": [
        5,
        210,
        119,
        223,
        235,
        192,
        155,
        123
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
            "Farm-state-owned ATA for the reward mint (same as `add_farm`)."
          ],
          "writable": true
        },
        {
          "name": "rewardDrain",
          "docs": [
            "Destination for any remaining reward tokens in the escrow."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
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
      "name": "reallocStakePosition",
      "discriminator": [
        102,
        40,
        210,
        22,
        204,
        59,
        71,
        25
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "farmState"
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "refillFarm",
      "docs": [
        "Curator tops up the reward escrow for an existing farm. Pure SPL",
        "transfer from the curator's token account to the farm_state-owned",
        "ATA; no accrual state is touched.",
        "",
        "We intentionally don't bump `token_rate` here — rate changes are a",
        "separate concern. refill_farm only adds liquidity for claims; if",
        "the curator wants to extend/shorten the stream they'd need a",
        "dedicated `set_farm_rate` ix (not in scope)."
      ],
      "discriminator": [
        195,
        225,
        229,
        188,
        146,
        222,
        201,
        197
      ],
      "accounts": [
        {
          "name": "curator",
          "signer": true
        },
        {
          "name": "farmState"
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardSrc",
          "docs": [
            "Curator's source of reward tokens."
          ],
          "writable": true
        },
        {
          "name": "rewardEscrow",
          "docs": [
            "Farm-state-owned ATA for this reward mint. Must be the one",
            "wired up in `add_farm` (same ATA constraint)."
          ],
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
  "events": [
    {
      "name": "emissionClaimed",
      "discriminator": [
        75,
        85,
        135,
        20,
        99,
        229,
        53,
        24
      ]
    },
    {
      "name": "farmAdded",
      "discriminator": [
        146,
        58,
        215,
        97,
        210,
        124,
        125,
        38
      ]
    },
    {
      "name": "farmDecommissioned",
      "discriminator": [
        235,
        136,
        121,
        118,
        135,
        71,
        209,
        194
      ]
    },
    {
      "name": "farmRefilled",
      "discriminator": [
        95,
        175,
        114,
        32,
        234,
        93,
        13,
        250
      ]
    },
    {
      "name": "farmStateInitialized",
      "discriminator": [
        77,
        191,
        17,
        250,
        127,
        151,
        130,
        190
      ]
    },
    {
      "name": "stakePositionReallocated",
      "discriminator": [
        35,
        115,
        147,
        73,
        186,
        241,
        197,
        191
      ]
    },
    {
      "name": "staked",
      "discriminator": [
        11,
        146,
        45,
        205,
        230,
        58,
        213,
        240
      ]
    },
    {
      "name": "unstaked",
      "discriminator": [
        27,
        179,
        156,
        215,
        47,
        71,
        195,
        7
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
    },
    {
      "code": 6007,
      "name": "stalePosition",
      "msg": "Stake position is too small for current farm count; call realloc_stake_position"
    },
    {
      "code": 6008,
      "name": "farmStillLive",
      "msg": "Farm is still live; wait until expiry_timestamp before decommissioning"
    }
  ],
  "types": [
    {
      "name": "emissionClaimed",
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
            "name": "rewardMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
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
      "name": "farmAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "farmState",
            "type": "pubkey"
          },
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
          }
        ]
      }
    },
    {
      "name": "farmDecommissioned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "farmState",
            "type": "pubkey"
          },
          {
            "name": "rewardMint",
            "type": "pubkey"
          },
          {
            "name": "sweptAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "farmRefilled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "farmState",
            "type": "pubkey"
          },
          {
            "name": "rewardMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
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
      "name": "farmStateInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "farmState",
            "type": "pubkey"
          },
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
    },
    {
      "name": "stakePositionReallocated",
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
            "name": "nFarms",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "staked",
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
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "userStaked",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unstaked",
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
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "userStaked",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

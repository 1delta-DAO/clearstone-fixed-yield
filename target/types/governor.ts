/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/governor.json`.
 */
export type Governor = {
  "address": "6xqW3D1ebp5WjbYh4vwar7ponxrpEaQiVG6uhBYVZtJi",
  "metadata": {
    "name": "governor",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Governor for KYC-gated lending pools — orchestrates delta-mint and Kamino market setup"
  },
  "instructions": [
    {
      "name": "activateWrapping",
      "docs": [
        "Transfer delta-mint authority from deployer → pool PDA.",
        "This enables the wrap/unwrap flow. Call AFTER whitelisting is done.",
        "Only the root authority (current delta-mint authority) can call this."
      ],
      "discriminator": [
        12,
        50,
        128,
        61,
        170,
        11,
        167,
        34
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "poolConfig"
          ]
        },
        {
          "name": "poolConfig"
        },
        {
          "name": "dmMintConfig",
          "writable": true
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
        }
      ],
      "args": []
    },
    {
      "name": "addAdmin",
      "docs": [
        "Add an admin to the pool. Only the root authority can add admins."
      ],
      "discriminator": [
        177,
        236,
        33,
        205,
        124,
        152,
        55,
        186
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "poolConfig"
          ]
        },
        {
          "name": "poolConfig"
        },
        {
          "name": "newAdmin"
        },
        {
          "name": "adminEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "poolConfig"
              },
              {
                "kind": "account",
                "path": "newAdmin"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "addParticipant",
      "docs": [
        "Add a participant (KYC'd holder or liquidator bot).",
        "Can be called by root authority OR any admin.",
        "NOTE: Only works on pools where wrapping is NOT activated (authority not transferred).",
        "For activated pools, use add_participant_via_pool."
      ],
      "discriminator": [
        153,
        137,
        99,
        142,
        169,
        212,
        240,
        50
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig"
        },
        {
          "name": "adminEntry",
          "docs": [
            "Optional admin PDA. Pass if signer is not root authority."
          ],
          "optional": true
        },
        {
          "name": "dmMintConfig",
          "writable": true
        },
        {
          "name": "wallet"
        },
        {
          "name": "whitelistEntry",
          "writable": true
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "role",
          "type": {
            "defined": {
              "name": "participantRole"
            }
          }
        }
      ]
    },
    {
      "name": "addParticipantViaPool",
      "docs": [
        "Add a participant via pool PDA (for pools where wrapping is activated).",
        "The pool PDA signs as the delta-mint authority (since authority was transferred).",
        "Can be called by root authority OR any admin."
      ],
      "discriminator": [
        200,
        11,
        127,
        111,
        117,
        242,
        194,
        36
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool_config.underlying_mint",
                "account": "poolConfig"
              }
            ]
          }
        },
        {
          "name": "adminEntry",
          "docs": [
            "Optional admin PDA."
          ],
          "optional": true
        },
        {
          "name": "dmMintConfig",
          "writable": true
        },
        {
          "name": "wallet"
        },
        {
          "name": "whitelistEntry",
          "writable": true
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "role",
          "type": {
            "defined": {
              "name": "participantRole"
            }
          }
        }
      ]
    },
    {
      "name": "fixCoAuthority",
      "docs": [
        "Fix co_authority on an activated pool's MintConfig.",
        "Sets co_authority = pool PDA so whitelist_via_pool works."
      ],
      "discriminator": [
        207,
        204,
        16,
        243,
        198,
        62,
        99,
        178
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "poolConfig"
          ]
        },
        {
          "name": "poolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool_config.underlying_mint",
                "account": "poolConfig"
              }
            ]
          }
        },
        {
          "name": "dmMintConfig",
          "writable": true
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializePool",
      "docs": [
        "Create a new KYC-gated lending pool."
      ],
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "underlyingMint"
              }
            ]
          }
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "wrappedMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "dmMintConfig",
          "writable": true
        },
        {
          "name": "dmMintAuthority"
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "poolParams"
            }
          }
        }
      ]
    },
    {
      "name": "mintWrapped",
      "docs": [
        "Mint wrapped tokens to a whitelisted holder.",
        "Can be called by root authority OR any admin."
      ],
      "discriminator": [
        130,
        90,
        18,
        116,
        188,
        64,
        204,
        199
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig"
        },
        {
          "name": "adminEntry",
          "docs": [
            "Optional admin PDA. Pass if signer is not root authority."
          ],
          "optional": true
        },
        {
          "name": "dmMintConfig"
        },
        {
          "name": "wrappedMint",
          "writable": true
        },
        {
          "name": "dmMintAuthority"
        },
        {
          "name": "whitelistEntry"
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
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
      "name": "registerLendingMarket",
      "docs": [
        "Register the klend market and reserve addresses.",
        "Transitions Initializing → Active. Only root authority."
      ],
      "discriminator": [
        55,
        69,
        63,
        204,
        224,
        83,
        4,
        64
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "poolConfig"
          ]
        },
        {
          "name": "poolConfig",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "lendingMarket",
          "type": "pubkey"
        },
        {
          "name": "collateralReserve",
          "type": "pubkey"
        },
        {
          "name": "borrowReserve",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "removeAdmin",
      "docs": [
        "Remove an admin. Only root authority."
      ],
      "discriminator": [
        74,
        202,
        71,
        106,
        252,
        31,
        72,
        183
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "poolConfig"
          ]
        },
        {
          "name": "poolConfig"
        },
        {
          "name": "adminEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "poolConfig"
              },
              {
                "kind": "account",
                "path": "admin_entry.wallet",
                "account": "adminEntry"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "selfRegister",
      "docs": [
        "Self-register as a KYC'd holder by proving a valid Civic gateway token.",
        "The user signs and pays for their own whitelist PDA.",
        "Requires a valid, non-expired Civic pass from the pool's gatekeeper network."
      ],
      "discriminator": [
        178,
        242,
        25,
        57,
        254,
        122,
        182,
        226
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The user who wants to self-register. They sign and pay rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
          "docs": [
            "Pool config — used to read gatekeeper_network and as PDA signer for CPI."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool_config.underlying_mint",
                "account": "poolConfig"
              }
            ]
          }
        },
        {
          "name": "gatewayToken"
        },
        {
          "name": "dmMintConfig",
          "writable": true
        },
        {
          "name": "whitelistEntry",
          "writable": true
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setBorrowRateCurve",
      "docs": [
        "Set the borrow rate curve on a klend reserve via CPI.",
        "Authority must be both pool authority (or admin) AND the klend market owner.",
        "The curve is validated for monotonicity and bounds before forwarding to klend."
      ],
      "discriminator": [
        85,
        153,
        152,
        170,
        20,
        70,
        239,
        124
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig"
        },
        {
          "name": "adminEntry",
          "docs": [
            "Optional admin PDA. Pass if signer is not root authority."
          ],
          "optional": true
        },
        {
          "name": "lendingMarket"
        },
        {
          "name": "reserve",
          "writable": true
        },
        {
          "name": "klendGlobalConfig"
        },
        {
          "name": "klendProgram"
        }
      ],
      "args": [
        {
          "name": "reserveType",
          "type": {
            "defined": {
              "name": "reserveType"
            }
          }
        },
        {
          "name": "curve",
          "type": {
            "defined": {
              "name": "borrowRateCurve"
            }
          }
        }
      ]
    },
    {
      "name": "setGatekeeperNetwork",
      "docs": [
        "Set the Civic gatekeeper network for self-registration.",
        "Only root authority. Pass Pubkey::default() to disable self-registration.",
        "Handles migration from pre-v2 PoolConfig accounts (expands if needed)."
      ],
      "discriminator": [
        204,
        176,
        133,
        243,
        72,
        93,
        118,
        91
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gatekeeperNetwork",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setPoolStatus",
      "docs": [
        "Freeze or unfreeze the pool. Only root authority."
      ],
      "discriminator": [
        112,
        87,
        135,
        223,
        83,
        204,
        132,
        53
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "poolConfig"
          ]
        },
        {
          "name": "poolConfig",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "status",
          "type": {
            "defined": {
              "name": "poolStatus"
            }
          }
        }
      ]
    },
    {
      "name": "unwrap",
      "docs": [
        "Unwrap d-tokens back into underlying tokens.",
        "User burns d-tokens and receives underlying tokens from the vault.",
        "Requires the user to be KYC-whitelisted."
      ],
      "discriminator": [
        126,
        175,
        198,
        14,
        212,
        69,
        50,
        44
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool_config.underlying_mint",
                "account": "poolConfig"
              }
            ]
          }
        },
        {
          "name": "underlyingMint",
          "docs": [
            "The underlying token mint."
          ]
        },
        {
          "name": "userUnderlyingAta",
          "docs": [
            "User's underlying token account (destination)."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Pool vault — underlying tokens transferred out."
          ],
          "writable": true
        },
        {
          "name": "wrappedMint",
          "docs": [
            "Wrapped Token-2022 mint (tokens burned from user)."
          ],
          "writable": true
        },
        {
          "name": "userWrappedAta",
          "docs": [
            "User's d-token account (source — burned)."
          ],
          "writable": true
        },
        {
          "name": "underlyingTokenProgram"
        },
        {
          "name": "wrappedTokenProgram"
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
      "name": "wrap",
      "docs": [
        "Wrap underlying tokens into d-tokens (KYC-wrapped).",
        "User deposits underlying tokens (e.g., tUSDY) into the pool vault,",
        "and receives an equal amount of d-tokens (e.g., dtUSDY) in return.",
        "Requires the user to be KYC-whitelisted."
      ],
      "discriminator": [
        178,
        40,
        10,
        189,
        228,
        129,
        186,
        140
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool_config.underlying_mint",
                "account": "poolConfig"
              }
            ]
          }
        },
        {
          "name": "underlyingMint",
          "docs": [
            "The underlying token mint (e.g., tUSDY). Must match pool_config."
          ]
        },
        {
          "name": "userUnderlyingAta",
          "docs": [
            "User's token account for the underlying (source)."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Pool vault — token account for underlying, owned by pool PDA."
          ],
          "writable": true
        },
        {
          "name": "dmMintConfig"
        },
        {
          "name": "wrappedMint",
          "writable": true
        },
        {
          "name": "dmMintAuthority"
        },
        {
          "name": "whitelistEntry"
        },
        {
          "name": "userWrappedAta",
          "writable": true
        },
        {
          "name": "deltaMintProgram",
          "address": "BKprvLqNUDCGrpxddppHHQ3UBhof8J5axyexDyctX1xy"
        },
        {
          "name": "underlyingTokenProgram"
        },
        {
          "name": "wrappedTokenProgram"
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
      "name": "adminEntry",
      "discriminator": [
        253,
        36,
        78,
        119,
        205,
        167,
        16,
        68
      ]
    },
    {
      "name": "poolConfig",
      "discriminator": [
        26,
        108,
        14,
        123,
        116,
        230,
        129,
        43
      ]
    }
  ],
  "events": [
    {
      "name": "borrowRateCurveUpdated",
      "discriminator": [
        11,
        87,
        9,
        76,
        217,
        189,
        97,
        11
      ]
    },
    {
      "name": "poolCreatedEvent",
      "discriminator": [
        25,
        94,
        75,
        47,
        112,
        99,
        53,
        63
      ]
    },
    {
      "name": "selfRegisterEvent",
      "discriminator": [
        124,
        67,
        187,
        216,
        94,
        99,
        37,
        150
      ]
    },
    {
      "name": "unwrapEvent",
      "discriminator": [
        73,
        129,
        203,
        215,
        50,
        111,
        179,
        20
      ]
    },
    {
      "name": "wrapEvent",
      "discriminator": [
        148,
        134,
        198,
        142,
        20,
        51,
        173,
        180
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidPoolStatus",
      "msg": "Pool is not in the expected status for this operation"
    },
    {
      "code": 6001,
      "name": "poolNotActive",
      "msg": "Pool is not active — register lending market first"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Signer is not the pool authority or an approved admin"
    },
    {
      "code": 6003,
      "name": "selfRegisterDisabled",
      "msg": "Self-registration is not enabled for this pool"
    },
    {
      "code": 6004,
      "name": "invalidGatewayToken",
      "msg": "Invalid or expired Civic gateway token"
    },
    {
      "code": 6005,
      "name": "reserveMismatch",
      "msg": "Reserve address does not match pool config"
    },
    {
      "code": 6006,
      "name": "marketMismatch",
      "msg": "Lending market does not match pool config"
    },
    {
      "code": 6007,
      "name": "invalidCurve",
      "msg": "Invalid borrow rate curve: must be sorted, bounded, start at 0% and end at 100%"
    }
  ],
  "types": [
    {
      "name": "adminEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "addedBy",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "borrowRateCurve",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "points",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "curvePoint"
                  }
                },
                11
              ]
            }
          }
        ]
      }
    },
    {
      "name": "borrowRateCurveUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "reserve",
            "type": "pubkey"
          },
          {
            "name": "reserveType",
            "type": {
              "defined": {
                "name": "reserveType"
              }
            }
          }
        ]
      }
    },
    {
      "name": "curvePoint",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "utilizationRateBps",
            "type": "u32"
          },
          {
            "name": "borrowRateBps",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "participantRole",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "holder"
          },
          {
            "name": "liquidator"
          },
          {
            "name": "escrow"
          }
        ]
      }
    },
    {
      "name": "poolConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "underlyingMint",
            "type": "pubkey"
          },
          {
            "name": "underlyingOracle",
            "type": "pubkey"
          },
          {
            "name": "borrowMint",
            "type": "pubkey"
          },
          {
            "name": "borrowOracle",
            "type": "pubkey"
          },
          {
            "name": "wrappedMint",
            "type": "pubkey"
          },
          {
            "name": "dmMintConfig",
            "type": "pubkey"
          },
          {
            "name": "lendingMarket",
            "type": "pubkey"
          },
          {
            "name": "collateralReserve",
            "type": "pubkey"
          },
          {
            "name": "borrowReserve",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "ltvPct",
            "type": "u8"
          },
          {
            "name": "liquidationThresholdPct",
            "type": "u8"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "poolStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "gatekeeperNetwork",
            "docs": [
              "Civic gatekeeper network for self-registration. Pubkey::default() = disabled.",
              "Added in v2 — must be at end for backwards compatibility with existing accounts."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "poolCreatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "underlyingMint",
            "type": "pubkey"
          },
          {
            "name": "wrappedMint",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "poolParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "underlyingOracle",
            "type": "pubkey"
          },
          {
            "name": "borrowMint",
            "type": "pubkey"
          },
          {
            "name": "borrowOracle",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "ltvPct",
            "type": "u8"
          },
          {
            "name": "liquidationThresholdPct",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "poolStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "initializing"
          },
          {
            "name": "active"
          },
          {
            "name": "frozen"
          }
        ]
      }
    },
    {
      "name": "reserveType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "collateral"
          },
          {
            "name": "borrow"
          }
        ]
      }
    },
    {
      "name": "selfRegisterEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "gatekeeperNetwork",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "unwrapEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "underlyingAmount",
            "type": "u64"
          },
          {
            "name": "wrappedAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "wrapEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "underlyingAmount",
            "type": "u64"
          },
          {
            "name": "wrappedAmount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/malicious_sy_nonsense.json`.
 */
export type MaliciousSyNonsense = {
  "address": "jEsn9RSpNmmG8tFTo6TjYM8WxVyP9p6sBVGLbHZxZJs",
  "metadata": {
    "name": "maliciousSyNonsense",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Test-only SY adapter that deliberately returns garbage (zero exchange rate, wrong emissions length) so we can assert the core's validate_sy_state catches it."
  },
  "instructions": [
    {
      "name": "claimEmission",
      "docs": [
        "claim_emission: no-op."
      ],
      "discriminator": [
        8
      ],
      "accounts": [
        {
          "name": "syMarket"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": {
            "defined": {
              "name": "amount"
            }
          }
        }
      ]
    },
    {
      "name": "depositSy",
      "docs": [
        "deposit_sy with the configured garbage return."
      ],
      "discriminator": [
        5
      ],
      "accounts": [
        {
          "name": "syMarket"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "syState"
        }
      }
    },
    {
      "name": "getPosition",
      "docs": [
        "get_position: returns empty state."
      ],
      "discriminator": [
        10
      ],
      "accounts": [
        {
          "name": "syMarket"
        },
        {
          "name": "position"
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "positionState"
        }
      }
    },
    {
      "name": "getSyState",
      "docs": [
        "get_sy_state with the configured garbage return. This is usually",
        "the ix the tests trigger to exercise validate_sy_state."
      ],
      "discriminator": [
        7
      ],
      "accounts": [
        {
          "name": "syMarket"
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "syState"
        }
      }
    },
    {
      "name": "initPersonalAccount",
      "docs": [
        "Minimal init_personal_account so clearstone_core::initialize_vault",
        "can seed a position for its authority PDA."
      ],
      "discriminator": [
        3
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner"
        },
        {
          "name": "syMarket"
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
      "name": "initialize",
      "docs": [
        "Initialize a malicious market keyed by `seed_key` (any pubkey —",
        "allows multiple instances in one test without collisions)."
      ],
      "discriminator": [
        0
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "seedKey"
        },
        {
          "name": "syMarket",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "mode",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setMode",
      "docs": [
        "Change the mode without redeploying."
      ],
      "discriminator": [
        100
      ],
      "accounts": [
        {
          "name": "syMarket",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "mode",
          "type": "u8"
        }
      ]
    },
    {
      "name": "withdrawSy",
      "docs": [
        "withdraw_sy with the configured garbage return."
      ],
      "discriminator": [
        6
      ],
      "accounts": [
        {
          "name": "syMarket"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "syState"
        }
      }
    }
  ],
  "accounts": [
    {
      "name": "personalPosition",
      "discriminator": [
        40,
        172,
        123,
        89,
        170,
        15,
        56,
        141
      ]
    },
    {
      "name": "syMarket",
      "discriminator": [
        180,
        101,
        13,
        82,
        190,
        193,
        213,
        148
      ]
    }
  ],
  "types": [
    {
      "name": "amount",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "all"
          },
          {
            "name": "some",
            "fields": [
              "u64"
            ]
          }
        ]
      }
    },
    {
      "name": "emission",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amountClaimable",
            "type": "u64"
          },
          {
            "name": "lastSeenEmissionIndex",
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
      "name": "personalPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "syMarket",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "positionState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "syBalance",
            "type": "u64"
          },
          {
            "name": "emissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "emission"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "syMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seedKey",
            "type": "pubkey"
          },
          {
            "name": "mode",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "syState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "exchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "emissionIndexes",
            "type": {
              "vec": {
                "defined": {
                  "name": "number"
                }
              }
            }
          }
        ]
      }
    }
  ]
};

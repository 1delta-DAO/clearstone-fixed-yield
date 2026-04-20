/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/malicious_sy_reentrant.json`.
 */
export type MaliciousSyReentrant = {
  "address": "FNh2bhq9exxygNfJTd2ZCmUubB5Tdk51D5od2NLKCsv8",
  "metadata": {
    "name": "maliciousSyReentrant",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Test-only SY adapter that CPIs back into clearstone_core during its own deposit_sy / withdraw_sy. Used by the M6 runtime reentrancy tests to prove the vault's reentrancy_guard blocks recursive entry."
  },
  "instructions": [
    {
      "name": "claimEmission",
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
        "If mode = MODE_REENTER_ON_DEPOSIT, re-invoke clearstone_core.strip",
        "with the accounts the attacker wired through CpiAccounts.deposit_sy.",
        "The second call's `do_deposit_sy` will call `latch(&vault)`, which",
        "errors because the outer call already set the guard byte."
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
        "If mode = MODE_REENTER_ON_WITHDRAW, re-invoke clearstone_core.merge."
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
  "errors": [
    {
      "code": 6000,
      "name": "notEnoughAccounts",
      "msg": "remaining_accounts must contain [target_program, ...target_accounts]"
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

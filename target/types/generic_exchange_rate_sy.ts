/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/generic_exchange_rate_sy.json`.
 */
export type GenericExchangeRateSy = {
  "address": "HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3",
  "metadata": {
    "name": "genericExchangeRateSy",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Reference SY adapter for Clearstone fixed-yield core. Wraps an SPL mint behind a manually-pokable exchange rate."
  },
  "instructions": [
    {
      "name": "claimEmission",
      "docs": [
        "No-op: this reference adapter has no emissions.",
        "The `amount` arg is accepted to match the core's call shape."
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
        "Deposit SY into the adapter's pool escrow and credit the position.",
        "Returns the current SyState so the caller can update its view."
      ],
      "discriminator": [
        5
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Must sign. Moves SY from sy_src to the adapter's pool."
          ],
          "signer": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "poolEscrow",
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
        "Read-only: position data for the passed PersonalPosition."
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
        "Read-only: current SyState."
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
        "Create a PersonalPosition for `owner` on this SY market.",
        "Positions are PDAs keyed by (sy_market, owner)."
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
          "name": "owner",
          "docs": [
            "The owner the position is being created for. Does not need to be the",
            "payer — a router program can init positions on behalf of callers."
          ]
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
        "Create a new SY market wrapping `base_mint`. Anyone can call this",
        "once per base_mint — the SyMarket PDA is derived from the mint."
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
          "name": "authority",
          "docs": [
            "Authority that can later poke the exchange rate. Does NOT have to",
            "equal the payer — creators can hand this to a timelock or oracle."
          ]
        },
        {
          "name": "baseMint"
        },
        {
          "name": "syMarket",
          "writable": true
        },
        {
          "name": "syMint",
          "docs": [
            "SY mint; authority is the sy_market PDA."
          ],
          "writable": true
        },
        {
          "name": "baseVault",
          "docs": [
            "Pool escrow for base asset (pays out on redeem)."
          ],
          "writable": true
        },
        {
          "name": "poolEscrow",
          "docs": [
            "Pool escrow for deposited SY (deposit_sy / withdraw_sy flow)."
          ],
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
          "name": "initialExchangeRate",
          "type": {
            "defined": {
              "name": "number"
            }
          }
        }
      ]
    },
    {
      "name": "mintSy",
      "docs": [
        "Mint SY from base. `sy_out = floor(base_in / exchange_rate)`."
      ],
      "discriminator": [
        1
      ],
      "accounts": [
        {
          "name": "owner",
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
          "name": "syDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amountBase",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "mintSyReturnData"
        }
      }
    },
    {
      "name": "pokeExchangeRate",
      "docs": [
        "Authority-only: overwrite the stored exchange rate.",
        "Stand-in for a real oracle read.",
        "",
        "Enforces ATH monotonicity (I-V3): the rate may only increase. This",
        "prevents a compromised authority from dropping the rate to strip",
        "value from PT/YT holders on any vault wired to this SY market.",
        "A real oracle-backed adapter would replace the manual `new_rate`",
        "input with an oracle read but keep the same floor check."
      ],
      "discriminator": [
        9
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "syMarket",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newRate",
          "type": {
            "defined": {
              "name": "number"
            }
          }
        }
      ]
    },
    {
      "name": "redeemSy",
      "docs": [
        "Burn SY, return base. `base_out = floor(amount_sy * exchange_rate)`."
      ],
      "discriminator": [
        2
      ],
      "accounts": [
        {
          "name": "owner",
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
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amountSy",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "redeemSyReturnData"
        }
      }
    },
    {
      "name": "withdrawSy",
      "docs": [
        "Withdraw SY from pool escrow back to the owner."
      ],
      "discriminator": [
        6
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "syMarket"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "syDst",
          "writable": true
        },
        {
          "name": "poolEscrow",
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
      "name": "invalidExchangeRate",
      "msg": "Invalid exchange rate (must be > 0)"
    },
    {
      "code": 6001,
      "name": "exchangeRateRegression",
      "msg": "Exchange rate cannot regress below previous value"
    },
    {
      "code": 6002,
      "name": "overflow",
      "msg": "Position balance overflow"
    },
    {
      "code": 6003,
      "name": "insufficientBalance",
      "msg": "Position balance underflow"
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
      "name": "mintSyReturnData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "syOutAmount",
            "type": "u64"
          },
          {
            "name": "exchangeRate",
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
          },
          {
            "name": "syBalance",
            "type": "u64"
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
      "name": "redeemSyReturnData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "baseOutAmount",
            "type": "u64"
          },
          {
            "name": "exchangeRate",
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
      "name": "syMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Who can poke the exchange rate. No admin hierarchy — creator is it."
            ],
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "syMint",
            "type": "pubkey"
          },
          {
            "name": "poolEscrow",
            "type": "pubkey"
          },
          {
            "name": "exchangeRate",
            "docs": [
              "Base units per 1 SY. Monotonicity is NOT enforced in this reference;",
              "a production adapter should guarantee it (ATH monotonicity — I-V3)."
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "syMarketBump",
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

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/mock_klend.json`.
 */
export type MockKlend = {
  "address": "AKeo9L8sGnMABrsUs7gJAk8WLye62hSJ7ikZ6yytCGkv",
  "metadata": {
    "name": "mockKlend",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Test-only mock of Kamino Lend V2 for clearstone kamino_sy_adapter integration tests."
  },
  "instructions": [
    {
      "name": "depositReserveLiquidity",
      "docs": [
        "Deposit liquidity tokens; receive ctokens.",
        "amount_collateral = floor(amount_liquidity / exchange_rate)"
      ],
      "discriminator": [
        169,
        201,
        30,
        126,
        6,
        205,
        102,
        68
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "reserve",
          "writable": true
        },
        {
          "name": "liquidityMint"
        },
        {
          "name": "liquiditySupply",
          "writable": true
        },
        {
          "name": "collateralMint",
          "writable": true
        },
        {
          "name": "userLiquidity",
          "writable": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amountLiquidity",
          "type": "u64"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "initializeReserve",
      "docs": [
        "Initialize a reserve for a given liquidity mint. Creates the ctoken mint and the",
        "liquidity supply vault. Exchange rate starts at 1.0 (1 liquidity = 1 ctoken)."
      ],
      "discriminator": [
        91,
        188,
        92,
        135,
        153,
        155,
        112,
        16
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "lendingMarket"
        },
        {
          "name": "liquidityMint"
        },
        {
          "name": "reserve",
          "writable": true
        },
        {
          "name": "liquiditySupply",
          "writable": true
        },
        {
          "name": "collateralMint",
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
      "name": "pokeExchangeRate",
      "docs": [
        "Test hook: overwrite the collateral exchange rate. Simulates interest accrual."
      ],
      "discriminator": [
        13,
        104,
        89,
        126,
        64,
        108,
        102,
        176
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "reserve",
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
      "name": "redeemReserveCollateral",
      "docs": [
        "Redeem ctokens; receive liquidity tokens.",
        "amount_liquidity = floor(amount_collateral * exchange_rate)"
      ],
      "discriminator": [
        234,
        117,
        181,
        125,
        185,
        142,
        220,
        29
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "reserve",
          "writable": true
        },
        {
          "name": "liquidityMint"
        },
        {
          "name": "liquiditySupply",
          "writable": true
        },
        {
          "name": "collateralMint",
          "writable": true
        },
        {
          "name": "userLiquidity",
          "writable": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amountCollateral",
          "type": "u64"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "refreshReserve",
      "docs": [
        "No-op; mirrors the shape of klend's `refresh_reserve`. Real klend refreshes",
        "oracle prices and accrues interest here; the mock has no interest model."
      ],
      "discriminator": [
        2,
        218,
        138,
        235,
        79,
        201,
        25,
        102
      ],
      "accounts": [
        {
          "name": "reserve"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "reserve",
      "discriminator": [
        43,
        242,
        204,
        202,
        26,
        247,
        59,
        127
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be > 0"
    },
    {
      "code": 6001,
      "name": "invalidExchangeRate",
      "msg": "Exchange rate must be > 0"
    }
  ],
  "types": [
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
      "name": "reserve",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lendingMarket",
            "type": "pubkey"
          },
          {
            "name": "liquidityMint",
            "type": "pubkey"
          },
          {
            "name": "liquiditySupply",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "collateralExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};

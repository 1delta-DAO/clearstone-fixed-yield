/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kamino_sy_adapter.json`.
 */
export type KaminoSyAdapter = {
  "address": "29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd",
  "metadata": {
    "name": "kaminoSyAdapter",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clearstone SY adapter that wraps a Kamino Lend V2 reserve. Optionally CPIs into the clearstone-finance governor to whitelist clearstone_core escrow PDAs for KYC-gated d-token underlyings."
  },
  "instructions": [
    {
      "name": "claimEmission",
      "docs": [
        "No-op; this adapter has no emissions. Placeholder for interface parity."
      ],
      "discriminator": [
        8
      ],
      "accounts": [
        {
          "name": "syMetadata"
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
        "User deposits SY into adapter's pool escrow and credits their position."
      ],
      "discriminator": [
        5
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "syMetadata"
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
          "name": "klendReserve"
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
        "Read-only: position data."
      ],
      "discriminator": [
        10
      ],
      "accounts": [
        {
          "name": "syMetadata"
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
        "Read-only SyState. Exchange rate read from klend reserve."
      ],
      "discriminator": [
        7
      ],
      "accounts": [
        {
          "name": "syMetadata"
        },
        {
          "name": "klendReserve"
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
        "Create a PersonalPosition for `owner` on this SY market."
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
          "name": "syMetadata"
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
      "name": "initSyParams",
      "docs": [
        "Create SY parameters: new SY mint, collateral vault (holds ctokens), SY pool escrow.",
        "When kyc_mode is GovernorWhitelist, the caller passes",
        "`core_pdas_to_whitelist: Vec<Pubkey>` and paired `[wallet, whitelist_entry]` accounts",
        "via remaining_accounts; the adapter CPIs governor once per PDA."
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
          "name": "curator",
          "docs": [
            "Curator is the caller authorizing the init. When kyc_mode is GovernorWhitelist",
            "they must be a governor root/admin — enforced by the governor CPI in M-KYC-3."
          ],
          "signer": true
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "syMetadata",
          "writable": true
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "collateralVault",
          "docs": [
            "Adapter-owned vault holding klend ctokens. SY supply tracks this 1:1."
          ],
          "writable": true
        },
        {
          "name": "poolEscrow",
          "docs": [
            "Pool escrow for deposit_sy / withdraw_sy flow."
          ],
          "writable": true
        },
        {
          "name": "klendReserve",
          "docs": [
            "downstream ixs. Here we just store its pubkey."
          ]
        },
        {
          "name": "klendLendingMarket"
        },
        {
          "name": "klendCollateralMint"
        },
        {
          "name": "klendProgram"
        },
        {
          "name": "governorProgram",
          "optional": true
        },
        {
          "name": "poolConfig",
          "optional": true
        },
        {
          "name": "dmMintConfig",
          "optional": true
        },
        {
          "name": "deltaMintProgram",
          "optional": true
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
          "name": "kycMode",
          "type": {
            "defined": {
              "name": "kycMode"
            }
          }
        },
        {
          "name": "corePdasToWhitelist",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "mintSy",
      "docs": [
        "Mint SY: user's underlying → klend.deposit_reserve_liquidity → ctokens stored in",
        "adapter's collateral_vault → adapter mints amount_collateral of SY (1:1) to user."
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
          "name": "syMetadata"
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "syMint",
          "writable": true
        },
        {
          "name": "userUnderlying",
          "writable": true
        },
        {
          "name": "syDst",
          "writable": true
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "klendReserve",
          "writable": true
        },
        {
          "name": "klendLiquiditySupply",
          "writable": true
        },
        {
          "name": "klendCollateralMint",
          "writable": true
        },
        {
          "name": "klendProgram"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amountUnderlying",
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
      "name": "redeemSy",
      "docs": [
        "Redeem SY: burn SY from user → redeem equal ctokens from adapter vault via",
        "klend.redeem_reserve_collateral → user receives underlying."
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
          "name": "syMetadata"
        },
        {
          "name": "underlyingMint"
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
          "name": "userUnderlying",
          "writable": true
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "klendReserve",
          "writable": true
        },
        {
          "name": "klendLiquiditySupply",
          "writable": true
        },
        {
          "name": "klendCollateralMint",
          "writable": true
        },
        {
          "name": "klendProgram"
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
        "Withdraw SY from pool escrow back to owner."
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
          "name": "syMetadata"
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
          "name": "klendReserve"
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
      "name": "syMetadata",
      "discriminator": [
        238,
        103,
        154,
        99,
        51,
        91,
        34,
        91
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
      "msg": "Invalid exchange rate (must be > 0)"
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
    },
    {
      "code": 6004,
      "name": "governorAccountMismatch",
      "msg": "Governor account does not match kyc_mode payload"
    },
    {
      "code": 6005,
      "name": "whitelistAccountsMismatch",
      "msg": "remaining_accounts count does not match whitelist request length"
    },
    {
      "code": 6006,
      "name": "whitelistPdaMismatch",
      "msg": "remaining_accounts pubkey does not match core_pdas_to_whitelist entry"
    },
    {
      "code": 6007,
      "name": "whitelistNotInKycMode",
      "msg": "Cannot pass core_pdas_to_whitelist when kyc_mode is None"
    },
    {
      "code": 6008,
      "name": "reserveDataMalformed",
      "msg": "Reserve account data malformed / unexpected layout"
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
      "name": "kycMode",
      "docs": [
        "KYC configuration stored on SyMetadata."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "governorWhitelist",
            "fields": [
              {
                "name": "governorProgram",
                "type": "pubkey"
              },
              {
                "name": "poolConfig",
                "type": "pubkey"
              },
              {
                "name": "dmMintConfig",
                "type": "pubkey"
              },
              {
                "name": "deltaMintProgram",
                "type": "pubkey"
              }
            ]
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
            "name": "syMetadata",
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
      "name": "syMetadata",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "curator",
            "type": "pubkey"
          },
          {
            "name": "underlyingMint",
            "type": "pubkey"
          },
          {
            "name": "syMint",
            "type": "pubkey"
          },
          {
            "name": "collateralVault",
            "type": "pubkey"
          },
          {
            "name": "poolEscrow",
            "type": "pubkey"
          },
          {
            "name": "klendProgram",
            "type": "pubkey"
          },
          {
            "name": "klendLendingMarket",
            "type": "pubkey"
          },
          {
            "name": "klendReserve",
            "type": "pubkey"
          },
          {
            "name": "klendCollateralMint",
            "type": "pubkey"
          },
          {
            "name": "kycMode",
            "type": {
              "defined": {
                "name": "kycMode"
              }
            }
          },
          {
            "name": "bump",
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

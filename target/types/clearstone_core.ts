/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearstone_core.json`.
 */
export type ClearstoneCore = {
  "address": "EKpLcVc6rky1ah28NMZFoT2oSXkAKWcEsr6nbZziTWbC",
  "metadata": {
    "name": "clearstoneCore",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clearstone fixed-yield core (Exponent Core fork)"
  },
  "instructions": [
    {
      "name": "addLpTokensMetadata",
      "discriminator": [
        41
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "curator",
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "mintLp"
        },
        {
          "name": "metadata",
          "writable": true
        },
        {
          "name": "tokenMetadataProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "buyYt",
      "discriminator": [
        0
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "tokenSyTrader",
          "writable": true
        },
        {
          "name": "tokenYtTrader",
          "writable": true
        },
        {
          "name": "tokenPtTrader",
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "tokenFeeTreasurySy",
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
          "name": "vaultAuthority",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenSyEscrowVault",
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
          "name": "addressLookupTableVault"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "syIn",
          "type": "u64"
        },
        {
          "name": "ytOut",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "buyYtEvent"
        }
      }
    },
    {
      "name": "collectEmission",
      "discriminator": [
        19
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
          "name": "position",
          "writable": true
        },
        {
          "name": "syProgram"
        },
        {
          "name": "authority"
        },
        {
          "name": "emissionEscrow",
          "writable": true
        },
        {
          "name": "emissionDst",
          "writable": true
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "treasuryEmissionTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u16"
        },
        {
          "name": "amount",
          "type": {
            "defined": {
              "name": "amount"
            }
          }
        }
      ],
      "returns": {
        "defined": {
          "name": "collectEmissionEventV2"
        }
      }
    },
    {
      "name": "collectInterest",
      "discriminator": [
        6
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenSyDst",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "treasurySyTokenAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "mintSy"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
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
      ],
      "returns": {
        "defined": {
          "name": "collectInterestEventV2"
        }
      }
    },
    {
      "name": "collectTreasuryEmission",
      "discriminator": [
        20
      ],
      "accounts": [
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "syProgram"
        },
        {
          "name": "authority"
        },
        {
          "name": "emissionEscrow",
          "writable": true
        },
        {
          "name": "emissionDst",
          "writable": true
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "emissionIndex",
          "type": "u16"
        },
        {
          "name": "amount",
          "type": {
            "defined": {
              "name": "amount"
            }
          }
        },
        {
          "name": "kind",
          "type": {
            "defined": {
              "name": "collectTreasuryEmissionKind"
            }
          }
        }
      ]
    },
    {
      "name": "collectTreasuryInterest",
      "discriminator": [
        21
      ],
      "accounts": [
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "syDst",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "authority"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "mintSy"
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
        },
        {
          "name": "kind",
          "type": {
            "defined": {
              "name": "collectTreasuryInterestKind"
            }
          }
        }
      ]
    },
    {
      "name": "depositYt",
      "discriminator": [
        7
      ],
      "accounts": [
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userYieldPosition",
          "writable": true
        },
        {
          "name": "ytSrc",
          "writable": true
        },
        {
          "name": "escrowYt",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
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
          "name": "depositYtEventV2"
        }
      }
    },
    {
      "name": "initMarketTwo",
      "discriminator": [
        10
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "vault"
        },
        {
          "name": "mintSy",
          "writable": true
        },
        {
          "name": "mintPt"
        },
        {
          "name": "mintLp",
          "writable": true
        },
        {
          "name": "escrowPt",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "ptSrc",
          "writable": true
        },
        {
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "lpDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "tokenTreasuryFeeSy"
        }
      ],
      "args": [
        {
          "name": "lnFeeRateRoot",
          "type": "f64"
        },
        {
          "name": "rateScalarRoot",
          "type": "f64"
        },
        {
          "name": "initRateAnchor",
          "type": "f64"
        },
        {
          "name": "syExchangeRate",
          "type": {
            "defined": {
              "name": "number"
            }
          }
        },
        {
          "name": "ptInit",
          "type": "u64"
        },
        {
          "name": "syInit",
          "type": "u64"
        },
        {
          "name": "feeTreasurySyBps",
          "type": "u16"
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
          "name": "seedId",
          "type": "u8"
        },
        {
          "name": "curator",
          "type": "pubkey"
        },
        {
          "name": "creatorFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializeVault",
      "discriminator": [
        2
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority"
        },
        {
          "name": "vault",
          "writable": true,
          "signer": true
        },
        {
          "name": "mintPt",
          "writable": true
        },
        {
          "name": "mintYt",
          "writable": true
        },
        {
          "name": "escrowYt",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "treasuryTokenAccount"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "metadata",
          "writable": true
        },
        {
          "name": "tokenMetadataProgram"
        }
      ],
      "args": [
        {
          "name": "startTimestamp",
          "type": "u32"
        },
        {
          "name": "duration",
          "type": "u32"
        },
        {
          "name": "interestBpsFee",
          "type": "u16"
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
          "name": "minOpSizeStrip",
          "type": "u64"
        },
        {
          "name": "minOpSizeMerge",
          "type": "u64"
        },
        {
          "name": "ptMetadataName",
          "type": "string"
        },
        {
          "name": "ptMetadataSymbol",
          "type": "string"
        },
        {
          "name": "ptMetadataUri",
          "type": "string"
        },
        {
          "name": "curator",
          "type": "pubkey"
        },
        {
          "name": "creatorFeeBps",
          "type": "u16"
        },
        {
          "name": "maxPySupply",
          "type": "u64"
        },
        {
          "name": "emissionsSeed",
          "type": {
            "vec": {
              "defined": {
                "name": "emissionSeed"
              }
            }
          }
        },
        {
          "name": "enableMetadata",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initializeYieldPosition",
      "discriminator": [
        3
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "initializeYieldPositionEvent"
        }
      }
    },
    {
      "name": "marketTwoDepositLiquidity",
      "discriminator": [
        11
      ],
      "accounts": [
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "tokenPtSrc",
          "writable": true
        },
        {
          "name": "tokenSySrc",
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "writable": true
        },
        {
          "name": "tokenLpDst",
          "writable": true
        },
        {
          "name": "mintLp",
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "ptIntent",
          "type": "u64"
        },
        {
          "name": "syIntent",
          "type": "u64"
        },
        {
          "name": "minLpOut",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "depositLiquidityEvent"
        }
      }
    },
    {
      "name": "marketTwoWithdrawLiquidity",
      "discriminator": [
        12
      ],
      "accounts": [
        {
          "name": "withdrawer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "tokenPtDst",
          "writable": true
        },
        {
          "name": "tokenSyDst",
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "writable": true
        },
        {
          "name": "tokenLpSrc",
          "writable": true
        },
        {
          "name": "mintLp",
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "lpIn",
          "type": "u64"
        },
        {
          "name": "minPtOut",
          "type": "u64"
        },
        {
          "name": "minSyOut",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "withdrawLiquidityEvent"
        }
      }
    },
    {
      "name": "merge",
      "discriminator": [
        5
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
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
          "name": "syDst",
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
          "name": "mintSy"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
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
          "name": "mergeEvent"
        }
      }
    },
    {
      "name": "modifyMarketSetting",
      "discriminator": [
        27
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "marketAdminAction"
            }
          }
        }
      ]
    },
    {
      "name": "modifyVaultSetting",
      "discriminator": [
        26
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "curator",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "adminAction"
            }
          }
        }
      ]
    },
    {
      "name": "reallocMarket",
      "discriminator": [
        40
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "curator",
          "writable": true,
          "signer": true
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
          "name": "additionalBytes",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sellYt",
      "discriminator": [
        1
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "tokenYtTrader",
          "writable": true
        },
        {
          "name": "tokenPtTrader",
          "writable": true
        },
        {
          "name": "tokenSyTrader",
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "writable": true
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "authorityVault",
          "writable": true
        },
        {
          "name": "tokenSyEscrowVault",
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
          "name": "addressLookupTableVault"
        },
        {
          "name": "yieldPositionVault",
          "writable": true
        },
        {
          "name": "syProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "ytIn",
          "type": "u64"
        },
        {
          "name": "minSyOut",
          "type": "u64"
        }
      ],
      "returns": {
        "defined": {
          "name": "sellYtEvent"
        }
      }
    },
    {
      "name": "stageYtYield",
      "discriminator": [
        9
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userYieldPosition",
          "writable": true
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "syProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "stageYieldEventV2"
        }
      }
    },
    {
      "name": "strip",
      "discriminator": [
        4
      ],
      "accounts": [
        {
          "name": "depositor",
          "writable": true,
          "signer": true
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
          "name": "mintSy"
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
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
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
          "name": "stripEvent"
        }
      }
    },
    {
      "name": "tradePt",
      "discriminator": [
        17
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "tokenSyTrader",
          "writable": true
        },
        {
          "name": "tokenPtTrader",
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "writable": true
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "netTraderPt",
          "type": "i64"
        },
        {
          "name": "syConstraint",
          "type": "i64"
        }
      ],
      "returns": {
        "defined": {
          "name": "tradePtEvent"
        }
      }
    },
    {
      "name": "withdrawYt",
      "discriminator": [
        8
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
          "name": "userYieldPosition",
          "writable": true
        },
        {
          "name": "ytDst",
          "writable": true
        },
        {
          "name": "escrowYt",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "authority"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
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
          "name": "withdrawYtEventV2"
        }
      }
    }
  ],
  "accounts": [
    {
      "name": "marketTwo",
      "discriminator": [
        212,
        4,
        132,
        126,
        169,
        121,
        121,
        20
      ]
    },
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
    },
    {
      "name": "yieldTokenPosition",
      "discriminator": [
        227,
        92,
        146,
        49,
        29,
        85,
        71,
        94
      ]
    }
  ],
  "events": [
    {
      "name": "buyYtEvent",
      "discriminator": [
        172,
        181,
        56,
        183,
        219,
        24,
        130,
        64
      ]
    },
    {
      "name": "collectEmissionEvent",
      "discriminator": [
        220,
        173,
        217,
        52,
        133,
        253,
        5,
        114
      ]
    },
    {
      "name": "collectEmissionEventV2",
      "discriminator": [
        235,
        35,
        233,
        149,
        215,
        221,
        100,
        66
      ]
    },
    {
      "name": "collectInterestEvent",
      "discriminator": [
        95,
        53,
        16,
        82,
        91,
        39,
        176,
        252
      ]
    },
    {
      "name": "collectInterestEventV2",
      "discriminator": [
        208,
        173,
        139,
        10,
        96,
        51,
        184,
        154
      ]
    },
    {
      "name": "depositLiquidityEvent",
      "discriminator": [
        169,
        84,
        67,
        174,
        222,
        138,
        16,
        123
      ]
    },
    {
      "name": "depositYtEvent",
      "discriminator": [
        78,
        226,
        18,
        115,
        161,
        164,
        137,
        112
      ]
    },
    {
      "name": "depositYtEventV2",
      "discriminator": [
        24,
        10,
        201,
        118,
        79,
        178,
        237,
        243
      ]
    },
    {
      "name": "initializeYieldPositionEvent",
      "discriminator": [
        114,
        53,
        131,
        31,
        90,
        57,
        208,
        196
      ]
    },
    {
      "name": "mergeEvent",
      "discriminator": [
        25,
        30,
        29,
        41,
        108,
        139,
        103,
        4
      ]
    },
    {
      "name": "sellYtEvent",
      "discriminator": [
        149,
        147,
        29,
        159,
        148,
        240,
        129,
        7
      ]
    },
    {
      "name": "stageYieldEvent",
      "discriminator": [
        248,
        92,
        96,
        80,
        238,
        94,
        91,
        195
      ]
    },
    {
      "name": "stageYieldEventV2",
      "discriminator": [
        23,
        7,
        36,
        198,
        5,
        216,
        217,
        189
      ]
    },
    {
      "name": "stripEvent",
      "discriminator": [
        114,
        189,
        26,
        143,
        143,
        50,
        197,
        89
      ]
    },
    {
      "name": "tradePtEvent",
      "discriminator": [
        159,
        225,
        96,
        81,
        255,
        227,
        233,
        174
      ]
    },
    {
      "name": "withdrawLiquidityEvent",
      "discriminator": [
        214,
        6,
        161,
        45,
        191,
        142,
        124,
        186
      ]
    },
    {
      "name": "withdrawYtEvent",
      "discriminator": [
        190,
        66,
        234,
        53,
        4,
        207,
        221,
        17
      ]
    },
    {
      "name": "withdrawYtEventV2",
      "discriminator": [
        41,
        253,
        139,
        142,
        167,
        187,
        86,
        118
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidProxyAccount",
      "msg": "Invalid Proxy Account"
    },
    {
      "code": 6001,
      "name": "vaultExpired",
      "msg": "Vault is expired"
    },
    {
      "code": 6002,
      "name": "emissionIndexMustBeSequential",
      "msg": "Emission Index must be sequential"
    },
    {
      "code": 6003,
      "name": "amountLargerThanStaged",
      "msg": "Amount larger than staged"
    },
    {
      "code": 6004,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6005,
      "name": "durationNegative",
      "msg": "Duration is negative"
    },
    {
      "code": 6006,
      "name": "farmDoesNotExist",
      "msg": "Farm does not exist"
    },
    {
      "code": 6007,
      "name": "lpSupplyMaximumExceeded",
      "msg": "Lp supply maximum exceeded"
    },
    {
      "code": 6008,
      "name": "vaultIsNotActive",
      "msg": "Vault has not started yet or has ended"
    },
    {
      "code": 6009,
      "name": "operationAmountTooSmall",
      "msg": "Operation amount too small"
    },
    {
      "code": 6010,
      "name": "strippingDisabled",
      "msg": "Stripping is disabled"
    },
    {
      "code": 6011,
      "name": "mergingDisabled",
      "msg": "Merging is disabled"
    },
    {
      "code": 6012,
      "name": "depositingYtDisabled",
      "msg": "Depositing YT is disabled"
    },
    {
      "code": 6013,
      "name": "withdrawingYtDisabled",
      "msg": "Withdrawing YT is disabled"
    },
    {
      "code": 6014,
      "name": "collectingInterestDisabled",
      "msg": "Collecting interest is disabled"
    },
    {
      "code": 6015,
      "name": "collectingEmissionsDisabled",
      "msg": "Collecting Emissions is disabled"
    },
    {
      "code": 6016,
      "name": "buyingPtDisabled",
      "msg": "Buying PT is disabled"
    },
    {
      "code": 6017,
      "name": "sellingPtDisabled",
      "msg": "Selling PT is disabled"
    },
    {
      "code": 6018,
      "name": "buyingYtDisabled",
      "msg": "Buying YT is disabled"
    },
    {
      "code": 6019,
      "name": "sellingYtDisabled",
      "msg": "Selling YT is disabled"
    },
    {
      "code": 6020,
      "name": "depositingLiquidityDisabled",
      "msg": "Depositing Liquidity is disabled"
    },
    {
      "code": 6021,
      "name": "withdrawingLiquidityDisabled",
      "msg": "Withdrawing Liquidity is disabled"
    },
    {
      "code": 6022,
      "name": "vaultInEmergencyMode",
      "msg": "Vault is in emergency mode"
    },
    {
      "code": 6023,
      "name": "farmAlreadyExists",
      "msg": "Farm already exists"
    },
    {
      "code": 6024,
      "name": "claimLimitExceeded",
      "msg": "Claim limit exceeded"
    },
    {
      "code": 6025,
      "name": "netBalanceChangeExceedsLimit",
      "msg": "Net balance change exceeds limit"
    },
    {
      "code": 6026,
      "name": "minSyOutNotMet",
      "msg": "Min SY out not met"
    },
    {
      "code": 6027,
      "name": "minPtOutNotMet",
      "msg": "Min PT out not met"
    },
    {
      "code": 6028,
      "name": "minLpOutNotMet",
      "msg": "Min LP out not met"
    },
    {
      "code": 6029,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6030,
      "name": "reentrancyLocked",
      "msg": "Reentrancy locked"
    },
    {
      "code": 6031,
      "name": "syInvalidExchangeRate",
      "msg": "SY program returned an invalid exchange rate"
    },
    {
      "code": 6032,
      "name": "syEmissionIndexesMismatch",
      "msg": "SY program emissions vec length does not match vault emissions"
    },
    {
      "code": 6033,
      "name": "feeExceedsProtocolCap",
      "msg": "Fee exceeds protocol cap"
    },
    {
      "code": 6034,
      "name": "feeNotRatchetDown",
      "msg": "Fee can only be ratcheted down"
    },
    {
      "code": 6035,
      "name": "durationOutOfBounds",
      "msg": "Duration out of bounds"
    },
    {
      "code": 6036,
      "name": "startTimestampInPast",
      "msg": "Start timestamp is in the past"
    },
    {
      "code": 6037,
      "name": "minOperationSizeZero",
      "msg": "Minimum operation size must be greater than zero"
    },
    {
      "code": 6038,
      "name": "immutablePostInit",
      "msg": "Action is not allowed post-init"
    }
  ],
  "types": [
    {
      "name": "adminAction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "setVaultStatus",
            "fields": [
              "u8"
            ]
          },
          {
            "name": "lowerInterestBpsFee",
            "fields": [
              "u16"
            ]
          },
          {
            "name": "changeVaultTreasuryTokenAccount",
            "fields": [
              "pubkey"
            ]
          },
          {
            "name": "changeEmissionTreasuryTokenAccount",
            "fields": [
              {
                "name": "emissionIndex",
                "type": "u16"
              },
              {
                "name": "newTokenAccount",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "changeMinOperationSize",
            "fields": [
              {
                "name": "isStrip",
                "type": "bool"
              },
              {
                "name": "newSize",
                "type": "u64"
              }
            ]
          },
          {
            "name": "lowerEmissionBpsFee",
            "fields": [
              {
                "name": "emissionIndex",
                "type": "u16"
              },
              {
                "name": "newFeeBps",
                "type": "u16"
              }
            ]
          },
          {
            "name": "changeCpiAccounts",
            "fields": [
              {
                "name": "cpiAccounts",
                "type": {
                  "defined": {
                    "name": "cpiAccounts"
                  }
                }
              }
            ]
          },
          {
            "name": "changeClaimLimits",
            "fields": [
              {
                "name": "maxClaimAmountPerWindow",
                "type": "u64"
              },
              {
                "name": "claimWindowDurationSeconds",
                "type": "u32"
              }
            ]
          },
          {
            "name": "changeAddressLookupTable",
            "fields": [
              "pubkey"
            ]
          },
          {
            "name": "removeVaultEmission",
            "fields": [
              "u8"
            ]
          }
        ]
      }
    },
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
      "name": "buyYtEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "tokenSyTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenYtTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenPtTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "type": "pubkey"
          },
          {
            "name": "maxSyIn",
            "type": "u64"
          },
          {
            "name": "ytOut",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "syToStrip",
            "type": "u64"
          },
          {
            "name": "syBorrowed",
            "type": "u64"
          },
          {
            "name": "ptOut",
            "type": "u64"
          },
          {
            "name": "syRepaid",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
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
      "name": "collectEmissionEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "emissionIndex",
            "type": "u16"
          },
          {
            "name": "amountToUser",
            "type": "u64"
          },
          {
            "name": "amountToTreasury",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "collectEmissionEventV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "emissionIndex",
            "type": "u16"
          },
          {
            "name": "amountToUser",
            "type": "u64"
          },
          {
            "name": "amountToTreasury",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          },
          {
            "name": "userInterest",
            "type": {
              "defined": {
                "name": "yieldTokenTracker"
              }
            }
          },
          {
            "name": "userEmissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "yieldTokenTracker"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "collectInterestEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "amountToUser",
            "type": "u64"
          },
          {
            "name": "amountToTreasury",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "collectInterestEventV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "amountToUser",
            "type": "u64"
          },
          {
            "name": "amountToTreasury",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          },
          {
            "name": "userInterest",
            "type": {
              "defined": {
                "name": "yieldTokenTracker"
              }
            }
          },
          {
            "name": "userEmissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "yieldTokenTracker"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "collectTreasuryEmissionKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yieldPosition"
          },
          {
            "name": "treasuryEmission"
          }
        ]
      }
    },
    {
      "name": "collectTreasuryInterestKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yieldPosition"
          },
          {
            "name": "treasuryInterest"
          }
        ]
      }
    },
    {
      "name": "cpiAccounts",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "getSyState",
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
      "name": "depositLiquidityEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "tokenPtSrc",
            "type": "pubkey"
          },
          {
            "name": "tokenSySrc",
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenLpDst",
            "type": "pubkey"
          },
          {
            "name": "mintLp",
            "type": "pubkey"
          },
          {
            "name": "ptIntent",
            "type": "u64"
          },
          {
            "name": "syIntent",
            "type": "u64"
          },
          {
            "name": "ptIn",
            "type": "u64"
          },
          {
            "name": "syIn",
            "type": "u64"
          },
          {
            "name": "lpOut",
            "type": "u64"
          },
          {
            "name": "newLpSupply",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "depositYtEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "vaultYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "ytSrc",
            "type": "pubkey"
          },
          {
            "name": "escrowYt",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "userYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "vaultYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "userStagedYield",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "depositYtEventV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "vaultYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "ytSrc",
            "type": "pubkey"
          },
          {
            "name": "escrowYt",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "userYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "vaultYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "userStagedYield",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          },
          {
            "name": "userInterest",
            "type": {
              "defined": {
                "name": "yieldTokenTracker"
              }
            }
          },
          {
            "name": "userEmissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "yieldTokenTracker"
                }
              }
            }
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
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "treasuryTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "treasuryEmission",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "emissionSeed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenAccount",
            "type": "pubkey"
          },
          {
            "name": "treasuryTokenAccount",
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
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "initializeYieldPositionEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "yieldPosition",
            "type": "pubkey"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "liquidityNetBalanceLimits",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "windowStartTimestamp",
            "type": "u32"
          },
          {
            "name": "windowStartNetBalance",
            "type": "u64"
          },
          {
            "name": "maxNetBalanceChangeNegativePercentage",
            "type": "u16"
          },
          {
            "name": "maxNetBalanceChangePositivePercentage",
            "type": "u32"
          },
          {
            "name": "windowDurationSeconds",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "marketAdminAction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "setStatus",
            "fields": [
              "u8"
            ]
          },
          {
            "name": "lowerTreasuryTradeSyBpsFee",
            "fields": [
              "u16"
            ]
          },
          {
            "name": "changeCpiAccounts",
            "fields": [
              {
                "name": "cpiAccounts",
                "type": {
                  "defined": {
                    "name": "cpiAccounts"
                  }
                }
              }
            ]
          },
          {
            "name": "changeLiquidityNetBalanceLimits",
            "fields": [
              {
                "name": "maxNetBalanceChangeNegativePercentage",
                "type": "u16"
              },
              {
                "name": "maxNetBalanceChangePositivePercentage",
                "type": "u32"
              },
              {
                "name": "windowDurationSeconds",
                "type": "u32"
              }
            ]
          },
          {
            "name": "changeAddressLookupTable",
            "fields": [
              "pubkey"
            ]
          }
        ]
      }
    },
    {
      "name": "marketFinancials",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "expirationTs",
            "type": "u64"
          },
          {
            "name": "ptBalance",
            "type": "u64"
          },
          {
            "name": "syBalance",
            "type": "u64"
          },
          {
            "name": "lnFeeRateRoot",
            "type": "f64"
          },
          {
            "name": "lastLnImpliedRate",
            "type": "f64"
          },
          {
            "name": "rateScalarRoot",
            "type": "f64"
          }
        ]
      }
    },
    {
      "name": "marketTwo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "curator",
            "type": "pubkey"
          },
          {
            "name": "creatorFeeBps",
            "type": "u16"
          },
          {
            "name": "reentrancyGuard",
            "type": "bool"
          },
          {
            "name": "addressLookupTable",
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "type": "pubkey"
          },
          {
            "name": "mintSy",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mintLp",
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenFeeTreasurySy",
            "type": "pubkey"
          },
          {
            "name": "feeTreasurySyBps",
            "type": "u16"
          },
          {
            "name": "selfAddress",
            "type": "pubkey"
          },
          {
            "name": "signerBump",
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "statusFlags",
            "type": "u8"
          },
          {
            "name": "syProgram",
            "type": "pubkey"
          },
          {
            "name": "financials",
            "type": {
              "defined": {
                "name": "marketFinancials"
              }
            }
          },
          {
            "name": "maxLpSupply",
            "type": "u64"
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
            "name": "isCurrentFlashSwap",
            "type": "bool"
          },
          {
            "name": "liquidityNetBalanceLimits",
            "type": {
              "defined": {
                "name": "liquidityNetBalanceLimits"
              }
            }
          },
          {
            "name": "seedId",
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          }
        ]
      }
    },
    {
      "name": "mergeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "syDst",
            "type": "pubkey"
          },
          {
            "name": "escrowSy",
            "type": "pubkey"
          },
          {
            "name": "ytSrc",
            "type": "pubkey"
          },
          {
            "name": "ptSrc",
            "type": "pubkey"
          },
          {
            "name": "mintYt",
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "type": "pubkey"
          },
          {
            "name": "yieldPosition",
            "type": "pubkey"
          },
          {
            "name": "amountPyIn",
            "type": "u64"
          },
          {
            "name": "amountSyOut",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "ptRedemptionRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "totalSyInEscrow",
            "type": "u64"
          },
          {
            "name": "ptSupply",
            "type": "u64"
          },
          {
            "name": "ytBalance",
            "type": "u64"
          },
          {
            "name": "syForPt",
            "type": "u64"
          },
          {
            "name": "isVaultActive",
            "type": "bool"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "number",
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
      "name": "sellYtEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "tokenYtTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenPtTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenSyTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "type": "pubkey"
          },
          {
            "name": "amountYtIn",
            "type": "u64"
          },
          {
            "name": "amountSyReceivedFromMerge",
            "type": "u64"
          },
          {
            "name": "amountSySpentBuyingPt",
            "type": "u64"
          },
          {
            "name": "amountSyOut",
            "type": "u64"
          },
          {
            "name": "ptBorrowedAndRepaid",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stageYieldEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "vaultYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "userYtBalance",
            "type": "u64"
          },
          {
            "name": "userStagedYield",
            "type": "u64"
          },
          {
            "name": "userStagedEmissions",
            "type": {
              "vec": "u64"
            }
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stageYieldEventV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "vaultYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "userYtBalance",
            "type": "u64"
          },
          {
            "name": "userStagedYield",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          },
          {
            "name": "userInterest",
            "type": {
              "defined": {
                "name": "yieldTokenTracker"
              }
            }
          },
          {
            "name": "userEmissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "yieldTokenTracker"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "stripEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "sySrc",
            "type": "pubkey"
          },
          {
            "name": "escrowSy",
            "type": "pubkey"
          },
          {
            "name": "ytDst",
            "type": "pubkey"
          },
          {
            "name": "ptDst",
            "type": "pubkey"
          },
          {
            "name": "mintYt",
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "type": "pubkey"
          },
          {
            "name": "yieldPosition",
            "type": "pubkey"
          },
          {
            "name": "amountSyIn",
            "type": "u64"
          },
          {
            "name": "amountPyOut",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "totalSyInEscrow",
            "type": "u64"
          },
          {
            "name": "ptSupply",
            "type": "u64"
          },
          {
            "name": "ytBalance",
            "type": "u64"
          },
          {
            "name": "allTimeHighSyExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "syForPt",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tradePtEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "tokenSyTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenPtTrader",
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "type": "pubkey"
          },
          {
            "name": "netTraderPt",
            "type": "i64"
          },
          {
            "name": "netTraderSy",
            "type": "i64"
          },
          {
            "name": "feeSy",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
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
            "type": "pubkey"
          },
          {
            "name": "creatorFeeBps",
            "type": "u16"
          },
          {
            "name": "reentrancyGuard",
            "type": "bool"
          },
          {
            "name": "syProgram",
            "type": "pubkey"
          },
          {
            "name": "mintSy",
            "type": "pubkey"
          },
          {
            "name": "mintYt",
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "type": "pubkey"
          },
          {
            "name": "escrowYt",
            "type": "pubkey"
          },
          {
            "name": "escrowSy",
            "type": "pubkey"
          },
          {
            "name": "yieldPosition",
            "type": "pubkey"
          },
          {
            "name": "addressLookupTable",
            "type": "pubkey"
          },
          {
            "name": "startTs",
            "type": "u32"
          },
          {
            "name": "duration",
            "type": "u32"
          },
          {
            "name": "signerSeed",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "signerBump",
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "lastSeenSyExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "allTimeHighSyExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "finalSyExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "totalSyInEscrow",
            "type": "u64"
          },
          {
            "name": "syForPt",
            "type": "u64"
          },
          {
            "name": "ptSupply",
            "type": "u64"
          },
          {
            "name": "treasurySy",
            "type": "u64"
          },
          {
            "name": "uncollectedSy",
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
    },
    {
      "name": "withdrawLiquidityEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "withdrawer",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "tokenPtDst",
            "type": "pubkey"
          },
          {
            "name": "tokenSyDst",
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "type": "pubkey"
          },
          {
            "name": "tokenLpSrc",
            "type": "pubkey"
          },
          {
            "name": "mintLp",
            "type": "pubkey"
          },
          {
            "name": "lpIn",
            "type": "u64"
          },
          {
            "name": "ptOut",
            "type": "u64"
          },
          {
            "name": "syOut",
            "type": "u64"
          },
          {
            "name": "newLpSupply",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawYtEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "vaultYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "ytDst",
            "type": "pubkey"
          },
          {
            "name": "escrowYt",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "userYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "vaultYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "userStagedYield",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawYtEventV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "userYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "vaultYieldPosition",
            "type": "pubkey"
          },
          {
            "name": "ytDst",
            "type": "pubkey"
          },
          {
            "name": "escrowYt",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "syExchangeRate",
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "userYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "vaultYtBalanceAfter",
            "type": "u64"
          },
          {
            "name": "userStagedYield",
            "type": "u64"
          },
          {
            "name": "unixTimestamp",
            "type": "i64"
          },
          {
            "name": "userInterest",
            "type": {
              "defined": {
                "name": "yieldTokenTracker"
              }
            }
          },
          {
            "name": "userEmissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "yieldTokenTracker"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "yieldTokenPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "ytBalance",
            "type": "u64"
          },
          {
            "name": "interest",
            "type": {
              "defined": {
                "name": "yieldTokenTracker"
              }
            }
          },
          {
            "name": "emissions",
            "type": {
              "vec": {
                "defined": {
                  "name": "yieldTokenTracker"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "yieldTokenTracker",
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
            "name": "staged",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

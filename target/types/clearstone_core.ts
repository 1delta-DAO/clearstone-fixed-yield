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
      "docs": [
        "Buy YT with SY"
      ],
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
          "docs": [
            "Source account for the trader's SY tokens"
          ],
          "writable": true
        },
        {
          "name": "tokenYtTrader",
          "docs": [
            "Destination for receiving YT tokens"
          ],
          "writable": true
        },
        {
          "name": "tokenPtTrader",
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "docs": [
            "Temporary SY account owned by market"
          ],
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "docs": [
            "PT liquidity owned by market"
          ],
          "writable": true
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
          "docs": [
            "Owner of the YieldTokenPosition"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "yieldPosition",
          "docs": [
            "Owner's position data for YT deposits"
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "The vault that holds the SY tokens in escrow"
          ],
          "writable": true
        },
        {
          "name": "tokenSyDst",
          "docs": [
            "The receiving token account for SY withdrawn"
          ],
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
          "docs": [
            "constrained by vault"
          ],
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
          "name": "authority",
          "docs": [
            "constrained by vault"
          ]
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
          "docs": [
            "The vault that holds the SY tokens in escrow"
          ],
          "writable": true
        },
        {
          "name": "syDst",
          "docs": [
            "The receiving token account for SY withdrawn"
          ],
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
      "docs": [
        "Deposit YT into escrow in order to earn rewards & SY interest"
      ],
      "discriminator": [
        7
      ],
      "accounts": [
        {
          "name": "depositor",
          "docs": [
            "Permissionless depositor - not necessarily the owner of the YieldTokenPosition"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "docs": [
            "Vault that manages YT"
          ],
          "writable": true
        },
        {
          "name": "userYieldPosition",
          "docs": [
            "Position data for YT deposits, linked to vault"
          ],
          "writable": true
        },
        {
          "name": "ytSrc",
          "docs": [
            "Depositor's YT token account"
          ],
          "writable": true
        },
        {
          "name": "escrowYt",
          "docs": [
            "Vault-owned escrow account for YT"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram",
          "docs": [
            "The SY interface implementation for the vault's token"
          ]
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "yieldPosition",
          "docs": [
            "Vault-owned yield token position"
          ],
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
          "docs": [
            "There is 1 market per vault"
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Links the mint_sy & mint_pt & sy_program together"
          ]
        },
        {
          "name": "mintSy"
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
          "docs": [
            "This account for SY is only a temporary pass-through account",
            "It is used to transfer SY tokens from the signer to the market",
            "And then from the market to the SY program's escrow"
          ],
          "writable": true
        },
        {
          "name": "ptSrc",
          "docs": [
            "Signer's PT token account"
          ],
          "writable": true
        },
        {
          "name": "sySrc",
          "docs": [
            "Signer's SY token account"
          ],
          "writable": true
        },
        {
          "name": "lpDst",
          "docs": [
            "Receiving account for LP tokens"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Use the old Token program as the implementation for PT & SY & LP tokens"
          ]
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
      "docs": [
        "Permissionless vault init. Creator supplies the curator pubkey —",
        "that pubkey controls all future modify_* instructions for this vault.",
        "`creator_fee_bps` is the permanent upper bound on `interest_bps_fee`",
        "(capped by `PROTOCOL_FEE_MAX_BPS` — see I-E1 / I-E2)."
      ],
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
          "name": "authority",
          "docs": [
            "The signer for the vault"
          ]
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
          "docs": [
            "Owner of the new YieldTokenPosition",
            "ie - the \"owner\" is not a Signer"
          ],
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
          "name": "addressLookupTable",
          "docs": [
            "Address lookup table for vault"
          ]
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
          "docs": [
            "Market PT liquidity account"
          ],
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "docs": [
            "Market-owned interchange account for SY"
          ],
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
          "name": "addressLookupTable",
          "docs": [
            "Address lookup table for vault"
          ]
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
      "docs": [
        "Merge PT + YT into SY",
        "Redeems & burns them, in exchange for SY"
      ],
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
          "docs": [
            "This authority owns the escrow_sy account & the robot account with the SY program",
            "Needs to be mutable to be used in deposit_sy CPI"
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "syDst",
          "docs": [
            "Destination account for SY withdrawn from vault"
          ],
          "writable": true
        },
        {
          "name": "escrowSy",
          "docs": [
            "Vault-owned account for SY tokens"
          ],
          "writable": true
        },
        {
          "name": "ytSrc",
          "docs": [
            "The owner's YT token account"
          ],
          "writable": true
        },
        {
          "name": "ptSrc",
          "docs": [
            "The owner's PT token account"
          ],
          "writable": true
        },
        {
          "name": "mintYt",
          "docs": [
            "Mint for YT -- needed for burning"
          ],
          "writable": true
        },
        {
          "name": "mintPt",
          "docs": [
            "Mint for PT -- needed for burning"
          ],
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
          "docs": [
            "Yield position for the vault robot account"
          ],
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
      "docs": [
        "Sell YT for SY"
      ],
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
          "docs": [
            "Account owned by market",
            "This is a temporary account that receives SY tokens from the user, after which it transfers them to the SY program"
          ],
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "docs": [
            "PT liquidity account"
          ],
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
          "docs": [
            "Vault-robot authority"
          ],
          "writable": true
        },
        {
          "name": "tokenSyEscrowVault",
          "docs": [
            "Vault-robot owned escrow account for SY"
          ],
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
          "name": "addressLookupTableVault",
          "docs": [
            "ALT owned by vault"
          ]
        },
        {
          "name": "yieldPositionVault",
          "docs": [
            "Yield position owned by vault robot"
          ],
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
          "docs": [
            "Position data for YT deposits, linked to vault"
          ],
          "writable": true
        },
        {
          "name": "yieldPosition",
          "docs": [
            "Yield position for the vault robot account"
          ],
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
      "docs": [
        "Strip SY into PT + YT"
      ],
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
          "docs": [
            "This account owns the mints for PT & YT",
            "And owns the robot account with the SY program",
            "Needs to be mutable to be used in deposit_sy CPI"
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "sySrc",
          "docs": [
            "Depositor's SY token account"
          ],
          "writable": true
        },
        {
          "name": "escrowSy",
          "docs": [
            "Temporary account owned by the vault for receiving SY tokens before depositing into the SY Program's escrow account"
          ],
          "writable": true
        },
        {
          "name": "ytDst",
          "docs": [
            "Final destination for receiving YT (probably, but not necessarily, owned by the depositor)"
          ],
          "writable": true
        },
        {
          "name": "ptDst",
          "docs": [
            "Final destination for receiving PT (probably, but not necessarily, owned by the depositor)"
          ],
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
          "name": "tokenProgram"
        },
        {
          "name": "addressLookupTable",
          "docs": [
            "Address lookup table for vault"
          ]
        },
        {
          "name": "syProgram"
        },
        {
          "name": "yieldPosition",
          "docs": [
            "Vault-owned yield position account"
          ],
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
          "docs": [
            "Trader's SY token account",
            "Mint is constrained by TokenProgram"
          ],
          "writable": true
        },
        {
          "name": "tokenPtTrader",
          "docs": [
            "Receiving PT token account",
            "Mint is constrained by TokenProgram"
          ],
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "docs": [
            "Account owned by market",
            "This is a temporary account that receives SY tokens from the user, after which it transfers them to the SY program"
          ],
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "docs": [
            "PT liquidity account"
          ],
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
          "docs": [
            "Vault that manages YT"
          ],
          "writable": true
        },
        {
          "name": "userYieldPosition",
          "docs": [
            "Position data for YT deposits, linked to vault"
          ],
          "writable": true
        },
        {
          "name": "ytDst",
          "docs": [
            "Withdrawer's YT token account"
          ],
          "writable": true
        },
        {
          "name": "escrowYt",
          "docs": [
            "Vault-owned escrow account for YT"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "authority"
        },
        {
          "name": "syProgram",
          "docs": [
            "The SY interface implementation for the vault's token"
          ]
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
      "docs": [
        "Curator-gated actions on a live vault. Every variant here is either a",
        "*pause* (status flags), a *ratchet-down* (interest fee), or a *bookkeeping*",
        "update (treasury target, claim limits). No variant can raise a fee, change",
        "the curve, relax safety limits, or bump `max_py_supply` — those are",
        "immutable post-init (PLAN §6.2 / I-E2)."
      ],
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
      "docs": [
        "Account lists for validating CPI calls to the SY program"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "getSyState",
            "docs": [
              "Fetch SY state"
            ],
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
            "docs": [
              "Deposit SY into personal account owned by vault"
            ],
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
            "docs": [
              "Withdraw SY from personal account owned by vault"
            ],
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
            "docs": [
              "Settle rewards for vault to accounts owned by the vault"
            ],
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
            "docs": [
              "Get personal yield position"
            ],
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
            "docs": [
              "Address-lookup-table index"
            ],
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
            "docs": [
              "The token account for the emission where the vault authority is the authority"
            ],
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
            "docs": [
              "The final index is used to track the last claimable index after the vault expires"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "treasuryTokenAccount",
            "docs": [
              "The treasury token account for this reward"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "The fee taken from emission collecting"
            ],
            "type": "u16"
          },
          {
            "name": "treasuryEmission",
            "docs": [
              "The lambo fund"
            ],
            "type": "u64"
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
            "docs": [
              "Maximum allowed negative change in basis points (10000 = 100%)"
            ],
            "type": "u16"
          },
          {
            "name": "maxNetBalanceChangePositivePercentage",
            "docs": [
              "Maximum allowed positive change in basis points (10000 = 100%)",
              "Using u32 to allow for very large increases (up to ~429,496%)"
            ],
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
      "docs": [
        "Curator-gated actions on a live market. Same rules as AdminAction: only",
        "pauses, ratchet-downs, and bookkeeping. The core curve parameters",
        "(`ln_fee_rate_root`, `rate_scalar_root`) and `max_lp_supply` are frozen at",
        "init and cannot be changed — a curator who wants a different curve must",
        "spin up a new market."
      ],
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
      "docs": [
        "Financial parameters for the market"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "expirationTs",
            "docs": [
              "Expiration timestamp, which is copied from the vault associated with the PT"
            ],
            "type": "u64"
          },
          {
            "name": "ptBalance",
            "docs": [
              "Balance of PT in the market",
              "This amount is tracked separately to prevent bugs from token transfers directly to the market"
            ],
            "type": "u64"
          },
          {
            "name": "syBalance",
            "docs": [
              "Balance of SY in the market",
              "This amount is tracked separately to prevent bugs from token transfers directly to the market"
            ],
            "type": "u64"
          },
          {
            "name": "lnFeeRateRoot",
            "docs": [
              "Initial log of fee rate, which decreases over time"
            ],
            "type": "f64"
          },
          {
            "name": "lastLnImpliedRate",
            "docs": [
              "Last seen log of implied rate (APY) for PT",
              "Used to maintain continuity of the APY between trades over time"
            ],
            "type": "f64"
          },
          {
            "name": "rateScalarRoot",
            "docs": [
              "Initial rate scalar, which increases over time"
            ],
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
            "docs": [
              "Curator authorized to modify this market's mutable settings.",
              "Set at init; replaces the global admin-principle whitelist."
            ],
            "type": "pubkey"
          },
          {
            "name": "creatorFeeBps",
            "docs": [
              "Ceiling committed at init for this market's treasury SY fee.",
              "Bounded by PROTOCOL_FEE_MAX_BPS at creation, immutable after."
            ],
            "type": "u16"
          },
          {
            "name": "reentrancyGuard",
            "docs": [
              "Non-reentrancy latch. Same semantics as Vault.reentrancy_guard."
            ],
            "type": "bool"
          },
          {
            "name": "addressLookupTable",
            "docs": [
              "Address to ALT"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "docs": [
              "Mint of the vault's PT token"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintSy",
            "docs": [
              "Mint of the SY program's SY token"
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Link to yield-stripping vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintLp",
            "docs": [
              "Mint for the market's LP tokens"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenPtEscrow",
            "docs": [
              "Token account that holds PT liquidity"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenSyEscrow",
            "docs": [
              "Pass-through token account for SY moving from the depositor to the SY program"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenFeeTreasurySy",
            "docs": [
              "Token account that holds SY fees from trade_pt"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeTreasurySyBps",
            "docs": [
              "Fee treasury SY BPS"
            ],
            "type": "u16"
          },
          {
            "name": "selfAddress",
            "docs": [
              "Authority for CPI calls owned by the market struct"
            ],
            "type": "pubkey"
          },
          {
            "name": "signerBump",
            "docs": [
              "Bump for signing the PDA"
            ],
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
            "docs": [
              "Link to the SY program ID"
            ],
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
            "docs": [
              "Record of CPI accounts"
            ],
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
            "docs": [
              "Unique seed id for the market"
            ],
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
            "docs": [
              "Curator authorized to modify this vault's mutable settings.",
              "Set at init; replaces the global admin-principle whitelist."
            ],
            "type": "pubkey"
          },
          {
            "name": "creatorFeeBps",
            "docs": [
              "Ceiling committed at init for this vault's interest fee.",
              "Bounded by PROTOCOL_FEE_MAX_BPS at creation, immutable after.",
              "See I-E1 / I-E2 in PLAN.md §3."
            ],
            "type": "u16"
          },
          {
            "name": "reentrancyGuard",
            "docs": [
              "Non-reentrancy latch. Set to true before any untrusted SY CPI and",
              "cleared on the way out. User-facing entrypoints must assert it is",
              "false on entry. See I-C1 in PLAN.md §3."
            ],
            "type": "bool"
          },
          {
            "name": "syProgram",
            "docs": [
              "Link to SY program"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintSy",
            "docs": [
              "Mint for SY token"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintYt",
            "docs": [
              "Mint for the vault-specific YT token"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintPt",
            "docs": [
              "Mint for the vault-specific PT token"
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowYt",
            "docs": [
              "Escrow account for holding deposited YT"
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowSy",
            "docs": [
              "Escrow account that holds temporary SY tokens",
              "As an interchange between users and the SY program"
            ],
            "type": "pubkey"
          },
          {
            "name": "yieldPosition",
            "docs": [
              "Link to a vault-owned YT position",
              "This account collects yield from all \"unstaked\" YT"
            ],
            "type": "pubkey"
          },
          {
            "name": "addressLookupTable",
            "docs": [
              "Address lookup table key for vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "startTs",
            "docs": [
              "start timestamp"
            ],
            "type": "u32"
          },
          {
            "name": "duration",
            "docs": [
              "seconds duration"
            ],
            "type": "u32"
          },
          {
            "name": "signerSeed",
            "docs": [
              "Seed for CPI signing"
            ],
            "type": "pubkey"
          },
          {
            "name": "authority",
            "docs": [
              "Authority for CPI signing"
            ],
            "type": "pubkey"
          },
          {
            "name": "signerBump",
            "docs": [
              "bump for signer authority PDA"
            ],
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "lastSeenSyExchangeRate",
            "docs": [
              "Last seen SY exchange rate",
              "This continues to be updated even after vault maturity to track SY appreciation for treasury collection"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "allTimeHighSyExchangeRate",
            "docs": [
              "This is the all time high exchange rate for SY"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "finalSyExchangeRate",
            "docs": [
              "This is the exchange rate for SY when the vault expires"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "totalSyInEscrow",
            "docs": [
              "How much SY is held in escrow"
            ],
            "type": "u64"
          },
          {
            "name": "syForPt",
            "docs": [
              "The total SY set aside to back the PT holders",
              "This value is updated on every operation that touches the PT supply or the last seen exchange rate"
            ],
            "type": "u64"
          },
          {
            "name": "ptSupply",
            "docs": [
              "Total supply of PT"
            ],
            "type": "u64"
          },
          {
            "name": "treasurySy",
            "docs": [
              "Amount of SY staged for the treasury"
            ],
            "type": "u64"
          },
          {
            "name": "uncollectedSy",
            "docs": [
              "SY that has been earned by YT, but not yet collected"
            ],
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
            "docs": [
              "Link to address that owns this position"
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Link to vault that manages the YT"
            ],
            "type": "pubkey"
          },
          {
            "name": "ytBalance",
            "docs": [
              "Track the YT balance of the user here"
            ],
            "type": "u64"
          },
          {
            "name": "interest",
            "docs": [
              "Tracker for interest earned (paid in SY)"
            ],
            "type": {
              "defined": {
                "name": "yieldTokenTracker"
              }
            }
          },
          {
            "name": "emissions",
            "docs": [
              "Tracker for emissions earned (paid in emission tokens)"
            ],
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
      "docs": [
        "Generic tracker for interest and emissions earned by YT deposits"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastSeenIndex",
            "docs": [
              "The index is the per-share value of the SY token",
              "Note that the YT balance must be converted to the equivalent SY balance"
            ],
            "type": {
              "defined": {
                "name": "number"
              }
            }
          },
          {
            "name": "staged",
            "docs": [
              "Staged tokens that may be withdrawn"
            ],
            "type": "u64"
          }
        ]
      }
    }
  ]
};

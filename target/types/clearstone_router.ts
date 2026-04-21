/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearstone_router.json`.
 */
export type ClearstoneRouter = {
  "address": "DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW",
  "metadata": {
    "name": "clearstoneRouter",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clearstone periphery router: base-asset UX for core. Wraps base↔SY mint/redeem around clearstone_core primitives so users never handle raw SY."
  },
  "instructions": [
    {
      "name": "wrapperBuyPt",
      "docs": [
        "Base → PT via (adapter.mint_sy → core.trade_pt buy).",
        "",
        "Caller specifies the exact PT out they want (`pt_amount`) and",
        "their maximum base spend. The wrapper mints enough SY to cover",
        "and trades SY → PT. Leftover SY stays in the user's SY ATA."
      ],
      "discriminator": [
        6,
        127,
        6,
        136,
        226,
        194,
        250,
        168
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
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
          "name": "market",
          "writable": true
        },
        {
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "ptDst",
          "writable": true
        },
        {
          "name": "marketEscrowSy",
          "writable": true
        },
        {
          "name": "marketEscrowPt",
          "writable": true
        },
        {
          "name": "marketAlt"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "ptAmount",
          "type": "u64"
        },
        {
          "name": "maxBase",
          "type": "u64"
        },
        {
          "name": "maxSyIn",
          "type": "i64"
        }
      ]
    },
    {
      "name": "wrapperBuyYt",
      "docs": [
        "Base → YT via (adapter.mint_sy → core.buy_yt).",
        "`sy_in` is how much SY to spend on YT; `yt_out` is the exact YT",
        "the trader expects. core.buy_yt is a self-CPI cascade so the outer",
        "accounts must include every account `strip` + `trade_pt` touch."
      ],
      "discriminator": [
        94,
        68,
        16,
        91,
        21,
        168,
        222,
        105
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
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
          "name": "market",
          "writable": true
        },
        {
          "name": "sySrc",
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
          "name": "marketEscrowSy",
          "writable": true
        },
        {
          "name": "marketEscrowPt",
          "writable": true
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "marketAlt"
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
          "name": "escrowSyVault",
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
          "name": "vaultAlt"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "baseIn",
          "type": "u64"
        },
        {
          "name": "syIn",
          "type": "u64"
        },
        {
          "name": "ytOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrapperCollectInterest",
      "docs": [
        "collect_interest on vault → adapter.redeem_sy. The interest ix",
        "drops SY into `token_sy_dst`; we then redeem whatever lands there",
        "to base."
      ],
      "discriminator": [
        49,
        225,
        174,
        89,
        185,
        117,
        33,
        68
      ],
      "accounts": [
        {
          "name": "user",
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
          "name": "sySrc",
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
          "name": "treasurySyTokenAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable"
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
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
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
      "name": "wrapperMerge",
      "docs": [
        "PT + YT → base via (core.merge → adapter.redeem_sy)."
      ],
      "discriminator": [
        177,
        36,
        171,
        125,
        89,
        198,
        144,
        219
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
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
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
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
          "name": "tokenProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "amountPy",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrapperProvideLiquidity",
      "docs": [
        "Base + PT → LP via (adapter.mint_sy → core.market_two_deposit_liquidity).",
        "User supplies base (converted to SY inside) + pre-held PT; the two",
        "are deposited pro-rata for LP."
      ],
      "discriminator": [
        143,
        141,
        37,
        135,
        218,
        136,
        82,
        143
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
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
          "name": "market",
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
          "name": "escrowPt",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "lpDst",
          "writable": true
        },
        {
          "name": "mintLp",
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
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "baseIn",
          "type": "u64"
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
          "name": "minLpOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrapperProvideLiquidityBase",
      "docs": [
        "Base → LP via (adapter.mint_sy → core.trade_pt buy → deposit_liquidity).",
        "Exchanges all base for SY, trades `pt_intent` worth of SY for PT,",
        "deposits the resulting PT + remaining SY.  Caller supplies a",
        "slippage bound on the SY-in leg (`max_sy_in` is negative)."
      ],
      "discriminator": [
        27,
        226,
        43,
        92,
        253,
        10,
        154,
        160
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
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
          "name": "market",
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
          "name": "escrowPt",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "lpDst",
          "writable": true
        },
        {
          "name": "mintLp",
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
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "baseIn",
          "type": "u64"
        },
        {
          "name": "ptIntent",
          "type": "u64"
        },
        {
          "name": "maxSyIn",
          "type": "i64"
        },
        {
          "name": "syIntent",
          "type": "u64"
        },
        {
          "name": "minLpOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrapperProvideLiquidityClassic",
      "docs": [
        "PT + SY → LP passthrough. Spares the caller the Anchor-IDL gymnastics",
        "of building the DepositLiquidity accounts list when they're already",
        "holding SY directly."
      ],
      "discriminator": [
        40,
        95,
        127,
        3,
        238,
        166,
        12,
        160
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
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
          "name": "market",
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
          "name": "escrowPt",
          "writable": true
        },
        {
          "name": "escrowSy",
          "writable": true
        },
        {
          "name": "lpDst",
          "writable": true
        },
        {
          "name": "mintLp",
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
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
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
      ]
    },
    {
      "name": "wrapperSellPt",
      "docs": [
        "PT → base via (core.trade_pt sell → adapter.redeem_sy).",
        "`pt_amount` is the PT the trader is selling (positive). The",
        "resulting SY lands in the user's SY ATA and is immediately",
        "redeemed to base. `min_sy_out` gates the trade_pt slippage (SY",
        "enters the user, so it's positive)."
      ],
      "discriminator": [
        127,
        65,
        108,
        12,
        72,
        21,
        50,
        200
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "ptSrc",
          "writable": true
        },
        {
          "name": "marketEscrowSy",
          "writable": true
        },
        {
          "name": "marketEscrowPt",
          "writable": true
        },
        {
          "name": "marketAlt"
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
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
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "ptAmount",
          "type": "u64"
        },
        {
          "name": "minSyOut",
          "type": "i64"
        }
      ]
    },
    {
      "name": "wrapperSellYt",
      "docs": [
        "YT → base via (core.sell_yt → adapter.redeem_sy). `yt_in` is what",
        "the user is selling; `min_sy_out` is the slippage floor."
      ],
      "discriminator": [
        146,
        253,
        101,
        113,
        98,
        94,
        193,
        149
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
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
          "name": "sySrc",
          "writable": true
        },
        {
          "name": "marketEscrowSy",
          "writable": true
        },
        {
          "name": "marketEscrowPt",
          "writable": true
        },
        {
          "name": "marketAlt"
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "writable": true
        },
        {
          "name": "escrowSyVault",
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
          "name": "vaultAlt"
        },
        {
          "name": "yieldPosition",
          "writable": true
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
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
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
      ]
    },
    {
      "name": "wrapperStrip",
      "docs": [
        "Base → PT + YT via (adapter.mint_sy → core.strip)."
      ],
      "discriminator": [
        59,
        87,
        87,
        160,
        141,
        112,
        198,
        132
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
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
          "name": "tokenProgram"
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "yieldPosition",
          "writable": true
        },
        {
          "name": "coreEventAuthority"
        }
      ],
      "args": [
        {
          "name": "amountBase",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrapperWithdrawLiquidity",
      "docs": [
        "LP → base + PT. Withdraws liquidity, then redeems the SY leg",
        "to base. PT is returned to the user."
      ],
      "discriminator": [
        239,
        203,
        52,
        75,
        39,
        22,
        70,
        209
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "ptDst",
          "writable": true
        },
        {
          "name": "sySrc",
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
          "name": "lpSrc",
          "writable": true
        },
        {
          "name": "mintLp",
          "writable": true
        },
        {
          "name": "addressLookupTable"
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
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
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
      ]
    },
    {
      "name": "wrapperWithdrawLiquidityClassic",
      "docs": [
        "LP → PT + SY passthrough. Same call as core.market_two_withdraw_liquidity",
        "but signed through the router (useful when paired with other",
        "router-only ops in a batch)."
      ],
      "discriminator": [
        6,
        139,
        182,
        200,
        96,
        200,
        106,
        2
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "ptDst",
          "writable": true
        },
        {
          "name": "sySrc",
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
          "name": "lpSrc",
          "writable": true
        },
        {
          "name": "mintLp",
          "writable": true
        },
        {
          "name": "addressLookupTable"
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
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "baseDst",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "coreProgram"
        },
        {
          "name": "coreEventAuthority"
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
      ]
    }
  ],
  "accounts": [
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
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "missingReturnData",
      "msg": "Missing return data from inner CPI"
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
    }
  ]
};

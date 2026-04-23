/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearstone_fusion.json`.
 */
export type ClearstoneFusion = {
  "address": "9ShSnLUcWeg5BZzokj8mdo9cNHARCKa42kwmqSdBNM6J",
  "metadata": {
    "name": "clearstoneFusion",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clearstone Fusion — Solana intent settlement (fork of 1inch solana-fusion-protocol)"
  },
  "instructions": [
    {
      "name": "cancel",
      "docs": [
        "Maker explicitly voids an outstanding order on-chain. Initializes",
        "(or updates) `OrderState` with `canceled = true` so resolvers can",
        "observe cancellation authoritatively instead of relying on stale",
        "off-chain state."
      ],
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "maker",
          "writable": true,
          "signer": true
        },
        {
          "name": "srcMint"
        },
        {
          "name": "dstMint"
        },
        {
          "name": "makerReceiver"
        },
        {
          "name": "protocolDstAcc",
          "optional": true
        },
        {
          "name": "integratorDstAcc",
          "optional": true
        },
        {
          "name": "orderState",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "order",
          "type": {
            "defined": {
              "name": "orderConfig"
            }
          }
        }
      ]
    },
    {
      "name": "cleanExpired",
      "docs": [
        "Permissionless sweep: close an expired `OrderState` PDA and send",
        "the rent lamports to the caller. Works for any expired order, whether",
        "partially filled, fully filled, or canceled."
      ],
      "discriminator": [
        142,
        209,
        17,
        163,
        184,
        95,
        114,
        156
      ],
      "accounts": [
        {
          "name": "cleaner",
          "writable": true,
          "signer": true
        },
        {
          "name": "maker"
        },
        {
          "name": "orderState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "maker"
              },
              {
                "kind": "arg",
                "path": "orderHash"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "orderHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "fill",
      "docs": [
        "Resolver fills (partially or fully) a maker-signed order.",
        "",
        "Requires the preceding instruction to be a native Ed25519 verify",
        "over `(maker_pubkey, order_hash)`. Pulls src tokens from the",
        "maker's ATA via the program's delegate PDA; the maker must have",
        "previously called SPL Token `Approve` granting the delegate PDA",
        "sufficient allowance."
      ],
      "discriminator": [
        168,
        96,
        183,
        163,
        92,
        10,
        40,
        160
      ],
      "accounts": [
        {
          "name": "taker",
          "docs": [
            "Resolver / taker, authorized by the order's `resolver_policy`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "maker",
          "docs": [
            "over `order_hash`, which binds this pubkey to the order."
          ],
          "writable": true
        },
        {
          "name": "makerReceiver",
          "writable": true
        },
        {
          "name": "srcMint"
        },
        {
          "name": "dstMint"
        },
        {
          "name": "makerSrcAta",
          "docs": [
            "Maker's ATA of `src_mint` — tokens are pulled from here via the",
            "program's delegate PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "maker"
              },
              {
                "kind": "account",
                "path": "srcTokenProgram"
              },
              {
                "kind": "account",
                "path": "srcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "takerSrcAta",
          "docs": [
            "Taker's ATA of `src_mint`."
          ],
          "writable": true
        },
        {
          "name": "makerDstAta",
          "docs": [
            "Maker receiver's ATA of `dst_mint`; created if missing."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "makerReceiver"
              },
              {
                "kind": "account",
                "path": "dstTokenProgram"
              },
              {
                "kind": "account",
                "path": "dstMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "takerDstAta",
          "docs": [
            "Taker's ATA of `dst_mint`."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "taker"
              },
              {
                "kind": "account",
                "path": "dstTokenProgram"
              },
              {
                "kind": "account",
                "path": "dstMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "protocolDstAcc",
          "writable": true,
          "optional": true
        },
        {
          "name": "integratorDstAcc",
          "writable": true,
          "optional": true
        },
        {
          "name": "orderState",
          "docs": [
            "Per-order state. Initialized on first fill; taker pays rent."
          ],
          "writable": true
        },
        {
          "name": "delegateAuthority",
          "docs": [
            "Program's delegate PDA; signs the `TransferChecked` that pulls the",
            "maker's src tokens. The maker must have previously `Approve`d this",
            "PDA on `maker_src_ata`."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "srcTokenProgram"
        },
        {
          "name": "dstTokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "order",
          "type": {
            "defined": {
              "name": "orderConfig"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "merkleProof",
          "type": {
            "option": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "orderState",
      "discriminator": [
        60,
        123,
        67,
        162,
        96,
        43,
        173,
        225
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6001,
      "name": "missingMakerDstAta",
      "msg": "Missing maker dst ata"
    },
    {
      "code": 6002,
      "name": "orderExpired",
      "msg": "Order expired"
    },
    {
      "code": 6003,
      "name": "invalidEstimatedTakingAmount",
      "msg": "Invalid estimated taking amount"
    },
    {
      "code": 6004,
      "name": "invalidProtocolSurplusFee",
      "msg": "Protocol surplus fee too high"
    },
    {
      "code": 6005,
      "name": "inconsistentProtocolFeeConfig",
      "msg": "Inconsistent protocol fee config"
    },
    {
      "code": 6006,
      "name": "inconsistentIntegratorFeeConfig",
      "msg": "Inconsistent integrator fee config"
    },
    {
      "code": 6007,
      "name": "orderNotExpired",
      "msg": "Order not expired"
    },
    {
      "code": 6008,
      "name": "missingTakerDstAta",
      "msg": "Missing taker dst ata"
    },
    {
      "code": 6009,
      "name": "unauthorizedResolver",
      "msg": "Caller is not authorized by the order's resolver policy"
    },
    {
      "code": 6010,
      "name": "allowedListTooLong",
      "msg": "AllowedList exceeds the maximum inline size"
    },
    {
      "code": 6011,
      "name": "missingMerkleProof",
      "msg": "Merkle proof is required for MerkleRoot policy but was not provided"
    },
    {
      "code": 6012,
      "name": "unexpectedMerkleProof",
      "msg": "Merkle proof was provided for a policy that does not accept one"
    },
    {
      "code": 6013,
      "name": "merkleProofTooDeep",
      "msg": "Merkle proof exceeds the maximum allowed depth"
    },
    {
      "code": 6014,
      "name": "invalidMerkleProof",
      "msg": "Merkle proof does not verify against the order's root"
    },
    {
      "code": 6015,
      "name": "orderCanceled",
      "msg": "Order has been canceled by the maker"
    },
    {
      "code": 6016,
      "name": "orderFullyFilled",
      "msg": "Order has already been fully filled"
    },
    {
      "code": 6017,
      "name": "missingSignatureInstruction",
      "msg": "Preceding Ed25519 signature verification instruction is missing"
    },
    {
      "code": 6018,
      "name": "invalidSignatureInstruction",
      "msg": "Preceding instruction is not an Ed25519 signature verification"
    },
    {
      "code": 6019,
      "name": "malformedSignatureInstruction",
      "msg": "Ed25519 signature verification instruction is malformed"
    },
    {
      "code": 6020,
      "name": "signerMismatch",
      "msg": "Signed pubkey does not match the declared maker"
    },
    {
      "code": 6021,
      "name": "messageMismatch",
      "msg": "Signed message does not match the expected order hash"
    }
  ],
  "types": [
    {
      "name": "auctionData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startTime",
            "type": "u32"
          },
          {
            "name": "duration",
            "type": "u32"
          },
          {
            "name": "initialRateBump",
            "type": "u16"
          },
          {
            "name": "pointsAndTimeDeltas",
            "type": {
              "vec": {
                "defined": {
                  "name": "pointAndTimeDelta"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "feeConfig",
      "docs": [
        "Configuration for fees applied to an order."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "protocolFee",
            "type": "u16"
          },
          {
            "name": "integratorFee",
            "type": "u16"
          },
          {
            "name": "surplusPercentage",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "orderConfig",
      "docs": [
        "Off-chain-signed order submitted by the maker.",
        "",
        "`src_asset_is_native` is intentionally absent: the pull-settlement model",
        "relies on SPL Token `Approve`, which native SOL doesn't support — sellers",
        "of SOL must wrap to wSOL before signing an order."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "srcAmount",
            "type": "u64"
          },
          {
            "name": "minDstAmount",
            "type": "u64"
          },
          {
            "name": "estimatedDstAmount",
            "type": "u64"
          },
          {
            "name": "expirationTime",
            "type": "u32"
          },
          {
            "name": "dstAssetIsNative",
            "type": "bool"
          },
          {
            "name": "fee",
            "type": {
              "defined": {
                "name": "feeConfig"
              }
            }
          },
          {
            "name": "dutchAuctionData",
            "type": {
              "defined": {
                "name": "auctionData"
              }
            }
          },
          {
            "name": "resolverPolicy",
            "type": {
              "defined": {
                "name": "resolverPolicy"
              }
            }
          }
        ]
      }
    },
    {
      "name": "orderState",
      "docs": [
        "Per-order on-chain state tracking partial fills and cancellation.",
        "",
        "Initialized lazily by the first `fill` (or by `cancel`) at the PDA",
        "`[\"order\", maker, order_hash]`. Rent paid by the initializer.",
        "",
        "The account stays alive until `clean_expired` sweeps it post-expiration;",
        "keeping it alive until then is what guarantees replay protection for",
        "fully-filled orders."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "filledAmount",
            "docs": [
              "Cumulative amount of `src_mint` pulled from the maker so far."
            ],
            "type": "u64"
          },
          {
            "name": "expirationTime",
            "docs": [
              "Copied from the signed order on first init; kept here so `clean_expired`",
              "can verify expiration without re-deriving `order_hash`."
            ],
            "type": "u32"
          },
          {
            "name": "canceled",
            "docs": [
              "Maker explicitly canceled this order on-chain."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pointAndTimeDelta",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rateBump",
            "type": "u16"
          },
          {
            "name": "timeDelta",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "resolverPolicy",
      "docs": [
        "Per-order maker-signed resolver policy."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "allowedList",
            "fields": [
              {
                "vec": "pubkey"
              }
            ]
          },
          {
            "name": "merkleRoot",
            "fields": [
              {
                "array": [
                  "u8",
                  32
                ]
              }
            ]
          }
        ]
      }
    }
  ]
};

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/mock_flash_callback.json`.
 */
export type MockFlashCallback = {
  "address": "9AduMJSRv79G5UBrj3WZCK1KzpzmZ4zAKV4Mud4Z4hvF",
  "metadata": {
    "name": "mockFlashCallback",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Test-only callback program for core.flash_swap_pt. Configurable per-invocation behavior to exercise happy/short-repay/nested-flash/no-op paths without needing fusion deployed."
  },
  "instructions": [
    {
      "name": "onFlashPtReceived",
      "discriminator": [
        206,
        129,
        57,
        212,
        98,
        189,
        226,
        67
      ],
      "accounts": [
        {
          "name": "market"
        },
        {
          "name": "callerPtDst",
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "solver",
          "signer": true
        },
        {
          "name": "coreTokenProgram"
        },
        {
          "name": "solverSySrc",
          "docs": [
            "Solver's own SY ATA — pre-funded by the test harness to cover the repay."
          ],
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "writable": true
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "mintPt",
          "docs": [
            "the M-FLASH-1.5 hardening that added `mint_pt` to FlashSwapPt accounts)."
          ]
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "selfProgram"
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
          "name": "ptReceived",
          "type": "u64"
        },
        {
          "name": "syRequired",
          "type": "u64"
        },
        {
          "name": "data",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "onFlashSellYtReceived",
      "docs": [
        "Mirror of `on_flash_sy_received` for the sell-YT direction. Core's",
        "`flash_sell_yt` has already advanced `sy_received` SY to the solver",
        "(in `caller_sy_dst`) and now expects the callback to populate",
        "`caller_yt_dst` with at least `yt_required` YT. In production the",
        "callback runs fusion.fill (maker.YT → solver, solver.SY → maker);",
        "the mock simply transfers from a pre-funded `solver_yt_src` ATA."
      ],
      "discriminator": [
        73,
        66,
        24,
        164,
        149,
        35,
        51,
        85
      ],
      "accounts": [
        {
          "name": "market"
        },
        {
          "name": "callerSyDst",
          "docs": [
            "Solver's SY ATA — pre-loaded with `sy_received` SY. In production",
            "the callback drains it via fusion.fill; the mock leaves it alone."
          ],
          "writable": true
        },
        {
          "name": "callerYtDst",
          "docs": [
            "Solver's YT ATA — must be topped up by ≥ `yt_required` before",
            "returning. The mock transfers from `solver_yt_src` below."
          ],
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "solver",
          "signer": true
        },
        {
          "name": "coreTokenProgram"
        },
        {
          "name": "solverYtSrc",
          "docs": [
            "Solver's pre-funded YT inventory ATA — drained on MODE_OK to",
            "land yt_required YT in caller_yt_dst."
          ],
          "writable": true
        },
        {
          "name": "mintYt",
          "docs": [
            "YT mint — needed for transfer_checked decimals."
          ]
        }
      ],
      "args": [
        {
          "name": "syReceived",
          "type": "u64"
        },
        {
          "name": "ytRequired",
          "type": "u64"
        },
        {
          "name": "data",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "onFlashSyReceived",
      "docs": [
        "Mirror of `on_flash_pt_received` for the sell-PT direction. Core's",
        "`flash_swap_sy` has already given the solver `sy_received` SY; the",
        "callback must deposit `pt_required` PT into `token_pt_escrow` before",
        "returning. Mode byte semantics match the buy-side variant."
      ],
      "discriminator": [
        74,
        114,
        47,
        202,
        95,
        144,
        119,
        42
      ],
      "accounts": [
        {
          "name": "market"
        },
        {
          "name": "callerSyDst",
          "docs": [
            "Solver's SY ATA where the flash-borrowed SY landed."
          ],
          "writable": true
        },
        {
          "name": "tokenPtEscrow",
          "docs": [
            "Market's PT escrow — the callback must deposit `pt_required` here."
          ],
          "writable": true
        },
        {
          "name": "mintSy"
        },
        {
          "name": "solver",
          "signer": true
        },
        {
          "name": "coreTokenProgram"
        },
        {
          "name": "solverPtSrc",
          "docs": [
            "Solver's own PT ATA — pre-funded by the test harness to cover the repay."
          ],
          "writable": true
        },
        {
          "name": "mintPt",
          "docs": [
            "PT mint — needed for transfer_checked decimals."
          ]
        },
        {
          "name": "tokenSyEscrow",
          "writable": true
        },
        {
          "name": "tokenFeeTreasurySy",
          "writable": true
        },
        {
          "name": "addressLookupTable"
        },
        {
          "name": "syProgram"
        },
        {
          "name": "selfProgram"
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
          "name": "syReceived",
          "type": "u64"
        },
        {
          "name": "ptRequired",
          "type": "u64"
        },
        {
          "name": "data",
          "type": "bytes"
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "missingModeByte",
      "msg": "callback_data must start with a mode byte (0..=3)"
    },
    {
      "code": 6001,
      "name": "unknownMode",
      "msg": "Mode byte out of range"
    }
  ]
};

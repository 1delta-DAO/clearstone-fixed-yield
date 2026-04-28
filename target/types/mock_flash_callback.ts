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

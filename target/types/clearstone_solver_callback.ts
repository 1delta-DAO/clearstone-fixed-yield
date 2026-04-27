/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearstone_solver_callback.json`.
 */
export type ClearstoneSolverCallback = {
  "address": "27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP",
  "metadata": {
    "name": "clearstoneSolverCallback",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Reference callback program for clearstone_core.flash_swap_pt. Settles a clearstone-fusion order atomically against the flash-borrowed PT."
  },
  "instructions": [
    {
      "name": "onFlashPtReceived",
      "docs": [
        "Invoked by `clearstone_core.flash_swap_pt` after it has sent `pt_out` PT",
        "to the solver's PT ATA. Handler must ensure `token_sy_escrow.amount`",
        "grows by at least `sy_required` before returning — core enforces this",
        "on its side via I-F2.",
        "",
        "`data` is a borsh-encoded `CallbackPayload` (see below)."
      ],
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
          "docs": [
            "Solver's PT ATA. Core just deposited `pt_received` PT here.",
            "Fusion.fill will move it to maker's PT ATA."
          ],
          "writable": true
        },
        {
          "name": "tokenSyEscrow",
          "docs": [
            "Market's SY escrow. Callback must top it up by `sy_required`."
          ],
          "writable": true
        },
        {
          "name": "mintSy",
          "docs": [
            "SY mint — used for `transfer_checked`."
          ]
        },
        {
          "name": "caller",
          "docs": [
            "Solver signs the outer tx; their signature is propagated here via CPI."
          ],
          "signer": true
        },
        {
          "name": "coreTokenProgram",
          "docs": [
            "Token program for the SY-escrow repay leg."
          ]
        },
        {
          "name": "fusionProgram"
        },
        {
          "name": "maker"
        },
        {
          "name": "makerReceiver",
          "writable": true
        },
        {
          "name": "makerSrcAta",
          "writable": true
        },
        {
          "name": "takerSrcAta",
          "docs": [
            "Solver's src ATA. Fusion will credit it by the pulled amount.",
            "This is where we pull our SY repayment from at the end."
          ],
          "writable": true
        },
        {
          "name": "makerDstAta",
          "writable": true
        },
        {
          "name": "srcMint"
        },
        {
          "name": "dstMint"
        },
        {
          "name": "srcTokenProgram"
        },
        {
          "name": "dstTokenProgram"
        },
        {
          "name": "delegateAuthority"
        },
        {
          "name": "orderState",
          "writable": true
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
          "name": "systemProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "instructionsSysvar"
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
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "malformedPayload",
      "msg": "callback_data could not be borsh-decoded as CallbackPayload"
    },
    {
      "code": 6001,
      "name": "unsupportedSrcMint",
      "msg": "Reference callback only supports orders where src_mint == market.mint_sy"
    },
    {
      "code": 6002,
      "name": "insufficientPulledSrc",
      "msg": "fusion.fill pulled less src than sy_required — order underfills the flash"
    }
  ]
};

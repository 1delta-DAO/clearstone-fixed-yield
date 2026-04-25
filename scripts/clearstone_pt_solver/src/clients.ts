// Anchor + web3 clients used across the solver.

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import type { ClearstoneFusion } from "./clearstone_fusion.js";
import { loadFusionProgram } from "./fusion.js";

export interface SolverClients {
  connection: Connection;
  solver: Keypair;
  provider: anchor.AnchorProvider;
  /** Core + adapter loaded via on-chain IDL fetch — they change less often
   * than fusion (which we vendor for typed OrderConfig). */
  clearstoneCore: anchor.Program;
  kaminoSyAdapter: anchor.Program;
  fusion: anchor.Program<ClearstoneFusion>;
  fusionProgramId: PublicKey;
  /** Reference callback program id — solver passes this to core.flash_swap_pt. */
  callbackProgramId: PublicKey;
}

/** Program ids (mainnet-ish). Override via env for localnet / devnet. */
const CORE_ID = new PublicKey(
  process.env.CORE_PROGRAM ?? "DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW"
);
const KAMINO_SY_ID = new PublicKey(
  process.env.KAMINO_SY_PROGRAM ?? "29tisXppYM4NcAEJfzMe1aqyuf2M7w9StTtiXBHxTKxd"
);
const FUSION_ID = new PublicKey(
  process.env.FUSION_PROGRAM ?? "9ShSnLUcWeg5BZzokj8mdo9cNHARCKa42kwmqSdBNM6J"
);
const CALLBACK_ID = new PublicKey(
  process.env.CALLBACK_PROGRAM ?? "27UhEF34wbyPdZw4nnAFUREU5LHMFs55PethnhJ6yNCP"
);

export async function loadClients(args: {
  connection: Connection;
  solver: Keypair;
}): Promise<SolverClients> {
  const { connection, solver } = args;
  const wallet = new anchor.Wallet(solver);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const coreIdl = await fetchIdlOrThrow(provider, CORE_ID, "clearstone_core");
  const adapterIdl = await fetchIdlOrThrow(provider, KAMINO_SY_ID, "kamino_sy_adapter");

  return {
    connection,
    solver,
    provider,
    clearstoneCore: new anchor.Program(coreIdl, provider),
    kaminoSyAdapter: new anchor.Program(adapterIdl, provider),
    fusion: loadFusionProgram(provider),
    fusionProgramId: FUSION_ID,
    callbackProgramId: CALLBACK_ID,
  };
}

async function fetchIdlOrThrow(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  name: string
): Promise<anchor.Idl> {
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) {
    throw new Error(
      `No on-chain IDL published for ${name} (${programId.toBase58()}). ` +
        `Either publish the IDL via 'anchor idl init' or vendor a JSON at target/idl/${name}.json.`
    );
  }
  return idl as anchor.Idl;
}

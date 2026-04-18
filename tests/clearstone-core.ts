import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ClearstoneCore } from "../target/types/clearstone_core";

describe("clearstone-core", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.clearstoneCore as Program<ClearstoneCore>;

  it("", async () => {
    return true;
  });
});

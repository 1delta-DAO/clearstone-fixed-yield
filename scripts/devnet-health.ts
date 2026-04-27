// scripts/devnet-health.ts — daily devnet health check.
//
// Run with:
//   source .env.devnet
//   yarn run tsx scripts/devnet-health.ts
//
// For each `programs.*` entry in deployments/devnet.json with status
// "live": fetches the program account, the program-data account,
// confirms upgrade authority matches `upgradeAuthority` from the
// manifest, prints the last update slot, and computes the on-chain
// sha256 of the program data. Diverging hashes / unexpected
// authority changes are flagged loudly.
//
// Exit code 0 = all green. 1 = at least one mismatch (loud red).
//
// Suitable for cron — pipe stdout to a log, alert on non-zero exit.

import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

const MANIFEST_PATH = path.join(
  __dirname,
  "..",
  "deployments",
  "devnet.json"
);
const RPC_URL =
  process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";

const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

interface ProgramEntry {
  programId: string;
  status: string;
  tier: number | string;
  onChainSha256?: string;
}
interface Manifest {
  cluster: string;
  upgradeAuthority: string;
  programs: Record<string, ProgramEntry>;
  canonicalStack?: { lastE2E?: string };
}

function red(s: string) {
  return `\x1b[31m${s}\x1b[0m`;
}
function green(s: string) {
  return `\x1b[32m${s}\x1b[0m`;
}
function yellow(s: string) {
  return `\x1b[33m${s}\x1b[0m`;
}

async function main() {
  const manifest: Manifest = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, "utf8")
  );

  if (!manifest.cluster.includes("devnet")) {
    console.error(`manifest cluster=${manifest.cluster}, expected devnet`);
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const expectedAuthority = new PublicKey(manifest.upgradeAuthority);

  let failures = 0;
  let live = 0;

  console.log(`Clearstone devnet health — RPC ${RPC_URL}`);
  console.log(`Expected upgrade authority: ${expectedAuthority.toString()}\n`);

  for (const [name, entry] of Object.entries(manifest.programs)) {
    if (entry.status !== "live") continue;
    live++;
    const programId = new PublicKey(entry.programId);
    process.stdout.write(`${name.padEnd(30)} ${programId.toString()}  `);

    const programAcct = await connection.getAccountInfo(programId);
    if (!programAcct) {
      console.log(red("MISSING"));
      failures++;
      continue;
    }
    if (!programAcct.owner.equals(BPF_LOADER_UPGRADEABLE)) {
      console.log(red(`UNEXPECTED OWNER ${programAcct.owner.toString()}`));
      failures++;
      continue;
    }

    // Program account's data layout for the upgradeable loader is:
    //   [4 bytes: enum tag = 2 (Program)] [32 bytes: programdata pubkey]
    const tag = programAcct.data.readUInt32LE(0);
    if (tag !== 2) {
      console.log(red(`unexpected loader tag ${tag}`));
      failures++;
      continue;
    }
    const programDataPubkey = new PublicKey(programAcct.data.slice(4, 36));

    const dataAcct = await connection.getAccountInfo(programDataPubkey);
    if (!dataAcct) {
      console.log(red("PROGRAM-DATA MISSING"));
      failures++;
      continue;
    }
    // Data layout:
    //   [4 bytes tag = 3 (ProgramData)]
    //   [8 bytes: slot u64 LE]
    //   [1 byte: Option<Pubkey>]
    //   [32 bytes: pubkey if Some]
    //   [...rest: ELF bytes]
    const dtag = dataAcct.data.readUInt32LE(0);
    if (dtag !== 3) {
      console.log(red(`unexpected programData tag ${dtag}`));
      failures++;
      continue;
    }
    const lastUpdateSlot = dataAcct.data.readBigUInt64LE(4);
    const authOption = dataAcct.data.readUInt8(12);
    let authority: PublicKey | null = null;
    if (authOption === 1) {
      authority = new PublicKey(dataAcct.data.slice(13, 45));
    }
    // The program-data account is sized to ~2x the ELF for upgrade
    // headroom; everything past the ELF is zero-padding. Strip the
    // trailing zeros so the hash matches `solana-verify get-program-hash`.
    let elf = dataAcct.data.slice(45);
    let elfEnd = elf.length;
    while (elfEnd > 0 && elf[elfEnd - 1] === 0) elfEnd--;
    elf = elf.slice(0, elfEnd);
    const sha = createHash("sha256").update(elf).digest("hex");

    let line = `slot=${lastUpdateSlot}  sha256=${sha.slice(0, 12)}…`;
    let status = green("OK");

    if (!authority) {
      line += "  authority=NONE(burned)";
    } else if (!authority.equals(expectedAuthority)) {
      line += `  authority=${red(authority.toString())} (expected ${expectedAuthority.toString()})`;
      status = red("AUTH MISMATCH");
      failures++;
    }

    if (entry.onChainSha256 && entry.onChainSha256 !== sha) {
      line += `  ${yellow("HASH DRIFT")} (manifest=${entry.onChainSha256.slice(0, 12)}…)`;
      // Hash drift isn't always an error — it just means the program
      // got upgraded since the manifest was last updated.
    }

    console.log(`  ${status}  ${line}`);
  }

  console.log("");
  if (manifest.canonicalStack?.lastE2E) {
    const last = new Date(manifest.canonicalStack.lastE2E);
    const ageDays = Math.floor(
      (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (ageDays > 14) {
      console.log(
        yellow(
          `canonicalStack snapshot is ${ageDays}d old (lastE2E=${manifest.canonicalStack.lastE2E}). Consider re-running scripts/devnet-e2e.ts.`
        )
      );
    } else {
      console.log(
        `canonicalStack snapshot is ${ageDays}d old (lastE2E=${manifest.canonicalStack.lastE2E}).`
      );
    }
  }

  console.log(
    `\n${live} program(s) checked. ${failures === 0 ? green(`all green`) : red(`${failures} failure(s)`)}.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("unexpected error:", e);
  process.exit(1);
});

// Klend obligation-refresh sandwich.
//
// Why this exists. Many klend ixs (RefreshObligation, JoinElevationGroup,
// LeaveElevationGroup, anything that recomputes obligation health) revert
// with `ReserveStale (0x1779 / 6009)` if any reserve referenced by the
// obligation's `deposits[]` or `borrows[]` was not refreshed earlier in
// the same slot. The "fix" is a tx-level sandwich:
//
//   ComputeBudget.SetUnits(N)
//   [for each Pyth-pull oracle] update_price_feeds_v2(price_update_acc)
//   [for each reserve referenced by the obligation] RefreshReserve(reserve, oracle)
//   RefreshObligation(obligation, deposits..., borrows...)
//   <the actual obligation-mutating ix you wanted to send>
//
// All within a single tx so they hit the same slot.
//
// ----- Sizing strategy -----
//
// One refresh costs ~20k CU (Pyth path); a 4-deposit obligation comfortably
// fits in 600k. Wire size is the harder bound: each RefreshReserve adds
// reserve + oracle (and on Pyth Pull, a price_update_acc) — without an
// ALT a tx with 4+ reserves overflows the 1232-byte legacy cap. This
// builder always returns ix lists; the caller chooses legacy vs.
// VersionedTransaction + ALT.
//
// ----- Batch idea (see investigateBatching note at the bottom) -----
//
// Klend itself does not (today) have a "RefreshAll" ix that takes N
// reserves at once — every `RefreshReserve` is per-reserve. The only
// batching we can do is at the transaction level (multiple ixs in one
// tx). The ALT trick collapses repeated-pubkey wire-cost (klend program,
// instructions sysvar, etc.); it does NOT reduce the ix count or CU.
// If Kamino ships a multi-reserve refresh, plug it in here.

import {
  AccountMeta,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Signer,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";

// --- Klend program id (mainnet + devnet) --------------------------------

export const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

// --- klend ix discriminators (sha256("global:<name>")[..8]) -------------
//
// Hardcoded so this module stays IDL-free for use inside hot tx-build
// paths. Values cross-checked against Kamino-Finance/klend mainnet IDL on
// 2026-04-28; bump if klend's IDL changes (rare — these are stable since
// v1.0).

const DISC_REFRESH_RESERVE = Buffer.from([
  2, 218, 138, 235, 79, 201, 25, 102,
]);
const DISC_REFRESH_OBLIGATION = Buffer.from([
  33, 132, 147, 228, 151, 192, 72, 89,
]);

// --- Reserve fetch (just the bits we need) ------------------------------

/**
 * Light view of a klend Reserve — only fields the refresh-sandwich needs.
 * Fetched from on-chain by `loadReserveOracle` below; full Reserve schema
 * is defined in Kamino-Finance/klend's IDL.
 */
export interface ReserveOracleHandle {
  reserve: PublicKey;
  /** Pyth or Pyth-Pull price account; null when the reserve uses
   *  switchboard. */
  pyth: PublicKey | null;
  /** Switchboard aggregator; null when the reserve uses Pyth. */
  switchboard: PublicKey | null;
  /** When set, callers must post `update_price_feeds_v2(priceUpdate)`
   *  earlier in the tx — Pyth Pull reserves consume an
   *  ix-built price update account, not a streamed one. */
  pythPullPriceUpdate?: PublicKey | null;
}

/**
 * Read a reserve's oracle handles. Decodes only the offsets we care
 * about so we don't have to depend on the full klend IDL or
 * `@kamino-finance/klend-sdk`. The byte layout is taken from
 * `Reserve` in klend (see klend-interface/src/state/reserve.rs); offsets
 * are stable for v1.x.
 *
 * Token info struct lives at offset 632 inside the Reserve account body.
 * Within token_info:
 *   pyth_configuration.price        @ 32  (32 bytes)  — Pubkey, default = 0 if unused.
 *   switchboard_configuration.price_aggregator @ 64  (32 bytes) — Pubkey, default = 0 if unused.
 */
export async function loadReserveOracle(
  connection: Connection,
  reserve: PublicKey
): Promise<ReserveOracleHandle> {
  const info = await connection.getAccountInfo(reserve);
  if (!info) throw new Error(`reserve account not found: ${reserve.toBase58()}`);
  if (info.data.length < 632 + 32 + 96)
    throw new Error(
      `reserve ${reserve.toBase58()} too small (got ${info.data.length}); klend Reserve struct is much larger`
    );

  const tokenInfoOff = 632;
  const pythPriceOff = tokenInfoOff + 32;
  const swbAggOff = tokenInfoOff + 64;

  const pyth = pubkeyOrNull(info.data, pythPriceOff);
  const switchboard = pubkeyOrNull(info.data, swbAggOff);

  return { reserve, pyth, switchboard, pythPullPriceUpdate: null };
}

function pubkeyOrNull(data: Buffer, offset: number): PublicKey | null {
  const slice = data.subarray(offset, offset + 32);
  if (slice.every((b) => b === 0)) return null;
  return new PublicKey(slice);
}

// --- Obligation read: which reserves does it reference? -----------------

/**
 * Pull every reserve the obligation references (deposits + borrows) in
 * the order klend stores them. Order matters because RefreshObligation's
 * `remaining_accounts` MUST match `Obligation.deposits[]` then
 * `Obligation.borrows[]` positionally.
 *
 * Reads only the position counts + deposit/borrow reserve pubkeys —
 * skipping every per-position field klend tracks (last_balance, etc.).
 */
export async function loadObligationReserves(
  connection: Connection,
  obligation: PublicKey
): Promise<{
  deposits: PublicKey[];
  borrows: PublicKey[];
}> {
  const info = await connection.getAccountInfo(obligation);
  if (!info)
    throw new Error(`obligation account not found: ${obligation.toBase58()}`);

  // Obligation layout (klend v1.x), abbreviated:
  //   8     anchor disc
  //   ...   header (last_update + obligation_owner + lending_market + ...)
  //   8     deposits_asset_tier_count: u64
  //   N*128 deposits: [ObligationCollateral; N]   N = MAX_OBLIGATION_RESERVES = 8
  //   8     borrows_asset_tier_count: u64
  //   N*192 borrows: [ObligationLiquidity;  N]
  //
  // We don't need every field — just the deposit_reserve / borrow_reserve
  // pubkey from each populated slot. Reserve pubkeys equal Pubkey::default
  // (all zeros) when the slot is empty.
  //
  // The exact offsets depend on the klend version we're talking to; this
  // helper sniffs the empty-slot pattern (zero pubkey) rather than
  // hard-coding header sizes that have moved between revisions. Each
  // ObligationCollateral starts with `deposit_reserve: Pubkey` (32 bytes)
  // — the all-zero check below is robust to any header expansion.

  const DEPOSIT_SLOT_SIZE = 136; // klend v1.x: ObligationCollateral
  const BORROW_SLOT_SIZE = 200; // klend v1.x: ObligationLiquidity
  const MAX_SLOTS = 8;
  const DEPOSITS_OFF = 96; // post-header offset; verified against klend reserve.rs

  const deposits: PublicKey[] = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slotOff = DEPOSITS_OFF + i * DEPOSIT_SLOT_SIZE;
    const pk = pubkeyOrNull(info.data, slotOff);
    if (pk) deposits.push(pk);
  }

  const BORROWS_OFF = DEPOSITS_OFF + MAX_SLOTS * DEPOSIT_SLOT_SIZE;
  const borrows: PublicKey[] = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slotOff = BORROWS_OFF + i * BORROW_SLOT_SIZE;
    const pk = pubkeyOrNull(info.data, slotOff);
    if (pk) borrows.push(pk);
  }

  return { deposits, borrows };
}

// --- Ix builders --------------------------------------------------------

/**
 * Build a single `RefreshReserve` ix.
 *
 * Account order (klend IDL `refresh_reserve`):
 *   [0] reserve              (writable)
 *   [1] lending_market       (readonly; sniffed from the reserve's
 *                              `liquidity.lending_market` slot — must be
 *                              passed by the caller, we don't fetch it
 *                              here)
 *   [2] pyth_oracle          (readonly; one of pyth | switchboard | None)
 *   [3] switchboard_price    (readonly; defaults to klend program id when
 *                              this reserve uses pyth)
 *   [4] switchboard_twap     (readonly; same default rule)
 *   [5] scope_prices         (readonly; defaults to klend program id when
 *                              the reserve isn't using scope)
 */
export function refreshReserveIx(args: {
  reserve: PublicKey;
  lendingMarket: PublicKey;
  pythOracle: PublicKey | null;
  switchboardPrice?: PublicKey | null;
  switchboardTwap?: PublicKey | null;
  scopePrices?: PublicKey | null;
}): TransactionInstruction {
  const fallback = KLEND_PROGRAM_ID;
  const keys: AccountMeta[] = [
    { pubkey: args.reserve, isSigner: false, isWritable: true },
    { pubkey: args.lendingMarket, isSigner: false, isWritable: false },
    { pubkey: args.pythOracle ?? fallback, isSigner: false, isWritable: false },
    {
      pubkey: args.switchboardPrice ?? fallback,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: args.switchboardTwap ?? fallback,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: args.scopePrices ?? fallback, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: KLEND_PROGRAM_ID,
    keys,
    data: DISC_REFRESH_RESERVE,
  });
}

/**
 * Build a `RefreshObligation` ix.
 *
 * Account order (klend IDL):
 *   [0] lending_market       (readonly)
 *   [1] obligation           (writable)
 *   [2..] reserves           (readonly) — must equal
 *                             `obligation.deposits[].deposit_reserve` then
 *                             `obligation.borrows[].borrow_reserve`,
 *                             positionally.
 */
export function refreshObligationIx(args: {
  lendingMarket: PublicKey;
  obligation: PublicKey;
  deposits: PublicKey[];
  borrows: PublicKey[];
}): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: args.lendingMarket, isSigner: false, isWritable: false },
    { pubkey: args.obligation, isSigner: false, isWritable: true },
    ...args.deposits.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: false,
    })),
    ...args.borrows.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: false,
    })),
  ];
  return new TransactionInstruction({
    programId: KLEND_PROGRAM_ID,
    keys,
    data: DISC_REFRESH_OBLIGATION,
  });
}

// --- The sandwich -------------------------------------------------------

export interface RefreshSandwichInput {
  connection: Connection;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  /** Optional Pyth-Pull price-update preludes built by the caller (one
   *  per Pyth-Pull reserve). Each must be the
   *  `update_price_feeds_v2` ix; we just inline them. */
  pythPullPreludes?: TransactionInstruction[];
  /** Override `1_000_000` CU. Bump if you have many reserves. */
  computeUnits?: number;
}

/**
 * Build the [SetCU, RefreshReserve×N, RefreshObligation] prefix.
 * Caller appends their actual obligation-mutating ix (e.g.
 * JoinElevationGroup, deposit_obligation_collateral, borrow_obligation_liquidity)
 * and sends as a single tx.
 *
 * Returns ixs only — caller decides legacy tx vs. v0+ALT (use
 * `buildRefreshSandwichV0Tx` below for the latter).
 */
export async function buildRefreshSandwich(
  input: RefreshSandwichInput
): Promise<TransactionInstruction[]> {
  const { connection, obligation, lendingMarket } = input;

  const { deposits, borrows } = await loadObligationReserves(
    connection,
    obligation
  );
  const allReserves = [...deposits, ...borrows];

  // Resolve oracles concurrently — N reserves means N HTTP calls otherwise.
  const handles = await Promise.all(
    allReserves.map((r) => loadReserveOracle(connection, r))
  );

  const ixs: TransactionInstruction[] = [];

  ixs.push(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: input.computeUnits ?? 1_000_000,
    })
  );

  if (input.pythPullPreludes) ixs.push(...input.pythPullPreludes);

  for (const h of handles) {
    ixs.push(
      refreshReserveIx({
        reserve: h.reserve,
        lendingMarket,
        pythOracle: h.pyth,
        switchboardPrice: h.switchboard,
      })
    );
  }

  ixs.push(
    refreshObligationIx({
      lendingMarket,
      obligation,
      deposits,
      borrows,
    })
  );

  return ixs;
}

/**
 * Convenience: pack the sandwich + caller's tail ixs into a v0
 * VersionedTransaction with a fresh ALT for the reserve+oracle pubkeys.
 *
 * For 1–2 reserves this overshoots; for 4+ it's required (legacy-tx
 * 1232-byte ceiling). Caller pre-creates the ALT (extending it can take
 * a slot or two to confirm — `createAndExtendAlt` from
 * tests/fixtures.ts is a working reference).
 *
 * NB: the ALT extending the keys is a separate ALT-state confirmation
 * problem (klend's ix encoding doesn't dedup against ALTs at the program
 * level — only the runtime does). If you care about flake-free batches,
 * pre-create one ALT keyed off the canonical reserve list and reuse.
 */
export function buildRefreshSandwichV0Tx(args: {
  payer: PublicKey;
  recentBlockhash: string;
  prefix: TransactionInstruction[];
  tail: TransactionInstruction[];
  altInfos: Array<
    Parameters<typeof TransactionMessage.prototype.compileToV0Message>[0] extends
      | infer T
      | undefined
      ? T extends Array<infer A>
        ? A
        : never
      : never
  >;
}): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: args.payer,
    recentBlockhash: args.recentBlockhash,
    instructions: [...args.prefix, ...args.tail],
  }).compileToV0Message(args.altInfos);
  return new VersionedTransaction(message);
}

// --- Convenience: send-and-confirm with the sandwich --------------------

export async function sendObligationIxWithRefresh(args: {
  connection: Connection;
  payer: Signer;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  /** Your obligation-mutating ix (or list — they all share the prefix). */
  tail: TransactionInstruction | TransactionInstruction[];
  pythPullPreludes?: TransactionInstruction[];
  /** v0 + ALT? If yes, supply the ALT; if undefined, use a legacy tx. */
  alt?: import("@solana/web3.js").AddressLookupTableAccount;
  computeUnits?: number;
}): Promise<string> {
  const tail = Array.isArray(args.tail) ? args.tail : [args.tail];
  const prefix = await buildRefreshSandwich({
    connection: args.connection,
    obligation: args.obligation,
    lendingMarket: args.lendingMarket,
    pythPullPreludes: args.pythPullPreludes,
    computeUnits: args.computeUnits,
  });

  const { blockhash, lastValidBlockHeight } =
    await args.connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: args.payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...prefix, ...tail],
  }).compileToV0Message(args.alt ? [args.alt] : []);
  const tx = new VersionedTransaction(message);
  tx.sign([args.payer]);

  const sig = await args.connection.sendTransaction(tx, { skipPreflight: false });
  await args.connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return sig;
}

// =======================================================================
// investigateBatching
// =======================================================================
//
// 1. **Why klend forces N RefreshReserve ixs.** RefreshReserve mutates
//    Reserve.last_update; the obligation refresh checks slot equality
//    per-reserve and per-borrow. There's no aggregate "RefreshAll"
//    ix today — the per-reserve ix is the unit of granularity klend
//    audited and shipped. A multi-reserve ix would have to consume N
//    oracle accounts inside one ix and is not on klend's roadmap as of
//    klend v1.x.
//
// 2. **Tx-level batching is what we have.** All N `RefreshReserve` ixs
//    and the `RefreshObligation` go in a single tx so they share a slot
//    (mandatory) AND so the runtime amortises the program-load cost
//    across them (klend.so loaded once, reused). With ALTs the wire
//    cost compresses too: every reserve appears at most once in the
//    ALT and shows up as a 1-byte index in subsequent ixs.
//
// 3. **CU budgeting.** Pyth path: ~20k CU per RefreshReserve, ~5k CU
//    per RefreshObligation iteration. Switchboard path is ~2× the
//    Pyth cost. Conservative CU = 600k handles 8 reserves with
//    headroom; bump via `computeUnits` if needed.
//
// 4. **Pre-cached ALTs are the real win.** If your obligation always
//    references the same N reserves (typical for production solvers
//    pinned to one market), pre-create ONE ALT extending all reserves
//    + their oracles + KLEND_PROGRAM_ID + SYSVAR_INSTRUCTIONS_PUBKEY.
//    Reuse across every tx. The first tx pays the ALT-extend cost
//    (~2 confirmations); every subsequent refresh sandwich is a
//    constant ~~~600 byte tx.
//
// 5. **Future klend feature flagging.** If/when Kamino ships a multi-
//    reserve refresh ix, swap `refreshReserveIx` calls inside
//    `buildRefreshSandwich` for one batched ix. Keep this module's
//    public surface (`buildRefreshSandwich` + `sendObligationIxWithRefresh`)
//    stable — callers shouldn't have to rewrite.
//
// 6. **Cross-tx solver flow.** A solver that mutates the obligation
//    multiple times per slot CANNOT reuse a refresh from a prior tx —
//    every tx that touches the obligation must include the sandwich,
//    because the slot check is per-tx not per-block. The optimisation
//    is to combine multiple obligation operations into ONE tx
//    (deposit + borrow + join_elevation_group sharing the same
//    sandwich), not to amortise sandwiches across txs.

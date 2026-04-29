import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CLEARSTONE_ROUTER } from "../lib/programs.js";
import { MarketPicker } from "../components/MarketPicker.js";

// LP provision flow — `clearstone_router.wrapper_provide_liquidity_classic`
// (or its base-asset variant `wrapper_provide_liquidity` which mints SY first).
//
// User holds PT + SY (or wraps base into SY then strips). The router's
// classic wrapper composes core.market_two_deposit_liquidity in one tx.
// Withdrawal mirrors via wrapper_withdraw_liquidity_classic.
//
// This stub captures the inputs but doesn't build the tx — see FLOWS.md
// §0 for the full account list and tests/clearstone-router.ts's
// `wrapper_provide_liquidity_classic` test for a working reference.

export function LpProvision() {
  useConnection();
  const { publicKey } = useWallet();
  const [marketPk, setMarketPk] = useState("");
  const [ptIntent, setPtIntent] = useState("100000");
  const [syIntent, setSyIntent] = useState("100000");
  const [minLpOut, setMinLpOut] = useState("99000");
  const [status, setStatus] = useState<string | null>(null);

  async function handleProvide() {
    if (!publicKey) {
      setStatus("connect a wallet first");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _m = new PublicKey(marketPk);
    } catch {
      setStatus("invalid market pubkey");
      return;
    }
    setStatus(
      `[stub] would call wrapper_provide_liquidity_classic(pt_intent=${ptIntent}, sy_intent=${syIntent}, min_lp_out=${minLpOut})`
    );
    // Production wiring: derive escrow/mint/lp ATAs, load market state to
    // build the SY-CPI remaining_accounts (cpiAccounts.depositSy +
    // withdrawSy + getSyState resolved through the market's ALT — same
    // pattern as `syCpiExtras` in tests/clearstone-fusion-flash.ts).
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Provide liquidity</h2>
      <p style={{ color: "#8a8a8a", fontSize: 13 }}>
        PT + SY → LP via clearstone_router.wrapper_provide_liquidity_classic.
        For a base-only deposit path, use the non-classic
        wrapper_provide_liquidity (auto-mints SY first).
      </p>
      <div style={{ display: "grid", gap: 12, maxWidth: 540 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ color: "#8a8a8a" }}>Market</span>
          <MarketPicker value={marketPk} onChange={setMarketPk} />
        </label>
        <F label="PT intent" value={ptIntent} onChange={setPtIntent} />
        <F label="SY intent" value={syIntent} onChange={setSyIntent} />
        <F label="Min LP out (slippage floor)" value={minLpOut} onChange={setMinLpOut} />
        <button onClick={handleProvide} style={btn}>
          Build + sign
        </button>
        {status && <div style={statusBox}>{status}</div>}
      </div>
      <div style={{ marginTop: 24, fontSize: 11, color: "#666" }}>
        Router: <code>{CLEARSTONE_ROUTER.toBase58()}</code>
      </div>
    </div>
  );
}

function F({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span style={{ color: "#8a8a8a" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "#161618",
          color: "#e8e8e8",
          border: "1px solid #2a2a2e",
          padding: "8px 10px",
          borderRadius: 4,
          fontFamily: "inherit",
          fontSize: 13,
        }}
      />
    </label>
  );
}

const btn: React.CSSProperties = {
  background: "#6cf",
  color: "#0e0e10",
  border: "none",
  padding: "10px 16px",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  width: "max-content",
};

const statusBox: React.CSSProperties = {
  fontSize: 12,
  color: "#8a8a8a",
  background: "#161618",
  border: "1px solid #2a2a2e",
  padding: "8px 12px",
  borderRadius: 4,
};

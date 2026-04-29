import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CLEARSTONE_ROUTER } from "../lib/programs.js";
import { MarketPicker } from "../components/MarketPicker.js";

// Buy-PT flow — `clearstone_router.wrapper_buy_pt`.
//
// On-chain composition (see FLOWS.md §1):
//   user.base_ata  ──► adapter.mint_sy   ──► user.sy_ata
//                              │
//                              └──► core.trade_pt(net_trader_pt = +pt_amount)
//
// This page is a STUB — it surfaces the args the user would need to
// provide, but doesn't actually build the tx. Wiring in the real call
// requires loading the IDL via @coral-xyz/anchor, deriving the market's
// ALT-resolved remaining_accounts, and signing with the connected wallet.
// See `tests/clearstone-router.ts` for a working reference.

export function BuyPt() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [marketPk, setMarketPk] = useState("");
  const [ptAmount, setPtAmount] = useState("100000");
  const [maxBase, setMaxBase] = useState("110000");
  const [status, setStatus] = useState<string | null>(null);

  async function handleBuy() {
    if (!publicKey || !signTransaction) {
      setStatus("connect a wallet first");
      return;
    }
    if (!marketPk) {
      setStatus("market pubkey required");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _market = new PublicKey(marketPk);
    } catch {
      setStatus("invalid market pubkey");
      return;
    }
    setStatus(
      `[stub] would call clearstone_router.wrapper_buy_pt(pt_amount=${ptAmount}, max_base=${maxBase}, max_sy_in=…) — see FLOWS.md §1.`
    );
    // Production wiring: load the router program via
    // `new anchor.Program(routerIdl, provider)`, derive the market's
    // address_lookup_table from the market account, build the
    // `wrapper_buy_pt` ix, sign + send. The remaining_accounts list is
    // the union of the SY adapter's `mint_sy` + `trade_pt` CPI extras
    // (see tests/fixtures.ts for the canonical builder).
    void connection; // referenced to silence the unused-import lint
  }

  return (
    <Section
      title="Buy PT (router.wrapper_buy_pt)"
      subtitle="base → SY → PT in one tx; leftover SY stays in your SY ATA"
    >
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ color: "#8a8a8a" }}>Market</span>
        <MarketPicker value={marketPk} onChange={setMarketPk} />
      </label>
      <Field label="PT amount (out)" value={ptAmount} onChange={setPtAmount} />
      <Field label="Max base spend" value={maxBase} onChange={setMaxBase} />
      <button onClick={handleBuy} style={btnStyle}>
        Build + sign
      </button>
      {status && <div style={statusStyle}>{status}</div>}
    </Section>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
      {subtitle && <p style={{ color: "#8a8a8a", fontSize: 13 }}>{subtitle}</p>}
      <div style={{ display: "grid", gap: 12, maxWidth: 540 }}>{children}</div>
      <div style={{ marginTop: 24, fontSize: 11, color: "#666" }}>
        Router: <code>{CLEARSTONE_ROUTER.toBase58()}</code>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span style={{ color: "#8a8a8a" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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

const btnStyle: React.CSSProperties = {
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

const statusStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: "#8a8a8a",
  background: "#161618",
  border: "1px solid #2a2a2e",
  padding: "8px 12px",
  borderRadius: 4,
};

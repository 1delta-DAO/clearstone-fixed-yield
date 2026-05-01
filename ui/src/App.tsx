import { useState, useMemo } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { LpProvision } from "./pages/LpProvision.js";
import { BuyPt } from "./pages/BuyPt.js";
import { IntentFill } from "./pages/IntentFill.js";
import { Setup } from "./pages/Setup.js";
import { Sourcing } from "./pages/Sourcing.js";
import { StackContext } from "./lib/stack-context.js";
import { loadStack, saveStack, type CanonicalStack } from "./lib/deployments.js";

type Tab = "setup" | "sourcing" | "lp" | "buy_pt" | "intent_fill";

const TABS: { id: Tab; label: string; subtitle: string }[] = [
  {
    id: "setup",
    label: "Setup",
    subtitle: "active deployment handles + override JSON",
  },
  {
    id: "sourcing",
    label: "Sourcing",
    subtitle: "USDC → SY (mint_sy) and SY → PT+YT (strip); pre-flight balances",
  },
  {
    id: "lp",
    label: "LP provision",
    subtitle: "deposit PT + SY → LP via clearstone_router.wrapper_provide_liquidity",
  },
  {
    id: "buy_pt",
    label: "Buy PT",
    subtitle: "base → SY → PT via clearstone_router.wrapper_buy_pt",
  },
  {
    id: "intent_fill",
    label: "Self-solve intent",
    subtitle: "sign + (stub) submit a fusion OrderConfig with the same wallet",
  },
];

export function App() {
  const { publicKey } = useWallet();
  const [tab, setTab] = useState<Tab>("setup");
  const [stack, setStack] = useState<CanonicalStack>(() => loadStack());
  const stackCtx = useMemo(
    () => ({
      stack,
      replace: (next: CanonicalStack) => {
        setStack(next);
        saveStack(next);
      },
    }),
    [stack]
  );

  return (
    <StackContext.Provider value={stackCtx}>
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "32px 16px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 32,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Clearstone Fixed Yield</h1>
          <div style={{ color: "#8a8a8a", fontSize: 13 }}>
            Boilerplate UI · {publicKey ? publicKey.toBase58().slice(0, 8) + "…" : "no wallet"}
          </div>
        </div>
        <WalletMultiButton />
      </header>

      <nav
        style={{
          display: "flex",
          gap: 8,
          borderBottom: "1px solid #2a2a2e",
          marginBottom: 24,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "transparent",
              color: tab === t.id ? "#6cf" : "#e8e8e8",
              border: "none",
              padding: "8px 12px",
              borderBottom: tab === t.id ? "2px solid #6cf" : "2px solid transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 14,
            }}
            title={t.subtitle}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <section style={{ minHeight: 320 }}>
        {tab === "setup" && <Setup />}
        {tab === "sourcing" && <Sourcing />}
        {tab === "lp" && <LpProvision />}
        {tab === "buy_pt" && <BuyPt />}
        {tab === "intent_fill" && <IntentFill />}
      </section>

      <footer style={{ marginTop: 64, color: "#8a8a8a", fontSize: 12 }}>
        <div>
          See <a href="https://github.com/1delta-DAO/clearstone-fixed-yield/blob/main/FLOWS.md">FLOWS.md</a>{" "}
          for the on-chain flow this UI illustrates. The page handlers
          here are stubs — they show the call shape, leave the tx-build
          to the integrator. Override the RPC with{" "}
          <code>?rpc=&lt;url&gt;</code> in the address bar.
        </div>
      </footer>
    </main>
    </StackContext.Provider>
  );
}

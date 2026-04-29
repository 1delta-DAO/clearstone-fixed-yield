import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";
import { App } from "./App.js";

// Devnet by default. Override via `?rpc=...` query string for local
// validators or alternate clusters. The cluster choice is intentionally
// surfaced — Clearstone runs on devnet today, mainnet later, and many
// integrators want to point at their own forks during development.
function resolveEndpoint(): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("rpc");
  if (fromQuery) return fromQuery;
  return "https://api.devnet.solana.com";
}

function Root() {
  const endpoint = useMemo(resolveEndpoint, []);
  // Phantom is the only wallet wired by default — adding more is a
  // one-line append. Keeping the list small keeps the `npm install`
  // tree manageable for a demo.
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

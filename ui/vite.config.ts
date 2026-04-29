import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Clearstone Fixed Yield demo UI.
//
// Solana's @solana/wallet-adapter-* and @coral-xyz/anchor pull in some
// node-builtins (Buffer, process). The `define` block below shims them
// for the browser. Keep this file minimal — no dev-server proxies, no
// path aliases — so integrators can copy/paste the patterns without
// fighting Vite config.
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env": {},
    global: "globalThis",
  },
  resolve: {
    alias: {
      // Anchor expects Buffer at the global scope; provide it via the
      // browser polyfill that wallet-adapter ships with.
      buffer: "buffer",
    },
  },
  optimizeDeps: {
    // Pre-bundle the Solana ecosystem so HMR doesn't choke on CommonJS
    // boundaries during dev.
    include: [
      "@coral-xyz/anchor",
      "@solana/web3.js",
      "@solana/wallet-adapter-react",
      "@solana/wallet-adapter-wallets",
    ],
  },
});

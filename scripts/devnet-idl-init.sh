#!/usr/bin/env bash
# scripts/devnet-idl-init.sh — freeze the IDL for each shipped program
# and publish it on-chain so explorers can decode events.
#
# Two effects:
#   1. Snapshot target/idl/*.json into repo-root idl/ (the frozen
#      devnet IDL). Integrators build against this, not target/idl,
#      because target/idl regenerates on every `anchor build`.
#   2. `anchor idl init <PID>` writes the IDL to the IDL account for
#      <PID> on devnet so tools that fetch IDLs from-chain (Solana
#      Explorer, Anchor's own dumpers) can decode events.
#
# Idempotent on the repo side. `anchor idl init` errors if the IDL
# account already exists — use `anchor idl upgrade` instead; this
# script tries init then falls back to upgrade.
#
# Requires: .env.devnet sourced AND upgrade authority is the hot
# deployer (run before transfer-upgrade-authority.sh, or move
# authority back temporarily for IDL changes).

set -euo pipefail

: "${ANCHOR_WALLET:?source .env.devnet first}"
RPC="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"

PROGRAMS=(
  "clearstone_core           DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW"
  "generic_exchange_rate_sy  HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3"
  "clearstone_rewards        7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g"
  "clearstone_curator        831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm"
  "clearstone_router         DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW"
)

if [ ! -d target/idl ] || [ -z "$(ls -A target/idl/*.json 2>/dev/null)" ]; then
  echo "target/idl/ is empty — run 'anchor build' first"
  exit 1
fi

mkdir -p idl

for entry in "${PROGRAMS[@]}"; do
  read -r name pid <<<"$entry"
  src="target/idl/${name}.json"
  dst="idl/${name}.json"

  if [ ! -f "$src" ]; then
    echo "[err ] $name: missing $src — rebuild the workspace"
    continue
  fi

  cp "$src" "$dst"
  echo "[copy] $src → $dst"

  # Init first; if it already exists, upgrade. Anchor prints a clear
  # error either way, so we keep going.
  if anchor idl init "$pid" --filepath "$src" --provider.cluster "$RPC" --provider.wallet "$ANCHOR_WALLET" 2>/tmp/idl.err; then
    echo "[init] $name IDL uploaded"
  else
    if grep -qi "already in use\|already exists\|account already" /tmp/idl.err; then
      echo "[up  ] $name IDL exists — upgrading"
      anchor idl upgrade "$pid" --filepath "$src" --provider.cluster "$RPC" --provider.wallet "$ANCHOR_WALLET"
    else
      echo "[err ] $name: anchor idl init failed:"
      cat /tmp/idl.err >&2
      exit 1
    fi
  fi
done

echo
echo "idl/ snapshot (commit these):"
ls -la idl/

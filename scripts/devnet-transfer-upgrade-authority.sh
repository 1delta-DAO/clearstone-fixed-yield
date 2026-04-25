#!/usr/bin/env bash
# scripts/devnet-transfer-upgrade-authority.sh — move upgrade authority
# on every deployed program from the hot deployer to the cold key.
#
# Run once, immediately after the initial `anchor deploy`. Idempotent:
# re-running checks each program's current upgrade authority first and
# skips ones already pointing at cold.
#
# Requires: .env.devnet sourced (or ANCHOR_WALLET / CLEARSTONE_DEVNET_COLD_AUTHORITY
# exported).

set -euo pipefail

: "${ANCHOR_WALLET:?source .env.devnet first}"
: "${CLEARSTONE_DEVNET_COLD_AUTHORITY:?source .env.devnet first}"
RPC="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"

COLD_PUB=$(solana-keygen pubkey "$CLEARSTONE_DEVNET_COLD_AUTHORITY")
HOT_PUB=$(solana-keygen pubkey "$ANCHOR_WALLET")

echo "hot deployer  : $HOT_PUB"
echo "cold authority: $COLD_PUB"
echo "rpc           : $RPC"
echo

# One program per line, same order as DEPLOY_IDS.md. Mocks + test-only
# stay off devnet.
PROGRAMS=(
  "clearstone_core           DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW"
  "generic_exchange_rate_sy  HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3"
  "clearstone_rewards        7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g"
  "clearstone_curator        831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm"
  "clearstone_router         DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW"
)

for entry in "${PROGRAMS[@]}"; do
  read -r name pid <<<"$entry"

  current=$(solana program show "$pid" --url "$RPC" 2>/dev/null | awk '/^Authority:/ {print $2}') || true
  if [ -z "$current" ]; then
    echo "[skip] $name ($pid) — not deployed yet or unreadable"
    continue
  fi

  if [ "$current" = "$COLD_PUB" ]; then
    echo "[skip] $name already owned by cold"
    continue
  fi
  if [ "$current" != "$HOT_PUB" ]; then
    echo "[skip] $name authority is $current — not hot, can't transfer. (Foreign auth or already migrated.)"
    continue
  fi

  echo "[xfer] $name : $HOT_PUB → $COLD_PUB"
  # `--skip-new-upgrade-authority-signer-check` lets the cold key
  # stay offline (no signature on this tx). Solana accepts the
  # transfer because we explicitly opt-out of the signer check; the
  # cold key still controls upgrades thereafter via its private key.
  solana program set-upgrade-authority \
    "$pid" \
    --new-upgrade-authority "$COLD_PUB" \
    --skip-new-upgrade-authority-signer-check \
    --keypair "$ANCHOR_WALLET" \
    --url "$RPC"
done

echo
echo "done. Verify:"
for entry in "${PROGRAMS[@]}"; do
  read -r name pid <<<"$entry"
  printf "%-26s %s\n" "$name" "$(solana program show "$pid" --url "$RPC" 2>/dev/null | awk '/^Authority:/ {print $2}')"
done

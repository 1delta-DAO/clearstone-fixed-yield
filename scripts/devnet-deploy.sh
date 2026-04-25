#!/usr/bin/env bash
# scripts/devnet-deploy.sh — idempotent devnet deploy of the Clearstone
# program set.
#
# Order matches DEVNET_PLAN.md §3:
#   1. clearstone_core
#   2. generic_exchange_rate_sy
#   3. clearstone_rewards
#   4. clearstone_curator
#   5. clearstone_router
#
# Idempotent: each program is deployed via `anchor deploy` which
# auto-upgrades if the program ID is already on-chain and authority
# matches the current wallet. If you ran
# `scripts/devnet-transfer-upgrade-authority.sh` already, you must
# upgrade with the cold key — this script will skip programs whose
# upgrade authority is no longer the hot deployer, printing a warning.
#
# Requires: .env.devnet sourced.

set -euo pipefail

: "${ANCHOR_WALLET:?source .env.devnet first}"
RPC="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"
HOT_PUB=$(solana-keygen pubkey "$ANCHOR_WALLET")

# Rebuild is *not* forced — run `anchor build` beforehand if you've
# changed any Rust. This script just deploys what's already in
# target/deploy/.
if [ ! -f target/deploy/clearstone_core.so ]; then
  echo "target/deploy/*.so missing — run 'anchor build' first"
  exit 1
fi

# Deploy list: crate name + expected program ID.
PROGRAMS=(
  "clearstone_core           DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW"
  "generic_exchange_rate_sy  HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3"
  "clearstone_rewards        7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g"
  "clearstone_curator        831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm"
  "clearstone_router         DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW"
)

deploy_one () {
  local name="$1"
  local expected_pid="$2"
  local so="target/deploy/${name}.so"
  local kp="target/deploy/${name}-keypair.json"

  if [ ! -f "$so" ];  then echo "[err ] $name: missing $so";  return 1; fi
  if [ ! -f "$kp" ];  then echo "[err ] $name: missing $kp";  return 1; fi

  local actual_pid
  actual_pid=$(solana-keygen pubkey "$kp")
  if [ "$actual_pid" != "$expected_pid" ]; then
    echo "[err ] $name: keypair pubkey $actual_pid != expected $expected_pid"
    return 1
  fi

  local current_auth
  current_auth=$(solana program show "$expected_pid" --url "$RPC" 2>/dev/null | awk '/^Authority:/ {print $2}') || true

  if [ -z "$current_auth" ]; then
    echo "[new ] $name: first-time deploy → $expected_pid"
  elif [ "$current_auth" = "$HOT_PUB" ]; then
    echo "[up  ] $name: upgrade (authority is hot) → $expected_pid"
  else
    echo "[skip] $name: upgrade authority $current_auth != hot $HOT_PUB (transferred to cold?)"
    return 0
  fi

  # `anchor deploy` reads target/deploy/<name>-keypair.json + the .so
  # and handles both first deploy and upgrade. We pin provider explicitly
  # so sourcing the wrong .env doesn't silently land on localnet.
  anchor deploy \
    --provider.cluster "$RPC" \
    --provider.wallet  "$ANCHOR_WALLET" \
    --program-name "$name" \
    --program-keypair "$kp"
}

for entry in "${PROGRAMS[@]}"; do
  read -r name pid <<<"$entry"
  deploy_one "$name" "$pid"
done

echo
echo "final authorities:"
for entry in "${PROGRAMS[@]}"; do
  read -r name pid <<<"$entry"
  printf "%-26s %s (%s)\n" \
    "$name" \
    "$pid" \
    "$(solana program show "$pid" --url "$RPC" 2>/dev/null | awk '/^Authority:/ {print $2}')"
done

#!/usr/bin/env bash
# scripts/devnet-verify-hashes.sh — reproducible-build sha256 per
# program, formatted to paste into DEPLOY_IDS.md.
#
# Runs `solana-verify build --library-name <crate>` for each shipped
# program. That command uses a pinned Docker toolchain + environment so
# a deterministic .so comes out (independent of local Cargo flags,
# rustc version drift, etc.). The sha256 of that .so should match
# whatever we've got deployed on devnet after `anchor deploy`.
#
# Usage:
#   scripts/devnet-verify-hashes.sh               # all shipped programs
#   scripts/devnet-verify-hashes.sh clearstone_core
#
# Prints a markdown table row per program to stdout. Does not mutate
# DEPLOY_IDS.md — paste the output in.

set -euo pipefail

# Two modes:
#   --on-chain        : just dump on-chain hashes (no Docker needed)
#   (default / build) : run `solana-verify build` (Docker required)
MODE="build"
if [ "${1:-}" = "--on-chain" ]; then
  MODE="--on-chain"
  shift
fi

PROGRAMS=("${@}")
if [ "${#PROGRAMS[@]}" -eq 0 ]; then
  PROGRAMS=(
    clearstone_core
    generic_exchange_rate_sy
    clearstone_rewards
    clearstone_curator
    clearstone_router
  )
fi

if ! command -v solana-verify >/dev/null; then
  echo "solana-verify not installed. Get it from:"
  echo "  cargo install solana-verify"
  exit 1
fi

COMMIT=$(git rev-parse --short HEAD)

if [ "$MODE" = "--on-chain" ]; then
  : "${ANCHOR_PROVIDER_URL:=https://api.devnet.solana.com}"
  declare -A IDS=(
    [clearstone_core]=DZmP7zaBrc6FdJc842aeexnGV5YwPucg2Jv8p6Szh6hW
    [generic_exchange_rate_sy]=HA1T2p7DkktepgtwrVqNBK8KidAYr5wvS1uKqzvScNm3
    [clearstone_rewards]=7ddrynBQiCNjxejxRwxvSbDb56k8F8Yp4KwYgfiaHX8g
    [clearstone_curator]=831zw8r2fGwRB1QpuRU3gZHZBFYYHBHeG7RbKUz9ssGm
    [clearstone_router]=DenU4j4oV4wCMCsytrfYuFwAumTE1abFAPmpYDpjWmsW
  )
  printf "| crate | on-chain sha256 | local .so sha256 | pinned commit |\n"
  printf "|-------|-----------------|------------------|---------------|\n"
  for crate in "${PROGRAMS[@]}"; do
    pid="${IDS[$crate]:-?}"
    chain=$(solana-verify get-program-hash "$pid" --url "$ANCHOR_PROVIDER_URL" 2>/dev/null | tail -1)
    so="target/deploy/${crate}.so"
    local_h=$(sha256sum "$so" 2>/dev/null | awk '{print $1}')
    printf "| \`%s\` | \`%s\` | \`%s\` | \`%s\` |\n" "$crate" "${chain:-?}" "${local_h:-?}" "$COMMIT"
  done
  exit 0
fi

# Reproducible build path — needs Docker.
if ! docker ps >/dev/null 2>&1; then
  echo "docker daemon NOT reachable. Either:"
  echo "  - start Docker, then re-run this script, or"
  echo "  - run with --on-chain to skip the reproducible build and"
  echo "    just dump on-chain + local hashes as a snapshot."
  exit 1
fi

printf "| crate | reproducible sha256 | pinned commit |\n"
printf "|-------|---------------------|---------------|\n"
for crate in "${PROGRAMS[@]}"; do
  echo "[build] $crate" >&2
  solana-verify build --library-name "$crate" >&2

  so="target/deploy/${crate}.so"
  if [ ! -f "$so" ]; then
    echo "[err ] $crate: expected $so after solana-verify build" >&2
    continue
  fi
  hash=$(sha256sum "$so" | awk '{print $1}')
  printf "| \`%s\` | \`%s\` | \`%s\` |\n" "$crate" "$hash" "$COMMIT"
done

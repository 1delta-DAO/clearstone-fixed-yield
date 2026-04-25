#!/usr/bin/env bash
# scripts/devnet-deploy-init.sh — bootstrap the two keypairs our devnet
# deploy flow depends on.
#
#   ~/.config/solana/clearstone-devnet.json         hot deployer
#   ~/.config/solana/clearstone-devnet-cold.json    cold upgrade authority
#
# The hot deployer pays for uploads and is the *initial* upgrade
# authority of each program. Immediately after a deploy we transfer
# upgrade authority to the cold key via
# scripts/devnet-transfer-upgrade-authority.sh so the hot deployer
# can't be coerced into shipping a bad upgrade.
#
# Idempotent: re-running won't overwrite an existing keypair.

set -euo pipefail

HOT="$HOME/.config/solana/clearstone-devnet.json"
COLD="$HOME/.config/solana/clearstone-devnet-cold.json"

mkdir -p "$(dirname "$HOT")"

gen_if_missing () {
  local path="$1"
  local label="$2"
  if [ -f "$path" ]; then
    echo "[skip] $label already exists at $path → pubkey $(solana-keygen pubkey "$path")"
  else
    solana-keygen new --no-bip39-passphrase --silent -o "$path"
    echo "[new]  $label   pubkey $(solana-keygen pubkey "$path")"
  fi
}

gen_if_missing "$HOT"  "devnet hot deployer"
gen_if_missing "$COLD" "devnet cold upgrade authority"

echo
echo "Next: fund the hot deployer with"
echo "  scripts/devnet-fund.sh 50"
echo "and deploy with"
echo "  source .env.devnet && scripts/devnet-deploy.sh"

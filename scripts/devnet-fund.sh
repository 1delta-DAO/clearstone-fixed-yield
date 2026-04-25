#!/usr/bin/env bash
# scripts/devnet-fund.sh — fund the devnet deployer with airdrops.
#
# Devnet's airdrop rate limits at ~5 SOL per request per minute. This
# loop airdrops in 5-SOL chunks until the target balance is met, with
# a 12s pause between requests to stay under the hourly cap.
#
# Usage:
#   scripts/devnet-fund.sh                # 50 SOL target, default wallet
#   scripts/devnet-fund.sh 80              # 80 SOL target
#   scripts/devnet-fund.sh 50 /path/to/wallet.json

set -euo pipefail

TARGET="${1:-50}"
WALLET="${2:-$HOME/.config/solana/clearstone-devnet.json}"
RPC="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"

if [ ! -f "$WALLET" ]; then
  echo "wallet not found at $WALLET — generate with:"
  echo "  solana-keygen new -o $WALLET --no-bip39-passphrase"
  exit 1
fi

PUBKEY=$(solana-keygen pubkey "$WALLET")
echo "funding $PUBKEY on $RPC → target $TARGET SOL"

# Loop in 5-SOL chunks. `solana airdrop` exits non-zero on rate-limit;
# we swallow that and back off.
while true; do
  BAL=$(solana balance "$PUBKEY" --url "$RPC" | awk '{print $1}')
  echo "current balance: ${BAL} SOL"

  # Float compare via awk
  AT_TARGET=$(awk -v b="$BAL" -v t="$TARGET" 'BEGIN{print (b >= t) ? 1 : 0}')
  if [ "$AT_TARGET" = "1" ]; then
    echo "target reached."
    break
  fi

  if solana airdrop 5 "$PUBKEY" --url "$RPC" 2>&1 | tee /tmp/devnet-airdrop.log; then
    echo "airdropped 5 SOL"
  else
    echo "airdrop failed (likely rate-limited); sleeping 60s"
    sleep 60
    continue
  fi

  # Devnet airdrops settle fast but the rate limit is aggressive;
  # 12s per request keeps us under the typical hourly cap.
  sleep 12
done

echo "final balance:"
solana balance "$PUBKEY" --url "$RPC"

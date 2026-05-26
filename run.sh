#!/usr/bin/env bash
# Quick-start helper for BaseStriker.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

case "${1:-help}" in
  install)
    npm install
    (cd backend && npm install)
    (cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-commit || true)
    ;;
  dev)
    npm run dev ;;
  backend)
    (cd backend && npm run dev) ;;
  contracts:test)
    (cd contracts && forge test -vv) ;;
  contracts:deploy:sepolia)
    (cd contracts && forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify -vv) ;;
  build)
    npm run build && (cd backend && npm run build) ;;
  *)
    cat <<EOF
BaseStriker runner

  ./run.sh install                  install all deps
  ./run.sh dev                      start the game (Vite)
  ./run.sh backend                  start the score-verification backend
  ./run.sh contracts:test           run Foundry tests
  ./run.sh contracts:deploy:sepolia deploy stack to Base Sepolia
  ./run.sh build                    build frontend + backend for prod
EOF
    ;;
esac

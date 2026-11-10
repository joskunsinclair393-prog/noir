#!/bin/zsh
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add your chosen provider key before expecting AI replies."
fi

if command -v node >/dev/null 2>&1; then
  NOIR_NODE="$(command -v node)"
elif [ -x "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  NOIR_NODE="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  echo "Node.js 20 or newer is required. Install it from https://nodejs.org, then double-click this file again."
  read "?Press Return to close this window. "
  exit 1
fi

NOIR_NODE_MAJOR="$("$NOIR_NODE" -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NOIR_NODE_MAJOR" -lt 20 ]; then
  echo "NOIR needs Node.js 20 or newer. Your current version is $($NOIR_NODE --version)."
  read "?Press Return to close this window. "
  exit 1
fi

"$NOIR_NODE" server.js &
NOIR_SERVER_PID=$!
trap 'kill "$NOIR_SERVER_PID" 2>/dev/null || true' INT TERM EXIT
sleep 1
open "http://127.0.0.1:3000"
echo "NOIR is running. Keep this Terminal window open; press Ctrl+C to stop it."
wait "$NOIR_SERVER_PID"

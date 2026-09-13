#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
npm install --omit=dev --no-fund --no-audit 2>/dev/null || true
mkdir -p "$HOME/.local/bin"
ln -sfn "$ROOT/dist/index.js" "$HOME/.local/bin/ivx"
chmod +x "$ROOT/dist/index.js"
echo "Installed: $HOME/.local/bin/ivx"
echo "Ensure ~/.local/bin is on PATH, then run: ivx --help"

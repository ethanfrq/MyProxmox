#!/usr/bin/env bash
# Lanceur Linux / macOS : mise à jour depuis GitHub (si dossier git), compilation si besoin, puis démarrage.
# Options : --no-update
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js 20+ est requis : https://nodejs.org"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "Node.js 20 ou plus récent est requis."; exit 1; }
mkdir -p data
changed=0

if [[ " $* " != *" --no-update "* && ! -f data/no-auto-update && -d .git ]] && command -v git >/dev/null; then
  before=$(git rev-parse HEAD)
  if git fetch --quiet origin "${MYPROXMOX_BRANCH:-main}" && git merge --ff-only --quiet "origin/${MYPROXMOX_BRANCH:-main}"; then
    [ "$before" != "$(git rev-parse HEAD)" ] && changed=1 && echo "  Nouvelle version récupérée."
  else
    echo "  Mise à jour impossible, on continue avec la version installée."
  fi
fi

if [[ $changed -eq 1 || ! -d node_modules || ! -f server/dist/index.js || ! -f web/dist/index.html ]]; then
  npm ci --no-audit --no-fund --loglevel=error
  npm run build --silent
fi

exec node server/dist/index.js

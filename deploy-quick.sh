#!/usr/bin/env bash
# Quick production deploy — run on the VPS after pushing to GitHub.
#
# Already includes:
#   git pull origin main (or BRANCH arg)
#   npm run build          ← API + shared TypeScript (required for API code changes)
#   npm run web:build      ← Next.js
#   pm2 restart tours-api + tours-web
#
# Skips: npm install, db:migrate:prod
# Use ./deploy.sh when package-lock or migrations change.
#
# Usage: ./deploy-quick.sh [branch]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BRANCH="${1:-main}"
API_APP="${PM2_API_APP:-tours-api}"
WEB_APP="${PM2_WEB_APP:-tours-web}"

log() { printf '\n==> %s\n' "$*"; }

if [[ ! -f .env.production ]]; then
  echo "error: .env.production not found in $ROOT" >&2
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "error: $ROOT is not a git checkout" >&2
  exit 1
fi

log "Quick deploy (origin/${BRANCH})"
git fetch origin "$BRANCH"

if git status --porcelain | grep -q 'apps/web/next-env.d.ts'; then
  log "Resetting dirty apps/web/next-env.d.ts"
  git checkout -- apps/web/next-env.d.ts
fi

log "git pull origin ${BRANCH}"
git pull --ff-only origin "$BRANCH"

log "Building API / shared (npm run build)"
npm run build

log "Building Next.js web (npm run web:build)"
npm run web:build

log "Restarting PM2 apps (no migrate)"
pm2 restart "$API_APP" --update-env
pm2 restart "$WEB_APP" --update-env
pm2 status

log "Quick deploy complete"
echo "Note: skipped npm install and db:migrate:prod — run ./deploy.sh if deps or migrations changed."

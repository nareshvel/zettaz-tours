#!/usr/bin/env bash
# Full production deploy — run on the VPS after pushing to GitHub.
#
# Includes:
#   git pull origin main (or BRANCH arg)
#   npm install
#   npm run build          ← API + shared TypeScript
#   npm run web:build
#   npm run db:migrate:prod
#   pm2 restart tours-api + tours-web --update-env
#
# Usage: ./deploy.sh [branch]
# Default branch: main
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

log "Full deploy (origin/${BRANCH})"
git fetch origin "$BRANCH"

# Avoid pull failures from generated Next type stubs
if git status --porcelain | grep -q 'apps/web/next-env.d.ts'; then
  log "Resetting dirty apps/web/next-env.d.ts"
  git checkout -- apps/web/next-env.d.ts
fi

log "git pull origin ${BRANCH}"
git pull --ff-only origin "$BRANCH"

log "Installing dependencies (npm install)"
npm install

log "Building API / shared (npm run build)"
npm run build

log "Building Next.js web (npm run web:build)"
npm run web:build

log "Applying database migrations (npm run db:migrate:prod)"
npm run db:migrate:prod

log "Restarting PM2 apps"
pm2 restart "$API_APP" --update-env
pm2 restart "$WEB_APP" --update-env
pm2 status

log "Full deploy complete"

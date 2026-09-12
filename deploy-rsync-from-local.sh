#!/usr/bin/env bash
# Optional: build on your laptop and rsync dist/.next to the VPS.
# Prefer server-side ./deploy.sh or ./deploy-quick.sh after git push.
set -euo pipefail

VPS="${DEPLOY_VPS:-root@185.75.21.46}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/var/www/zettaz-tours}"

echo "=== Syncing API dist ==="
rsync -av --delete dist/ "$VPS:$REMOTE_DIR/dist/"

echo "=== Syncing web .next ==="
rsync -av --delete apps/web/.next/ "$VPS:$REMOTE_DIR/apps/web/.next/"

echo "=== Syncing web public ==="
rsync -av apps/web/public/ "$VPS:$REMOTE_DIR/apps/web/public/"

echo "=== Applying migrations on VPS ==="
ssh "$VPS" "cd $REMOTE_DIR && npm run db:migrate:prod"

echo "=== Restarting PM2 ==="
ssh "$VPS" "pm2 restart tours-api --update-env && pm2 restart tours-web --update-env"
echo "=== Deploy complete ==="

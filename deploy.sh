#!/bin/bash
set -e
VPS="root@185.75.21.46"
REMOTE_DIR="/var/www/zettaz-tours"

echo "=== Syncing API dist ==="
rsync -av --delete dist/ "$VPS:$REMOTE_DIR/dist/"

echo "=== Syncing web .next ==="
rsync -av --delete apps/web/.next/ "$VPS:$REMOTE_DIR/apps/web/.next/"

echo "=== Syncing web public ==="
rsync -av apps/web/public/ "$VPS:$REMOTE_DIR/apps/web/public/"

echo "=== Applying migrations on VPS ==="
ssh "$VPS" "cd $REMOTE_DIR && npm run db:migrate:prod"

echo "=== Restarting PM2 ==="
ssh "$VPS" "pm2 restart tours-api && pm2 restart tours-web"
echo "=== Deploy complete ==="

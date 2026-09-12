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

echo "=== Running migration 060 on VPS ==="
ssh "$VPS" "psql -U zettaz_owner -d zettaz_tours -f $REMOTE_DIR/apps/api/migrations/060_auth_functions.sql"

echo "=== Restarting PM2 ==="
ssh "$VPS" "pm2 restart tours-api && pm2 restart tours-web"
echo "=== Deploy complete ==="

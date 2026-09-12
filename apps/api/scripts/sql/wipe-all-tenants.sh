#!/bin/bash
# Wipe ALL tenants and orphan staff on this database.
# Run on the VPS as root (uses postgres superuser):
#   bash apps/api/scripts/sql/wipe-all-tenants.sh
# Or:
#   sudo -u postgres psql -d zettaz_tours -f apps/api/scripts/sql/wipe-all-tenants.sql

set -euo pipefail
DB="${1:-zettaz_tours}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Wiping ALL tenants from database: $DB"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/wipe-all-tenants.sql"
echo "Done. Remaining tenants:"
sudo -u postgres psql -d "$DB" -c "SELECT id, slug, name FROM tenants ORDER BY created_at;"

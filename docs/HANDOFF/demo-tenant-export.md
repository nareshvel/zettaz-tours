# Demo tenant export / signup cleanup

**Updated:** 12 September 2026

## Clear test signup tenants

Do **not** use TablePlus as `zettaz_owner` for wipes — it cannot set `session_replication_role`.

On the VPS:

```sh
cd /var/www/zettaz-tours
sudo -u postgres psql -d zettaz_tours -f apps/api/scripts/sql/wipe-all-tenants.sql
```

That deletes **every** tenant and orphan staff. Use only on empty/test databases.

## Export Rock local DB → production Demo seed SQL

From the repo root (local `.env.development` with `ADMIN_DATABASE_URL`):

```sh
npm run db:seed                                          # refresh local Rock demo if needed
DEMO_EXPORT_PASSWORD='YourStrongDemoPass!' npm run db:export-demo
# or catalog-only (no bookings/payments):
DEMO_EXPORT_PASSWORD='YourStrongDemoPass!' npm run db:export-demo -- --mode=catalog
```

Output (gitignored):

`apps/api/scripts/sql/generated/demo-tenant-demo-rock-adventures-full.sql`

Seed INTO an existing production tenant (keeps that tenant’s owner login):

```sh
npm run db:seed   # ensure local Rock sample is current
npm run db:export-demo -- --into-tenant-id=f6e566ce-bb5c-4cc7-b801-8992268981d1 --mode=full
```

Copy the generated file to the VPS (or pull), then:

```sh
sudo -u postgres psql -d zettaz_tours -f apps/api/scripts/sql/generated/seed-into-f6e566ce-full.sql
```

`--mode=catalog` seeds products/pickups/partners only (no synthetic bookings).

The into-tenant SQL remaps catalog/booking UUIDs onto the existing tenant and rewrites actor FKs to that tenant’s owner. It does **not** create staff or change the login email/password.

### Apply on production (into existing tenant)

1. Copy the generated SQL to the VPS (file is gitignored):
   `scp apps/api/scripts/sql/generated/seed-into-f6e566ce-full.sql root@YOUR_VPS:/var/www/zettaz-tours/apps/api/scripts/sql/generated/`
2. On the VPS: `sudo -u postgres psql -d zettaz_tours -f apps/api/scripts/sql/generated/seed-into-f6e566ce-full.sql`
3. Reload the web app and open Catalog / Departures / Reservations.

Do **not** promote the local slug `sample-river-excursions`. Synthetic bookings in `--mode=full` are for demos only, not live operator finance.

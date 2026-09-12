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

Options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--source-slug` | `sample-river-excursions` | Local Rock sample |
| `--target-slug` | `demo-rock-adventures` | New slug on the target DB |
| `--target-name` | `Rock Adventures Demo` | Display name |
| `--mode` | `full` | `full` or `catalog` |
| `--out` | under `scripts/sql/generated/` | Output path |

The SQL remaps all tenant entity UUIDs, creates demo staff as `demo.{user}@zettaz.com`, clears Stripe subscription ids, and forces a Growth trial plan when the local plan id is obsolete.

### Apply on production

1. Migrations current (`npm run db:migrate:prod`) including subscription plans.
2. TablePlus → production **owner** connection.
3. Open the generated SQL, review the target slug / staff emails, run.
4. Protect `demo-rock-adventures` in the clear-signup script if you also clean signup tenants on that database.
5. Sign in with a `demo.*@zettaz.com` identity and the `DEMO_EXPORT_PASSWORD` you set at export time; change it after first login.

Do **not** promote the local slug `sample-river-excursions` or local passwords into production. The export creates a **new** Demo tenant. Synthetic bookings in `--mode=full` are for demos only, not live operator finance.

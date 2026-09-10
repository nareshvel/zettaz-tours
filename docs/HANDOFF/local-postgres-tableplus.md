# Persistent local PostgreSQL and TablePlus

**Recorded:** 9 September 2026

Use this setup when a durable local database is needed for development or TablePlus inspection. The temporary database created by `npm run demo:web` has a random port and password and is discarded when stopped; it is not the TablePlus database.

## Local Docker database

The project Compose service binds PostgreSQL to loopback only. Configure `.env` with a migration-owner connection and a separate restricted runtime connection. This example uses the locally selected database name and port:

```env
POSTGRES_USER=zettaz_owner
POSTGRES_PASSWORD=<owner-password>
ADMIN_DATABASE_URL=postgresql://zettaz_owner:<owner-password>@127.0.0.1:5433/zettaz_tours

DATABASE_ROLE=zettaz_runtime
DATABASE_URL=postgresql://zettaz_runtime:<runtime-password>@127.0.0.1:5433/zettaz_tours
```

The Compose mapping must be `127.0.0.1:5433:5432` and its `POSTGRES_DB` must be `zettaz_tours` when that database name and host port are used. Start and verify the service:

```sh
docker compose up -d postgres
docker compose ps
docker compose exec postgres psql -U zettaz_owner -d zettaz_tours -c "SELECT current_user, current_database();"
```

If port 5432 is already occupied, use port 5433 as above rather than stopping an unrelated local service.

## TablePlus connections

Create an owner connection for schema management:

- Host: `127.0.0.1`
- Port: `5433`
- Database: `zettaz_tours`
- User: `zettaz_owner`
- SSL: disabled

For the runtime role, open an owner query in TablePlus and create it once:

```sql
CREATE ROLE zettaz_runtime
  LOGIN
  PASSWORD '<runtime-password>'
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE;
```

Then apply migrations from the project root:

```sh
npm run db:migrate
```

### Migration result output

The migration command prints the sanitized database target, every discovered SQL
script, and one status per script:

- `[SKIP]` means the stored checksum matches an already-applied script.
- `[RUN ]` identifies the script currently executing.
- `[DONE]` means the script executed successfully and is awaiting the transaction commit.
- `Migration result: COMPLETE` with `Pending: 0` is the success condition.
- `Migration result: INCOMPLETE` means the transaction was rolled back. Scripts shown
  as `DONE` during that run were not committed and remain pending.

The target line intentionally omits the database password. On failure, use `Failed
script` and `Pending scripts` to identify the next action, correct the unapplied
migration, and rerun the command. Never edit a migration whose checksum is already
recorded in `schema_migrations`; add a new corrective migration instead.

Add a second TablePlus connection with the same host, port and database but user `zettaz_runtime`. It is expected to be restricted by row-level security. The API supplies tenant context inside each transaction; the owner connection is for schema inspection and local maintenance only.

To reset the owner password without placing it in shell history, open an interactive `psql` session and use `\password zettaz_owner`. Update `.env` afterward. The `POSTGRES_PASSWORD` Compose variable creates an initial password only; it does not modify an existing database role.

Never commit `.env`, passwords, session tokens, or TablePlus exports containing customer data.

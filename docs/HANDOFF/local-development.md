# Running the tenant workspace and API

**Date:** 9 September 2026

## Implemented scope

NestJS modular API with persistent PostgreSQL storage and a Next.js tenant workspace: database-backed tenant identity and RBAC, support grants, tenant settings, catalog and schedules, availability/holds, reservations and changes, customers/passengers, manual payments, partner finance, operations/resources/pickups, waivers/check-in, integration inbox, notifications queue, reports, audit/outbox, browser/PDF print output, and a connected Expo crew client.

Migrations 001–055 are applied to the persistent local database and the fresh-database API/PostgreSQL suite passes 43 of 43 tests. API startup still deliberately rejects production mode. Privileged MFA, actual gateways, provider-backed delivery, encrypted offline mobile data, physical printer-agent delivery, retained waiver PDFs, tenant-one data validation, and cutover acceptance remain. This is working development software, not launch-ready software.

## Quick start

Prerequisites: Node 22.14+ and npm. The persistent workspace requires its configured PostgreSQL server; for the documented local setup, start Docker Desktop and run `docker compose up -d postgres`. Local PostgreSQL binaries (`initdb`, `pg_ctl`) are needed only for the self-contained temporary demo/test path.

From the project root:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run workspace:dev
```

Open http://127.0.0.1:3191 and sign in with a seeded persistent database identity. The local access-file fallback has been removed from the normal workspace path. If a port is occupied, update `PORT`, `WEB_PORT`, and `WEB_ORIGIN` consistently in `.env`. `npm run demo` remains available for isolated API-only work.

This builds TypeScript, applies migrations to the persistent PostgreSQL database configured in `.env`, starts the API on loopback port 3190, and starts the Next.js workspace on loopback port 3191.

Persistent workspace development uses database-backed sign-in. Seeded local sessions may also be written to `.local/persistent-sample-access.json` for development helpers; they expire after eight hours and are ignored by Git. Do not paste tokens into shared documents. Ctrl-C stops the web server/API process; it does not delete the persistent database.

The disposable `npm run demo` path still creates a temporary isolated PostgreSQL cluster and may write non-secret demo output under `.local/`. Use it for isolated API checks, not normal persistent workspace development.

Visit [API contract](http://127.0.0.1:3190/openapi.json) and [health](http://127.0.0.1:3190/health). These are JSON endpoints, not a frontend. Make authenticated requests with `Authorization: Bearer <tenant token>`; the token selects tenant context. Mutations under tenant façades require a unique `Idempotency-Key` (8–128 permitted characters). Reusing a key with different input returns 409.

For a one-shot demo smoke test: `DEMO_EXIT_AFTER_SEED=1 npm run demo`. Access tokens from that stopped demo are not usable afterward.

## Web session boundary

The Next.js server reads the local access file only when `ZETTAZ_DEMO_WEB=1`. `demo:web` supplies this flag, the absolute `DEMO_ACCESS_FILE`, and a `WEB_ORIGIN` derived from `WEB_PORT` (default: `http://127.0.0.1:3191`). Tokens stay server-side and in HttpOnly, SameSite=Strict cookies; no token is returned in JSON or kept in localStorage. Mutating web requests require the exact configured Origin. The proxy allowlist excludes platform provisioning. Both servers bind to loopback; this setup must not be publicly deployed.

The demo uses owner sessions. Team administration creates mock membership records and applies role/revocation changes; it does not send invitations or provide staff login. The UI derives navigation from session permissions and the API enforces permissions on every request.

## Developer commands

- `npm run workspace:dev`: start the persistent local API and workspace using the seeded Sample tenants.
- `npm run demo:web`: start the complete temporary mock workspace for isolated demo checks only.
- `npm run web:build`: optimized Next.js build including frontend TypeScript checks.
- `npm run web:typecheck`: frontend types without a build.
- `npm run web:smoke`: HTTP integration checks against the running demo at port 3191; creates a synthetic booking. It does not automate browser clicks.
- `npm run mobile:typecheck`: validate the connected Expo crew client.
- `EXPO_PUBLIC_API_BASE_URL=http://<device-reachable-host>:3190 npm run mobile:start`: start the crew client for iOS/Android development.

- `npm run typecheck`: strict TypeScript checks.
- `npm test`: build and execute real database/API tests in an isolated native PostgreSQL cluster. If PostgreSQL binaries are not installed, set `TEST_ADMIN_DATABASE_URL` to a fresh disposable PostgreSQL database; never a production or shared database.
- `npm run db:migrate`: apply checksum-verified migrations using `.env`'s owner connection, granting an already-created runtime role only the required privileges. A successful run ends with `Migration result: COMPLETE` and `Pending: 0`; an incomplete run reports its failed and pending scripts and confirms transaction rollback. See [Persistent local PostgreSQL and TablePlus](local-postgres-tableplus.md#migration-result-output). Create the runtime login role with no superuser, bypass-RLS, database-creation or role-creation privileges. The API refuses a table-owner or bypass-RLS connection.
- `npm run db:seed`: add or complete two persistent, clearly labelled Sample tenants in the configured local database. It is idempotent and never changes another tenant. It creates catalog, schedules, team members, bookings, payments, pickup plans and waiver evidence through application services; it never creates live payment, messaging or external-integration data. It also writes eight-hour owner sessions to `.local/persistent-sample-access.json` for the local workspace selector.
- `npm run dev`: start against `.env` configuration after migrations. Requires explicit demo/test mode and an issued development session; no default credentials.
- `npm run outbox:drain`: consume a tenant's pending outbox in bounded batches using `STAFF_SESSION_TOKEN`. Only the idempotent local observer exists; this does not send email or invoke a payment gateway.

`npm run workspace:dev` starts both the API and web app with the persistent Sample tenant sessions. Run `npm run db:seed` again when those local sessions expire after eight hours. Nest bootstrap route dumps and Next.js incoming-request dumps stay quiet by default; set `NEST_LOG=verbose` or `NEXT_REQUEST_LOG=verbose` in `.env.development` when you need them.

The optional Compose PostgreSQL service needs explicit credentials. Redis is under the `future-integrations` profile. S3-compatible storage is deferred until documents are implemented, so no unused storage service is started. CI declares PostgreSQL 18; local acceptance was performed against installed PostgreSQL 14.17. The CI workflow must run remotely before claiming PostgreSQL 18 verification.

For a durable Docker database and TablePlus connections, including the distinct owner and runtime role setup, see [Persistent local PostgreSQL and TablePlus](local-postgres-tableplus.md).

## Configuration vs implementation limits

Tenant-configurable now: timezone, currency (same booking/collection/reporting currency per tenant in this slice), hold TTL, manual method/source dictionaries, minimum paid percentage, tax basis points, unresolved pickup policy, passenger categories/capacity participation, seasonal rates, recurring weekdays/blackouts and departure capacity. There is no global Rock Adventures catalog or price.

Mock fixtures are in `apps/api/test/fixtures.ts`, visibly named Mock and used only by tests/demo. Mock tax 0 and required payment 100% are explicit fixture choices, not implicit production defaults. Holds snapshot price and confirmation policy for their TTL; later configuration changes affect new holds only.

Deliberate limits: no arbitrary JSON rule engine, no multi-currency conversion, no price override/discount permissions, no charter/transfer engine, no automatic gateway fallback. Expired held bookings are projected as expired from database time; a new hold/reservation is required. Pending manual payment evidence does not settle a balance and has no reconciliation/correction endpoint yet. No real data should use that unfinished financial workflow.

## Security and recovery notes

Runtime access uses a distinct restricted database role and RLS plus application tenant filters. The migration owner bypasses policies for setup; never pass its connection to the API. Session hashes are stored in separate principal tables; raw tokens exist only in the local access file. First-slice roles are deliberately limited to implemented actions; financial overrides and owner transfer have no permissive default.

Audits, payments and snapshots reject updates/deletes. Corrections/reversals need their own later workflows. Outbox writes share business transactions. External consumers, retry backoff/dead-letter UI and privacy retention are still pending. The explicit multipart dependency override pins a patched release until Nest's adapter updates its transitive dependency.

## Current web limits

The catalog displays at most 100 products; departures, reservations and team lists use cursor pagination. Product creation currently supports one initial seasonal date range. Existing product editing, payment correction/reconciliation, richer dashboard reporting, system-admin UI and Partners/Resellers workflows remain future bounded increments. SaaS billing and tenant Connect/regional collection remain separate planned domains with live integrations disabled.

For an unresolved pickup, open Amend reservation to arrange it before confirming; the original hold deadline is preserved. Mock demo state is discarded on restart. Browser interaction and print layout still require visual acceptance before pilot use.

## Reservation amendments and cancellations

Open a reservation and choose **Amend reservation** or **Cancel reservation**. **Amend** reuses the Make reservation page (same discovery layout and guest/stay/contact fields) in amend mode: review a change quote, then Accept or Revise. Amendments quote the proposed guest, phone, purchaser, emergency contact, stay, pickup and (for confirmed reservations) departure/party details before explicit acceptance. Quotes reserve no seats; the server rechecks inventory and the booking version. A failed acceptance preserves the original reservation. Contact/stay/pickup-only changes keep the accepted price; commercial changes use current rates. Source, partner, concession and overbook controls stay locked on amend. After a confirmed party-size change, the reservation detail prompts staff to update the traveller roster.

Tenant settings include **Allow confirmed amendments to create an additional balance due**. This is false unless explicitly enabled; the synthetic tenants enable it for mock exploration. When disabled, the quote's minimum-paid policy must be met before acceptance. Additional balances can be recorded after accepting an allowed amendment. A reduction below paid money shows a credit for finance review, without issuing a refund.

Cancellation requires a reason and UI acknowledgement. It releases seats and removes the booking from manifests, retaining historical prices and payment records. Cancelled bookings cannot collect payments or be reconfirmed. Settled or pending payment records trigger finance review; cancellation establishes neither a fee nor refund entitlement. No financial review completion or refund endpoint exists yet.

Held reservations support guest, stay, contact and pickup corrections and cancellation before expiry. Changing their departure/party requires confirmation first or a new reservation; expiry is never extended by editing. Started or expired bookings are rejected by this pre-departure workflow. Accepted amendments and cancellations appear in booking change history and audit/outbox events.

## Operations board and pickup planning

Open **Operations** and select a tenant-local operating date. The board shows confirmed guests, arranged pickups requiring a stop, planned stops, and unresolved pickup work. Owners, admins and dispatchers can open a departure's **Pickup plan**, create controlled pickup locations, arrange an explicit stop order and save it with optimistic version protection. Saving does not reserve, optimize, map or validate a driving route; it is a dispatcher-entered sequence.

Only future, confirmed bookings with an arranged pickup can be added. Pickup time cannot be later than departure start. Cancelling a booking, changing its departure, or changing its pickup away from arranged removes its stop. Locations, plans and edits are tenant-scoped and audited.

Open **Pickup list** from an operations card or pickup plan to prepare a paper list. The server returns the current departure, plan version, ordered stops and exceptions for unresolved or unplanned pickups. **Print** opens the browser dialog; **Download PDF** creates an auditable print job and streams a tenant-authorized PDF. The list deliberately excludes email, payment status and customer-facing pickup instructions. PDFs are generated on demand and are not retained server-side. It does not calculate routes or enable offline use. Crew/resource assignments and expiry checks are available from **Team & resources**; the departure manifest supports arrival, clearance and boarding only after the payment and waiver gates pass. Physical printer-agent delivery remains planned.

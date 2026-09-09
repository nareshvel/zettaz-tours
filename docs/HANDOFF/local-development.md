# Running the tenant workspace and API

**Date:** 9 September 2026

## Implemented scope

NestJS modular API with real PostgreSQL storage: mock tenant provisioning, opaque expiring sessions, owner-managed staff presets/revocation, versioned tenant policies, shared-tour category/season prices, recurring departures, seat holds, manual reservations/payments, explicit confirmation, immutable snapshots, manifest reads, audit and a durable local outbox consumer.

The next approved increment adds a Next.js tenant workspace: overview, reservations, departures/manifests, catalog creation, recurring schedules, team roles/revocation, tenant policies and audit reads. No Expo application exists yet. API startup deliberately rejects production mode. Interactive login/MFA/invitations, support grants, actual gateways, partner finance, currency conversion, add-ons/contract overrides and remaining Track A workflows are later increments. This is working development software, not launch-ready software.

## Quick start

Prerequisites: Node 22.14+ and npm; local PostgreSQL binaries (`initdb`, `pg_ctl`) on PATH for the self-contained demo/test path. Docker is optional. Existing databases are not used by the demo.

From the project root:

```sh
npm ci
npm run demo:web
```

Open http://127.0.0.1:3191 and choose a mock tenant as its owner. This is a local development selector, not production login. If a port is occupied, update `PORT`, `WEB_PORT`, and `WEB_ORIGIN` consistently in `.env`. `npm run demo` remains available for API-only work.

This builds TypeScript, starts a new isolated local PostgreSQL cluster with a random password/runtime role, applies migrations, launches the API on loopback port 3190, and creates two synthetic tenants with USD and XCD configurations respectively. Each gets one paid and confirmed reservation. There is no live money collection or outbound messaging.

Session tokens and IDs are written to `.local/demo-access.json` with owner-only file permissions. They expire after eight hours and are ignored by Git. Do not paste tokens into shared documents. Ctrl-C stops the web server/API/database; each subsequent demo uses a new isolated cluster. Temporary clusters are stopped but retained in the OS temporary directory for debugging; this workflow is not durable operator storage.

The non-secret demo manifest results are saved to `.local/demo-manifests.json` for inspection after the smoke test.

Visit [API contract](http://127.0.0.1:3190/openapi.json) and [health](http://127.0.0.1:3190/health). These are JSON endpoints, not a frontend. Make authenticated requests with `Authorization: Bearer <tenant token>`; the token selects tenant context. Mutations under tenant façades require a unique `Idempotency-Key` (8–128 permitted characters). Reusing a key with different input returns 409.

For a one-shot demo smoke test: `DEMO_EXIT_AFTER_SEED=1 npm run demo`. Access tokens from that stopped demo are not usable afterward.

## Web session boundary

The Next.js server reads the local access file only when `ZETTAZ_DEMO_WEB=1`. `demo:web` supplies this flag, the absolute `DEMO_ACCESS_FILE`, and a `WEB_ORIGIN` derived from `WEB_PORT` (default: `http://127.0.0.1:3191`). Tokens stay server-side and in HttpOnly, SameSite=Strict cookies; no token is returned in JSON or kept in localStorage. Mutating web requests require the exact configured Origin. The proxy allowlist excludes platform provisioning. Both servers bind to loopback; this setup must not be publicly deployed.

The demo uses owner sessions. Team administration creates mock membership records and applies role/revocation changes; it does not send invitations or provide staff login. The UI derives navigation from session permissions and the API enforces permissions on every request.

## Developer commands

- `npm run demo:web`: start the complete temporary mock workspace.
- `npm run web:build`: optimized Next.js build including frontend TypeScript checks.
- `npm run web:typecheck`: frontend types without a build.
- `npm run web:smoke`: HTTP integration checks against the running demo at port 3191; creates a synthetic booking. It does not automate browser clicks.


- `npm run typecheck`: strict TypeScript checks.
- `npm test`: build and execute real database/API tests in an isolated native PostgreSQL cluster. If PostgreSQL binaries are not installed, set `TEST_ADMIN_DATABASE_URL` to a fresh disposable PostgreSQL database; never a production or shared database.
- `npm run db:migrate`: apply checksum-verified migrations using `.env`'s owner connection, granting an already-created runtime role only the required privileges. Create that login role with no superuser, bypass-RLS, database-creation or role-creation privileges. The API refuses a table-owner or bypass-RLS connection.
- `npm run dev`: start against `.env` configuration after migrations. Requires explicit demo/test mode and an issued development session; no default credentials.
- `npm run outbox:drain`: consume a tenant's pending outbox in bounded batches using `STAFF_SESSION_TOKEN`. Only the idempotent local observer exists; this does not send email or invoke a payment gateway.

The optional Compose PostgreSQL service needs explicit credentials. Redis is under the `future-integrations` profile. S3-compatible storage is deferred until documents are implemented, so no unused storage service is started. CI declares PostgreSQL 18; local acceptance was performed against installed PostgreSQL 14.17. The CI workflow must run remotely before claiming PostgreSQL 18 verification.

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

Open a reservation and choose **Amend reservation** or **Cancel reservation**. Amendments quote the proposed guest/pickup and (for confirmed reservations) departure/party details before explicit acceptance. Quotes reserve no seats; the server rechecks inventory and the booking version. A failed acceptance preserves the original reservation. Contact/pickup-only changes keep the accepted price; commercial changes use current rates.

Tenant settings include **Allow confirmed amendments to create an additional balance due**. This is false unless explicitly enabled; the synthetic tenants enable it for mock exploration. When disabled, the quote's minimum-paid policy must be met before acceptance. Additional balances can be recorded after accepting an allowed amendment. A reduction below paid money shows a credit for finance review, without issuing a refund.

Cancellation requires a reason and UI acknowledgement. It releases seats and removes the booking from manifests, retaining historical prices and payment records. Cancelled bookings cannot collect payments or be reconfirmed. Settled or pending payment records trigger finance review; cancellation establishes neither a fee nor refund entitlement. No financial review completion or refund endpoint exists yet.

Held reservations support guest/pickup corrections and cancellation before expiry. Changing their departure/party requires a new reservation; expiry is never extended by editing. Started or expired bookings are rejected by this pre-departure workflow. Accepted amendments and cancellations appear in booking change history and audit/outbox events.

## Operations board and pickup planning

Open **Operations** and select a tenant-local operating date. The board shows confirmed guests, arranged pickups requiring a stop, planned stops, and unresolved pickup work. Owners, admins and dispatchers can open a departure's **Pickup plan**, create controlled pickup locations, arrange an explicit stop order and save it with optimistic version protection. Saving does not reserve, optimize, map or validate a driving route; it is a dispatcher-entered sequence.

Only future, confirmed bookings with an arranged pickup can be added. Pickup time cannot be later than departure start. Cancelling a booking, changing its departure, or changing its pickup away from arranged removes its stop. Locations, plans and edits are tenant-scoped and audited.

Open **Pickup list** from an operations card or pickup plan to prepare a paper list. The server returns the current departure, plan version, ordered stops and exceptions for unresolved or unplanned pickups. **Print or save PDF** opens the browser's native print dialog. The list deliberately excludes email, payment status and customer-facing pickup instructions. It does not calculate routes, create stored PDFs, enable offline use or certify readiness. Crew/resource assignments, vehicle/vessel documents, cruise-call constraints, weather action and check-in are still pending.

# ADR 009 — First-slice implementation and mock configuration

**Status:** Accepted for development · **Date:** 9 September 2026

Owner accepted the recommendations and authorized coding with mock data. Implement the existing first vertical slice, not the full Track A interface or integrations.

## Decisions

- npm workspaces, strict TypeScript, NestJS API and node-postgres with explicit parameterized SQL and versioned transactional migrations. SQL keeps capacity locking, composite tenant foreign keys and RLS visible. No ORM in this slice.
- PostgreSQL is the capacity and hold authority. All availability writes lock the departure row; live holds are filtered by database time, independent of cleanup. Expired booking holds are terminal; recovery creates a new hold/booking. No unsupported FSM transitions.
- Typed, versioned tenant configuration requires hold TTL, currencies, permitted manual methods, booking sources, minimum payment percentage, tax basis points, unresolved pickup policy and category/season prices. Mock fixtures are opt-in and visibly synthetic. Nonmatching collection/reporting currencies are rejected in this slice rather than silently converted. Future FX uses recorded rates per ADR 004.
- Shared-tour product creation includes one option and configurable categories/rates. Recurring schedules use ISO weekdays, explicit finite dates and IANA timezone; reject nonexistent/ambiguous local times. Category and seasonal pricing first; add-on/contract overrides follow with the remaining E02 scope.
- Freeze server-priced quote at hold creation for its TTL; confirm uses that quote, and never live rates. Configuration changes affect future holds. Require active hold and configured paid percentage, explicit pickup disposition and lead contact; no override or partner credit engine in this slice.
- Tenant and platform principal/session tables are separate. Opaque random bearer tokens are stored hashed, expire, and are checked against active membership on every request. Demo bootstrap and initial owner token issuance are development-only conveniences, not a production identity provider. Production startup is blocked until interactive login/MFA/invitation hardening is implemented. No header-based fake user authentication.
- Runtime database connection must use a non-superuser, non-bypass-RLS role that does not own tables. Migration credentials are separate. Transactions set tenant/actor context locally; all writes emit audit and outbox records atomically.
- PostgreSQL outbox is durable. First-slice worker records idempotent local event receipts only; no notification/payment network consumers. Redis/S3 service definitions are local infrastructure for later epics, not required for this slice's transactions.
- API-first now; Next.js reservation workspace and Expo crew app follow later bounded epics. Live Connect, regional gateways, WP ingress and subscription automation remain disabled/unimplemented, never simulated as successful payments.

## Sources and verification

Implementation guidance checked against [Nest validation](https://docs.nestjs.com/techniques/validation), [node-postgres transactions](https://node-postgres.com/features/transactions), and [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). Actual installed versions are pinned in the lockfile. Tests must exercise a real PostgreSQL database under the restricted runtime role; in-memory mocks cannot prove tenancy or concurrency.

## Production gates

Mock policies are not finance/legal approval. Real gateway eligibility, currency/FX/tax rules, identity/MFA/invitations, deployment/recovery, partner contracts, waivers, support controls and remaining Track A acceptance still require completion. No production-readiness claim follows from the first slice passing tests.

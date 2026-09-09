# Architecture

**Version 2.0 · 5 September 2026**

This document and [DECISIONS/](../DECISIONS/) win on stack, modules, APIs, and tenancy. Index: [README.md](../README.md).

## Decision

Start as a **modular monolith** with strict domain modules, PostgreSQL as the system of record, and durable event/outbox processing. Faster and safer than premature microservices; extraction boundaries stay clean.

Stack is locked (ADR 001). This repository lives under Laravel Herd as a local folder only. The application is TypeScript.

| Layer | Baseline | Reason |
| --- | --- | --- |
| Cloud admin / operations / (later) reseller and customer web | Next.js + TypeScript + responsive PWA | Shared components, agent tooling, later SEO checkout |
| Staff mobile | React Native + Expo, SQLite encrypted offline store | iOS/Android, camera/QR/GPS/push, offline |
| API / backend | NestJS modular monolith | Domain modules, validation, shared types |
| Primary data | PostgreSQL, tenant-aware access | Transactions, constraints, reporting, optional PostGIS later |
| Cache / locks | Redis | Rate limits, short holds, distributed locks |
| Async jobs | Durable queue + transactional outbox | Channel sync, notifications, documents |
| Files | S3-compatible object storage | Waivers, receipts, inspections, incidents, exports |
| Search | Postgres search at launch | Avoid extra infrastructure |
| Observability | Structured logs, traces, metrics, error monitoring | Sync latency, field issues, audit integrations |
| Deployment | Containerized managed cloud, infrastructure as code | Repeatability, backups, environments |

WordPress / WP Travel Engine remains the public booking site in Track A. Next.js does not replace the marketing site in the first slice.

## Logical modules

Communicate through explicit application services and domain events. No cross-module table joins in write paths except through published APIs.

- Identity and tenant
- Catalog, pricing, availability
- Reservation and customer
- Partner (data in Track A; portal in Track B)
- Operations and dispatch
- Finance ledger and invoicing
- Fleet and safety (expiry documents in Track A; full suite Track B)
- Documents, waivers, tickets
- Notifications
- Integration hub and reconciliation
- Reporting read models (SQL views; ADR 008)

Suggested NestJS package layout (adjust to repo conventions only with an ADR):

```text
apps/api          NestJS monolith
apps/web          Next.js admin / ops / later portals
apps/mobile       Expo crew app
packages/shared   Shared types, OpenAPI client types
```

## Tenancy

Single PostgreSQL database. `tenant_id` on every tenant-owned row. UUID primary keys. Row-level security as defense in depth, not as the only check. Application queries always constrain by tenant. Isolation tests are mandatory.

Do not start with schema-per-tenant or database-per-tenant.

Cache keys, object-storage prefixes, queue payloads, logs, and analytics all include `tenant_id`. Platform support access uses time-limited `SupportAccessGrant` and an impersonation banner.

Details: [003-tenancy.md](../DECISIONS/003-tenancy.md).

## Identity partitions

Three principal types. Do not hang them off one `users` table with a type flag and shared passwords.

| Principal | Authenticates as | Sees |
| --- | --- | --- |
| Tenant staff | Tenant membership + RBAC | That tenant’s operations |
| Partner user | Partner organization membership (Track B portal) | Own organization only |
| Customer | Magic link / optional account | Own bookings only |

Platform admins are a fourth, Zettaz-scoped principal with audited support mode — not a tenant role.

Details: [005-identity-partitions.md](../DECISIONS/005-identity-partitions.md).

## API façades

REST/JSON, OpenAPI generated and versioned. Idempotency-Key required for booking, payment, refund, and channel mutation endpoints. Cursor pagination. Filterable timestamps/status. Tenant timezone. Currency as integer minor units. ETag/version for concurrent edits. RFC 9457 problem details. Correlation IDs. Signed webhooks with event id, version, `occurred_at`.

Do not expose one `/v1` surface to every actor.

| Façade | Audience | Auth |
| --- | --- | --- |
| Admin API | Tenant configuration | Staff session / JWT + RBAC |
| Staff / ops API | Reservations, dispatch, check-in | Staff session / JWT + RBAC |
| Public booking API | Guest checkout (Track B) and payment/waiver links | Guest session / signed token |
| Partner API | Reseller portal (Track B) | Partner credentials |
| Integration ingress | WP, later OTAs | Signature + connector allowlist |
| OCTO façade | External connectivity (Track B) | Separate versioning; never leak internal aggregates |

Representative staff/ops routes (shape, not a promise of exact paths):

| Area | Endpoints |
| --- | --- |
| Availability | `GET /v1/products`, `GET /v1/availability`, `POST /v1/holds`, `DELETE /v1/holds/{id}` |
| Bookings | `POST /v1/bookings`, `GET/PATCH /v1/bookings/{id}`, `POST .../confirm`, `POST .../cancel`, `POST .../change-quote` |
| Passengers | `POST/PATCH /bookings/{id}/passengers`, `POST /check-ins`, `POST /waiver-signatures` |
| Operations | `GET /departures/{id}/manifest`, `POST /assignments`, `POST /trip-events`, `GET /dispatch-board` |
| Partners | Track A staff-only; Track B `GET /partner/products`, `POST /partner/bookings` |
| Finance | `POST /payment-sessions`, `POST /check-in-payments`, `POST /refunds`, `GET /invoices` |
| Fleet | `GET /resources`, document expiry; inspections Track B |
| Integrations | `POST /webhooks/{connector}`, `GET /reconciliation-issues`, `POST /sync-jobs` |

## Events and outbox

Write path commits business rows and `OutboxEvent` in one transaction. A worker publishes afterward.

Examples: `booking.held`, `booking.confirmed`, `booking.amended`, `booking.cancelled`, `payment.succeeded`, `payment.failed`, `waiver.signed`, `departure.capacity_changed`, `departure.weather_hold`, `assignment.changed`, `trip.started`, `trip.completed`, `incident.created`, `commission.accrued`, `invoice.issued`, `connector.sync_failed`.

Idempotency: [006-idempotency-and-outbox.md](../DECISIONS/006-idempotency-and-outbox.md).

## Offline synchronization

- Mobile downloads only assigned date windows and minimum passenger data.
- Local commands use device-generated IDs and monotonic client timestamps.
- Server validates version and returns accepted, rejected, or conflict.
- Field events (check-in, trip status) are append-oriented.
- Sensitive cached data is encrypted, expires after the assignment window, and is remotely revocable.
- Photos upload separately with resumable transfer; the event can sync before media completes.

Conflict matrix: [finance-and-offline.md](finance-and-offline.md) and [007-offline-sync.md](../DECISIONS/007-offline-sync.md).

## Reporting

Same database. SQL views or materialized views. No warehouse and no separate read-model service until Track B / Enterprise packaging produces a real reason. [008-reporting-in-postgres.md](../DECISIONS/008-reporting-in-postgres.md).

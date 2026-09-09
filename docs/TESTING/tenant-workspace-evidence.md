# Tenant workspace acceptance evidence

Date: 9 September 2026. Local development increment; not a production launch sign-off.

## Delivered

Next.js tenant selector and role-aware operations navigation; overview counts; searchable/paginated departures, reservations and team records; tour/category/rate creation; recurring schedules and blackouts; hold and quote countdown; guest/source/pickup capture; manual settled-payment recording; explicit confirmation; printable departure manifest; staff preset roles/revocation; versioned tenant policies; audit summaries.

Two configurable synthetic tenants demonstrate independent USD and XCD operations. Existing NestJS services remain authoritative for all business mutations. New read models and a staff-directory RLS migration remain tenant-scoped. The web gateway permits only listed tenant routes, validates mutation origins and stores credentials in HttpOnly, SameSite=Strict cookies.

## Executed checks

- API/PostgreSQL suite: 15 tests passed, including existing capacity races, duplicate-command idempotency, rollback, expiry, price snapshots and permissions. Added coverage for paginated workspace queries, tenant isolation, staff-directory permissions, counts and booking expiry output.
- Stabilized the test harness with one ephemeral loopback listener across concurrent Supertest requests. The earlier implicit listener lifecycle stalled with no active database query. The rerun completed successfully.
- Next.js optimized build: passed compilation, TypeScript and route generation. Separate frontend typecheck passed.
- Web HTTP smoke: passed cookie flags, absence of tokens in tenant selection JSON, unauthenticated reads, cross-origin rejection, platform-route rejection, hold → reservation → payment → confirm → manifest, tenant switch isolation, stale-tab tenant mismatch rejection, logout, and HTTP responses from workspace pages.
- Runtime dependency audit: 0 known vulnerabilities reported; no live provider credentials used.

The reproducible smoke script is `apps/web/scripts/smoke.mjs`; run `npm run web:smoke` against `npm run demo:web`. It inserts synthetic data and checks API responses through Next.js; it is not a browser interaction test. Local database version remains PostgreSQL 14.17. CI PostgreSQL 18 execution has not been observed remotely.

## Acceptance still required

Browser interaction, responsive layout, keyboard navigation and printed manifest inspection have not been automated or visually verified. Production identity/MFA, staff invitations, system administration, booking amendments/cancellation, payment corrections, Partners/Resellers records and financial workflows, SaaS subscription billing, tenant Connect/regional gateways and the remaining launch contract are not implemented in this increment. The current UI must be used with mock data only.

Subsequent increment: booking amendments and cancellations are now implemented; see [booking-changes-evidence.md](booking-changes-evidence.md). The limits above describe the original workspace increment.

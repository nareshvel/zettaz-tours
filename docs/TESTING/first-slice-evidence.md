# First-slice implementation evidence

**Date:** 9 September 2026 · **Environment:** local Node 22.14.0, PostgreSQL 14.17, restricted runtime role.

## Results

- `npm test`: **14 passed, 0 failed**. Includes strict TypeScript compilation and real PostgreSQL/API integration; no in-memory substitute for tenancy or locking.
- `DEMO_EXIT_AFTER_SEED=1 npm run demo`: successful. Two independent mock tenants, USD and XCD respectively, each completed product → recurring departure → hold → manual reservation → manual payment → confirm → manifest. Processes stopped cleanly afterward.
- Dependency installation/audit after the explicit patched multipart override: **0 vulnerabilities reported** at verification time.
- `npm run format:check`: formatting verification recorded after the final formatting pass.
- The generated `.local/demo-manifests.json` contains the demo manifest results without access tokens. The separate access file contains local secrets and must remain untracked.

## Behavior proven

1. Full manual journey, explicit confirmation after payment, immutable price and confirmed-only manifest.
2. Cross-tenant API denial, unscoped SQL isolation under runtime RLS, and composite foreign-key enforcement.
3. Expiry releases availability independently of cleanup; expired confirm fails.
4. Eight simultaneous last-seat hold attempts produce one success; concurrent confirm retries commit capacity once.
5. Concurrent identical idempotency keys create one hold; changed payload conflicts.
6. Pending payments do not settle balance; unsupported currency/method is rejected; payment retries do not duplicate receipts; overpayment is rejected.
7. Role denials, owner-role escalation prevention, revoked memberships and expired sessions.
8. Tenant-specific tax/payment/pickup policy, version conflicts, and policy snapshot stability across configuration changes.
9. Unknown fields, overlapping rates, empty/invalid parties and duplicate departures are rejected.
10. Injected snapshot-write failure rolls back capacity, hold consumption, confirmation audit and outbox; retry succeeds after fault removal.
11. Recurrence rejects DST gaps/ambiguities and invalid dates; blackouts suppress occurrences.
12. Unresolved pickup and stale booking version prevent confirmation without committing seats.
13. Payment/audit/snapshot updates are rejected; concurrent outbox drains produce one durable local receipt per event.
14. Repeat migration succeeds, OpenAPI is served, and production/privileged-database startup is rejected.

## What is not proven or shipped

This is the first development API slice, not complete E01–E10 or a production release. No Next.js/Expo UI, interactive login/MFA/invitations, support grants, live Connect/regional gateway, WP adapter, actual notification delivery, partner remittance/commission engine, currency conversion, waiver/boarding workflow, cancellation/refund corrections, backup restore or deployment has been exercised.

The outbox consumer is a local durable observer. Network delivery/backoff/dead-letter processing is not implemented. Held-booking expiry is projected from database time; no persistent expiry-event worker exists yet. Pending manual-payment correction is not implemented. These limits are explicit in the handoff and should not be hidden by demo data.

CI configuration targets PostgreSQL 18, but CI has not been run remotely. Local results above apply to PostgreSQL 14.17. Real tenant policies, gateway eligibility, legal content and cutover evidence still need approval before production use.

## Next bounded increment

Harden the tenant administration/identity journey and expose the first workflow through the Next.js reservation workspace. Preserve the current PostgreSQL concurrency/isolation suite. Elaborate the remaining E02 pricing and E04 change/cancellation workflows before implementing them; do not enable gateway placeholders or bypass the existing transaction services from the UI.

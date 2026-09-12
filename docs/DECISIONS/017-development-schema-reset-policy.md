# ADR 017 — Development schema redesign and reset policy

**Status:** Accepted for development · **Date:** 10 September 2026

## Context

The application is still in active development. No production tenants or production booking records exist. The early vertical slices intentionally favored proving tenant isolation, holds, reservations, payments, manifests, and audit behavior over final catalog normalization. Product definitions currently embed one option, categories, and rates in JSON, which is too restrictive for the accepted Catalog, availability, and departures architecture.

Treating synthetic records as immutable production history would force compatibility layers into the permanent design, increase implementation complexity, and preserve weak user workflows without protecting a real tenant.

## Decision

During this pre-production phase, engineering may redesign tables, replace development migrations, transform or delete seeded demo records, reset the local database, and reseed bookings when doing so produces a clearer tenant-neutral domain, stronger constraints, or better user experience.

The permission is bounded by these rules:

1. Confirm that the target contains no production tenant or production customer data before a destructive reset.
2. Keep seed data repeatable and clearly synthetic. Tenant-provided approved catalog facts may be reseeded, but synthetic bookings remain labeled as demonstration data.
3. Preserve the target architecture's financial, audit, tenant-isolation, idempotency, and inventory invariants. Permission to reset development data is not permission to weaken those guarantees.
4. Update migrations, seed scripts, API contracts, tests, acceptance evidence, and documentation together. Do not leave an undocumented manual database edit as the required setup path.
5. Before the first production tenant is onboarded, freeze a production migration baseline, document backup/restore and rollback procedures, and prohibit destructive reset migrations outside disposable test/development environments.

For the Catalog redesign, prefer a clean relational model for products, options, units, rate plans, availability rules, availability times/exceptions, departures, and resource requirements. JSON remains appropriate for explicitly extensible content and integration metadata, not core relationships or inventory state.

## Consequences

- Existing local product IDs, departures, holds, bookings, and synthetic history may change or be reseeded during the redesign.
- Development screenshots, test fixtures, and acceptance evidence may need regeneration.
- We can remove the current one-product/one-option limitation rather than maintaining it indefinitely.
- A separate, non-destructive migration policy becomes mandatory before production onboarding.


# ADR 010 — Tenant web workspace

**Status:** Accepted for development · **Date:** 9 September 2026

Owner authorized proceeding from the first API slice to tenant administration and reservation web work.

- Next.js App Router under apps/web, React and scoped CSS. Preserve NestJS domain services and PostgreSQL as the authority. No Sites/Workers/D1 migration or public deployment of this local-only demo.
- Same-origin Next.js route handlers forward allowlisted tenant API calls. The opaque backend session is in an HttpOnly, SameSite=Strict cookie; never browser storage or rendered credentials. Mutation requests validate a configured origin. Gateway requests also verify the UI’s expected tenant against the session to reject stale tabs after a tenant switch. The browser cannot proxy arbitrary URLs or access platform provisioning.
- Explicit opt-in local demo sign-in selects a seeded mock tenant; credentials are read only by the server from the local access file. This is labeled demo access and is not production login. Deployment/onboarding/MFA remain under ADR 009's production gate.
- Add tenant-scoped read models for session, members, departures and reservations. Apply database RLS and existing permissions, including on list/count queries. Use keyset pagination rather than silently dropping results after a fixed count.
- Build the implemented operations only: overview, reservations, new booking, booking detail/payment/confirm, departures and printable manifest, catalog/product/schedule creation, staff records/access and tenant settings/audit. Do not show inactive feature menus or successful gateway placeholders.
- UI mutations retain idempotency keys for uncertain retries, disable repeated submissions and reload authoritative data after success. Tenant switching clears active forms and data; responses are never cached between tenants.
- Tenant-specific rates, categories, payment/source dictionaries and policies come from the API. Label all mock data. Same-currency collection remains the first-slice limit.

Follow [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers) and [cookies](https://nextjs.org/docs/app/api-reference/functions/cookies). HTTP integration tests validate the cookie/proxy boundary; database tests cover the new read models. Frontend compilation is separate from the API's decorator-enabled TypeScript build.

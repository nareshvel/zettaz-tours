# Cross-IDE agent resume guide

**Updated:** 12 September 2026  
**Audience:** ChatGPT Codex, Cursor, Claude, Devin, or another IDE agent continuing this project

This file is the portable resume packet for Zettaz Tours & Charters. Use it when work moves between tools, then update it when a session changes the implementation state, task order, or a standing decision.

## Project identity

Zettaz Tours & Charters is a multi-tenant SaaS platform for tour, charter, excursion, activity and transport operators. Rock Adventures Antigua is the launch tenant and current demo data source. No Rock-specific product, price, rule, permission, channel, payment method, route or partner agreement may be hard-coded into application defaults.

Stack is locked: NestJS modular monolith, Next.js workspace, Expo crew app, PostgreSQL, Redis, S3-compatible storage and transactional outbox. Herd is only the local folder location.

## Read this first

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/AI_CONTEXT/README.md`
4. `docs/AI_CONTEXT/MEMORY.md`
5. `docs/STRATEGY/launch-contract.md`
6. `docs/STRATEGY/implementation-backlog.md`
7. `docs/STRATEGY/ui-waiver-launch-task-list.md`
8. `docs/HANDOFF/local-development.md`

When these conflict, the authority table in `docs/README.md` wins.

## Current implementation state

- Persistent local PostgreSQL is the normal development database. Do not return to the removed browser/local-file sign-in path.
- Migrations are current through `061_staff_login_email_verified.sql` (public sign-in reads `email_verified_at` from `staff_login_identity`, not a direct `staff_users` SELECT under RLS). See `docs/ISSUES_FIXES/signin-email-verified-rls.md`.
- `npm run db:migrate` / `db:migrate:prod` should report `Migration result: COMPLETE` and `Pending: 0`.
- Production demo (`tours.zettaz.com`): tenant `f6e566ce-…` seeded via into-tenant Rock export; owner login preserved (not `demo.owner@…`). Ops notes: `docs/HANDOFF/demo-tenant-export.md`.
- `npm test` currently verifies the database-backed API suite.
- The Next.js workspace, tenant RBAC, staff sessions, tenant settings, subscriptions read model, dashboard, reservations list, manual reservation flow (partner source inline + returnTo), booking changes, customers, operations, resources, partner finance, boarding Pay / partner clearance on the web manifest, integration inbox, reports, print/PDF output, catalog foundation, fixed availability foundation, operational departure views and connected Expo crew app all exist as development foundations.
- Connected crew waiver capture exists for assigned staff, pending passenger names, stay details and signature evidence. Encrypted offline sync, retained authoritative waiver PDFs and optional drive-copy adapters remain open.
- Boarding money pending items: `docs/FEATURES/operations/boarding-balance-collection.md`.

## Current task sequence

The page-by-page UI sequence is tracked in `docs/STRATEGY/ui-waiver-launch-task-list.md`. As of this handoff:

- Complete or owner-accepted foundations: shared responsive baseline, global shell/aside, Overview, Day Board / Plan pickups / Print pickup list (owner-accepted), Reservations list, Catalog, Departures, New reservation discovery (including Departures Book lock), web boarding Pay and partner clearance. Manifest gate toolbar (Search/Scan/Crew) implemented 14 September 2026 — see `docs/FEATURES/operations/manifest-boarding-toolbar.md`.
- **Next executable task (owner direction):** finish **Subscription** polish — billing-cycle and failed-payment/grace messaging (phone/tablet/desktop). Responsive plan grid + profile embedding already shipped; see `docs/TESTING/subscription-polish-evidence.md`.
- Profile polish + responsive flush follow-up are implemented; short owner visual pass can run in parallel. Tenant settings polish + country/tax/currency follow-up is implemented; short owner visual pass can run in parallel. Other polished surfaces still need owner visual passes (see UI task list rows marked “needs owner visual pass”).
- Continue after Subscription with Audit, then any deferred Customers polish.

The broader engineering backlog is in `docs/STRATEGY/implementation-backlog.md`.

## Development commands

From the project root:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run workspace:dev
```

Open `http://127.0.0.1:3191`.

Useful checks:

```sh
npm test
npm run build
npm run web:build
npm run mobile:typecheck
```

Use `npm run demo:web` only for isolated disposable demo checks. The normal workspace uses the persistent database configured in `.env`.

## Documentation rules

- Update `docs/AI_CONTEXT/MEMORY.md` for standing decisions that future agents must know.
- Update `docs/STRATEGY/implementation-backlog.md` when the task order, completion boundary or dependency state changes.
- Update `docs/STRATEGY/ui-waiver-launch-task-list.md` when a page review changes status.
- Add acceptance evidence under `docs/TESTING/` for every completed bounded epic.
- Add implementation details under `docs/FEATURES/` or `docs/MODULES/` when a shipped module needs operational explanation.
- Add tenant-specific research under `docs/CLIENTS/<tenant-slug>/`.
- Do not add one-off guides directly under `docs/`.

## Handoff update checklist

Before leaving a session for another IDE or returning to ChatGPT:

1. Run the relevant checks for the changed surface and record the result.
2. Update the matching `docs/TESTING/*-evidence.md` file, or create one if this is a new bounded epic.
3. Update `implementation-backlog.md` and `ui-waiver-launch-task-list.md` if status or next task changed.
4. Update `MEMORY.md` only for durable decisions, not routine progress.
5. Leave code, migrations, seed data and docs aligned. If a migration is already applied, create the next numbered migration rather than editing applied migration history.

## Open decisions and dependencies

Do not invent these in code:

- Stripe live Connect account eligibility, responsibility terms, fees/disputes, webhook secrets and card-present path.
- Approved XCD-to-USD rate source and rounding rule.
- SMTP credentials, sender-domain DNS verification and production delivery rules.
- Printer/station inventory, Go print-agent deployment policy and retained-document policy.
- Encrypted offline mobile retention, device revoke/wipe behavior and production privacy acceptance.
- Rock sign-off for final schedules, capacities, waiver text and operational configuration.
- Production cutover evidence from the 7-14 day parallel run.
- Complimentary/prepaid boarding-policy flags, authorized boarding exceptions, mixed collection, crew-mobile Pay UI (see boarding-balance-collection.md).

## Agent operating notes

- Work one bounded epic at a time with migrations, tests and acceptance evidence.
- Prefer server-side permission checks and tenant predicates over UI-only hiding.
- Keep tenant data configurable; seed Rock-flavored demo records only through seed/client data paths.
- Preserve append-only financial, waiver and audit facts.
- Never mark a page complete based only on visual appearance. Verify phone, tablet, desktop, keyboard and role-denied behavior where applicable.

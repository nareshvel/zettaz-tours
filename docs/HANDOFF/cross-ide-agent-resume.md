# Cross-IDE agent resume guide

**Updated:** 19 September 2026  
**Audience:** ChatGPT Codex, Cursor, Claude, Devin, or another IDE agent continuing this project

This file is the portable resume packet for Zettaz Tours & Charters. Use it when work moves between tools, then update it when a session changes the implementation state, task order, or a standing decision.

## Start here every session

1. [agent-current-sprint.md](agent-current-sprint.md) — **what is next / what is closed / deploy truth**
2. [../AI_CONTEXT/MEMORY.md](../AI_CONTEXT/MEMORY.md) — standing decisions
3. [../STRATEGY/launch-contract.md](../STRATEGY/launch-contract.md) — Track A vs B
4. [../STRATEGY/implementation-backlog.md](../STRATEGY/implementation-backlog.md) — epic order
5. [../STRATEGY/ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md) — page polish status
6. [../STRATEGY/crew-app-delivery.md](../STRATEGY/crew-app-delivery.md) — Zettaz Crew phases (do not start Phase 1 until owner-accepted)
7. [deploy.md](deploy.md) — VPS pull/build (do not invent ad-hoc `psql -f` migration steps)

Also: root `AGENTS.md`, [../README.md](../README.md), [../AI_CONTEXT/README.md](../AI_CONTEXT/README.md), [local-development.md](local-development.md).

When docs conflict, the authority table in [../README.md](../README.md) wins. When **execution focus** conflicts with chat history, **agent-current-sprint.md wins**.

## Project identity

Zettaz Tours & Charters is a multi-tenant SaaS platform for tour, charter, excursion, activity and transport operators. Rock Adventures Antigua is the launch tenant and current demo data source. No Rock-specific product, price, rule, permission, channel, payment method, route or partner agreement may be hard-coded into application defaults.

Stack is locked: NestJS modular monolith, Next.js workspace, Expo crew app, PostgreSQL, Redis, S3-compatible storage and transactional outbox. Herd is only the local folder location.

## Current implementation state

- Persistent local PostgreSQL is the normal development database.
- Repo migrations exist through **`089_crew_captain_roles.sql`**. Production migrate via `./deploy.sh` → `db:migrate:prod`. Sign-in email verification under RLS: migration `061` + [../ISSUES_FIXES/signin-email-verified-rls.md](../ISSUES_FIXES/signin-email-verified-rls.md).
- **VPS tip `cad0ed8`**. `origin/main` is `0acc028` (retained waiver PDF). Owner deploying. Profile polish is local until committed.
- Production demo (`tours.zettaz.com`): tenant `f6e566ce-…`; deploy notes in [deploy.md](deploy.md) and [demo-tenant-export.md](demo-tenant-export.md).
- **Ops pickups (14 September 2026) closed:** Plan pickups Phase 1, Print list polish, Settings → Pickup locations (Esri map, tenant city/country default), demo multi-stop seed. See [../FEATURES/operations/pickup-disposition-and-plans.md](../FEATURES/operations/pickup-disposition-and-plans.md) and [../TESTING/pickup-location-modal-and-print-evidence.md](../TESTING/pickup-location-modal-and-print-evidence.md).
- Connected crew Phases 1–4 live on production (`088`/`089` applied). 4.8 airplane-mode drill is owner after EAS.
- Boarding money pending: [../FEATURES/operations/boarding-balance-collection.md](../FEATURES/operations/boarding-balance-collection.md).

## Current task sequence

See [agent-current-sprint.md](agent-current-sprint.md). Short form (19 Sep):

1. **Crew store binaries** iOS ASC `6813693098` 1.0.1 (2); Play Internal 1.0.1/2. Engineering Phases 1–4 on production. Owner: Unlisted/review notes, screenshots, **4.8 airplane-mode**.
2. **Do not start Phase 5** (kiosk, GPS, card-present, push, white-label).
3. **Operations menu group closed** pending further testing.
4. **Customers / Audit / Document library** polish on production (owner visual outstanding). **Profile + Crew field-pass** local. Settings General/Taxes/Stays + Finance Partners list pass 19 Sep.
5. **Hold** Subscription messaging polish.

Pasteable Claude brief: [claude-handoff-2026-09-14.md](claude-handoff-2026-09-14.md).

## Development commands

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run workspace:dev
```

Open `http://127.0.0.1:3191`.

```sh
npm test
npm run build
npm run web:build
npm run mobile:typecheck
```

## Documentation rules

- Update [agent-current-sprint.md](agent-current-sprint.md) whenever next task or git/deploy truth changes.
- Update `MEMORY.md` for standing decisions only (keep under 200 lines).
- Update `implementation-backlog.md` / `ui-waiver-launch-task-list.md` when status changes.
- Add acceptance evidence under `docs/TESTING/`.
- Feature write-ups under `docs/FEATURES/` or `docs/MODULES/`.
- Never drop new guides at `docs/` root.
- **Commit and push** handoff/doc updates so the next IDE and the VPS share the same truth.

## Handoff update checklist

1. Run checks for the changed surface; record results in TESTING evidence.
2. Refresh agent-current-sprint.md (next task + closed items).
3. Sync ui-waiver-launch-task-list.md / implementation-backlog.md.
4. MEMORY.md only for durable decisions.
5. Push to `origin/main` before asking another agent or redeploying.

## Open decisions (do not invent)

- Stripe Connect eligibility, fees/disputes, webhooks, card-present
- Approved XCD-to-USD rate source and rounding
- SMTP sender-domain DNS / production delivery policy
- Printer inventory, Go agent retention
- Rock waiver legal text, schedules/capacities sign-off, cutover parallel-run evidence
- Complimentary/prepaid boarding flags, boarding exceptions, mixed collection

## Agent operating notes

- Prefer [agent-current-sprint.md](agent-current-sprint.md) over prior chat summaries (they go stale).
- One bounded epic at a time with migrations, tests, and evidence.
- Server-side permission checks; no Rock hard-coding.
- Append-only financial, waiver, and audit facts.
- Never mark a page complete on appearance alone.

# Cross-IDE agent resume guide

**Updated:** 14 September 2026  
**Audience:** ChatGPT Codex, Cursor, Claude, Devin, or another IDE agent continuing this project

This file is the portable resume packet for Zettaz Tours & Charters. Use it when work moves between tools, then update it when a session changes the implementation state, task order, or a standing decision.

## Start here every session

1. [agent-current-sprint.md](agent-current-sprint.md) — **what is next / what is closed / deploy truth**
2. [../AI_CONTEXT/MEMORY.md](../AI_CONTEXT/MEMORY.md) — standing decisions
3. [../STRATEGY/launch-contract.md](../STRATEGY/launch-contract.md) — Track A vs B
4. [../STRATEGY/implementation-backlog.md](../STRATEGY/implementation-backlog.md) — epic order
5. [../STRATEGY/ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md) — page polish status
6. [deploy.md](deploy.md) — VPS pull/build (do not invent ad-hoc `psql -f` migration steps)

Also: root `AGENTS.md`, [../README.md](../README.md), [../AI_CONTEXT/README.md](../AI_CONTEXT/README.md), [local-development.md](local-development.md).

When docs conflict, the authority table in [../README.md](../README.md) wins. When **execution focus** conflicts with chat history, **agent-current-sprint.md wins**.

## Project identity

Zettaz Tours & Charters is a multi-tenant SaaS platform for tour, charter, excursion, activity and transport operators. Rock Adventures Antigua is the launch tenant and current demo data source. No Rock-specific product, price, rule, permission, channel, payment method, route or partner agreement may be hard-coded into application defaults.

Stack is locked: NestJS modular monolith, Next.js workspace, Expo crew app, PostgreSQL, Redis, S3-compatible storage and transactional outbox. Herd is only the local folder location.

## Current implementation state

- Persistent local PostgreSQL is the normal development database.
- Repo migrations exist through **`067_booking_created_at.sql`**. Production migrate via `./deploy.sh` → `db:migrate:prod`. Sign-in email verification under RLS: migration `061` + [../ISSUES_FIXES/signin-email-verified-rls.md](../ISSUES_FIXES/signin-email-verified-rls.md).
- **`main` tracks `origin/main`** as of 14 September 2026 tip `a18e083` (pickup location improvement). Do not claim auth/trial migration `060` is “unpushed.”
- Production demo (`tours.zettaz.com`): tenant `f6e566ce-…`; deploy notes in [deploy.md](deploy.md) and [demo-tenant-export.md](demo-tenant-export.md).
- **Ops pickups (14 September 2026) closed:** Plan pickups Phase 1, Print list polish, Settings → Pickup locations (Esri map, tenant city/country default), demo multi-stop seed. See [../FEATURES/operations/pickup-disposition-and-plans.md](../FEATURES/operations/pickup-disposition-and-plans.md) and [../TESTING/pickup-location-modal-and-print-evidence.md](../TESTING/pickup-location-modal-and-print-evidence.md).
- Connected crew waiver capture exists. Encrypted offline sync, retained waiver PDFs, drive-copy adapters, crew-mobile Pay remain open.
- Boarding money pending: [../FEATURES/operations/boarding-balance-collection.md](../FEATURES/operations/boarding-balance-collection.md).

## Current task sequence

See [agent-current-sprint.md](agent-current-sprint.md). Short form (owner priority 14 Sep evening):

1. **Operations menu group closed** pending further testing — do not expand Ops features.
2. **Hold** Subscription messaging polish.
3. **Next:** verify/improve non-Operations groups (Workspace → Insights → Administration → Profile).
4. VPS already at `a18e083`; only redeploy after new pushes.

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
- Complimentary/prepaid boarding flags, boarding exceptions, mixed collection, crew-mobile Pay

## Agent operating notes

- Prefer [agent-current-sprint.md](agent-current-sprint.md) over prior chat summaries (they go stale).
- One bounded epic at a time with migrations, tests, and evidence.
- Server-side permission checks; no Rock hard-coding.
- Append-only financial, waiver, and audit facts.
- Never mark a page complete on appearance alone.

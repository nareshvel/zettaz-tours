# Decisions

Architecture Decision Records only. One accepted decision per file. Do not reopen 001–008 without evidence.

| ADR | Title |
| --- | --- |
| [001](001-stack-nestjs.md) | NestJS, Next.js, Expo |
| [002](002-modular-monolith.md) | Modular monolith |
| [003](003-tenancy.md) | Single-database tenancy |
| [004](004-money.md) | Integer minor units, snapshots, append-only ledger |
| [005](005-identity-partitions.md) | Staff, partner, and customer principals |
| [006](006-idempotency-and-outbox.md) | Idempotency keys and transactional outbox |
| [007](007-offline-sync.md) | Offline command queue and conflict rules |
| [008](008-reporting-in-postgres.md) | Reporting in PostgreSQL, no warehouse in Track A |

[009 — First-slice foundation](009-first-slice-foundation.md) is accepted for development with mock data.

Next ADR is `010-<slug>.md`. Status line: Proposed or Accepted, plus date.

- [010 — Tenant web workspace](010-tenant-web-workspace.md) — local mock Next.js operations UI and session proxy.

- [011 — Booking amendments and cancellation](011-booking-amendments-cancellation.md) — quoted changes, capacity-safe acceptance and cancellation without automatic refunds.
- [012 — Operations board and pickup planning](012-operations-pickup-planning.md) — tenant-controlled pickup stops and manual day planning.
- [013 — Weather and closure controls](013-weather-closure-controls.md) — non-sellable operational status before commercial policy actions.
- [014 — Tenant branding and localization](014-tenant-branding-localization.md) — local logo files, presentation preferences and versioned waiver content.
- [015 — Channel-neutral booking core](015-channel-neutral-booking-core.md) — canonical booking ownership with source-specific adapters and reconciliation.
- [016 — Rock launch payments and operating controls](016-rock-launch-operations.md) — Stripe Connect/USD, SMTP, MFA, printer enrollment, offline data, and cutover controls.
- [017 — Development schema redesign and reset policy](017-development-schema-reset-policy.md) — permits coordinated schema replacement and demo-data reseeding before production, while retaining target invariants.
- [018 — Print delivery and the shared print agent](018-print-delivery-and-agent.md) — server-rendered vector PDF in four paper profiles, delivered to the shared Zettaz Go agent or the browser, with every job recorded.

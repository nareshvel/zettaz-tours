# Zettaz Tours & Charters — documentation

**Version 2.0 · 5 September 2026**

Working product and engineering spec. Rock Adventures Antigua is tenant one. No Rock Adventures tour name, rate, pickup, payment rule, or partner deal may be hard-coded.

Requirements elaboration (9 September 2026): start at [STRATEGY/requirements-plan.md](STRATEGY/requirements-plan.md) for module boundaries, RBAC, tenant/platform administration, navigation, payments and the first-slice specification. The owner accepted recommendations and authorized implementation with mock data on September 9. See [local development](HANDOFF/local-development.md) for the first-slice API and remaining production gates.

This folder is the home for **all** future project documentation. Put new files in the folder that matches the type (see below). Do not add one-off guides at this root.

The v1.1 blueprint is historical: [archive/Zettaz_Tours_Charters_Product_Blueprint_v1.1.md](archive/Zettaz_Tours_Charters_Product_Blueprint_v1.1.md).

Tenant sample waiver (not legal spec): [CLIENTS/rock-adventures/waiver-content.md](CLIENTS/rock-adventures/waiver-content.md).

## Authority on conflict

| Topic | Wins |
| --- | --- |
| Scope, tracks, deferrals, go-live | [STRATEGY/launch-contract.md](STRATEGY/launch-contract.md) |
| Entities, invariants, state machines | [ARCHITECTURE/domain-and-states.md](ARCHITECTURE/domain-and-states.md) |
| Stack, modules, APIs, tenancy | [ARCHITECTURE/overview.md](ARCHITECTURE/overview.md) and [DECISIONS/](DECISIONS/) |
| First slice and epic order | [STRATEGY/delivery.md](STRATEGY/delivery.md) |

## Where a new file goes

| Folder | Use for |
| --- | --- |
| [STRATEGY/](STRATEGY/) | Vision, launch contract, roadmaps, delivery |
| [ARCHITECTURE/](ARCHITECTURE/) | Domain, system design, APIs, pricing, workflows, finance, integrations |
| [DECISIONS/](DECISIONS/) | Architecture Decision Records only |
| [AI_CONTEXT/](AI_CONTEXT/) | Agent orientation and session memory |
| [CLIENTS/](CLIENTS/) | Tenant-specific content (never product defaults) |
| [FEATURES/](FEATURES/) | One folder per epic once you start building |
| [MODULES/](MODULES/) | How a shipped Nest module actually works |
| [TESTING/](TESTING/) | Test plans and acceptance evidence |
| [HANDOFF/](HANDOFF/) | Session notes, cutover runbooks, deploy notes |
| [ISSUES_FIXES/](ISSUES_FIXES/) | Bug + resolution write-ups |
| [archive/](archive/) | Superseded specs |

Do not create a product-named folder at `docs/` root (no `timeclock`-style exception). Client material goes under `CLIENTS/<tenant-slug>/`.

## Reading order (working spec)

1. [STRATEGY/product-vision.md](STRATEGY/product-vision.md) — thesis, roles, success
2. [STRATEGY/launch-contract.md](STRATEGY/launch-contract.md) — Track A vs Track B
3. [ARCHITECTURE/domain-and-states.md](ARCHITECTURE/domain-and-states.md) — model and three FSMs
4. [ARCHITECTURE/pricing-and-inventory.md](ARCHITECTURE/pricing-and-inventory.md) — Phase 1 bounds
5. [ARCHITECTURE/workflows.md](ARCHITECTURE/workflows.md) — including weather, cruise, migration
6. [ARCHITECTURE/overview.md](ARCHITECTURE/overview.md) — NestJS modular monolith
7. [DECISIONS/](DECISIONS/) — accepted ADRs 001–008
8. [ARCHITECTURE/finance-and-offline.md](ARCHITECTURE/finance-and-offline.md)
9. [ARCHITECTURE/integrations.md](ARCHITECTURE/integrations.md)
10. [ARCHITECTURE/ux-security-reporting.md](ARCHITECTURE/ux-security-reporting.md)
11. [STRATEGY/delivery.md](STRATEGY/delivery.md) — first slice, backlog, agent prompt
12. [STRATEGY/implementation-backlog.md](STRATEGY/implementation-backlog.md) — current execution order and unresolved decisions
13. [STRATEGY/crew-app-delivery.md](STRATEGY/crew-app-delivery.md) — Zettaz Crew phases (one binary; Track A/B leftovers)
14. [ARCHITECTURE/configuration-schema.md](ARCHITECTURE/configuration-schema.md) — seed / workbook

## Coding agents

Start at [AI_CONTEXT/README.md](AI_CONTEXT/README.md). When work moves between ChatGPT, Cursor, Claude, Devin or another IDE agent, read [HANDOFF/agent-current-sprint.md](HANDOFF/agent-current-sprint.md) first (next task + deploy truth), then [HANDOFF/cross-ide-agent-resume.md](HANDOFF/cross-ide-agent-resume.md). Prefer the sprint board over chat history. Then read the launch contract and [STRATEGY/delivery.md](STRATEGY/delivery.md) before writing application code. Root [AGENTS.md](../AGENTS.md) restates the same rule.

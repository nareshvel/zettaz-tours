# Agent instructions

This repository is **Zettaz Tours & Charters**, a multi-tenant SaaS platform for tour, charter, excursion, and transport operators. Rock Adventures Antigua is the launch tenant. No domain rule, label, product, channel, price, route, payment method, or partner agreement may be hard-coded for that tenant.

## Authoritative docs

Start at [docs/README.md](docs/README.md) and [docs/AI_CONTEXT/README.md](docs/AI_CONTEXT/README.md).

On conflict:

- Scope and deferrals: [docs/STRATEGY/launch-contract.md](docs/STRATEGY/launch-contract.md)
- States and entities: [docs/ARCHITECTURE/domain-and-states.md](docs/ARCHITECTURE/domain-and-states.md)
- Stack and APIs: [docs/ARCHITECTURE/overview.md](docs/ARCHITECTURE/overview.md) and [docs/DECISIONS/](docs/DECISIONS/)
- First slice: [docs/STRATEGY/delivery.md](docs/STRATEGY/delivery.md)

[docs/archive/Zettaz_Tours_Charters_Product_Blueprint_v1.1.md](docs/archive/Zettaz_Tours_Charters_Product_Blueprint_v1.1.md) is historical. Do not implement from it.

Put new documentation in the matching `docs/` folder (STRATEGY, ARCHITECTURE, DECISIONS, FEATURES, MODULES, TESTING, HANDOFF, ISSUES_FIXES, CLIENTS, AI_CONTEXT). Do not drop new guides at `docs/` root.

## Before writing application code

1. Read the launch contract and the first-slice section of the delivery doc.
2. State assumptions and unresolved decisions from the launch contract.
3. Implement one bounded epic at a time with migrations, tests, and acceptance evidence.
4. Use feature flags for unfinished external integrations. Do not invent placeholder business logic that silently becomes authoritative.

## Stack (locked)

NestJS modular monolith, Next.js (admin / reseller / customer web), Expo (staff mobile), PostgreSQL, Redis, S3-compatible storage, transactional outbox. See [docs/DECISIONS/001-stack-nestjs.md](docs/DECISIONS/001-stack-nestjs.md) and [docs/ARCHITECTURE/overview.md](docs/ARCHITECTURE/overview.md).

## Preferred first vertical slice

Create tenant → configure a shared tour product and recurring departure → query availability → create a short inventory hold → create a manual reservation → record an offline/manual payment state → confirm booking → show it on the departure manifest → audit every mutation.

Details: [docs/STRATEGY/delivery.md](docs/STRATEGY/delivery.md).

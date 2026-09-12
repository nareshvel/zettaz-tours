# Architecture

System design and domain rules. Stack decisions live in [../DECISIONS/](../DECISIONS/).

September 9 requirements elaboration: [module map](module-feature-map.md), [RBAC](rbac-and-access.md), [administration/navigation](admin-navigation.md), and [tenant payments](tenant-payments.md). The owner accepted this design direction for mock-data implementation; see the [decision register](../STRATEGY/requirements-plan.md).

| File | Role |
| --- | --- |
| [overview.md](overview.md) | NestJS monolith, tenancy, API façades — wins on stack with DECISIONS |
| [domain-and-states.md](domain-and-states.md) | Entities and three FSMs — wins on states |
| [pricing-and-inventory.md](pricing-and-inventory.md) | Phase 1 pricing and inventory strategies |
| [workflows.md](workflows.md) | End-to-end flows, weather, cruise, migration |
| [finance-and-offline.md](finance-and-offline.md) | Ledger, FX, sync conflict matrix |
| [integrations.md](integrations.md) | Channels, payments, comms |
| [ux-security-reporting.md](ux-security-reporting.md) | Surfaces, security, metrics |
| [responsive-admin-layout.md](responsive-admin-layout.md) | Phone / tablet / desktop layout rules for workspace pages |
| [configuration-schema.md](configuration-schema.md) | Tenant seed / workbook contract |

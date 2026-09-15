# Modules

How a **shipped** NestJS (or web/mobile) module actually works: tables, APIs, invariants as implemented. Write these after the first slice lands. Until then, design lives in [../ARCHITECTURE/](../ARCHITECTURE/).

## Catalog

- [Catalog/schedules-tab.md](Catalog/schedules-tab.md) — Catalog Schedules list (rules, filters, pause/resume)
- [Catalog/schedule-regenerate-on-edit.md](Catalog/schedule-regenerate-on-edit.md) — edit capacity/dates/times with booking-safe regenerate
- [Catalog/shared-capacity-vs-fleet.md](Catalog/shared-capacity-vs-fleet.md) — seat pools vs fleet resources (revisit triggers)
- [Catalog/assignments-from-fleet-deferred.md](Catalog/assignments-from-fleet-deferred.md) — assignments relocated to Catalog (DnD / bulk deferred)
- [Catalog/schedules-view-gemini-suggestion.md](Catalog/schedules-view-gemini-suggestion.md) — archived ops-board inspiration (not Catalog)

## Tenant settings

- [Tenant_settings/global-catalogs-plan.md](Tenant_settings/global-catalogs-plan.md) — shared platform catalogs with tenant additions
- [Tenant_settings/global_cruise_calls_seed_data.md](Tenant_settings/global_cruise_calls_seed_data.md) — vessel seed research (cruise calls themselves were dropped; vessels only)
- Printing: [../FEATURES/operations/printing-and-print-agent.md](../FEATURES/operations/printing-and-print-agent.md)
- Waivers: [../FEATURES/tenant-settings/waiver-template-lifecycle.md](../FEATURES/tenant-settings/waiver-template-lifecycle.md)
- Localization: [../FEATURES/tenant-settings/global-localization.md](../FEATURES/tenant-settings/global-localization.md)

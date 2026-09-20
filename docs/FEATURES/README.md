# Features

One subfolder per epic once implementation starts (for example `FEATURES/E01-tenant-identity/`). Add a file when there is a spec or acceptance note to record. Do not add empty “coming soon” stubs.

Current cross-epic specification: [first-slice/requirements.md](first-slice/requirements.md), covering tenant creation through confirmed booking and manifest. Requirements are accepted for mock-data development; [test evidence](../TESTING/first-slice-evidence.md) records the implemented subset.

Current operations specification: [operations/resources-and-assignments.md](operations/resources-and-assignments.md), defining the Track A minimum for crew/resource records, expiry controls and departure assignment.

Crew connected-mobile boundary: [operations/crew-mobile-facade.md](operations/crew-mobile-facade.md). Default Crew role × permission matrix: [operations/crew-roles-and-permissions.md](operations/crew-roles-and-permissions.md). Phased Track A/B delivery: [../STRATEGY/crew-app-delivery.md](../STRATEGY/crew-app-delivery.md). Live GPS held: [../STRATEGY/crew-gps-later.md](../STRATEGY/crew-gps-later.md). Phase 1 evidence: [../TESTING/crew-app-phase-1-evidence.md](../TESTING/crew-app-phase-1-evidence.md). Phase 2 evidence: [../TESTING/crew-app-phase-2-evidence.md](../TESTING/crew-app-phase-2-evidence.md). Phase 3 evidence: [../TESTING/crew-app-phase-3-evidence.md](../TESTING/crew-app-phase-3-evidence.md). Phase 4 evidence: [../TESTING/crew-app-phase-4-evidence.md](../TESTING/crew-app-phase-4-evidence.md). Field-pass UI: [../TESTING/crew-field-pass-ui-evidence.md](../TESTING/crew-field-pass-ui-evidence.md).

Short-lived document hot store and archive sync-out: [operations/document-storage.md](operations/document-storage.md).

Boarding guest-balance collection and partner clearance policy: [operations/boarding-balance-collection.md](operations/boarding-balance-collection.md).

Printing, paper profiles and the shared print agent: [operations/printing-and-print-agent.md](operations/printing-and-print-agent.md).

Waiver template versioning and deletion rules: [tenant-settings/waiver-template-lifecycle.md](tenant-settings/waiver-template-lifecycle.md).

Customer communication boundary: [customer-notifications.md](customer-notifications.md).

Customer identity, booking snapshots and history: [reservations/customer-records.md](reservations/customer-records.md). Insights list/detail polish: [../TESTING/customers-polish-evidence.md](../TESTING/customers-polish-evidence.md). Audit trail polish: [../TESTING/audit-polish-evidence.md](../TESTING/audit-polish-evidence.md). Document library polish: [../TESTING/document-library-polish-evidence.md](../TESTING/document-library-polish-evidence.md). Profile polish: [../TESTING/profile-polish-evidence.md](../TESTING/profile-polish-evidence.md).

Mode-aware New reservation discovery: [reservations/mode-aware-discovery.md](reservations/mode-aware-discovery.md).

Track A operational and commercial read model: [reporting-minimum.md](reporting-minimum.md). Finance Track A: [finance/PLAN.md](finance/PLAN.md). Accounting export (CSV first, not built): [finance/accounting-export.md](finance/accounting-export.md). Cashbook Phases 2–4 (held): [../STRATEGY/finance-money-in-out-later.md](../STRATEGY/finance-money-in-out-later.md).

Catalog Schedules IA and product editor tables/modals: [catalog-schedules-ia.md](catalog-schedules-ia.md). Nested adult/child occupancy: [nested-occupancy.md](nested-occupancy.md).

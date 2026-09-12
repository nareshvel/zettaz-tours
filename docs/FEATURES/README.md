# Features

One subfolder per epic once implementation starts (for example `FEATURES/E01-tenant-identity/`). Add a file when there is a spec or acceptance note to record. Do not add empty “coming soon” stubs.

Current cross-epic specification: [first-slice/requirements.md](first-slice/requirements.md), covering tenant creation through confirmed booking and manifest. Requirements are accepted for mock-data development; [test evidence](../TESTING/first-slice-evidence.md) records the implemented subset.

Current operations specification: [operations/resources-and-assignments.md](operations/resources-and-assignments.md), defining the Track A minimum for crew/resource records, expiry controls and departure assignment.

Crew connected-mobile boundary: [operations/crew-mobile-facade.md](operations/crew-mobile-facade.md).

Short-lived document hot store and archive sync-out: [operations/document-storage.md](operations/document-storage.md).

Boarding guest-balance collection and partner clearance policy: [operations/boarding-balance-collection.md](operations/boarding-balance-collection.md).

Customer communication boundary: [customer-notifications.md](customer-notifications.md).

Customer identity, booking snapshots and history: [reservations/customer-records.md](reservations/customer-records.md).

Mode-aware New reservation discovery: [reservations/mode-aware-discovery.md](reservations/mode-aware-discovery.md).

Track A operational and commercial read model: [reporting-minimum.md](reporting-minimum.md).

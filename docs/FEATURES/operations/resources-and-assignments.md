# Resources, crew and departure assignments

## Purpose

Give a tenant one operational source of truth for the people and assets required to run a departure. This is the Track A minimum for guides, drivers, skippers, vehicles, vessels and equipment. It is not the Track B maintenance suite.

## Assumptions and unresolved decisions

- A tenant configures the resource types and assignment requirements for each product or departure. No operator's guide, driver, vessel, vehicle or safety rule is a product default.
- A staff member may have multiple tenant memberships; a crew record links a tenant membership to operational qualifications without granting additional application permissions.
- A required document has a tenant-defined type, expiry date and optional uploaded evidence file (PDF/JPG/PNG/WebP). Files live in a long-lived per-tenant document library with a hard storage quota (default 1 GiB).
- A document expiring today is not valid for a new assignment unless a tenant policy says otherwise. The initial implementation treats expiry before the departure's local date as expired.
- An override requires `safety.assignment.override`, a reason, actor, time and audit event. The implementation permits it only when the selected subject has an expired document; it does not make unrelated assignments broadly exempt.
- Full inspections, defects, maintenance, fuel, utilization and route optimization are Track B.

## Minimum model

- `operational_resources`: tenant-owned **named** asset (one row per unit), code, name, **kind** (vehicle, van, bus, tuk-tuk, vessel, boat, jet ski, kayak, equipment, snorkel gear, other), passenger seats, make, model, registration/ID, active state, and notes. Eighteen units means eighteen rows.
- `crew_profiles`: tenant membership, display/operational name, active state and notes.
- `compliance_documents`: tenant-owned document for exactly one resource or crew profile, document type, expiry date, optional file metadata (`file_name`, `content_type`, `byte_size`, `storage_key`), and optional legacy evidence reference text.
- `departure_assignments`: departure, one crew or resource subject, assignment role, scheduled time window, status, override reason and audit linkage.

The database must enforce tenant-scoped foreign keys and prevent an active resource or crew profile from overlapping assignments in the same time window. It must also prevent a crew member or resource from being assigned when a required applicable document is expired, unless an audited authorized override is present.

## API and UI sequence

1. Manage people under **Staff** (Add staff, Grant access, personal compliance documents with upload). Every staff membership has a crew profile for assignment.
2. Manage fleet assets under **Assets** (identity on the asset sheet; papers listed there). Kind includes jet ski, kayak, van, boat, and similar. Make, model, and registration/ID identify the unit. Insurance, registration, license, and inspection are **expiry documents** (suggested types, custom allowed); they still block assignment when expired. Add document and view document open their own modals.
3. Manage all compliance files and storage usage under **Document library** (`/document-library`).
4. Assign crew and fleet assets under **Catalog → Assignments**. Planner shows assigned seats vs booked occupancy when fleet is assigned. Staff `assignment_role` comes from Workspace role; fleet uses asset type.
5. Manifest **Crew** sheet shows readiness only (`unassigned` / `ready` / `blocked`); it does not edit assignments. See [manifest-boarding-toolbar.md](manifest-boarding-toolbar.md).
5. Show unassigned and blocked items on Operations today.
6. Expose only the assigned crew member's minimum trip data to the mobile surface.

Do not name Fleet “Inventory” — sellable occupancy is set on Catalog → Schedules (`Units on this run` × seats per unit fills occupancy totals). Fleet passenger seats are operational coverage only: if assigned unit seats are below booked occupancy, Fleet and Assignments warn; they do not stop selling.

## Acceptance

- A tenant cannot read or assign another tenant's resource, crew profile or document.
- Overlapping active assignments for the same resource or crew profile fail cleanly.
- An expired required document blocks assignment.
- An authorized override requires a reason and creates an audit event; an unauthorized caller cannot submit one. The readiness view distinguishes an actual blocking expiry from an assignment covered by an authorized override.
- Changing assignment state is idempotent and does not silently delete the prior operational fact.
- Operations clearly separates sellable seat capacity from departure readiness.

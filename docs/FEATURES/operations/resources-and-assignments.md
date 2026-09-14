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

- `operational_resources`: tenant-owned asset with code, name, type, active state, optional capacity and operational notes.
- `crew_profiles`: tenant membership, display/operational name, active state and notes.
- `compliance_documents`: tenant-owned document for exactly one resource or crew profile, document type, expiry date, optional file metadata (`file_name`, `content_type`, `byte_size`, `storage_key`), and optional legacy evidence reference text.
- `departure_assignments`: departure, one crew or resource subject, assignment role, scheduled time window, status, override reason and audit linkage.

The database must enforce tenant-scoped foreign keys and prevent an active resource or crew profile from overlapping assignments in the same time window. It must also prevent a crew member or resource from being assigned when a required applicable document is expired, unless an audited authorized override is present.

## API and UI sequence

1. Manage people under **Staff** (Add staff, Grant access, personal compliance documents with upload). Every staff membership has a crew profile for assignment.
2. Manage fleet assets under **Fleet** (create/edit via modal; Manage documents per asset; remove deactivates).
3. Manage all compliance files and storage usage under **Document library** (`/document-library`).
4. Assign crew and fleet assets under **Catalog → Assignments** (date-range board + planner sheet with click/drag onto departures via `ops/v1/assignments`). Staff `assignment_role` comes from Workspace role; fleet uses asset type.
5. Manifest **Crew** sheet shows readiness only (`unassigned` / `ready` / `blocked`); it does not edit assignments. See [manifest-boarding-toolbar.md](manifest-boarding-toolbar.md).
5. Show unassigned and blocked items on Operations today.
6. Expose only the assigned crew member's minimum trip data to the mobile surface.

Do not name Fleet “Inventory” — sellable seat capacity is a separate domain (see pricing-and-inventory and shared-capacity-vs-fleet).

## Acceptance

- A tenant cannot read or assign another tenant's resource, crew profile or document.
- Overlapping active assignments for the same resource or crew profile fail cleanly.
- An expired required document blocks assignment.
- An authorized override requires a reason and creates an audit event; an unauthorized caller cannot submit one. The readiness view distinguishes an actual blocking expiry from an assignment covered by an authorized override.
- Changing assignment state is idempotent and does not silently delete the prior operational fact.
- Operations clearly separates sellable seat capacity from departure readiness.

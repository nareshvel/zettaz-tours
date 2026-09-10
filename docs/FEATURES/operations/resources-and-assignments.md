# Resources, crew and departure assignments

## Purpose

Give a tenant one operational source of truth for the people and assets required to run a departure. This is the Track A minimum for guides, drivers, skippers, vehicles, vessels and equipment. It is not the Track B maintenance suite.

## Assumptions and unresolved decisions

- A tenant configures the resource types and assignment requirements for each product or departure. No operator's guide, driver, vessel, vehicle or safety rule is a product default.
- A staff member may have multiple tenant memberships; a crew record links a tenant membership to operational qualifications without granting additional application permissions.
- A required document has a tenant-defined type, expiry date and evidence reference. The exact storage/retention policy is pending.
- A document expiring today is not valid for a new assignment unless a tenant policy says otherwise. The initial implementation treats expiry before the departure's local date as expired.
- An override requires `safety.assignment.override`, a reason, actor, time and audit event. The implementation permits it only when the selected subject has an expired document; it does not make unrelated assignments broadly exempt.
- Full inspections, defects, maintenance, fuel, utilization and route optimization are Track B.

## Minimum model

- `operational_resources`: tenant-owned asset with code, name, type, active state, optional capacity and operational notes.
- `crew_profiles`: tenant membership, display/operational name, active state and notes.
- `compliance_documents`: tenant-owned document for exactly one resource or crew profile, document type, expiry date and evidence storage reference.
- `departure_assignments`: departure, one crew or resource subject, assignment role, scheduled time window, status, override reason and audit linkage.

The database must enforce tenant-scoped foreign keys and prevent an active resource or crew profile from overlapping assignments in the same time window. It must also prevent a crew member or resource from being assigned when a required applicable document is expired, unless an audited authorized override is present.

## API and UI sequence

1. Manage resources and crew records in **Team & resources**.
2. Record expiry documents with a tenant-controlled evidence reference.
3. View a departure's assignment/readiness panel and assign an available subject.
4. Show unassigned and blocked items on Operations today.
5. Expose only the assigned crew member's minimum trip data to the future mobile surface.

## Acceptance

- A tenant cannot read or assign another tenant's resource, crew profile or document.
- Overlapping active assignments for the same resource or crew profile fail cleanly.
- An expired required document blocks assignment.
- An authorized override requires a reason and creates an audit event; an unauthorized caller cannot submit one. The readiness view distinguishes an actual blocking expiry from an assignment covered by an authorized override.
- Changing assignment state is idempotent and does not silently delete the prior operational fact.
- Operations clearly separates sellable seat capacity from departure readiness.

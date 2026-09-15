# Global catalogs: vessels, ports, properties

Status: agreed design, implementation in progress
Supersedes the tenant-scoped assumption in `global_cruise_calls_seed_data.md`.

## Why the original seed shape does not work

`global_cruise_calls_seed_data.md` models a *cruise call* — vessel x port x date —
as the thing to seed globally. Three problems follow from that:

1. **It expires.** Every row carries a `call_date`. The sample set is Oct–Nov
   2026; by December it is dead weight. Reference data should not have a
   shelf life.
2. **It is mostly irrelevant to any one tenant.** The sample spans Cozumel,
   Santorini, Juneau, Singapore and Sydney. A tenant operating in Antigua
   needs St. John's and nothing else. Shipping the rest as shared data means
   every tenant filters out ~99% of the table.
3. **It writes into a tenant-scoped table.** `cruise_calls` is
   `PRIMARY KEY (tenant_id, id)` with `bookings` holding a composite FK
   `(tenant_id, cruise_call_id)`. Seeding it under a placeholder tenant would
   either break that FK or silently attach platform data to one tenant.

What *is* stable and worth sharing is the vocabulary underneath a call: the
**ship** and the **port**. Those change rarely, are the same for every tenant,
and are what actually needs to be spelled consistently.

## The model

Two new platform-owned catalogs, no `tenant_id`, readable by every tenant:

- `global_vessels` — ship name, cruise line, IMO number, typical tender
  requirement, passenger capacity.
- `global_ports` — port name, country (ISO-3166-1 alpha-2), region, UN/LOCODE,
  timezone, coordinates.

Tenant tables are unchanged in shape. `cruise_calls` stays tenant-owned and
dated; creating one now means picking a vessel and a port from the catalog
rather than retyping a name. `accommodation_properties` stays tenant-owned and
gains the same adopt path once the property list lands.

### Copy on adopt

Using a catalog row copies it into the tenant's own table. The tenant then
owns that copy outright and can edit it. Consequences, accepted deliberately:

- Existing `bookings` FKs, RLS policies and the `(tenant_id, id)` convention
  are untouched. No migration risk to booking integrity.
- A later correction to a catalog row does **not** reach tenants who already
  adopted it. If that becomes a problem, `source_vessel_id` / `source_port_id`
  make a reconciliation job possible later.

### Avoiding duplicates

Every catalog row carries a stable natural key, unique where present:

| Catalog | Natural key | Notes |
| --- | --- | --- |
| `global_vessels` | `imo` (7 digits) | Permanent, assigned once, never reused even if the ship is renamed or sold. |
| `global_ports` | `locode` (5 chars) | UN/LOCODE, e.g. `AGSJO`. |

`slug` is always present and unique as a fallback key, so a row with no
verified identifier yet still cannot be inserted twice. Seeds upsert on the
natural key, so re-running a seed is a no-op rather than a duplicate.

On the tenant side, `source_vessel_id` / `source_port_id` record which catalog
row a tenant row was adopted from, with a unique index per tenant. A tenant
cannot adopt the same catalog row twice, and adopted rows are
distinguishable from ones the tenant typed themselves.

## Multi-region readiness

The product is not Antigua-specific and the schema should not assume it is.

- `global_ports.country` (ISO alpha-2) and `global_ports.region` (Caribbean,
  Mediterranean, Alaska, Baltic, Asia-Pacific, ...) exist so the picker can
  filter rather than scroll.
- Tenants already carry a `country` in `tenantSchema`. The port picker defaults
  to the tenant's country and widens on search, so an Antigua tenant sees
  Antigua first without the catalog being Antigua-only.
- Nothing in the catalog is scoped to a tenant's region, so a second tenant in
  another country needs no new seed work.

## Seeding worldwide: import, do not hand-write

The catalogs should be worldwide. They must **not** be hand-authored, because
the identifiers are real-world facts that are easy to get plausibly wrong.
Two checks made while drafting this, both of which failed:

| Value | Guessed from memory | Actual |
| --- | --- | --- |
| Icon of the Seas, IMO | 9834659 | **9829930** |
| St. John's, Antigua, UN/LOCODE | AGANU | **AGSJO** |

A hand-written worldwide seed would carry errors at that rate across hundreds
of rows, and the errors would look authoritative. So:

- The schema accepts `imo` / `locode` as **nullable**, unique where present. A
  row is usable with a verified name and country and no identifier yet.
- Bulk data loads from authoritative sources via an importer, not from SQL
  literals in a migration:
  - **Ports** — UN/LOCODE is published by UNECE as a downloadable code list
    and is the canonical source.
  - **Vessels** — IMO numbers from the ship registry; cruise line fleet lists
    for names and capacities.
- The migration seed carries only a small starter set whose identifiers have
  been verified, so the feature is demonstrable before the bulk import runs.
- Every import is an upsert on the natural key, so importing repeatedly, or
  importing an overlapping file, cannot create duplicates.

## Open items

- Property/hotel list is coming from the tenant side; `global_properties`
  follows the same shape as `global_ports` (name, country, region, address,
  slug) once that data exists.
- No reconciliation job yet for catalog corrections reaching adopted copies.
  `source_*_id` is recorded now so this stays possible.
- `cruise_calls` has no PATCH/DELETE route today, so adopted calls are
  add-and-list until those are added.

> **SUPERSEDED — kept for reference only.**
>
> This document proposed seeding *cruise calls* (vessel x port x date) into the
> tenant-scoped `cruise_calls` table. That table no longer exists: migration
> `076_vessels_replace_cruise_calls.sql` dropped it, and `global_ports` with it.
>
> Three things made the original shape unworkable:
>
> 1. **Dated rows expire.** Every row carried a `call_date`. The sample set was
>    Oct–Nov 2026 and is dead weight thereafter.
> 2. **Maintaining calls cost more than it returned.** Keeping a per-date call
>    register current is manual work, and a booking never needed the call — only
>    the ship's name, optionally, for the waiver and emergency contact.
> 3. **The schema would not take it.** `cruise_calls` was
>    `PRIMARY KEY (tenant_id, id)` with `bookings` holding a composite FK onto
>    it. Seeding it under a placeholder tenant would have either broken that FK
>    or silently attached platform data to one tenant.
>
> **What replaced it:** a single `vessels` table carrying both platform-seeded
> rows (`tenant_id IS NULL`, visible to everyone) and tenant-added ones, with
> `bookings.vessel_id` pointing at it and `bookings.stay->>'vesselName'` keeping
> the name as recorded so a later rename never rewrites an old waiver.
>
> **Read instead:** [`global-catalogs-plan.md`](./global-catalogs-plan.md)
>
> **One caution if you reuse the data below:** the IMO numbers and port codes in
> this file were not verified against a registry. Two values spot-checked while
> designing the replacement were both wrong, so treat every identifier here as
> unconfirmed. The live seed carries an identifier only where it was checked.

---

# Global Cruise Calls Sample Dataset & SQL Seed Generator

This document provides representative sample data for global cruise ship calls formatted according to your database schema requirements, followed by executable SQL `INSERT` statements ready for database seeding.

---

## Schema Overview

| Column # | Column Name | Type | Nullable | Default | Foreign Key |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `tenant_id` | `uuid` | NO | - | `public.tenants(id)` |
| **2** | `id` | `uuid` | NO | - | Primary Key |
| **3** | `vessel_name` | `text` | NO | - | - |
| **4** | `call_date` | `date` | NO | - | - |
| **5** | `port_name` | `text` | NO | - | - |
| **6** | `scheduled_arrival` | `timestamptz` | YES | `NULL` | - |
| **7** | `scheduled_departure` | `timestamptz` | YES | `NULL` | - |
| **8** | `all_aboard_at` | `timestamptz` | YES | `NULL` | - |
| **9** | `tender_required` | `bool` | NO | `false` | - |
| **10** | `active` | `bool` | NO | `true` | - |
| **11** | `created_at` | `timestamptz` | NO | `clock_timestamp()` | - |
| **12** | `created_by` | `uuid` | NO | - | `public.staff_users(id)` |

---

## Global Cruise Calls Dataset (Markdown Table Format)

*Note: Replace `00000000-0000-0000-0000-000000000001` with your target `tenant_id` and `11111111-1111-1111-1111-111111111111` with your `created_by` staff user UUID.*

| tenant_id | id | vessel_name | call_date | port_name | scheduled_arrival | scheduled_departure | all_aboard_at | tender_required | active | created_at | created_by |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `000...001` | `a1b2c3d4-0001-4000-8000-000000000001` | Icon of the Seas | 2026-10-12 | Cozumel, Mexico | `2026-10-12T07:00:00Z` | `2026-10-12T17:00:00Z` | `2026-10-12T16:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0002-4000-8000-000000000002` | Wonder of the Seas | 2026-10-13 | St. Thomas, USVI | `2026-10-13T08:00:00Z` | `2026-10-13T18:00:00Z` | `2026-10-13T17:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0003-4000-8000-000000000003` | Mardi Gras | 2026-10-14 | Nassau, Bahamas | `2026-10-14T09:00:00Z` | `2026-10-14T17:00:00Z` | `2026-10-14T16:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0004-4000-8000-000000000004` | Celebrity Ascent | 2026-10-15 | George Town, Grand Cayman | `2026-10-15T07:30:00Z` | `2026-10-15T16:00:00Z` | `2026-10-15T15:30:00Z` | `true` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0005-4000-8000-000000000005` | Norwegian Prima | 2026-10-16 | San Juan, Puerto Rico | `2026-10-16T10:00:00Z` | `2026-10-16T20:00:00Z` | `2026-10-16T19:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0006-4000-8000-000000000006` | Sun Princess | 2026-10-17 | Philipsburg, St. Maarten | `2026-10-17T08:00:00Z` | `2026-10-17T18:00:00Z` | `2026-10-17T17:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0007-4000-8000-000000000007` | MSC World Europa | 2026-10-18 | Civitavecchia (Rome), Italy | `2026-10-18T07:00:00Z` | `2026-10-18T19:00:00Z` | `2026-10-18T18:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0008-4000-8000-000000000008` | Celebrity Beyond | 2026-10-19 | Santorini, Greece | `2026-10-19T08:00:00Z` | `2026-10-19T22:00:00Z` | `2026-10-19T21:30:00Z` | `true` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0009-4000-8000-000000000009` | Symphony of the Seas | 2026-10-20 | Barcelona, Spain | `2026-10-20T06:00:00Z` | `2026-10-20T18:00:00Z` | `2026-10-20T17:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0010-4000-8000-000000000010` | Discovery Princess | 2026-09-21 | Juneau, Alaska, USA | `2026-09-21T12:00:00Z` | `2026-09-21T21:00:00Z` | `2026-09-21T20:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0011-4000-8000-000000000011` | Norwegian Bliss | 2026-09-22 | Ketchikan, Alaska, USA | `2026-09-22T07:00:00Z` | `2026-09-22T13:15:00Z` | `2026-09-22T12:45:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0012-4000-8000-000000000012` | Queen Mary 2 | 2026-10-23 | Southampton, UK | `2026-10-23T06:30:00Z` | `2026-10-23T16:30:00Z` | `2026-10-23T16:00:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0013-4000-8000-000000000013` | Spectrum of the Seas | 2026-10-24 | Singapore | `2026-10-24T07:00:00Z` | `2026-10-24T19:00:00Z` | `2026-10-24T18:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0014-4000-8000-000000000014` | Diamond Princess | 2026-10-25 | Yokohama (Tokyo), Japan | `2026-10-25T06:00:00Z` | `2026-10-25T17:00:00Z` | `2026-10-25T16:30:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |
| `000...001` | `a1b2c3d4-0015-4000-8000-000000000015` | Ovation of the Seas | 2026-11-01 | Sydney, Australia | `2026-11-01T06:00:00Z` | `2026-11-01T18:30:00Z` | `2026-11-01T18:00:00Z` | `false` | `true` | `2026-09-14T20:30:00Z` | `111...111` |

---

## SQL Seed Statements

You can execute the SQL query below directly against PostgreSQL or compatible SQL engines to seed the table:

```sql
-- Variable placeholder assumptions for tenant_id and created_by:
-- tenant_id  : '00000000-0000-0000-0000-000000000001'
-- created_by : '11111111-1111-1111-1111-111111111111'

INSERT INTO public.cruise_calls (
    tenant_id,
    id,
    vessel_name,
    call_date,
    port_name,
    scheduled_arrival,
    scheduled_departure,
    all_aboard_at,
    tender_required,
    active,
    created_at,
    created_by
) VALUES
-- Caribbean Calls
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0001-4000-8000-000000000001', 'Icon of the Seas', '2026-10-12', 'Cozumel, Mexico', '2026-10-12 07:00:00+00', '2026-10-12 17:00:00+00', '2026-10-12 16:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0002-4000-8000-000000000002', 'Wonder of the Seas', '2026-10-13', 'St. Thomas, USVI', '2026-10-13 08:00:00+00', '2026-10-13 18:00:00+00', '2026-10-13 17:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0003-4000-8000-000000000003', 'Mardi Gras', '2026-10-14', 'Nassau, Bahamas', '2026-10-14 09:00:00+00', '2026-10-14 17:00:00+00', '2026-10-14 16:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0004-4000-8000-000000000004', 'Celebrity Ascent', '2026-10-15', 'George Town, Grand Cayman', '2026-10-15 07:30:00+00', '2026-10-15 16:00:00+00', '2026-10-15 15:30:00+00', true, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0005-4000-8000-000000000005', 'Norwegian Prima', '2026-10-16', 'San Juan, Puerto Rico', '2026-10-16 10:00:00+00', '2026-10-16 20:00:00+00', '2026-10-16 19:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0006-4000-8000-000000000006', 'Sun Princess', '2026-10-17', 'Philipsburg, St. Maarten', '2026-10-17 08:00:00+00', '2026-10-17 18:00:00+00', '2026-10-17 17:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),

-- Mediterranean Calls
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0007-4000-8000-000000000007', 'MSC World Europa', '2026-10-18', 'Civitavecchia (Rome), Italy', '2026-10-18 07:00:00+00', '2026-10-18 19:00:00+00', '2026-10-18 18:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0008-4000-8000-000000000008', 'Celebrity Beyond', '2026-10-19', 'Santorini, Greece', '2026-10-19 08:00:00+00', '2026-10-19 22:00:00+00', '2026-10-19 21:30:00+00', true, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0009-4000-8000-000000000009', 'Symphony of the Seas', '2026-10-20', 'Barcelona, Spain', '2026-10-20 06:00:00+00', '2026-10-20 18:00:00+00', '2026-10-20 17:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),

-- Alaska Calls
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0010-4000-8000-000000000010', 'Discovery Princess', '2026-09-21', 'Juneau, Alaska, USA', '2026-09-21 12:00:00+00', '2026-09-21 21:00:00+00', '2026-09-21 20:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0011-4000-8000-000000000011', 'Norwegian Bliss', '2026-09-22', 'Ketchikan, Alaska, USA', '2026-09-22 07:00:00+00', '2026-09-22 13:15:00+00', '2026-09-22 12:45:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),

-- Northern Europe & Transatlantic
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0012-4000-8000-000000000012', 'Queen Mary 2', '2026-10-23', 'Southampton, UK', '2026-10-23 06:30:00+00', '2026-10-23 16:30:00+00', '2026-10-23 16:00:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),

-- Asia-Pacific Calls
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0013-4000-8000-000000000013', 'Spectrum of the Seas', '2026-10-24', 'Singapore', '2026-10-24 07:00:00+00', '2026-10-24 19:00:00+00', '2026-10-24 18:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0014-4000-8000-000000000014', 'Diamond Princess', '2026-10-25', 'Yokohama (Tokyo), Japan', '2026-10-25 06:00:00+00', '2026-10-25 17:00:00+00', '2026-10-25 16:30:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000001', 'a1b2c3d4-0015-4000-8000-000000000015', 'Ovation of the Seas', '2026-11-01', 'Sydney, Australia', '2026-11-01 06:00:00+00', '2026-11-01 18:30:00+00', '2026-11-01 18:00:00+00', false, true, clock_timestamp(), '11111111-1111-1111-1111-111111111111');
```
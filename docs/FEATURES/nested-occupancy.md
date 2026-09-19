# Nested occupancy (adult / child / hull)

**Status:** Implemented · **Date:** 19 September 2026  
**Inventory rules:** [pricing-and-inventory.md](../ARCHITECTURE/pricing-and-inventory.md)  
**Fleet vs sellable pool:** [shared-capacity-vs-fleet.md](../MODULES/Catalog/shared-capacity-vs-fleet.md)

## Model

A shared departure has **one hull occupancy** (`capacity`) and a **hard adult ceiling** (`capacity_adult`). Adults must fit the adult ceiling **and** counting guests must fit the hull. Children consume hull occupancy; they do not consume adult places.

Optional **`capacity_child`** is a partitioned child ceiling. Leave it blank when leftover occupancy may be any mix of children (glass-bottom style). Set it when child places cannot replace adult seats (typical tuk-tuk bench).

Passenger categories carry `occupancy_class`: `adult`, `child`, or `none` (infants / non-counting).

Ordinary holds require all applicable ceilings. If any ceiling fails, the party is not split across ordinary and overbooked pools. Authorized overbooking (permission + reason) still applies to the whole party. Tenant `overbookPolicy` is `authorized` (default) or `off`.

Schedule occupancy is entered as totals for the departure. A **units × per-unit** helper is only calculator math (tuk-tuks, boats, buses, jetskis, kayaks, and so on — for example 18 tuk-tuks × 4 adults + 2 children → 72 / 36 / 108). Fleet assignment is not auto-derived.

## Worked examples

**Glass-bottom:** 10 adults, 12 occupancy, no child cap. 10 adults + 2 children fit. An 11th adult does not. 9 adults + 3 children fit.

**Tuk-tuk run:** 18 units × 4 adults + 2 children = 72 adults, 36 children, 108 occupancy. 72 adults + 36 children fill the run. A 73rd adult or 37th child does not, even if hull arithmetic would otherwise look open.

## Surfaces

Schedule add/edit, catalog occupancy column, reservation finder remaining copy, Day Board / overview meters, Crew remaining-places copy, tenant overbook toggle.

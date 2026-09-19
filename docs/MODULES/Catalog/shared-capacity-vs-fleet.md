# Shared seat capacity vs fleet resources

**Status:** Standing guidance · **Date:** 12 September 2026  
**Authoritative inventory:** [pricing-and-inventory.md](../../ARCHITECTURE/pricing-and-inventory.md)  
**Ops assignment:** [resources-and-assignments.md](../../FEATURES/operations/resources-and-assignments.md)

## Why this note exists

Operators may ask: “We have 18 tuk-tuks and one product with seat capacity — how do multiple bookings work?”

Answer for Track A **shared tours**: multiple bookings already share one departure’s seat pool. Fleet size is a separate resource concern. Revisit only if a real tenant needs exclusive-per-vehicle selling or sell-blocking multi-vehicle pools.

## Separation

| Layer | Example | System role |
| --- | --- | --- |
| Sellable capacity | Schedule capacity 36 on “Tuk-Tuk Rainforest & Beach Hopping” | Holds and confirmed bookings consume seats |
| Fleet assets | 18 tuk-tuk resources | Assigned on the departure for readiness / conflict / compliance |

You do **not** create 18 products to take 18 bookings on a shared departure.

## Configuration checklist

1. Confirm the product is a **shared** fixed-departure tour (not private charter).
2. Set schedule **adult capacity**, **maximum occupancy**, and optional **child capacity** to the totals you will sell for that departure time (e.g. 18 tuk-tuks × 4 adults + 2 children = 72 / 36 / 108). Do not leave occupancy as “18” because there are 18 vehicles unless the sellable unit is one vehicle-slot.
3. Register vehicles under **Fleet**.
4. Assign vehicles on the departure as bookings fill (ops readiness; Catalog → Assignments).
5. If each party must own a whole vehicle exclusively → stop; that needs the charter/resource inventory model (deferred unless promoted).

**Naming:** Fleet = operational assets. Inventory (elsewhere in docs) = sellable seats. Do not conflate.

## Open revisit triggers

- Sell-blocking when the fleet pool is exhausted (beyond seat count).
- Auto-deriving departure capacity from assigned resource capacities.
- Per-vehicle private booking without faking capacity `1` shared tours.

Document any decision change here and in [pricing-and-inventory.md](../../ARCHITECTURE/pricing-and-inventory.md).

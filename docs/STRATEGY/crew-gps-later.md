# Crew GPS — possible expansion (held)

**Status:** Held — optional Track B expansion. Do **not** start until the owner reopens this file in writing  
**Recorded:** 19 September 2026  
**Audience:** any IDE agent  
**Authority on conflict:** [launch-contract.md](launch-contract.md) · [crew-app-delivery.md](crew-app-delivery.md) · [implementation-backlog.md](implementation-backlog.md) (Geolocation decision) · [ux-security-reporting.md](../ARCHITECTURE/ux-security-reporting.md)

This is a **study note**, not a sprint ticket. Connecteam was reviewed as a workforce time-clock ([connecteam.com](https://connecteam.com/)), not as a product to clone. Zettaz Crew remains tour operations: assigned trips, pickup sequence, boarding, waivers. Pickup catalog maps (Esri pin, no Google routing) already exist; live staff/vehicle GPS does not.

Do **not** invent breadcrumbs, guest ETAs, a second “clock in,” or Rock-hard-coded geofences. Do **not** treat this document as Phase 5 work. Phase 5.1 (kiosk lock) already shipped separately.

---

## Why this exists

The launch contract defers **GPS breadcrumbs / live ETAs** until privacy, battery, and legal review. On 19 September 2026 the owner asked what, if anything, [Connecteam’s GPS / geofence / breadcrumbs](https://connecteam.com/employee-time-clock-app/gps-tracking/) teaches us **if** we later implement GPS better. The answer is their **three-layer model and privacy envelope**, not their payroll dashboard.

Take this file only if operations prove that “were they at the dock / pickup?” cannot be answered with Start trip, pickup plans, and paper lists.

---

## Connecteam layers (public docs, Sep 2026)

| Layer | What they ship | Primary sources |
| --- | --- | --- |
| **Stamps** | Optional or required GPS pin on clock-in / clock-out. Shared kiosk punch devices can be exempt from required location. | [Geolocation help](https://help.connecteam.com/en/articles/6489778-time-clock-gps-location-tracking-geolocation) |
| **Fences** | Radius around a job (~150–750 m in marketing). Jobs without a fence stay punchable from anywhere. Accuracy circle must sit inside the fence. Optional auto clock-out when leaving a site (payroll). | [Create a geofence](https://help.connecteam.com/en/articles/3597710-how-to-create-a-geofence) · [Auto clock-out](https://help.connecteam.com/en/articles/10692218-auto-clock-out-employees-when-they-leave-a-worksite) |
| **Trails** | Breadcrumbs while clocked in. Needs Location **Always**. Admins see nothing off the clock; off-duty points stay on-device. Sparse (~5–10 min / ~25 m). One user trail at a time. | [Breadcrumbs guide](https://help.connecteam.com/en/articles/5675206-starting-guide-to-breadcrumbs-live-location-tracking) |

Connecteam’s product job is time theft, buddy punching, and timesheets. Zettaz must not add a parallel clock-in beside **Start trip**.

---

## Takeaways if GPS is ever reopened

Keep the three layers **separate**. Do not ship trails because stamps would have been enough.

1. **Stamps before trails.** One lat/lng on existing crew trip events (start trip, arrive pickup, all-aboard) answers “were they at the dock?” with **While Using the App**. Lowest legal heat.
2. **Work window only.** Analog of “clocked in” is the **trip run** (Start trip → close), not “signed into Crew.” Off-duty must not be visible to admins.
3. **Kiosk exemption.** Guest kiosk / shared dock iPad has no personal GPS story. Scan and waiver stay location-free.
4. **Tenant optional / required.** Multi-tenant: some operators will never want tracking. No Rock-hard-coded policy.
5. **Accuracy buffers.** Hotel GPS is often 100–200 m off. Hard-blocking boarding because a pin is outside a fence is worse GPS, not better.
6. **Sparse trails, if ever.** Battery and map clutter are first-class. Do not 1 Hz guest-ETA telemetry on the phone.

### Refuse even after a legal write-up (unless the owner promotes them)

| Idea | Why it is the wrong product |
| --- | --- |
| Payroll geofence **auto clock-out** | Ending a departure because a van left a hotel fence would strand the manifest. Close / weather-hold stay human. |
| Live **guest** ETAs | Different consent surface; Track B consumer/non-goal until checkout. Connecteam sells manager peace of mind, not passenger apps. |
| Background Always permission as v1 | Needed for Connecteam-style trails; App Review + staff trust cost. Not required for event stamps. |
| Google Places / live routing | Already deferred (ADR 012). Pickup catalog coordinates are the only fence source if fences exist. |

---

## First honest slice (only after owner reopen + write-up)

Gate (unchanged): privacy, consent, retention/anonymization, battery, Antigua/operating-country labor and insurance, App Store location purpose strings.

Then, in order:

| ID | Slice | Notes |
| --- | --- | --- |
| G1 | Event stamps | Foreground location on existing trip events. Tenant flag. Kiosk-exempt. Append-only; not proof of route completion (same as itinerary maps today). |
| G2 | Advisory distance | Optional “you appear N km from this pickup” using catalog lat/lng. Never a hard check-in block. |
| G3 | On-trip trails | Only after Start trip. Always permission. Off-duty local-only. Sparse sampling. One staff trail. New EAS + review notes. |

Feature-flag unfinished layers. Honest empty states. No silent placeholder that becomes authoritative.

---

## Invariants

1. GPS is never a substitute for assignment, Start trip, or the pickup plan.
2. Guest kiosk and shared dock devices stay exempt.
3. No tracking because the actor is merely signed in.
4. Retention/anonymization must be configurable (already named in ux-security-reporting).
5. No Rock-hard-coded sites, radii, or “must track guides” defaults.
6. A map remains an aid, not proof of route completion ([implementation-backlog.md](implementation-backlog.md)).

---

## Related

- Crew phases: [crew-app-delivery.md](crew-app-delivery.md) Phase 5 GPS row
- Pickup catalog (non-live): [pickup-disposition-and-plans.md](../FEATURES/operations/pickup-disposition-and-plans.md)
- Finance later (same “held until reopen” pattern): [finance-money-in-out-later.md](finance-money-in-out-later.md)

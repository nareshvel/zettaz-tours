# Gemini suggestion — Schedules view (archived inspiration)

**Status:** Discarded as Catalog Schedules implementation source · **Date:** 12 September 2026

This note mixed Catalog **schedule rules** with an **operations departure board** (fleet timeline, drafts/publish, templates, pickups, guides, Tailwind, Rock-hardcoded filters).

**Do not implement this as Catalog → Schedules.**

Authoritative Catalog Schedules work:

- [schedules-tab.md](schedules-tab.md) — list polish slice
- [../../FEATURES/catalog-schedules-ia.md](../../FEATURES/catalog-schedules-ia.md) — locked IA

Useful cues kept lightly (list density, status chips) are called out in `schedules-tab.md`. Ops calendar / manifest UX belongs on **Departures** / Day Board in later increments.

---

Act as a Principal Frontend Engineer and UX Architect. Build a responsive, accessible, high-performance Schedule Management page for a Tours & Charters SaaS application using Tailwind CSS, React, and Lucide React icons.

Incorporate design cues from the PayTime layout: clean pill navigation, clear status indicators ("Published" / "Draft"), color-coded activity types, and quick-action floaters.

### 1. PAGE HEADER & STATUS CONTROL BAR
- Top Row: Page Title ("Schedules") with Breadcrumbs ("Operations > Schedules").
- Left Controls: Tab view toggle [ Schedule Calendar | Template Builder ].
- Right Controls: 
  - Status Indicator Pill: "Published" (Green) or "Draft (Unpublished Changes)" (Amber).
  - Primary Action Group: Button "Publish Schedule", Button "Save as Template", Button "+ Create Departure".

### 2. COMPREHENSIVE FILTER & CONTROL TOOLBAR
- View Switcher: Toggle between [ Timeline / Fleet View ], [ Calendar Grid (Day/Week/Month) ], and [ List / Manifest View ].
- Date Navigator: Date picker with [< Today >] controls and date-range display.
- Dropdown Filters:
  - Experience Type: All, Private Skiff Charters, Tuk-Tuk Rainforest Tour, Kayak Eco Tour, Boat Cruise to Pig's Paradise.
  - Resource / Fleet: All Assets, Tuk-Tuk #1-4, Skiff Boat #1-2, Clear Kayaks.
  - Pickup Zone: All, Cruise Ship Port (St. John's), Dickenson Bay, Hodges Bay.
  - Guide / Captain: All Staff, Unassigned.

### 3. MAIN SCHEDULE VIEWS (Implement Switchable Views)

A. LIST / MANIFEST VIEW:
- Grouped by Departure Time Slots (e.g., Morning 08:00 AM, Mid-day 11:30 AM, Afternoon 03:00 PM).
- Table Columns:
  1. Time & Duration
  2. Experience / Tour Name (with color badge: Blue for Skiff, Green for Tuk-Tuk, Teal for Kayak)
  3. Assigned Asset & Staff (e.g., "Carolina Skiff #1 • Capt. Eli")
  4. Booked Seats / Capacity Bar (e.g., "5/6 Pax" with visual progress bar)
  5. Pickup Locations (Badge counter, e.g., "2 at Cruise Port")
  6. Operational Status (Confirmed, Pending Payment, Weather Hold)
  7. Actions: Quick Edit (... menu) for slot adjustment, reassignment, or cancellation.

B. CALENDAR / TIMELINE GRID VIEW:
- Resource / Activity rows on the left Y-axis.
- Days / Hours across the top X-axis.
- Render horizontal departure blocks displaying:
  - Tour Title
  - Occupancy counter badge (e.g., 4/6)
  - Color-coded left border for trip status (Green = Fully booked, Amber = Open slots, Red = Overbooked/Unassigned staff)

### 4. TEMPLATE BUILDER MODE (Slide-over or Sub-tab UI)
- Ability to create recurring weekly departure schedules (e.g., "Standard High-Season Schedule").
- Quick actions to "Apply Template to Date Range" and "Publish Drafts".
- Template cards showing recurring slots per day.

### 5. QUICK-EDIT SLIDE-OVER DRAWER (Triggers when clicking any Departure block)
- Drawer overlay showing:
  - Tour Details & Asset Re-assignment Dropdown.
  - Live Passenger Manifest (Guest Name, Pax count, Pickup point, Waiver signed checkbox).
  - Rapid capacity override and status update toggle (Draft -> Published).

### TECH & DESIGN SPECS:
- Styling: Tailwind CSS (Slate/Zinc neutral base with primary Navy `#1E293B` and vibrant accents).
- Accessibility: ARIA roles for keyboard navigation across calendar grid cells.
- State: Mock mock dataset representing Rock Adventures Antigua (Tuk-Tuk tours, Private Skiff charters, Kayak trips).

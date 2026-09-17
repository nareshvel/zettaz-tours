# Audit trail polish — implementation evidence

**Date:** 17 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Boundary

`GET /ops/v1/audit` still returns the latest 100 events. This pass does **not** add pagination, exports, or before/after payload disclosure (those snapshots can contain guest and money facts).

## Changes

- List joins membership role and staff name when RLS allows; otherwise the UI shows the role or “Staff” instead of an actor UUID.
- Insights-style metrics, search, and area filter (action prefix) on the loaded 100.
- Desktop table uses action labels and a Details disclosure (reason + full record id). Phone uses cards with a record-reference disclosure.
- Event JSON payloads stay off this page.

## Owner acceptance still needed

- Search and area filter on a tenant with mixed booking/payment/ops events.
- Confirm actor names appear for owners/admins and remain non-UUID for roles that cannot read other staff rows.
- Phone cards vs desktop table.
- Confirm guest/money payloads are not dumped here.

# Schedule regenerate-on-edit

**Status:** Implemented · **Date:** 12 September 2026  
**Related:** [schedules-tab.md](schedules-tab.md) · [catalog-schedules-ia.md](../../FEATURES/catalog-schedules-ia.md) · [pricing-and-inventory.md](../../ARCHITECTURE/pricing-and-inventory.md)

## Purpose

Operators can edit a schedule’s name, seat capacity, dates, times, and operating days from the same Add schedule modal. The API regenerates **upcoming** departures without silently breaking bookings.

## Rules

| Change | Behavior |
| --- | --- |
| Name | Rule rename only |
| Capacity | Updates upcoming scheduled departures; **blocked** if any already sold seats exceed the new capacity |
| Extend end / add times / add days | Inserts missing upcoming departures (or revives cancelled slots at the same start instant) |
| Shorten end / remove times / clear days | Cancels upcoming empty departures (`status=cancelled`, `operational_status=closed`); **blocked** if active bookings or live holds remain |
| Past departures | Left as history |
| Tour / product | Locked in the UI |

Active booking states for guards: `held`, `pending_payment`, `confirmed`, `disputed`. Live holds: unconsumed and not expired.

## API

`PATCH admin/v1/availability-rules/:id` accepts optional `startDate`, `endDate`, `weekdays`, `localTimes`, `capacity`, `blackoutDates` in addition to `version`, `status`, and `name`.

Response includes `impact: { added, cancelled, capacityUpdated, revived }`.

## UI

Edit opens `ScheduleFormDialog` with the rule loaded. Tour stays read-only. Submit sends the full regenerate payload.

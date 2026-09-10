# Passenger clearance — requirements

## Outcome

Each confirmed booking has explicit passenger records. Staff can record arrival and boarding per passenger; a minor must identify a guardian waiver signer. Booking-level check-in remains a summary derived from passenger clearance, never a substitute for passenger evidence.

## Implemented foundation

- Staff record one passenger row for every reserved category and quantity while the booking is held. Each row has a required name, category and minor flag.
- The server validates that the submitted roster exactly matches the party held against inventory. It is tenant-scoped, idempotent and audited.
- Confirmation freezes the roster. While held, staff can submit a reasoned correction that supersedes the prior roster rows, creates a new roster version and preserves the prior version as audit evidence.
- The reservation page reads and records the roster; the API is exposed through the authenticated web gateway and OpenAPI description.

## Implemented clearance evidence

- Passenger waiver evidence is now append-only and may be attributed to an adult passenger or to a minor with an eligible adult guardian from the same current roster. Existing booking-level waiver evidence remains available only for confirmed legacy bookings without a roster.
- Passenger check-in events are append-only. Arrival, clearance, boarding, and no-show are recorded per passenger; clearance and boarding are rejected until the booking balance and that passenger's waiver requirements are satisfied.
- Guides and drivers remain restricted to passengers on their actively assigned departure.

## Guards

- A passenger belongs to one tenant booking only.
- Boarding requires the booking’s financial clearance and a signed valid waiver for that passenger or an eligible guardian relationship.
- No browser or mobile client may mark a passenger boarded without server-side assignment and clearance checks.
- Passenger data follows tenant retention policy; no health or incident data belongs in this first increment.

## Deferred

- Guest self-service links, QR token issuance, offline conflict-aware syncing, ID scanning, and live GPS.

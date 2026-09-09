# ADR 013: Safe weather and closure controls before policy actions

## Decision

Use a versioned departure operational status: `open`, `weather_hold`, or `closed`. A non-open departure is not sellable. Applying or clearing the status requires `operations.write`, a non-empty internal reason, an expected version, an idempotency key, audit history, and an outbox event.

## Consequences

Confirmed bookings remain confirmed and keep all commercial facts. A later policy workflow will explicitly rebook, cancel, issue a finance review, preserve partner responsibility, and queue communications. This avoids treating a weather status change as an undocumented cancellation or refund rule.

## Evidence

Requirements: [weather-closure-requirements.md](../FEATURES/operations/weather-closure-requirements.md). The launch contract requires a weather/closure drill before cutover.

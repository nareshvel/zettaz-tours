# Integration retry and dead-letter review

**Status:** Queue and review boundary implemented · **Date:** 10 September 2026

Tenant integration administrators can queue a quarantined or retained event for a
bounded retry, or move any unprocessed event to dead letter with a required reason.
Every action is tenant-scoped, idempotent, audited, and limited to five retry queues.
The connector must be enabled before a retry can be queued.

`retry_pending` means the evidence is ready for an event-specific adapter. It does not
mean a booking was created or changed. The worker that consumes this state remains
disabled until the WP Travel Engine payload contract and test site are configured.
`dead_letter` retains the original immutable payload and review history; it is never
silently discarded.

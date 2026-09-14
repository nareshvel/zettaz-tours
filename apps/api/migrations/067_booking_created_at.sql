-- Booking creation time for reservation list ordering (latest first).

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE bookings b
SET created_at = COALESCE(
  (
    SELECT MIN(a.occurred_at)
    FROM audit_events a
    WHERE a.tenant_id = b.tenant_id
      AND a.aggregate_id = b.id
      AND a.action = 'booking.created'
  ),
  clock_timestamp()
)
WHERE created_at IS NULL;

ALTER TABLE bookings
  ALTER COLUMN created_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_tenant_created
  ON bookings (tenant_id, created_at DESC, id DESC);

-- Soft boarding attribution: optional passenger on a booking-level payment.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS passenger_id uuid;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_passenger_fk;

ALTER TABLE payments
  ADD CONSTRAINT payments_passenger_fk
  FOREIGN KEY (tenant_id, passenger_id)
  REFERENCES booking_passengers (tenant_id, id);

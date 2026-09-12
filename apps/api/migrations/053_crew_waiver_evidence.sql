ALTER TABLE bookings DROP CONSTRAINT booking_stay_reference_kind;
ALTER TABLE bookings ADD CONSTRAINT booking_stay_reference_kind CHECK(
  (stay->>'kind' IN ('none','cruise','hotel','private_accommodation','local')) AND
  (cruise_call_id IS NULL OR (stay->>'kind'='cruise' AND accommodation_property_id IS NULL)) AND
  (accommodation_property_id IS NULL OR (stay->>'kind'='hotel' AND cruise_call_id IS NULL)) AND
  (stay->>'kind' IN ('cruise','hotel') OR (cruise_call_id IS NULL AND accommodation_property_id IS NULL))
);

ALTER TABLE waiver_signatures ADD COLUMN consent_text text;
ALTER TABLE waiver_signatures ADD COLUMN signature_strokes jsonb;
ALTER TABLE waiver_signatures ADD COLUMN stay_snapshot jsonb;
ALTER TABLE waiver_signatures ADD COLUMN captured_at timestamptz;
ALTER TABLE waiver_signatures ADD COLUMN device_command_id text;
CREATE UNIQUE INDEX waiver_signature_device_command
  ON waiver_signatures(tenant_id,device_command_id)
  WHERE device_command_id IS NOT NULL;

ALTER TABLE booking_passengers ADD COLUMN superseded_at timestamptz;
ALTER TABLE booking_passengers ADD COLUMN superseded_by uuid;
ALTER TABLE booking_passengers ADD CONSTRAINT passenger_superseded_by_fk FOREIGN KEY(tenant_id,superseded_by) REFERENCES booking_passengers(tenant_id,id);
CREATE INDEX passenger_current_roster ON booking_passengers(tenant_id,booking_id,id) WHERE superseded_at IS NULL;

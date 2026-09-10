ALTER TABLE waiver_signatures ADD COLUMN passenger_id uuid;
ALTER TABLE waiver_signatures ADD COLUMN guardian_passenger_id uuid;
ALTER TABLE waiver_signatures ADD CONSTRAINT waiver_signature_passenger_fk FOREIGN KEY(tenant_id,passenger_id) REFERENCES booking_passengers(tenant_id,id);
ALTER TABLE waiver_signatures ADD CONSTRAINT waiver_signature_guardian_fk FOREIGN KEY(tenant_id,guardian_passenger_id) REFERENCES booking_passengers(tenant_id,id);
CREATE INDEX waiver_signatures_passenger ON waiver_signatures(tenant_id,passenger_id,occurred_at DESC) WHERE passenger_id IS NOT NULL;

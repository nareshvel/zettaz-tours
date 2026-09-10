CREATE TABLE booking_passengers (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, booking_id uuid NOT NULL,
  name text NOT NULL, category text NOT NULL, is_minor boolean NOT NULL DEFAULT false,
  guardian_passenger_id uuid, roster_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
  FOREIGN KEY(tenant_id,guardian_passenger_id) REFERENCES booking_passengers(tenant_id,id),
  CHECK(guardian_passenger_id IS NULL OR guardian_passenger_id<>id)
);
CREATE TABLE passenger_checkins (
  tenant_id uuid NOT NULL, id uuid NOT NULL, passenger_id uuid NOT NULL, state text NOT NULL CHECK(state IN ('arrived','cleared','boarded','no_show')),
  actor_id uuid NOT NULL REFERENCES staff_users(id), occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,passenger_id) REFERENCES booking_passengers(tenant_id,id)
);
CREATE INDEX passenger_booking ON booking_passengers(tenant_id,booking_id,id);
CREATE INDEX passenger_checkin_latest ON passenger_checkins(tenant_id,passenger_id,occurred_at DESC,id DESC);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['booking_passengers','passenger_checkins'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid)',t); END LOOP; END $$;

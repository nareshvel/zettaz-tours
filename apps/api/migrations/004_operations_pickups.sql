CREATE TABLE pickup_locations (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, slug text NOT NULL,
  name text NOT NULL, kind text NOT NULL CHECK(kind IN ('hotel','port','meeting_point','other')),
  notes text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,slug)
);
CREATE TABLE departure_pickup_plans (
  tenant_id uuid NOT NULL, departure_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  notes text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL,
  PRIMARY KEY(tenant_id,departure_id),
  FOREIGN KEY(tenant_id,departure_id) REFERENCES departures(tenant_id,id),
  FOREIGN KEY(tenant_id,updated_by) REFERENCES memberships(tenant_id,actor_id)
);
CREATE TABLE pickup_stops (
  tenant_id uuid NOT NULL, id uuid NOT NULL, departure_id uuid NOT NULL, booking_id uuid NOT NULL,
  location_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence>0), pickup_at timestamptz NOT NULL, notes text NOT NULL DEFAULT '',
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,booking_id), UNIQUE(tenant_id,departure_id,sequence),
  FOREIGN KEY(tenant_id,departure_id) REFERENCES departures(tenant_id,id),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
  FOREIGN KEY(tenant_id,location_id) REFERENCES pickup_locations(tenant_id,id)
);
CREATE INDEX pickup_stops_departure ON pickup_stops(tenant_id,departure_id,sequence);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pickup_locations','departure_pickup_plans','pickup_stops'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid)',t);
 END LOOP;
END $$;

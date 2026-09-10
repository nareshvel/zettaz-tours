CREATE TABLE cruise_calls (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  vessel_name text NOT NULL, call_date date NOT NULL, port_name text NOT NULL,
  scheduled_arrival timestamptz, scheduled_departure timestamptz, all_aboard_at timestamptz,
  tender_required boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by uuid NOT NULL REFERENCES staff_users(id),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,vessel_name,call_date,port_name),
  CHECK(all_aboard_at IS NULL OR scheduled_departure IS NULL OR all_aboard_at<=scheduled_departure)
);
CREATE TABLE accommodation_properties (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  name text NOT NULL, address text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by uuid NOT NULL REFERENCES staff_users(id),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,name)
);
ALTER TABLE bookings ADD COLUMN cruise_call_id uuid;
ALTER TABLE bookings ADD COLUMN accommodation_property_id uuid;
ALTER TABLE bookings ADD CONSTRAINT booking_cruise_call_fk FOREIGN KEY(tenant_id,cruise_call_id) REFERENCES cruise_calls(tenant_id,id);
ALTER TABLE bookings ADD CONSTRAINT booking_accommodation_fk FOREIGN KEY(tenant_id,accommodation_property_id) REFERENCES accommodation_properties(tenant_id,id);
ALTER TABLE bookings ADD CONSTRAINT booking_stay_reference_kind CHECK(
  (cruise_call_id IS NULL OR (stay->>'kind'='cruise' AND accommodation_property_id IS NULL)) AND
  (accommodation_property_id IS NULL OR (stay->>'kind'='hotel' AND cruise_call_id IS NULL))
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['cruise_calls','accommodation_properties'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid)',t);
END LOOP; END $$;
CREATE INDEX cruise_calls_active_date_idx ON cruise_calls(tenant_id,active,call_date,vessel_name);
CREATE INDEX accommodation_properties_active_name_idx ON accommodation_properties(tenant_id,active,name);

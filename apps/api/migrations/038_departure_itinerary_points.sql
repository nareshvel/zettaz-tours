CREATE TABLE departure_itinerary_points (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  departure_id uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence > 0),
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  directions text NOT NULL DEFAULT '',
  latitude numeric(9,6),
  longitude numeric(9,6),
  map_url text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','guest')),
  created_by uuid NOT NULL REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,departure_id,sequence),
  CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)),
  CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
  FOREIGN KEY(tenant_id,departure_id) REFERENCES departures(tenant_id,id)
);
ALTER TABLE departure_itinerary_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON departure_itinerary_points
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

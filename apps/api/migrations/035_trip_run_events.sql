CREATE TABLE trip_runs (
  tenant_id uuid NOT NULL REFERENCES tenants(id), departure_id uuid NOT NULL, state text NOT NULL CHECK(state IN ('preparing','en_route_pickup','boarding','departed','at_stop','delayed','completed','cancelled','emergency')),
  version integer NOT NULL DEFAULT 1, recorded_by uuid NOT NULL REFERENCES staff_users(id), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,departure_id), FOREIGN KEY(tenant_id,departure_id) REFERENCES departures(tenant_id,id)
);
CREATE TABLE trip_run_events (
  tenant_id uuid NOT NULL, id uuid NOT NULL, departure_id uuid NOT NULL, state text NOT NULL CHECK(state IN ('preparing','en_route_pickup','boarding','departed','at_stop','delayed','completed','cancelled','emergency')),
  reason text, actor_id uuid NOT NULL REFERENCES staff_users(id), occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,departure_id) REFERENCES departures(tenant_id,id)
);
CREATE INDEX trip_run_events_departure ON trip_run_events(tenant_id,departure_id,occurred_at DESC,id DESC);
ALTER TABLE trip_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE trip_run_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON trip_runs USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
CREATE POLICY tenant_scope ON trip_run_events USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

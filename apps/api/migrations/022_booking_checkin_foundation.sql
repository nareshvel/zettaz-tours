CREATE TABLE booking_checkins (
  tenant_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('not_arrived','arrived','balance_pending','waiver_pending','cleared_to_board','boarded','no_show')),
  version integer NOT NULL DEFAULT 1,
  recorded_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,booking_id),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
  FOREIGN KEY(tenant_id,recorded_by) REFERENCES memberships(tenant_id,actor_id)
);
ALTER TABLE booking_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON booking_checkins USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
INSERT INTO app_modules(code,name,description,sort_order) VALUES ('checkin','Check-in','Arrival, clearance and boarding',45) ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,module_code,name,description) VALUES ('checkin.write','checkin','Record check-in','Record arrivals, clearance and boarding') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,'checkin.write' FROM tenant_roles r WHERE r.code IN ('owner','admin','dispatcher') ON CONFLICT DO NOTHING;

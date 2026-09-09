-- Owners may list staff in their tenant. No global staff directory is exposed.
DROP POLICY staff_scope ON staff_users;
CREATE POLICY staff_scope ON staff_users
USING (
  id=nullif(current_setting('app.actor',true),'')::uuid
  OR current_setting('app.platform',true)='true'
  OR (current_setting('app.member_admin',true)='true' AND EXISTS (
    SELECT 1 FROM memberships m WHERE m.actor_id=staff_users.id
    AND m.tenant_id=nullif(current_setting('app.tenant',true),'')::uuid
  ))
)
WITH CHECK(current_setting('app.platform',true)='true' OR current_setting('app.member_admin',true)='true');
CREATE INDEX departures_tenant_start ON departures(tenant_id,starts_at,id);

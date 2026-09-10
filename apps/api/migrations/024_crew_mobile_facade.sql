INSERT INTO app_modules(code,name,description,sort_order)
VALUES ('crew','Crew mobile','Assigned trip information for staff mobile clients',44)
ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,module_code,name,description)
VALUES ('crew.trip.read','crew','View assigned trips','Read only departures and guest check-in state assigned to the current crew member')
ON CONFLICT(code) DO NOTHING;

INSERT INTO tenant_roles(tenant_id,code,name,is_system)
SELECT t.id,v.code,v.name,true
FROM tenants t
CROSS JOIN (VALUES
  ('guide','Guide'),
  ('driver','Driver / skipper'),
  ('resource_manager','Resource manager'),
  ('operations_manager','Operations manager'),
  ('partner_manager','Partner manager')
) AS v(code,name)
ON CONFLICT(tenant_id,code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code
FROM tenant_roles r
JOIN permissions p ON p.code=ANY(CASE r.code
  WHEN 'guide' THEN ARRAY['crew.trip.read','checkin.write']
  WHEN 'driver' THEN ARRAY['crew.trip.read','checkin.write']
  WHEN 'resource_manager' THEN ARRAY['catalog.read','manifest.read','resources.write','documents.expiry.manage']
  WHEN 'operations_manager' THEN ARRAY['catalog.read','bookings.read','manifest.read','operations.write','resources.write','documents.expiry.manage','assignments.write','checkin.write','print.jobs.create','print.jobs.read']
  WHEN 'partner_manager' THEN ARRAY['catalog.read','bookings.read']
  ELSE ARRAY[]::text[] END)
ON CONFLICT DO NOTHING;

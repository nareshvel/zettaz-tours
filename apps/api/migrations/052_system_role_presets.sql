-- Keep every tenant's protected role presets complete and aligned with the
-- accepted least-privilege matrix. Custom roles remain tenant-controlled.
INSERT INTO tenant_roles(tenant_id,code,name,is_system)
SELECT t.id,v.code,v.name,true FROM tenants t CROSS JOIN (VALUES
  ('owner','Owner'),('admin','Administrator'),('reservations','Reservations'),
  ('dispatcher','Dispatcher'),('finance','Finance'),('auditor','Auditor'),
  ('guide','Guide'),('driver','Driver / skipper'),
  ('resource_manager','Resource manager'),
  ('operations_manager','Operations manager'),
  ('partner_manager','Partner manager')
) v(code,name) ON CONFLICT(tenant_id,code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code FROM tenant_roles r
JOIN permissions p ON p.code=ANY(CASE r.code
  WHEN 'owner' THEN ARRAY['config.write','members.write','catalog.write','catalog.read','bookings.write','bookings.read','inventory.overbook','payment.write','payment.correct','manifest.read','operations.write','waiver.template.publish','resources.write','documents.expiry.manage','assignments.write','safety.assignment.override','checkin.write','print.templates.manage','print.jobs.create','print.jobs.read','partner.manage','partner.collection.record','partner.collection.verify','partner.statement.read','integration.manage','integration.inbox.read','notifications.request','notifications.read','audit.read']
  WHEN 'admin' THEN ARRAY['config.write','catalog.write','catalog.read','bookings.write','bookings.read','manifest.read','operations.write','resources.write','documents.expiry.manage','assignments.write','checkin.write','print.templates.manage','print.jobs.create','print.jobs.read','partner.manage','integration.manage','integration.inbox.read','notifications.request','notifications.read']
  WHEN 'reservations' THEN ARRAY['catalog.read','bookings.write','bookings.read','payment.write','manifest.read','partner.collection.record','notifications.request','notifications.read']
  WHEN 'dispatcher' THEN ARRAY['catalog.read','bookings.read','manifest.read','operations.write','assignments.write','checkin.write','print.jobs.create','print.jobs.read']
  WHEN 'finance' THEN ARRAY['catalog.read','bookings.read','payment.write','payment.correct','audit.read','partner.collection.record','partner.collection.verify','partner.statement.read']
  WHEN 'auditor' THEN ARRAY['catalog.read','bookings.read','manifest.read','audit.read','partner.statement.read','integration.inbox.read','notifications.read']
  WHEN 'guide' THEN ARRAY['crew.trip.read','checkin.write']
  WHEN 'driver' THEN ARRAY['crew.trip.read','checkin.write']
  WHEN 'resource_manager' THEN ARRAY['catalog.read','manifest.read','resources.write','documents.expiry.manage']
  WHEN 'operations_manager' THEN ARRAY['catalog.read','bookings.read','inventory.overbook','manifest.read','operations.write','resources.write','documents.expiry.manage','assignments.write','checkin.write','print.jobs.create','print.jobs.read']
  WHEN 'partner_manager' THEN ARRAY['catalog.read','bookings.read','partner.manage']
  ELSE ARRAY[]::text[] END)
WHERE r.is_system ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp USING tenant_roles r
WHERE rp.tenant_id=r.tenant_id AND rp.role_id=r.id
  AND r.is_system AND r.code IN ('reservations','dispatcher')
  AND rp.permission_code='inventory.overbook';

UPDATE memberships m SET permissions=source.permissions
FROM (
  SELECT r.tenant_id,r.id,
    COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
      FILTER(WHERE rp.permission_code IS NOT NULL),'{}') permissions
  FROM tenant_roles r LEFT JOIN role_permissions rp
    ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
  GROUP BY r.tenant_id,r.id
) source
WHERE m.tenant_id=source.tenant_id AND m.role_id=source.id;

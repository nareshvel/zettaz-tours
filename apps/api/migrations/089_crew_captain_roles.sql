-- Add Crew and Captain field roles for every tenant.
-- Same least-privilege matrix as Guide / Driver (crew app + check-in).
INSERT INTO tenant_roles(tenant_id,code,name,is_system)
SELECT t.id,v.code,v.name,true FROM tenants t CROSS JOIN (VALUES
  ('crew','Crew'),
  ('captain','Captain')
) v(code,name) ON CONFLICT(tenant_id,code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code FROM tenant_roles r
JOIN permissions p ON p.code=ANY(CASE r.code
  WHEN 'crew' THEN ARRAY['crew.trip.read','checkin.write']
  WHEN 'captain' THEN ARRAY['crew.trip.read','checkin.write']
  ELSE ARRAY[]::text[] END)
WHERE r.is_system AND r.code IN ('crew','captain')
ON CONFLICT DO NOTHING;

-- Keep membership permission arrays aligned if any membership already points
-- at these roles (normally none yet; safe for re-runs).
UPDATE memberships m SET permissions=source.permissions
FROM (
  SELECT r.tenant_id,r.id,
    COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
      FILTER(WHERE rp.permission_code IS NOT NULL),'{}') permissions
  FROM tenant_roles r LEFT JOIN role_permissions rp
    ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
  WHERE r.code IN ('crew','captain')
  GROUP BY r.tenant_id,r.id
) source
WHERE m.tenant_id=source.tenant_id AND m.role_id=source.id;

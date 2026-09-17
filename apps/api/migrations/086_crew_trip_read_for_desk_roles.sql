-- 086: Let owner / admin / dispatcher / operations_manager call the crew
--      Today façade. They already have checkin.write for the web manifest;
--      crew.trip.read was only on guide/driver, so a tenant owner could sign
--      into Zettaz Crew and get 403. The payload stays assignment-scoped —
--      a desk role still sees only departures they are assigned to as crew.

INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
  FROM tenant_roles r
  JOIN permissions p ON p.code = 'crew.trip.read'
 WHERE r.is_system
   AND r.code IN ('owner', 'admin', 'dispatcher', 'operations_manager')
ON CONFLICT DO NOTHING;

UPDATE memberships m SET permissions = source.permissions
FROM (
  SELECT r.tenant_id, r.id,
    COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
      FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
  FROM tenant_roles r
  LEFT JOIN role_permissions rp
    ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
  WHERE r.is_system
    AND r.code IN ('owner', 'admin', 'dispatcher', 'operations_manager')
  GROUP BY r.tenant_id, r.id
) source
WHERE m.tenant_id = source.tenant_id AND m.role_id = source.id;

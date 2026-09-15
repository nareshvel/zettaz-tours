-- 080: Give the reservations and finance desks the print permissions their work
--      already requires.
--
-- The presets in 052 left both roles without `print.jobs.create` while giving
-- them `bookings.write` / `payment.write` — so the two roles that actually hand
-- a guest a receipt were the two that could not record one. The web app papered
-- over this: every print button fell back to window.print() when the permission
-- was missing, which printed the document anyway and left no print_jobs row. The
-- audit trail was therefore missing exactly the staff it existed to cover.
--
-- Granting the permission is the correct half of the fix (the client-side
-- bypass is removed in the same change): these roles are already trusted with
-- the underlying booking and payment data, so printing it adds no exposure —
-- it only makes the act visible.
--
-- Only system roles are touched, and only by adding. A tenant that has
-- deliberately customised a role keeps its own grants.

INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
  FROM tenant_roles r
  JOIN permissions p ON p.code IN ('print.jobs.create', 'print.jobs.read')
 WHERE r.is_system
   AND r.code IN ('reservations', 'finance')
ON CONFLICT DO NOTHING;

-- memberships.permissions is the denormalised copy the API reads per request,
-- so it has to be recomputed or the grant above would not take effect until the
-- role was next edited.
UPDATE memberships m SET permissions = source.permissions
FROM (
  SELECT r.tenant_id, r.id,
    COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
      FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
  FROM tenant_roles r
  LEFT JOIN role_permissions rp
    ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
  WHERE r.is_system AND r.code IN ('reservations', 'finance')
  GROUP BY r.tenant_id, r.id
) source
WHERE m.tenant_id = source.tenant_id AND m.role_id = source.id;

ALTER TABLE departures ADD COLUMN overbooked integer NOT NULL DEFAULT 0 CHECK(overbooked>=0);

ALTER TABLE holds
  ADD COLUMN overbook_authorized_by uuid,
  ADD COLUMN overbook_reason text,
  ADD CONSTRAINT holds_overbook_authorizer_fk
    FOREIGN KEY(tenant_id,overbook_authorized_by) REFERENCES memberships(tenant_id,actor_id),
  ADD CONSTRAINT holds_overbook_evidence CHECK(
    (overbook_authorized_by IS NULL AND overbook_reason IS NULL)
    OR (overbook_authorized_by IS NOT NULL AND length(trim(overbook_reason))>=8)
  );

INSERT INTO permissions(code,module_code,name,description) VALUES
  ('inventory.overbook','reservations','Authorize overbooking','Create a reasoned hold beyond ordinary departure capacity')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,'inventory.overbook'
FROM tenant_roles r
WHERE r.code IN ('owner','reservations','dispatcher','operations_manager')
ON CONFLICT DO NOTHING;

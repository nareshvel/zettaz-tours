CREATE FUNCTION list_current_tenant_support_access()
RETURNS TABLE(
  id uuid,
  platform_actor_id uuid,
  platform_user text,
  purpose text,
  permissions text[],
  status text,
  requested_at timestamptz,
  decided_at timestamptz,
  expires_at timestamptz,
  decision_reason text
)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
  SELECT g.id,g.platform_actor_id,p.name,g.purpose,g.permissions,g.status,
    g.requested_at,g.decided_at,g.expires_at,g.decision_reason
  FROM support_access_grants g
  JOIN platform_users p ON p.id=g.platform_actor_id
  WHERE g.tenant_id=nullif(current_setting('app.tenant',true),'')::uuid
  ORDER BY g.requested_at DESC,g.id;
$$;

CREATE FUNCTION current_support_actor_profile(requested_actor_id uuid)
RETURNS TABLE(name text,email text,phone_number text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
  SELECT p.name,''::text,NULL::text
  FROM platform_users p
  WHERE p.id=requested_actor_id
    AND requested_actor_id=nullif(current_setting('app.actor',true),'')::uuid
    AND nullif(current_setting('app.tenant',true),'') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION list_current_tenant_support_access(),current_support_actor_profile(uuid) FROM PUBLIC;

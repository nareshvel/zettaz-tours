-- Auth functions deliberately expose only the minimum data needed by the API
-- server. They run as the migration owner so the runtime role does not bypass
-- tenant RLS to locate an account by email.
CREATE OR REPLACE FUNCTION staff_login_identity(p_email text)
RETURNS TABLE(actor_id uuid,password_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id,c.password_hash
  FROM staff_users s
  JOIN user_credentials c ON c.user_id=s.id
  WHERE lower(s.email)=lower(trim(p_email))
    AND s.is_active
    AND c.password_hash IS NOT NULL
    AND EXISTS(SELECT 1 FROM memberships m WHERE m.actor_id=s.id AND m.active)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION staff_login_tenants(p_actor_id uuid)
RETURNS TABLE(tenant_id uuid,name text,email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id,t.name,s.email
  FROM memberships m
  JOIN tenants t ON t.id=m.tenant_id
  JOIN staff_users s ON s.id=m.actor_id
  WHERE m.actor_id=p_actor_id AND m.active AND s.is_active
  ORDER BY t.name,t.id;
$$;

CREATE OR REPLACE FUNCTION issue_staff_session(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_token_hash text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1
    FROM memberships m
    JOIN staff_users s ON s.id=m.actor_id
    WHERE m.actor_id=p_actor_id AND m.tenant_id=p_tenant_id
      AND m.active AND s.is_active
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO staff_sessions(token_hash,actor_id,tenant_id,expires_at,revoked)
  VALUES(p_token_hash,p_actor_id,p_tenant_id,clock_timestamp()+interval '8 hours',false);
  UPDATE staff_users SET last_login_at=clock_timestamp() WHERE id=p_actor_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION staff_login_identity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION staff_login_tenants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION issue_staff_session(uuid,uuid,text) FROM PUBLIC;

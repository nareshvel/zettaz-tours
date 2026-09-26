-- Platform administrators are a fourth principal (ADR 005). Email and password
-- live on platform_users, never on staff_users / user_credentials.
ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

UPDATE platform_users
SET email = 'platform-' || id::text || '@zettaz.invalid'
WHERE email IS NULL OR btrim(email) = '';

ALTER TABLE platform_users ALTER COLUMN email SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS platform_users_email_lower
  ON platform_users (lower(email));

ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_self ON platform_users;
CREATE POLICY platform_self ON platform_users
  USING (
    current_setting('app.platform', true) = 'true'
    AND id = nullif(current_setting('app.actor', true), '')::uuid
  );

DROP POLICY IF EXISTS tenant_scope ON tenant_subscriptions;
CREATE POLICY tenant_scope ON tenant_subscriptions
  USING (
    tenant_id = nullif(current_setting('app.tenant', true), '')::uuid
    OR current_setting('app.platform', true) = 'true'
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant', true), '')::uuid
  );

CREATE OR REPLACE FUNCTION platform_login_identity(p_email text)
RETURNS TABLE(actor_id uuid, password_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT p.id, p.password_hash
  FROM platform_users p
  WHERE lower(p.email) = lower(trim(p_email))
    AND p.password_hash IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION issue_platform_session(p_actor_id uuid, p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM platform_users WHERE id = p_actor_id AND password_hash IS NOT NULL
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO platform_sessions(token_hash, actor_id, expires_at, revoked)
  VALUES (p_token_hash, p_actor_id, clock_timestamp() + interval '8 hours', false);
  UPDATE platform_users SET last_login_at = clock_timestamp() WHERE id = p_actor_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_platform_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed boolean;
BEGIN
  UPDATE platform_sessions
  SET revoked = true
  WHERE token_hash = p_token_hash AND NOT revoked
  RETURNING true INTO changed;
  RETURN COALESCE(changed, false);
END;
$$;

CREATE OR REPLACE FUNCTION revoke_all_platform_sessions(p_actor_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  UPDATE platform_sessions
  SET revoked = true
  WHERE actor_id = p_actor_id AND NOT revoked AND expires_at > clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION list_platform_support_access()
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  purpose text,
  permissions text[],
  status text,
  requested_at timestamptz,
  decided_at timestamptz,
  expires_at timestamptz,
  decision_reason text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT g.id, g.tenant_id, t.name, t.slug, g.purpose, g.permissions, g.status,
    g.requested_at, g.decided_at, g.expires_at, g.decision_reason
  FROM support_access_grants g
  JOIN tenants t ON t.id = g.tenant_id
  WHERE g.platform_actor_id = nullif(current_setting('app.actor', true), '')::uuid
    AND current_setting('app.platform', true) = 'true'
  ORDER BY g.requested_at DESC, g.id;
$$;

CREATE OR REPLACE FUNCTION current_support_actor_profile(requested_actor_id uuid)
RETURNS TABLE(name text, email text, phone_number text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT p.name, p.email, NULL::text
  FROM platform_users p
  WHERE p.id = requested_actor_id
    AND requested_actor_id = nullif(current_setting('app.actor', true), '')::uuid
    AND nullif(current_setting('app.tenant', true), '') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION resolve_session(token text)
RETURNS TABLE(actor_id uuid, tenant_id uuid, platform boolean, permissions text[], role text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT s.actor_id, NULL::uuid, true,
    ARRAY[
      'tenant.provision',
      'platform.tenant.read',
      'platform.support.request',
      'platform.support.use'
    ]::text[],
    'platform'
  FROM platform_sessions s
  WHERE token_hash = token AND NOT revoked AND expires_at > clock_timestamp()
  UNION ALL
  SELECT s.actor_id, s.tenant_id, false,
    ARRAY(
      SELECT rp.permission_code
      FROM role_permissions rp
      WHERE rp.tenant_id = s.tenant_id AND rp.role_id = m.role_id
      ORDER BY rp.permission_code
    ),
    m.role
  FROM staff_sessions s
  JOIN memberships m USING (tenant_id, actor_id)
  WHERE token_hash = token AND NOT s.revoked AND s.expires_at > clock_timestamp() AND m.active
  UNION ALL
  SELECT s.platform_actor_id, s.tenant_id, false, g.permissions, 'support'
  FROM support_sessions s
  JOIN support_access_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
  WHERE s.token_hash = token AND NOT s.revoked AND s.expires_at > clock_timestamp()
    AND g.status = 'approved' AND g.expires_at > clock_timestamp();
$$;

REVOKE ALL ON FUNCTION platform_login_identity(text), issue_platform_session(uuid, text),
  revoke_platform_session(text), revoke_all_platform_sessions(uuid),
  list_platform_support_access(), current_support_actor_profile(uuid)
  FROM PUBLIC;

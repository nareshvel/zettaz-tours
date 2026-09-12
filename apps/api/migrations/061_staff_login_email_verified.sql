-- Public sign-in cannot SELECT staff_users under RLS (no app.actor).
-- Return email_verified_at from the existing SECURITY DEFINER login helper.
DROP FUNCTION IF EXISTS staff_login_identity(text);
CREATE FUNCTION staff_login_identity(p_email text)
RETURNS TABLE(actor_id uuid, password_hash text, email_verified_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, c.password_hash, s.email_verified_at
  FROM staff_users s
  JOIN user_credentials c ON c.user_id = s.id
  WHERE lower(s.email) = lower(trim(p_email))
    AND s.is_active
    AND c.password_hash IS NOT NULL
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.actor_id = s.id AND m.active)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION staff_login_identity(text) FROM PUBLIC;

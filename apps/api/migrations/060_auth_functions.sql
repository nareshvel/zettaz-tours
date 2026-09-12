-- Migration 060: SECURITY DEFINER helpers for auth operations that bypass RLS
-- These functions run as the table owner so they can read/write RLS-protected tables
-- from the public connection pool (which has no app.actor / app.tenant context).

-- 1. Upsert password hash (needed at registration and password-reset time)
CREATE OR REPLACE FUNCTION upsert_user_credentials(p_user_id uuid, p_password_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO user_credentials(user_id, password_hash)
  VALUES(p_user_id, p_password_hash)
  ON CONFLICT(user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash;
$$;
GRANT EXECUTE ON FUNCTION upsert_user_credentials(uuid, text) TO zettaz_owner;

-- 2. Write the e-mail verification token (after registration)
CREATE OR REPLACE FUNCTION set_email_verification_token(
  p_user_id      uuid,
  p_token_hash   text,
  p_expires_at   timestamptz
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE user_credentials
  SET verification_token_hash = p_token_hash,
      verification_expires_at = p_expires_at
  WHERE user_id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION set_email_verification_token(uuid, text, timestamptz) TO zettaz_owner;

-- 3. Consume the verification token; sets email_verified_at and clears the token.
--    Returns the user_id on success, NULL if token is unknown / expired.
CREATE OR REPLACE FUNCTION consume_email_verification(p_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id
  FROM user_credentials
  WHERE verification_token_hash = p_token_hash
    AND verification_expires_at > NOW();

  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  UPDATE user_credentials
  SET verification_token_hash = NULL,
      verification_expires_at = NULL
  WHERE user_id = v_user_id;

  UPDATE staff_users
  SET email_verified_at = NOW()
  WHERE id = v_user_id AND email_verified_at IS NULL;

  RETURN v_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION consume_email_verification(text) TO zettaz_owner;

-- 4. Create a trial subscription, bypassing tenant_subscriptions RLS.
CREATE OR REPLACE FUNCTION create_trial_subscription(p_tenant_id uuid, p_plan_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO tenant_subscriptions(tenant_id, plan_id, status, trial_ends_at, period_ends_at)
  VALUES(
    p_tenant_id,
    p_plan_id,
    'trial',
    NOW() + INTERVAL '14 days',
    NOW() + INTERVAL '14 days'
  )
  ON CONFLICT(tenant_id) DO NOTHING;
$$;
GRANT EXECUTE ON FUNCTION create_trial_subscription(uuid, text) TO zettaz_owner;

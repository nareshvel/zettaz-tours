CREATE TABLE auth_rate_limits (
  identity_hash text PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION login_attempt_allowed(p_identity_hash text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE((SELECT locked_until IS NULL OR locked_until<=clock_timestamp() FROM auth_rate_limits WHERE identity_hash=p_identity_hash),true);
$$;
CREATE OR REPLACE FUNCTION record_login_attempt(p_identity_hash text,p_succeeded boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_succeeded THEN DELETE FROM auth_rate_limits WHERE identity_hash=p_identity_hash; RETURN; END IF;
  INSERT INTO auth_rate_limits(identity_hash,failed_attempts,window_started_at,locked_until,updated_at)
  VALUES(p_identity_hash,1,clock_timestamp(),NULL,clock_timestamp())
  ON CONFLICT(identity_hash) DO UPDATE SET
    failed_attempts=CASE WHEN auth_rate_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.failed_attempts+1 END,
    window_started_at=CASE WHEN auth_rate_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE auth_rate_limits.window_started_at END,
    locked_until=CASE WHEN (CASE WHEN auth_rate_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.failed_attempts+1 END)>=5 THEN clock_timestamp()+interval '15 minutes' ELSE auth_rate_limits.locked_until END,
    updated_at=clock_timestamp();
END;
$$;
REVOKE ALL ON FUNCTION login_attempt_allowed(text),record_login_attempt(text,boolean) FROM PUBLIC;

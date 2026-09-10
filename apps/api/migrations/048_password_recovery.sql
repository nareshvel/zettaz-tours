CREATE FUNCTION begin_password_reset(p_email text,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE affected integer;
BEGIN
  UPDATE user_credentials c SET password_reset_token_hash=p_token_hash,
    password_reset_expires_at=clock_timestamp()+interval '1 hour'
  FROM staff_users s
  WHERE c.user_id=s.id AND lower(s.email)=lower(trim(p_email)) AND s.is_active
    AND EXISTS(SELECT 1 FROM memberships m WHERE m.actor_id=s.id AND m.active);
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected>0;
END $$;

CREATE FUNCTION complete_password_reset(p_token_hash text,p_password_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE credential user_credentials%ROWTYPE;
BEGIN
  SELECT * INTO credential FROM user_credentials
  WHERE password_reset_token_hash=p_token_hash
    AND password_reset_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE user_credentials SET password_hash=p_password_hash,
    password_reset_token_hash=NULL,password_reset_expires_at=NULL
  WHERE user_id=credential.user_id;
  UPDATE staff_sessions SET revoked=true WHERE actor_id=credential.user_id AND NOT revoked;
  RETURN credential.user_id;
END $$;

REVOKE ALL ON FUNCTION begin_password_reset(text,text),complete_password_reset(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION revoke_staff_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed boolean;
BEGIN
  UPDATE staff_sessions
  SET revoked=true
  WHERE token_hash=p_token_hash AND NOT revoked
  RETURNING true INTO changed;
  RETURN COALESCE(changed,false);
END;
$$;

REVOKE ALL ON FUNCTION revoke_staff_session(text) FROM PUBLIC;

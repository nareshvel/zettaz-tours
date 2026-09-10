CREATE OR REPLACE FUNCTION revoke_all_staff_sessions(p_actor_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE affected integer;
BEGIN
  UPDATE staff_sessions SET revoked=true
  WHERE actor_id=p_actor_id AND NOT revoked;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION revoke_all_staff_sessions(uuid) FROM PUBLIC;

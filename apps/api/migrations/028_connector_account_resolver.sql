CREATE FUNCTION resolve_connector_account(p_public_inbound_id uuid)
RETURNS TABLE(tenant_id uuid,account_id uuid,connector_code text,status text,secret_ciphertext text,secret_key_version text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT tenant_id,id,connector_code,status,secret_ciphertext,secret_key_version
  FROM connector_accounts WHERE public_inbound_id=p_public_inbound_id
$$;
REVOKE ALL ON FUNCTION resolve_connector_account(uuid) FROM PUBLIC;

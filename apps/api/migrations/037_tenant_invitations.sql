CREATE TABLE tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  role_id uuid NOT NULL REFERENCES tenant_roles(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid NOT NULL REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR accepted_at >= created_at)
);
CREATE INDEX tenant_invitations_active ON tenant_invitations(tenant_id,created_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_invitation_scope ON tenant_invitations
  USING (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

CREATE OR REPLACE FUNCTION accept_staff_invitation(
  p_token_hash text,
  p_password_hash text
) RETURNS TABLE(actor_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  invite tenant_invitations%ROWTYPE;
  v_user_id uuid;
  permission_codes text[];
BEGIN
  SELECT * INTO invite FROM tenant_invitations
  WHERE token_hash=p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL
    AND expires_at>clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_user_id FROM staff_users WHERE lower(email)=lower(invite.email) FOR UPDATE;
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO staff_users(id,name,email,email_verified_at,signup_completed_at,is_active)
    VALUES(v_user_id,invite.name,lower(invite.email),clock_timestamp(),clock_timestamp(),true);
  END IF;
  IF EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=invite.tenant_id AND m.actor_id=v_user_id) THEN
    RAISE EXCEPTION 'account already has tenant access' USING ERRCODE='23505';
  END IF;
  INSERT INTO user_credentials(user_id,password_hash)
  VALUES(v_user_id,p_password_hash)
  ON CONFLICT(user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,
    password_reset_token_hash=NULL,password_reset_expires_at=NULL;
  SELECT COALESCE(array_agg(permission_code ORDER BY permission_code),'{}') INTO permission_codes
  FROM role_permissions rp WHERE rp.tenant_id=invite.tenant_id AND rp.role_id=invite.role_id;
  INSERT INTO memberships(tenant_id,actor_id,role,role_id,permissions,active)
  VALUES(invite.tenant_id,v_user_id,invite.role,invite.role_id,permission_codes,true);
  UPDATE tenant_invitations SET accepted_at=clock_timestamp() WHERE id=invite.id;
  RETURN QUERY SELECT v_user_id,invite.tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION accept_staff_invitation(text,text) FROM PUBLIC;

-- Allow activation for staff who already have an inactive membership (Add staff → Grant access).

CREATE OR REPLACE FUNCTION accept_staff_invitation(
  p_token_hash text,
  p_password_hash text
) RETURNS TABLE(actor_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  invite tenant_invitations%ROWTYPE;
  v_user_id uuid;
  permission_codes text[];
  existing_membership memberships%ROWTYPE;
BEGIN
  SELECT * INTO invite FROM tenant_invitations
  WHERE token_hash=p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL
    AND expires_at>clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_user_id FROM staff_users WHERE lower(email)=lower(invite.email) FOR UPDATE;
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO staff_users(id,name,email,email_verified_at,signup_completed_at,is_active,first_name,last_name)
    VALUES(
      v_user_id,
      invite.name,
      lower(invite.email),
      clock_timestamp(),
      clock_timestamp(),
      true,
      split_part(invite.name, ' ', 1),
      NULLIF(trim(substring(invite.name FROM length(split_part(invite.name, ' ', 1)) + 1)), '')
    );
  ELSE
    UPDATE staff_users
    SET
      name = CASE WHEN coalesce(trim(name),'') = '' THEN invite.name ELSE name END,
      email_verified_at = COALESCE(email_verified_at, clock_timestamp()),
      signup_completed_at = COALESCE(signup_completed_at, clock_timestamp()),
      is_active = true
    WHERE id = v_user_id;
  END IF;

  INSERT INTO user_credentials(user_id,password_hash)
  VALUES(v_user_id,p_password_hash)
  ON CONFLICT(user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,
    password_reset_token_hash=NULL,password_reset_expires_at=NULL;

  SELECT COALESCE(array_agg(permission_code ORDER BY permission_code),'{}') INTO permission_codes
  FROM role_permissions rp WHERE rp.tenant_id=invite.tenant_id AND rp.role_id=invite.role_id;

  SELECT * INTO existing_membership
  FROM memberships
  WHERE tenant_id=invite.tenant_id AND actor_id=v_user_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE memberships
    SET role=invite.role,
        role_id=invite.role_id,
        permissions=permission_codes,
        active=true
    WHERE tenant_id=invite.tenant_id AND actor_id=v_user_id;
  ELSE
    INSERT INTO memberships(tenant_id,actor_id,role,role_id,permissions,active)
    VALUES(invite.tenant_id,v_user_id,invite.role,invite.role_id,permission_codes,true);
  END IF;

  INSERT INTO crew_profiles(tenant_id,membership_actor_id,operational_name,notes,active)
  VALUES(invite.tenant_id,v_user_id,invite.name,'',true)
  ON CONFLICT (tenant_id, membership_actor_id) DO UPDATE
    SET operational_name = EXCLUDED.operational_name,
        active = true;

  UPDATE tenant_invitations SET accepted_at=clock_timestamp() WHERE id=invite.id;
  RETURN QUERY SELECT v_user_id,invite.tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION accept_staff_invitation(text,text) FROM PUBLIC;

CREATE TABLE support_access_grants (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  platform_actor_id uuid NOT NULL REFERENCES platform_users(id),
  purpose text NOT NULL CHECK(length(trim(purpose)) BETWEEN 8 AND 500),
  permissions text[] NOT NULL CHECK(
    cardinality(permissions)>0 AND
    permissions <@ ARRAY['catalog.read','bookings.read','manifest.read','audit.read','integration.inbox.read']::text[]
  ),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid, decided_at timestamptz, expires_at timestamptz, decision_reason text,
  PRIMARY KEY(tenant_id,id), UNIQUE(id),
  FOREIGN KEY(tenant_id,decided_by) REFERENCES memberships(tenant_id,actor_id),
  CHECK(
    (status='pending' AND decided_by IS NULL AND decided_at IS NULL AND expires_at IS NULL)
    OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(trim(decision_reason))>=8)
  ),
  CHECK(status<>'approved' OR expires_at>decided_at)
);

CREATE TABLE support_sessions (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  platform_actor_id uuid NOT NULL REFERENCES platform_users(id),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,grant_id) REFERENCES support_access_grants(tenant_id,id)
);

ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON support_access_grants
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
CREATE POLICY tenant_scope ON support_sessions
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

CREATE FUNCTION request_support_access(request_id uuid, platform_id uuid, target_tenant uuid, requested_purpose text, requested_permissions text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE event_id uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM platform_users WHERE id=platform_id) OR NOT EXISTS(SELECT 1 FROM tenants WHERE id=target_tenant) THEN
    RAISE EXCEPTION 'support target unavailable';
  END IF;
  IF length(trim(requested_purpose)) NOT BETWEEN 8 AND 500 OR cardinality(requested_permissions)=0
     OR NOT requested_permissions <@ ARRAY['catalog.read','bookings.read','manifest.read','audit.read','integration.inbox.read']::text[] THEN
    RAISE EXCEPTION 'invalid support request';
  END IF;
  INSERT INTO support_access_grants(tenant_id,id,platform_actor_id,purpose,permissions)
  VALUES(target_tenant,request_id,platform_id,trim(requested_purpose),requested_permissions)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM support_access_grants WHERE tenant_id=target_tenant AND id=request_id AND platform_actor_id=platform_id AND purpose=trim(requested_purpose) AND permissions=requested_permissions) THEN
      RAISE EXCEPTION 'support request id reused';
    END IF;
    RETURN request_id;
  END IF;
  event_id:=gen_random_uuid();
  INSERT INTO audit_events(tenant_id,id,actor_id,action,aggregate_id,before_data,after_data,reason)
  VALUES(target_tenant,event_id,platform_id,'support_access.requested',request_id,NULL,jsonb_build_object('permissions',requested_permissions),trim(requested_purpose));
  INSERT INTO outbox_events(tenant_id,id,type,aggregate_id,payload)
  VALUES(target_tenant,event_id,'support_access.requested',request_id,jsonb_build_object('version',1,'actorId',platform_id,'aggregateId',request_id));
  RETURN request_id;
END $$;

CREATE FUNCTION issue_support_session(platform_id uuid, access_grant_id uuid, token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE access support_access_grants%ROWTYPE; event_id uuid;
BEGIN
  SELECT * INTO access FROM support_access_grants WHERE id=access_grant_id AND platform_actor_id=platform_id FOR UPDATE;
  IF NOT FOUND OR access.status<>'approved' OR access.expires_at<=clock_timestamp() THEN RETURN false; END IF;
  INSERT INTO support_sessions(token_hash,tenant_id,grant_id,platform_actor_id,expires_at)
  VALUES(token,access.tenant_id,access.id,platform_id,access.expires_at);
  event_id:=gen_random_uuid();
  INSERT INTO audit_events(tenant_id,id,actor_id,action,aggregate_id,before_data,after_data,reason)
  VALUES(access.tenant_id,event_id,platform_id,'support_access.used',access.id,NULL,jsonb_build_object('expiresAt',access.expires_at),access.purpose);
  INSERT INTO outbox_events(tenant_id,id,type,aggregate_id,payload)
  VALUES(access.tenant_id,event_id,'support_access.used',access.id,jsonb_build_object('version',1,'actorId',platform_id,'aggregateId',access.id));
  RETURN true;
END $$;

CREATE FUNCTION revoke_support_session(token text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
  UPDATE support_sessions SET revoked=true WHERE token_hash=token;
$$;

CREATE OR REPLACE FUNCTION resolve_session(token text)
RETURNS TABLE(actor_id uuid, tenant_id uuid, platform boolean, permissions text[], role text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT s.actor_id, NULL::uuid, true,
    ARRAY['tenant.provision','platform.support.request','platform.support.use']::text[], 'platform'
  FROM platform_sessions s WHERE token_hash=token AND NOT revoked AND expires_at>clock_timestamp()
  UNION ALL
  SELECT s.actor_id,s.tenant_id,false,
    ARRAY(SELECT rp.permission_code FROM role_permissions rp WHERE rp.tenant_id=s.tenant_id AND rp.role_id=m.role_id ORDER BY rp.permission_code),m.role
  FROM staff_sessions s JOIN memberships m USING(tenant_id,actor_id)
  WHERE token_hash=token AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active
  UNION ALL
  SELECT s.platform_actor_id,s.tenant_id,false,g.permissions,'support'
  FROM support_sessions s JOIN support_access_grants g ON g.tenant_id=s.tenant_id AND g.id=s.grant_id
  WHERE s.token_hash=token AND NOT s.revoked AND s.expires_at>clock_timestamp()
    AND g.status='approved' AND g.expires_at>clock_timestamp();
$$;
REVOKE ALL ON FUNCTION request_support_access(uuid,uuid,uuid,text,text[]),issue_support_session(uuid,uuid,text),revoke_support_session(text) FROM PUBLIC;

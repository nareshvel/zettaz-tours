CREATE TABLE platform_users (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE staff_users (id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL);
CREATE TABLE tenants (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, timezone text NOT NULL,
  config jsonb NOT NULL, version integer NOT NULL DEFAULT 1, is_mock boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  tenant_id uuid REFERENCES tenants(id), actor_id uuid REFERENCES staff_users(id),
  role text NOT NULL CHECK(role IN ('owner','admin','reservations','dispatcher','finance','auditor')),
  permissions text[] NOT NULL, active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,actor_id)
);
CREATE TABLE platform_sessions (
  token_hash text PRIMARY KEY, actor_id uuid NOT NULL REFERENCES platform_users(id),
  expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE staff_sessions (
  token_hash text PRIMARY KEY, actor_id uuid NOT NULL, tenant_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
  FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,actor_id)
);
CREATE FUNCTION resolve_session(token text)
RETURNS TABLE(actor_id uuid, tenant_id uuid, platform boolean, permissions text[], role text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.actor_id, NULL::uuid, true, ARRAY['tenant.provision']::text[], 'platform'
  FROM platform_sessions s WHERE token_hash=token AND NOT revoked AND expires_at>clock_timestamp()
  UNION ALL
  SELECT s.actor_id,s.tenant_id,false,m.permissions,m.role
  FROM staff_sessions s JOIN memberships m USING(tenant_id,actor_id)
  WHERE token_hash=token AND NOT revoked AND expires_at>clock_timestamp() AND m.active;
$$;
REVOKE ALL ON FUNCTION resolve_session(text) FROM PUBLIC;
CREATE TABLE products (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
  definition jsonb NOT NULL, version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id)
);
CREATE TABLE schedules (
  tenant_id uuid NOT NULL, id uuid NOT NULL, product_id uuid NOT NULL,
  definition jsonb NOT NULL, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE departures (
  tenant_id uuid NOT NULL, id uuid NOT NULL, product_id uuid NOT NULL, schedule_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, local_date date NOT NULL, capacity integer NOT NULL CHECK(capacity>0),
  committed integer NOT NULL DEFAULT 0 CHECK(committed>=0 AND committed<=capacity),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,product_id,starts_at),
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
  FOREIGN KEY(tenant_id,schedule_id) REFERENCES schedules(tenant_id,id)
);
CREATE TABLE holds (
  tenant_id uuid NOT NULL, id uuid NOT NULL, departure_id uuid NOT NULL, actor_id uuid NOT NULL,
  party jsonb NOT NULL, seats integer NOT NULL CHECK(seats>=0), quote jsonb NOT NULL,
  expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,id,departure_id),
  FOREIGN KEY(tenant_id,departure_id) REFERENCES departures(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,actor_id)
);
CREATE INDEX holds_expiry ON holds(tenant_id,departure_id,expires_at) WHERE NOT consumed;
CREATE TABLE bookings (
  tenant_id uuid NOT NULL, id uuid NOT NULL, hold_id uuid NOT NULL, departure_id uuid NOT NULL,
  lead_name text NOT NULL, lead_email text NOT NULL, source text NOT NULL, pickup jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('held','confirmed')), version integer NOT NULL DEFAULT 1,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,hold_id),
  FOREIGN KEY(tenant_id,hold_id,departure_id) REFERENCES holds(tenant_id,id,departure_id)
);
CREATE INDEX manifest_lookup ON bookings(tenant_id,departure_id,state);
CREATE TABLE payments (
  tenant_id uuid NOT NULL, id uuid NOT NULL, booking_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000000),
  currency text NOT NULL, method text NOT NULL, status text NOT NULL CHECK(status IN ('settled','pending')),
  reference text NOT NULL, reason text NOT NULL, occurred_at timestamptz NOT NULL, actor_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id)
);
CREATE INDEX payments_booking ON payments(tenant_id,booking_id);
CREATE TABLE price_snapshots (
  tenant_id uuid NOT NULL, booking_id uuid NOT NULL, version integer NOT NULL, quote jsonb NOT NULL,
  PRIMARY KEY(tenant_id,booking_id,version), FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id)
);
CREATE TABLE audit_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, actor_id uuid NOT NULL,
  action text NOT NULL, aggregate_id uuid NOT NULL, before_data jsonb, after_data jsonb,
  reason text, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(tenant_id,id)
);
CREATE INDEX audit_tenant_time ON audit_events(tenant_id,occurred_at,id);
CREATE TABLE outbox_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, type text NOT NULL,
  aggregate_id uuid NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz, PRIMARY KEY(tenant_id,id)
);
CREATE INDEX outbox_pending ON outbox_events(tenant_id,occurred_at) WHERE delivered_at IS NULL;
CREATE TABLE event_receipts (
  tenant_id uuid NOT NULL, event_id uuid NOT NULL, handler text NOT NULL,
  PRIMARY KEY(tenant_id,event_id,handler), FOREIGN KEY(tenant_id,event_id) REFERENCES outbox_events(tenant_id,id)
);
CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid NOT NULL, operation text NOT NULL,
  key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL,
  PRIMARY KEY(tenant_id,actor_id,operation,key)
);
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only record'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER snapshot_append_only BEFORE UPDATE OR DELETE ON price_snapshots FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Owner-only migrations; the runtime role receives explicit grants from the migration runner.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenants USING(id = nullif(current_setting('app.tenant',true),'')::uuid OR current_setting('app.platform',true)='true')
  WITH CHECK(id = nullif(current_setting('app.tenant',true),'')::uuid OR current_setting('app.platform',true)='true');
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_scope ON staff_users USING(id=nullif(current_setting('app.actor',true),'')::uuid OR current_setting('app.platform',true)='true')
  WITH CHECK(current_setting('app.platform',true)='true' OR current_setting('app.member_admin',true)='true');
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','products','schedules','departures','holds','bookings','payments','price_snapshots','audit_events','outbox_events','event_receipts','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid)',t);
  END LOOP;
END $$;

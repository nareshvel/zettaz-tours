ALTER TABLE bookings DROP CONSTRAINT bookings_state_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_state_check CHECK(state IN ('held','confirmed','cancelled'));
CREATE TABLE booking_change_quotes (
 tenant_id uuid NOT NULL, id uuid NOT NULL, booking_id uuid NOT NULL, actor_id uuid NOT NULL,
 base_version integer NOT NULL, input jsonb NOT NULL, quote jsonb NOT NULL, seats integer NOT NULL CHECK(seats>=0),
 allow_balance boolean NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id)
);
CREATE TABLE booking_changes (
 tenant_id uuid NOT NULL, id uuid NOT NULL, booking_id uuid NOT NULL, version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('amendment','cancellation')), quote_id uuid,
 before_data jsonb NOT NULL, after_data jsonb NOT NULL, reason text NOT NULL, actor_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,booking_id,version), UNIQUE(tenant_id,quote_id),
 FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
 FOREIGN KEY(tenant_id,quote_id) REFERENCES booking_change_quotes(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['booking_change_quotes','booking_changes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid)',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_mutation()',t);
 END LOOP;
END $$;

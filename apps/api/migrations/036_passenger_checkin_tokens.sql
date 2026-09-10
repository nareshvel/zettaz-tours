CREATE TABLE passenger_checkin_tokens (
  tenant_id uuid NOT NULL, id uuid NOT NULL, passenger_id uuid NOT NULL, token_hash text NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_by uuid NOT NULL REFERENCES staff_users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,token_hash), FOREIGN KEY(tenant_id,passenger_id) REFERENCES booking_passengers(tenant_id,id)
);
CREATE INDEX passenger_checkin_tokens_lookup ON passenger_checkin_tokens(token_hash) WHERE revoked_at IS NULL;
ALTER TABLE passenger_checkin_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON passenger_checkin_tokens USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

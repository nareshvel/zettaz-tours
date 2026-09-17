-- Encrypted-offline crew devices and idempotent command receipts (ADR 007 / 016).
CREATE TABLE IF NOT EXISTS crew_devices (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  actor_id uuid NOT NULL,
  client_device_id text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios','android','web')),
  credential_hash text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES memberships(tenant_id, actor_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crew_devices_active_client
  ON crew_devices(tenant_id, actor_id, client_device_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS crew_devices_actor ON crew_devices(tenant_id, actor_id, enrolled_at DESC);

CREATE TABLE IF NOT EXISTS crew_offline_commands (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  device_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  client_command_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('checkin','trip_event','waiver','payment')),
  occurred_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted','duplicate','rejected','conflict')),
  reason text,
  result jsonb,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, client_command_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES crew_devices(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS crew_offline_commands_device
  ON crew_offline_commands(tenant_id, device_id, occurred_at DESC);

ALTER TABLE crew_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_offline_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON crew_devices;
CREATE POLICY tenant_scope ON crew_devices
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
DROP POLICY IF EXISTS tenant_scope ON crew_offline_commands;
CREATE POLICY tenant_scope ON crew_offline_commands
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

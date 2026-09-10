CREATE TABLE notification_messages (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  booking_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('booking_confirmation','payment_request','waiver_request','cancellation')),
  channel text NOT NULL CHECK(channel='email'),
  recipient text NOT NULL,
  locale text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK(status IN ('held_provider','queued','sent','failed','cancelled')) DEFAULT 'held_provider',
  provider_message_id text,
  failure_detail text,
  requested_by uuid NOT NULL REFERENCES staff_users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id)
);
CREATE INDEX notification_messages_booking_idx
  ON notification_messages(tenant_id,booking_id,requested_at DESC);
ALTER TABLE notification_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON notification_messages
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

INSERT INTO app_modules(code,name,description,sort_order)
VALUES ('notifications','Notifications','Auditable customer communication requests',49)
ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,module_code,name,description) VALUES
 ('notifications.request','notifications','Request notifications','Prepare tenant customer communication for provider delivery'),
 ('notifications.read','notifications','Read notifications','Review customer communication history')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code FROM tenant_roles r JOIN permissions p ON p.code=ANY(CASE r.code
 WHEN 'owner' THEN ARRAY['notifications.request','notifications.read']
 WHEN 'admin' THEN ARRAY['notifications.request','notifications.read']
 WHEN 'reservations' THEN ARRAY['notifications.request','notifications.read']
 WHEN 'auditor' THEN ARRAY['notifications.read']
 ELSE ARRAY[]::text[] END) ON CONFLICT DO NOTHING;

CREATE TABLE customers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  normalized_email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,normalized_email),
  CHECK(normalized_email=lower(trim(email)))
);

ALTER TABLE bookings
  ADD COLUMN customer_id uuid,
  ADD COLUMN purchaser jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN emergency_contact jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO customers(tenant_id,id,name,email,normalized_email)
SELECT DISTINCT ON (tenant_id,lower(trim(lead_email))) tenant_id,gen_random_uuid(),lead_name,lower(trim(lead_email)),lower(trim(lead_email))
FROM bookings
ORDER BY tenant_id,lower(trim(lead_email)),id;

UPDATE bookings b SET
  customer_id=c.id,
  purchaser=jsonb_build_object('name',b.lead_name,'email',b.lead_email,'phone','')
FROM customers c
WHERE c.tenant_id=b.tenant_id AND c.normalized_email=lower(trim(b.lead_email));

ALTER TABLE bookings
  ALTER COLUMN customer_id SET NOT NULL,
  ADD CONSTRAINT bookings_customer_fk FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  ADD CONSTRAINT bookings_purchaser_shape CHECK(
    purchaser ?& ARRAY['name','email','phone']
    AND jsonb_typeof(purchaser)='object'
  ),
  ADD CONSTRAINT bookings_emergency_contact_shape CHECK(
    emergency_contact='{}'::jsonb OR (
      emergency_contact ?& ARRAY['name','phone','relationship']
      AND jsonb_typeof(emergency_contact)='object'
    )
  );

CREATE INDEX customer_name_lookup ON customers(tenant_id,lower(name),id);
CREATE INDEX booking_customer_history ON bookings(tenant_id,customer_id,id);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON customers
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

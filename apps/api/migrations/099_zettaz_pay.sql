-- 099: Zettaz Pay (Stripe Connect) production tables.
--
-- * zettaz_pay_accounts   one connected merchant account per tenant. Moved out of
--                         tenants.config because Settings saves replace config
--                         wholesale and would silently drop the account link.
-- * zettaz_pay_requests   shareable pay links (email, QR, copy link). Token is
--                         stored hashed; the amount is re-checked against the
--                         live balance every time the guest opens it.
-- * zettaz_pay_checkouts  every Stripe Checkout Session we create, so webhooks
--                         resolve the tenant from our own row, refunds know the
--                         PaymentIntent, and a stale session can be expired.
-- * zettaz_pay_refunds    refunds started in the app or in the tenant's own
--                         Stripe Dashboard; ledger_posted makes posting once-only.
-- * zettaz_pay_disputes   chargebacks; a lost dispute removes the money from the
--                         booking ledger the same way a refund does.
--
-- Booking money stays in payments / payment_adjustments (append-only). A refund
-- reverses the live Zettaz Pay payment row and re-posts the remaining amount, so
-- every existing "paid" query keeps working unchanged.

CREATE TABLE zettaz_pay_accounts (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  account_id text NOT NULL UNIQUE CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
  merchant_country text NOT NULL CHECK (merchant_country ~ '^[A-Z]{2}$'),
  charges_enabled boolean NOT NULL DEFAULT false,
  requirements_due boolean NOT NULL DEFAULT false,
  requirements_deadline timestamptz,
  synced_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE zettaz_pay_requests (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  booking_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  amount_minor bigint CHECK (amount_minor IS NULL OR (amount_minor > 0 AND amount_minor <= 1000000000000)),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  channel text NOT NULL CHECK (channel IN ('email','qr','link')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings(tenant_id, id)
);
CREATE INDEX zettaz_pay_requests_booking ON zettaz_pay_requests(tenant_id, booking_id);

CREATE TABLE zettaz_pay_checkouts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  booking_id uuid NOT NULL,
  request_id uuid,
  session_id text NOT NULL UNIQUE CHECK (session_id ~ '^cs_[A-Za-z0-9_]+$'),
  account_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 1000000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','expired')),
  origin text NOT NULL CHECK (origin IN ('staff','pay_link')),
  payment_intent_id text,
  payment_id uuid,
  paid_minor bigint CHECK (paid_minor IS NULL OR paid_minor > 0),
  paid_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings(tenant_id, id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES zettaz_pay_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id)
);
CREATE INDEX zettaz_pay_checkouts_booking ON zettaz_pay_checkouts(tenant_id, booking_id);
CREATE UNIQUE INDEX zettaz_pay_checkouts_intent ON zettaz_pay_checkouts(payment_intent_id) WHERE payment_intent_id IS NOT NULL;

CREATE TABLE zettaz_pay_refunds (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  checkout_id uuid NOT NULL,
  refund_id text NOT NULL UNIQUE CHECK (refund_id ~ '^(re|pyr)_[A-Za-z0-9_]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','requires_action','succeeded','failed','canceled')),
  origin text NOT NULL CHECK (origin IN ('app','stripe_dashboard')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  ledger_posted boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, checkout_id) REFERENCES zettaz_pay_checkouts(tenant_id, id)
);

CREATE TABLE zettaz_pay_disputes (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  checkout_id uuid NOT NULL,
  dispute_id text NOT NULL UNIQUE CHECK (dispute_id ~ '^(dp|du)_[A-Za-z0-9_]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  status text NOT NULL,
  reason text NOT NULL DEFAULT '',
  evidence_due_by timestamptz,
  ledger_posted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, checkout_id) REFERENCES zettaz_pay_checkouts(tenant_id, id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['zettaz_pay_accounts','zettaz_pay_requests','zettaz_pay_checkouts','zettaz_pay_refunds','zettaz_pay_disputes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id = nullif(current_setting(''app.tenant'',true),'''')::uuid)', t);
  END LOOP;
END $$;

-- Webhooks and the public pay page arrive without a tenant session. These
-- definer functions return only the tenant id needed to open a scoped
-- transaction; every read after that goes through RLS.
CREATE FUNCTION zettaz_pay_tenant_for_account(p_account text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id FROM zettaz_pay_accounts WHERE account_id = p_account
$$;
CREATE FUNCTION zettaz_pay_checkout_for_session(p_session text)
RETURNS TABLE(tenant_id uuid, checkout_id uuid, account_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id, id, account_id FROM zettaz_pay_checkouts WHERE session_id = p_session
$$;
CREATE FUNCTION zettaz_pay_checkout_for_intent(p_intent text)
RETURNS TABLE(tenant_id uuid, checkout_id uuid, account_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id, id, account_id FROM zettaz_pay_checkouts WHERE payment_intent_id = p_intent
$$;
CREATE FUNCTION zettaz_pay_resolve_request(p_token_hash text)
RETURNS TABLE(tenant_id uuid, request_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id, id FROM zettaz_pay_requests WHERE token_hash = p_token_hash
$$;
CREATE FUNCTION zettaz_pay_owner(p_tenant uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.actor_id FROM memberships m JOIN tenant_roles r ON r.id = m.role_id
   WHERE m.tenant_id = p_tenant AND m.active AND r.code = 'owner'
   ORDER BY m.actor_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION zettaz_pay_tenant_for_account(text), zettaz_pay_checkout_for_session(text),
  zettaz_pay_checkout_for_intent(text), zettaz_pay_resolve_request(text), zettaz_pay_owner(uuid) FROM PUBLIC;

-- Carry over any account linked by the 20 Sep slice, then drop the config key
-- (the strict tenant config schema would otherwise reject the next Settings save).
INSERT INTO zettaz_pay_accounts(tenant_id, account_id, merchant_country, charges_enabled, created_by)
SELECT t.id,
       t.config #>> '{zettazPay,accountId}',
       CASE WHEN upper(coalesce(t.business_profile->>'country','')) ~ '^[A-Z]{2}$'
            THEN upper(t.business_profile->>'country') ELSE 'US' END,
       coalesce((t.config #>> '{zettazPay,chargesEnabled}')::boolean, false),
       '00000000-0000-0000-0000-000000000001'
  FROM tenants t
 WHERE t.config #>> '{zettazPay,accountId}' ~ '^acct_[A-Za-z0-9]+$'
ON CONFLICT DO NOTHING;
UPDATE tenants SET config = config - 'zettazPay' WHERE config ? 'zettazPay';

INSERT INTO permissions(code, module_code, name, description) VALUES
 ('payment.refund','reservations','Refund card payments','Refund Zettaz Pay card payments to the guest, in full or in part')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id, role_id, permission_code)
SELECT tenant_id, id, 'payment.refund' FROM tenant_roles WHERE code IN ('owner','finance')
ON CONFLICT DO NOTHING;

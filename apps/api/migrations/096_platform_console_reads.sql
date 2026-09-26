-- Cross-tenant platform console reads. SECURITY DEFINER + app.platform check.
-- No guest names, payloads, or booking money.

CREATE OR REPLACE FUNCTION platform_overview()
RETURNS TABLE(
  tenants_total int,
  tenants_trial int,
  tenants_active int,
  tenants_past_due int,
  tenants_cancelled int,
  support_pending int,
  inbox_attention int,
  outbox_pending int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT
    (SELECT COUNT(*)::int FROM tenants),
    (SELECT COUNT(*)::int FROM tenant_subscriptions WHERE status = 'trial'),
    (SELECT COUNT(*)::int FROM tenant_subscriptions WHERE status = 'active'),
    (SELECT COUNT(*)::int FROM tenant_subscriptions WHERE status = 'past_due'),
    (SELECT COUNT(*)::int FROM tenant_subscriptions WHERE status = 'cancelled'),
    (SELECT COUNT(*)::int FROM support_access_grants WHERE status = 'pending'),
    (SELECT COUNT(*)::int FROM webhook_inbox WHERE status IN ('quarantined','retry_pending','dead_letter')),
    (SELECT COUNT(*)::int FROM outbox_events WHERE delivered_at IS NULL)
  WHERE current_setting('app.platform', true) = 'true';
$$;

CREATE OR REPLACE FUNCTION platform_tenant_record(p_tenant uuid)
RETURNS TABLE(
  id uuid,
  slug text,
  name text,
  timezone text,
  created_at timestamptz,
  is_mock boolean,
  plan_id text,
  plan_name text,
  subscription_status text,
  period_ends_at timestamptz,
  owner_name text,
  owner_email text,
  owner_phone text,
  country text,
  products int,
  upcoming_departures int,
  pickup_locations int,
  waiver_templates int,
  members int,
  has_logo boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT t.id, t.slug, t.name, t.timezone, t.created_at, t.is_mock,
    s.plan_id, p.name, s.status, s.period_ends_at,
    t.authorized_contact->>'name',
    t.authorized_contact->>'email',
    t.authorized_contact->>'phone',
    t.business_profile->>'country',
    (SELECT COUNT(*)::int FROM products x WHERE x.tenant_id = t.id AND x.status = 'active'),
    (SELECT COUNT(*)::int FROM departures x WHERE x.tenant_id = t.id AND x.starts_at > clock_timestamp()),
    (SELECT COUNT(*)::int FROM pickup_locations x WHERE x.tenant_id = t.id AND x.active),
    (SELECT COUNT(*)::int FROM waiver_templates x WHERE x.tenant_id = t.id AND x.active),
    (SELECT COUNT(*)::int FROM memberships x WHERE x.tenant_id = t.id),
    (t.logo_path IS NOT NULL AND t.logo_path <> '')
  FROM tenants t
  LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
  LEFT JOIN subscription_plans p ON p.id = s.plan_id
  WHERE t.id = p_tenant
    AND current_setting('app.platform', true) = 'true';
$$;

CREATE OR REPLACE FUNCTION list_platform_health()
RETURNS TABLE(
  kind text,
  tenant_id uuid,
  tenant_name text,
  source text,
  status text,
  occurred_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT kind, tenant_id, tenant_name, source, status, occurred_at
  FROM (
    SELECT 'inbox'::text AS kind, t.id AS tenant_id, t.name AS tenant_name,
      c.connector_code AS source, i.status, i.received_at AS occurred_at
    FROM webhook_inbox i
    JOIN tenants t ON t.id = i.tenant_id
    JOIN connector_accounts c ON c.tenant_id = i.tenant_id AND c.id = i.connector_account_id
    WHERE i.status IN ('quarantined','retry_pending','dead_letter')
    UNION ALL
    SELECT 'outbox', t.id, t.name, o.type, 'undelivered', o.occurred_at
    FROM outbox_events o
    JOIN tenants t ON t.id = o.tenant_id
    WHERE o.delivered_at IS NULL
  ) health
  WHERE current_setting('app.platform', true) = 'true'
  ORDER BY occurred_at DESC
  LIMIT 80;
$$;

CREATE OR REPLACE FUNCTION list_platform_activity()
RETURNS TABLE(
  occurred_at timestamptz,
  action text,
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  actor_name text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT a.occurred_at, a.action, t.id, t.name, t.slug,
    COALESCE(p.name, 'Tenant staff')
  FROM audit_events a
  JOIN tenants t ON t.id = a.tenant_id
  LEFT JOIN platform_users p ON p.id = a.actor_id
  WHERE current_setting('app.platform', true) = 'true'
    AND (
      a.action = 'tenant.created'
      OR a.action LIKE 'support_access.%'
    )
  ORDER BY a.occurred_at DESC, a.id DESC
  LIMIT 80;
$$;

REVOKE ALL ON FUNCTION platform_overview(), platform_tenant_record(uuid),
  list_platform_health(), list_platform_activity() FROM PUBLIC;

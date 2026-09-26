-- Health: connector inbox only. Transactional outbox is a drain queue, not an incident.
-- Tenant record: plan features/limits + local trial extend / suspend (no Stripe).

DROP FUNCTION IF EXISTS platform_tenant_record(uuid);

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
    (SELECT COUNT(*)::int FROM tenant_subscriptions WHERE status IN ('cancelled','suspended')),
    (SELECT COUNT(*)::int FROM support_access_grants WHERE status = 'pending'),
    (SELECT COUNT(*)::int FROM webhook_inbox WHERE status IN ('quarantined','retry_pending','dead_letter')),
    0
  WHERE current_setting('app.platform', true) = 'true';
$$;

CREATE FUNCTION platform_tenant_record(p_tenant uuid)
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
  billing_cycle text,
  period_ends_at timestamptz,
  trial_ends_at timestamptz,
  stripe_billed boolean,
  features jsonb,
  limits jsonb,
  owner_name text,
  owner_email text,
  owner_phone text,
  country text,
  products int,
  upcoming_departures int,
  pickup_locations int,
  waiver_templates int,
  members int,
  assets int,
  has_logo boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
  SELECT t.id, t.slug, t.name, t.timezone, t.created_at, t.is_mock,
    s.plan_id, p.name, s.status, s.billing_cycle, s.period_ends_at, s.trial_ends_at,
    (s.stripe_subscription_id IS NOT NULL AND s.stripe_subscription_id <> ''),
    COALESCE(p.features, '[]'::jsonb), COALESCE(p.limits, '{}'::jsonb),
    t.authorized_contact->>'name',
    t.authorized_contact->>'email',
    t.authorized_contact->>'phone',
    t.business_profile->>'country',
    (SELECT COUNT(*)::int FROM products x WHERE x.tenant_id = t.id AND x.status = 'active'),
    (SELECT COUNT(*)::int FROM departures x WHERE x.tenant_id = t.id AND x.starts_at > clock_timestamp()),
    (SELECT COUNT(*)::int FROM pickup_locations x WHERE x.tenant_id = t.id AND x.active),
    (SELECT COUNT(*)::int FROM waiver_templates x WHERE x.tenant_id = t.id AND x.active),
    (SELECT COUNT(*)::int FROM memberships x WHERE x.tenant_id = t.id),
    (SELECT COUNT(*)::int FROM operational_resources x WHERE x.tenant_id = t.id AND x.active),
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
  SELECT 'inbox'::text, t.id, t.name, c.connector_code, i.status, i.received_at
  FROM webhook_inbox i
  JOIN tenants t ON t.id = i.tenant_id
  JOIN connector_accounts c ON c.tenant_id = i.tenant_id AND c.id = i.connector_account_id
  WHERE current_setting('app.platform', true) = 'true'
    AND i.status IN ('quarantined','retry_pending','dead_letter')
  ORDER BY i.received_at DESC
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
      OR a.action LIKE 'platform.subscription.%'
    )
  ORDER BY a.occurred_at DESC, a.id DESC
  LIMIT 80;
$$;

ALTER TABLE tenant_subscriptions DROP CONSTRAINT IF EXISTS tenant_subscriptions_status_check;
ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_status_check
  CHECK (status IN ('trial','active','past_due','cancelled','canceled','suspended'));

CREATE OR REPLACE FUNCTION platform_adjust_subscription(
  p_tenant uuid,
  p_action text,
  p_days int,
  p_reason text,
  p_event uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security=off AS $$
DECLARE
  sub tenant_subscriptions%ROWTYPE;
  actor uuid;
  next_trial timestamptz;
BEGIN
  IF current_setting('app.platform', true) IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Platform session required');
  END IF;
  actor := nullif(current_setting('app.actor', true), '')::uuid;
  IF actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Platform session required');
  END IF;
  SELECT * INTO sub FROM tenant_subscriptions WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This workspace has no subscription yet');
  END IF;
  IF sub.stripe_subscription_id IS NOT NULL AND btrim(sub.stripe_subscription_id) <> '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'This workspace is billed in Stripe. Extend trial or suspend from the tenant Subscription page so Billing and Connect stay unmixed.'
    );
  END IF;
  IF p_action = 'extend_trial' THEN
    IF sub.status IS DISTINCT FROM 'trial' THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Trial days can only be added while the workspace is on trial');
    END IF;
    IF p_days IS NULL OR p_days NOT IN (7, 14, 30) THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Choose 7, 14, or 30 extra trial days');
    END IF;
    next_trial := COALESCE(sub.trial_ends_at, sub.period_ends_at, clock_timestamp())
      + make_interval(days => p_days);
    UPDATE tenant_subscriptions
      SET trial_ends_at = next_trial, period_ends_at = next_trial
      WHERE tenant_id = p_tenant;
  ELSIF p_action = 'suspend' THEN
    IF sub.status IN ('cancelled', 'suspended') THEN
      RETURN jsonb_build_object('ok', false, 'message', 'This workspace is already suspended');
    END IF;
    UPDATE tenant_subscriptions SET status = 'suspended' WHERE tenant_id = p_tenant;
  ELSIF p_action = 'resume' THEN
    IF sub.status IS DISTINCT FROM 'suspended' THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Only a suspended workspace can be resumed');
    END IF;
    next_trial := COALESCE(sub.trial_ends_at, clock_timestamp() + interval '14 days');
    IF next_trial <= clock_timestamp() THEN
      next_trial := clock_timestamp() + interval '14 days';
    END IF;
    UPDATE tenant_subscriptions
      SET status = 'trial', trial_ends_at = next_trial, period_ends_at = next_trial
      WHERE tenant_id = p_tenant;
  ELSE
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown subscription action');
  END IF;
  INSERT INTO audit_events(tenant_id,id,actor_id,action,aggregate_id,before_data,after_data,reason)
  VALUES(
    p_tenant, p_event, actor, 'platform.subscription.' || p_action, p_tenant,
    NULL, jsonb_build_object('days', p_days), nullif(btrim(COALESCE(p_reason, '')), '')
  );
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION platform_overview(), platform_tenant_record(uuid),
  list_platform_health(), list_platform_activity(),
  platform_adjust_subscription(uuid, text, int, text, uuid) FROM PUBLIC;

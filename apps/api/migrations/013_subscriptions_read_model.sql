CREATE TABLE subscription_plans (
  id text PRIMARY KEY, name text NOT NULL, description text NOT NULL,
  monthly_minor integer NOT NULL CHECK(monthly_minor>=0), currency text NOT NULL,
  features jsonb NOT NULL DEFAULT '[]'::jsonb, active boolean NOT NULL DEFAULT true
);
CREATE TABLE tenant_subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id), plan_id text NOT NULL REFERENCES subscription_plans(id),
  status text NOT NULL CHECK(status IN ('trial','active','past_due','cancelled')), period_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenant_subscriptions USING (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

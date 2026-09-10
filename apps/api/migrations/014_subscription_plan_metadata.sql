ALTER TABLE subscription_plans
  ADD COLUMN yearly_minor integer CHECK (yearly_minor >= 0),
  ADD COLUMN limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN stripe_price_id_monthly text,
  ADD COLUMN stripe_price_id_yearly text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE tenant_subscriptions
  ADD COLUMN billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly')),
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE FUNCTION touch_subscription_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION touch_subscription_updated_at();

CREATE TRIGGER tenant_subscriptions_updated_at
  BEFORE UPDATE ON tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_subscription_updated_at();

-- Zettaz Tours & Charters subscription plans
-- Generated 2026-09-11 by setup-stripe-plans.ts
-- Stripe account: Zettaz SaaS (acct_1TgFuNDiMTz5HnMK) — live mode

-- Deactivate the old Cloud POS placeholder plans.
-- tenant_subscriptions rows referencing these have been manually migrated to
-- the new T&C plan UUIDs; safe to deactivate (or delete via migration 058).
UPDATE subscription_plans SET active = false
  WHERE id IN (
    '2487711b-a560-11f1-97e5-525400d69130',
    '6baf0d04-4c50-11f0-8dfa-525400d69130',
    '6baf1082-4c50-11f0-8dfa-525400d69130',
    '6baf11e2-4c50-11f0-8dfa-525400d69130'
  );

INSERT INTO subscription_plans (
  id, name, description,
  monthly_minor, yearly_minor, currency,
  features, limits,
  stripe_price_id_monthly, stripe_price_id_yearly
) VALUES
  ('4e0e6cc1-89b1-4dcb-a627-bfccb14f0af9','Essentials','Core booking and operations for small tour and charter businesses.',
   7900,79900,'USD',
   '["Reservations & manual booking","Departure calendar & availability","Day manifest & print / PDF","Payments — deposits, balances, cash & links","Basic reporting","Email booking confirmations"]',
   '{"Staff users":3,"Locations":1,"Tour products":50,"Storage":"500 MB"}',
   'price_1UEb4jDiMTz5HnMK1Ps9ww2a','price_1UEb4jDiMTz5HnMKjlGJt4Cb'),
  ('f7317df1-086a-4ad9-a9c9-c229a5995dcd','Operations','Full operational capability for tour businesses with crews, vehicles, and waivers.',
   14900,149000,'USD',
   '["Everything in Essentials","Dispatch board & pickup routes","Crew mobile app (iOS & Android)","Digital waivers & guest check-in","Resource & fleet basics","Weather & closure controls"]',
   '{"Staff users":10,"Locations":2,"Tour products":200,"Storage":"2 GB"}',
   'price_1UEb4kDiMTz5HnMKocYskjmW','price_1UEb4kDiMTz5HnMKFqtRyUT2'),
  ('3e595412-81e5-4c76-8216-25321d7ba56a','Growth','Multi-channel and partner capability for growing tour operators.',
   24900,249000,'USD',
   '["Everything in Operations","Partner & reseller attribution","Channel integrations (WP, OTA import)","Customer notifications (SMTP)","Partner statements & invoicing","Advanced reporting"]',
   '{"Staff users":25,"Locations":5,"Tour products":"1,000","Storage":"10 GB"}',
   'price_1UEb4lDiMTz5HnMKNQwkWlE4','price_1UEb4mDiMTz5HnMK2kqlaL9d'),
  ('70a106d7-1977-48a4-aa6d-d816470e477f','Enterprise','Customisable platform and priority support for larger operators.',
   59900,599000,'USD',
   '["Everything in Growth","Unlimited staff & locations","Priority support & SLA","Custom branding & white-label","API access","Dedicated onboarding"]',
   '{"Staff users":"Unlimited","Locations":"Unlimited","Tour products":"Unlimited","Storage":"50 GB"}',
   'price_1UEb4mDiMTz5HnMKsNPrcBqp','price_1UEb4nDiMTz5HnMKBHoSNz2o')
ON CONFLICT (id) DO UPDATE SET
  name                    = EXCLUDED.name,
  description             = EXCLUDED.description,
  monthly_minor           = EXCLUDED.monthly_minor,
  yearly_minor            = EXCLUDED.yearly_minor,
  features                = EXCLUDED.features,
  limits                  = EXCLUDED.limits,
  stripe_price_id_monthly = EXCLUDED.stripe_price_id_monthly,
  stripe_price_id_yearly  = EXCLUDED.stripe_price_id_yearly;

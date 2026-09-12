/**
 * Zettaz Tours & Charters — Stripe subscription plan setup
 *
 * Run from the project root after installing stripe:
 *   npm install stripe --workspace=apps/api
 *   STRIPE_SECRET_KEY=sk_live_... npx ts-node --project apps/api/tsconfig.json apps/api/scripts/setup-stripe-plans.ts
 *
 * Safe to re-run: products/prices are looked up by lookup_key / metadata before creating new ones.
 * After running, copy the printed SQL into 057_tours_charters_subscription_plans.sql.
 */

// @ts-ignore — stripe added via npm install stripe
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY env var is required");
const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" });

const PLANS = [
  {
    id: "4e0e6cc1-89b1-4dcb-a627-bfccb14f0af9",
    tier: "essentials",
    name: "Essentials",
    description: "Core booking and operations for small tour and charter businesses.",
    monthly_minor: 7900,
    yearly_minor: 79900,
    features: [
      "Reservations & manual booking",
      "Departure calendar & availability",
      "Day manifest & print / PDF",
      "Payments — deposits, balances, cash & links",
      "Basic reporting",
      "Email booking confirmations",
    ],
    limits: { "Staff users": 3, Locations: 1, "Tour products": 50, Storage: "500 MB" },
  },
  {
    id: "f7317df1-086a-4ad9-a9c9-c229a5995dcd",
    tier: "operations",
    name: "Operations",
    description: "Full operational capability for tour businesses with crews, vehicles, and waivers.",
    monthly_minor: 14900,
    yearly_minor: 149000,
    features: [
      "Everything in Essentials",
      "Dispatch board & pickup routes",
      "Crew mobile app (iOS & Android)",
      "Digital waivers & guest check-in",
      "Resource & fleet basics",
      "Weather & closure controls",
    ],
    limits: { "Staff users": 10, Locations: 2, "Tour products": 200, Storage: "2 GB" },
  },
  {
    id: "3e595412-81e5-4c76-8216-25321d7ba56a",
    tier: "growth",
    name: "Growth",
    description: "Multi-channel and partner capability for growing tour operators.",
    monthly_minor: 24900,
    yearly_minor: 249000,
    features: [
      "Everything in Operations",
      "Partner & reseller attribution",
      "Channel integrations (WP, OTA import)",
      "Customer notifications (SMTP)",
      "Partner statements & invoicing",
      "Advanced reporting",
    ],
    limits: { "Staff users": 25, Locations: 5, "Tour products": "1,000", Storage: "10 GB" },
  },
  {
    id: "70a106d7-1977-48a4-aa6d-d816470e477f",
    tier: "enterprise",
    name: "Enterprise",
    description: "Customisable platform and priority support for larger operators.",
    monthly_minor: 59900,
    yearly_minor: 599000,
    features: [
      "Everything in Growth",
      "Unlimited staff & locations",
      "Priority support & SLA",
      "Custom branding & white-label",
      "API access",
      "Dedicated onboarding",
    ],
    limits: { "Staff users": "Unlimited", Locations: "Unlimited", "Tour products": "Unlimited", Storage: "50 GB" },
  },
];

async function findOrCreateProduct(plan: typeof PLANS[number]): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `metadata["app"]:"tours-charters" AND metadata["tier"]:"${plan.tier}"`,
  });
  if (existing.data.length) {
    console.log(`  ✓ product exists  ${existing.data[0]!.id}  (${plan.name})`);
    return existing.data[0]!;
  }
  const product = await stripe.products.create({
    name: `Zettaz Tours & Charters — ${plan.name}`,
    description: plan.description,
    type: "service",
    metadata: { app: "tours-charters", tier: plan.tier, zettaz_plan_id: plan.id },
    marketing_features: plan.features.map((name) => ({ name })),
    statement_descriptor: `ZTC ${plan.name.toUpperCase().slice(0, 18)}`,
  });
  console.log(`  + created product ${product.id}  (${plan.name})`);
  return product;
}

async function findOrCreatePrice(
  productId: string, planId: string,
  interval: "month" | "year", unitAmount: number,
  nickname: string, lookupKey: string,
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey] });
  if (existing.data.length) {
    console.log(`    ✓ price exists   ${existing.data[0]!.id}  (${nickname})`);
    return existing.data[0]!;
  }
  const price = await stripe.prices.create({
    product: productId, currency: "usd", unit_amount: unitAmount,
    recurring: { interval },
    nickname, lookup_key: lookupKey,
    metadata: { app: "tours-charters", zettaz_plan_id: planId },
    tax_behavior: "exclusive",
  });
  console.log(`    + created price  ${price.id}  (${nickname})`);
  return price;
}

async function main() {
  console.log("\nZettaz Tours & Charters — Stripe plan setup\n");
  const results: Array<{ plan: typeof PLANS[number]; product: Stripe.Product; pm: Stripe.Price; py: Stripe.Price }> = [];

  for (const plan of PLANS) {
    console.log(`\n[${plan.name}]`);
    const product = await findOrCreateProduct(plan);
    const lk = (i: string) => `tc_${plan.tier}_${i}`;
    const pm = await findOrCreatePrice(product.id, plan.id, "month", plan.monthly_minor, `${plan.name} Monthly`, lk("monthly"));
    const py = await findOrCreatePrice(product.id, plan.id, "year",  plan.yearly_minor,  `${plan.name} Yearly`,  lk("yearly"));
    results.push({ plan, product, pm, py });
  }

  console.log("\n\n── Copy this into apps/api/migrations/057_tours_charters_subscription_plans.sql ──\n");
  console.log(`-- Zettaz Tours & Charters subscription plans
-- Generated ${new Date().toISOString().slice(0, 10)} by setup-stripe-plans.ts
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
) VALUES`);

  const rows = results.map(({ plan, pm, py }) =>
    `  ('${plan.id}','${plan.name}','${plan.description.replace(/'/g, "''")}',` +
    `${plan.monthly_minor},${plan.yearly_minor},'USD',` +
    `'${JSON.stringify(plan.features)}','${JSON.stringify(plan.limits)}',` +
    `'${pm.id}','${py.id}')`
  );
  console.log(rows.join(",\n"));
  console.log(`ON CONFLICT (id) DO UPDATE SET
  name                    = EXCLUDED.name,
  description             = EXCLUDED.description,
  monthly_minor           = EXCLUDED.monthly_minor,
  yearly_minor            = EXCLUDED.yearly_minor,
  features                = EXCLUDED.features,
  limits                  = EXCLUDED.limits,
  stripe_price_id_monthly = EXCLUDED.stripe_price_id_monthly,
  stripe_price_id_yearly  = EXCLUDED.stripe_price_id_yearly;`);

  console.log("\n── Done ──\n");
}

main().catch((err) => { console.error(err); process.exit(1); });

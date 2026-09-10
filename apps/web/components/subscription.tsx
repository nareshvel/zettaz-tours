"use client";
import { Check, CreditCard } from "lucide-react";
import { useState } from "react";
import type { Session } from "@/lib/types";
import { Heading, Loading, Notice } from "./common";
import { money, useResource } from "@/lib/client";
type Plan = {
  id: string;
  name: string;
  description: string;
  monthly_minor: number;
  yearly_minor: number | null;
  currency: string;
  features: string[];
  limits: Record<string, string | number>;
};
type Subscription = {
  current:
    | (Plan & {
        plan_id: string;
        status: string;
        billing_cycle: "monthly" | "yearly";
        period_ends_at: string | null;
        trial_ends_at: string | null;
        cancel_at_period_end: boolean;
      })
    | null;
  plans: Plan[];
  billingReady: boolean;
};
export function Subscription({ session }: { session: Session }) {
  const r = useResource<Subscription>("staff/v1/workspace/subscription");
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  if (r.error) return <Notice error>{r.error}</Notice>;
  if (!r.data) return <Loading />;
  const { current, plans } = r.data;
  const priceFor = (plan: Plan) =>
    cycle === "yearly" && plan.yearly_minor !== null
      ? plan.yearly_minor
      : plan.monthly_minor;
  return (
    <>
      <Heading
        title="Subscription"
        description="Your Zettaz Tours & Charters plan and included capabilities."
      />
      <section className="panel subscription-current">
        <CreditCard size={23} />
        <div>
          <p className="eyebrow">CURRENT PLAN</p>
          <h2>{current?.name ?? "No plan selected"}</h2>
          <p>
            {current?.status === "trial" && current.period_ends_at
              ? `Trial ends ${new Date(current.period_ends_at).toLocaleDateString()}`
              : "Subscription status is managed by Zettaz."}
          </p>
        </div>
        <strong>
          {current
            ? money(
                current.billing_cycle === "yearly" &&
                  current.yearly_minor !== null
                  ? current.yearly_minor
                  : current.monthly_minor,
                current.currency,
              ) + ` / ${current.billing_cycle === "yearly" ? "year" : "month"}`
            : ""}
        </strong>
      </section>
      <div className="subscription-plans-heading">
        <h2 className="subscription-title">Plans</h2>
        <div className="billing-cycle" aria-label="Billing interval">
          <button
            className={cycle === "monthly" ? "selected" : ""}
            onClick={() => setCycle("monthly")}
            type="button"
          >
            Monthly
          </button>
          <button
            className={cycle === "yearly" ? "selected" : ""}
            onClick={() => setCycle("yearly")}
            type="button"
          >
            Yearly
          </button>
        </div>
      </div>
      <div className="subscription-plans">
        {plans.map((plan) => (
          <section
            className={
              "panel subscription-plan " +
              (current?.plan_id === plan.id ? "selected" : "")
            }
            key={plan.id}
          >
            <p className="eyebrow">{plan.name}</p>
            <h2>
              {money(priceFor(plan), plan.currency)}{" "}
              <small>/ {cycle === "yearly" ? "year" : "month"}</small>
            </h2>
            <p>{plan.description}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={15} />
                  {feature}
                </li>
              ))}
            </ul>
            <dl className="plan-limits">
              {Object.entries(plan.limits).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <button className="button secondary" disabled>
              {current?.plan_id === plan.id
                ? "Current plan"
                : "Billing setup required"}
            </button>
          </section>
        ))}
      </div>
      <p className="subscription-note">
        Plan changes and payment methods will open the Zettaz billing portal
        after Stripe Billing setup and webhook verification are complete.
      </p>
    </>
  );
}

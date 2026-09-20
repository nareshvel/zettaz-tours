"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { AlertTriangle, Ban, Info } from "lucide-react";
import { api, formatMediumDate } from "@/lib/client";
import { Loading, Notice } from "./common";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanLimits {
  [key: string]: string | number;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  monthly_minor: number;
  yearly_minor: number;
  currency: string;
  features: string[];
  limits: PlanLimits;
  stripe_price_id_monthly: string;
  stripe_price_id_yearly: string;
}

type SubKind =
  | "trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "incomplete"
  | "unpaid";

function subKind(status: string): SubKind {
  if (status === "trial" || status === "trialing") return "trial";
  if (status === "canceled" || status === "cancelled") return "cancelled";
  if (status === "past_due") return "past_due";
  if (status === "incomplete") return "incomplete";
  if (status === "unpaid") return "unpaid";
  return "active";
}

function statusLabel(kind: SubKind): string {
  if (kind === "trial") return "Trial";
  if (kind === "past_due") return "Payment failed";
  if (kind === "cancelled") return "Cancelled";
  if (kind === "incomplete") return "Setup incomplete";
  if (kind === "unpaid") return "Suspended";
  return "Active";
}

interface CurrentSubscription {
  plan_id: string;
  status: string;
  billing_cycle: "monthly" | "yearly";
  period_ends_at: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
}

interface SubscriptionData {
  current: CurrentSubscription | null;
  plans: Plan[];
  billingReady: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(minor: number, currency: string): string {
  return (minor / 100).toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function yearlySavingsPct(plan: Plan): number {
  const annualMonthly = plan.monthly_minor * 12;
  return Math.round(
    ((annualMonthly - plan.yearly_minor) / annualMonthly) * 100,
  );
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil(
    (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
}

function when(iso: string | null): string | null {
  if (!iso) return null;
  return formatMediumDate(iso);
}

// ─── Status banner ────────────────────────────────────────────────────────────

function StatusBanner({
  current,
  canManage,
  onManage,
  portalBusy,
}: {
  current: CurrentSubscription;
  canManage: boolean;
  onManage: () => void;
  portalBusy: boolean;
}) {
  const kind = subKind(current.status);
  const trialDate = when(current.trial_ends_at);
  const periodDate = when(current.period_ends_at);
  const daysLeft = daysUntil(
    kind === "trial" ? current.trial_ends_at : current.period_ends_at,
  );

  let tone: "info" | "warning" | "danger" | null = null;
  let title = "";
  let body = "";

  if (kind === "trial") {
    const endingSoon = daysLeft !== null && daysLeft <= 7;
    tone = endingSoon ? "warning" : "info";
    title =
      daysLeft !== null && daysLeft <= 0
        ? "Trial ends today"
        : endingSoon && daysLeft !== null
          ? `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
          : "You are on a free trial";
    body = trialDate
      ? endingSoon
        ? `The trial lasts until ${trialDate}. Choose a plan below or add a payment method so the workspace keeps running when it ends. You are not charged until then.`
        : `The trial lasts until ${trialDate}. You are not charged until it ends. Emails go to the owner at 7 days and 1 day before.`
      : "You are not charged until the trial ends. Choose a plan before access stops.";
  } else if (kind === "past_due") {
    tone = "danger";
    title = "Invoice payment failed";
    body =
      "The last invoice did not succeed. The workspace stays available for a short grace window (about three days after the failed payment). Update the card in billing. After that the subscription is cancelled and this tenant is treated as suspended.";
  } else if (kind === "unpaid") {
    tone = "danger";
    title = "Workspace suspended";
    body =
      "Invoices stayed unpaid. Staff cannot keep operating this tenant until billing is restored. Open billing or choose a plan below.";
  } else if (kind === "cancelled") {
    const stillOpen = daysLeft !== null && daysLeft > 0;
    tone = stillOpen ? "warning" : "danger";
    title = stillOpen ? "Subscription cancelled" : "Access has ended";
    body = stillOpen
      ? `Access continues until ${periodDate}. After that this tenant is treated as suspended until you choose a plan again.`
      : "This tenant is suspended. Choose a plan below to reactivate.";
  } else if (kind === "incomplete") {
    tone = "warning";
    title = "Checkout did not finish";
    body =
      "The plan is not active yet. Complete payment to start the trial or subscription.";
  } else if (kind === "active" && current.cancel_at_period_end) {
    tone = "warning";
    title = "Will not renew";
    body = periodDate
      ? `This subscription stays active until ${periodDate}, then it ends. Reactivate from billing if you want the next cycle.`
      : "This subscription will not renew. Reactivate from billing to keep the plan.";
  }

  if (!tone || !title) return null;
  const Icon = tone === "danger" ? Ban : tone === "warning" ? AlertTriangle : Info;
  return (
    <div className={`subscription-status-banner ${tone}`} role="status">
      <Icon size={18} aria-hidden />
      <div>
        <strong>{title}. </strong>
        {body}
        {canManage && (kind === "past_due" || kind === "unpaid" || kind === "incomplete" || (kind === "active" && current.cancel_at_period_end)) ? (
          <>
            {" "}
            <button
              type="button"
              className="text-button"
              disabled={portalBusy}
              onClick={onManage}
            >
              {portalBusy ? "Opening billing…" : "Open billing"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Check icon ───────────────────────────────────────────────────────────────

function Check() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
  cycle,
  billingReady,
  hasSub,
  onSelect,
}: {
  plan: Plan;
  isCurrent: boolean;
  cycle: "monthly" | "yearly";
  billingReady: boolean;
  hasSub: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const price =
    cycle === "monthly"
      ? plan.monthly_minor
      : Math.round(plan.yearly_minor / 12);
  const savings = yearlySavingsPct(plan);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        border: isCurrent
          ? "2px solid var(--accent)"
          : "1px solid var(--border)",
        background: "var(--card)",
        boxShadow: isCurrent
          ? "0 0 0 4px color-mix(in srgb, var(--accent) 8%, transparent)"
          : "none",
        overflow: "hidden",
      }}
    >
      {/* Accent bar on current plan */}
      {isCurrent && (
        <div
          style={{
            height: 3,
            background:
              "linear-gradient(90deg,var(--accent),color-mix(in srgb, var(--accent) 60%, white))",
          }}
        />
      )}

      <div
        style={{
          padding: "22px 22px 0",
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Name + badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700 }}>{plan.name}</span>
          {isCurrent && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: "var(--accent)",
                color: "#fff",
                borderRadius: 99,
                padding: "3px 9px",
              }}
            >
              CURRENT
            </span>
          )}
        </div>

        {/* Description */}
        <p
          style={{
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.5,
            margin: "0 0 18px",
            minHeight: 34,
          }}
        >
          {plan.description}
        </p>

        {/* Price */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: "-1px",
                lineHeight: 1,
              }}
            >
              {fmt(price, plan.currency)}
            </span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>/mo</span>
            {cycle === "yearly" && savings > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  background: "#dcfce7",
                  color: "#166534",
                  borderRadius: 99,
                  padding: "2px 7px",
                  marginLeft: 4,
                }}
              >
                SAVE {savings}%
              </span>
            )}
          </div>
          {cycle === "yearly" && (
            <p
              style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0" }}
            >
              {fmt(plan.yearly_minor, plan.currency)} billed annually
            </p>
          )}
        </div>

        {/* Limits */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px 8px",
            padding: "14px 0",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            marginBottom: 18,
          }}
        >
          {Object.entries(plan.limits).map(([key, val]) => (
            <div key={key}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  textTransform: "capitalize",
                  marginBottom: 2,
                }}
              >
                {key}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{String(val)}</div>
            </div>
          ))}
        </div>

        {/* Features */}
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0 0 22px",
            display: "grid",
            gap: 9,
            flex: 1,
          }}
        >
          {plan.features.map((f) => (
            <li
              key={f}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                fontSize: 12,
              }}
            >
              <span style={{ color: "var(--accent)" }}>
                <Check />
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* CTA — pinned to bottom */}
      <div
        style={{
          padding: "16px 22px 22px",
          borderTop: "1px solid var(--border)",
        }}
      >
        {isCurrent ? (
          <button
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "default",
            }}
          >
            ✓ Current plan
          </button>
        ) : billingReady ? (
          <button
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onSelect}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              background: hovered
                ? "color-mix(in srgb, var(--accent) 80%, black)"
                : "var(--accent)",
              color: "#fff",
              transition: "background 0.15s",
            }}
          >
            {hasSub ? "Switch to this plan →" : "Get started →"}
          </button>
        ) : (
          <button
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 8,
              border: "1.5px dashed var(--border)",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "not-allowed",
            }}
          >
            Coming soon
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Upgrade modal ────────────────────────────────────────────────────────────

function UpgradeModal({
  plan,
  cycle,
  isExistingSub,
  onClose,
  onSwitched,
}: {
  plan: Plan;
  cycle: "monthly" | "yearly";
  isExistingSub: boolean;
  onClose: () => void;
  onSwitched: (planName: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price =
    cycle === "monthly"
      ? plan.monthly_minor
      : Math.round(plan.yearly_minor / 12);
  const savings = yearlySavingsPct(plan);

  async function handleAction() {
    setLoading(true);
    setError(null);
    try {
      if (isExistingSub) {
        // Already has Stripe subscription — update in place with proration
        const res = await api<{ status: string; planName: string }>(
          "/staff/v1/workspace/switch-plan",
          {
            method: "POST",
            body: JSON.stringify({ planId: plan.id, cycle }),
          },
        );
        onSwitched(res.planName);
      } else {
        // No active subscription yet — create Stripe Checkout session
        const res = await api<{ url: string }>("/staff/v1/workspace/checkout", {
          method: "POST",
          body: JSON.stringify({
            planId: plan.id,
            cycle,
            successUrl:
              window.location.origin +
              "/profile/subscription?checkout=success",
            cancelUrl: window.location.origin + "/profile/subscription",
          }),
        });
        window.location.href = res.url;
      }
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      setLoading(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
        }}
      />
      {/* Modal card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          zIndex: 1,
          background: "#1a3a42",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
          width: "100%",
          maxWidth: 440,
          padding: "28px 28px 24px",
          color: "#e8f2f3",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "1px",
              textTransform: "uppercase",
              color: "rgba(232,242,243,0.45)",
            }}
          >
            Upgrade Plan
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "rgba(232,242,243,0.5)",
              fontSize: 20,
              lineHeight: 1,
              padding: 0,
              marginTop: -2,
            }}
          >
            ✕
          </button>
        </div>
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: 24,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.5px",
          }}
        >
          {plan.name}
        </h2>
        <p
          style={{
            margin: "0 0 20px",
            fontSize: 13,
            color: "rgba(232,242,243,0.55)",
            lineHeight: 1.5,
          }}
        >
          {plan.description}
        </p>

        {/* Price block */}
        <div
          style={{
            background: "rgba(23,108,99,0.18)",
            border: "1px solid rgba(23,108,99,0.35)",
            borderRadius: 12,
            padding: "16px 18px",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 36,
                fontWeight: 800,
                color: "#ffffff",
                letterSpacing: "-1.5px",
              }}
            >
              {fmt(price, plan.currency)}
            </span>
            <span style={{ fontSize: 13, color: "rgba(232,242,243,0.5)" }}>
              /mo
            </span>
            {cycle === "yearly" && savings > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  background: "#176c63",
                  color: "#fff",
                  borderRadius: 99,
                  padding: "2px 8px",
                }}
              >
                SAVE {savings}%
              </span>
            )}
          </div>
          {cycle === "yearly" && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 11,
                color: "rgba(232,242,243,0.45)",
              }}
            >
              {fmt(plan.yearly_minor, plan.currency)} billed annually
            </p>
          )}
        </div>

        {/* Trial / switch callout */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            background: "rgba(255,255,255,0.05)",
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 22,
          }}
        >
          <span style={{ fontSize: 15, flexShrink: 0 }}>
            {isExistingSub ? "🔄" : "🎉"}
          </span>
          <div
            style={{
              fontSize: 12,
              color: "rgba(232,242,243,0.6)",
              lineHeight: 1.6,
            }}
          >
            {isExistingSub ? (
              <>
                <strong style={{ color: "#e8f2f3" }}>
                  Your plan will switch immediately.
                </strong>{" "}
                Any unused time is prorated — you&apos;ll see a credit or charge
                on your next invoice.
              </>
            ) : (
              <>
                <strong style={{ color: "#e8f2f3" }}>
                  14-day free trial included.
                </strong>{" "}
                You won&apos;t be charged until the trial ends. Cancel anytime
                from your billing portal.
              </>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 14px",
              borderRadius: 9,
              background: "rgba(163,68,56,0.2)",
              border: "1px solid rgba(163,68,56,0.4)",
              color: "#f87171",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleAction}
            disabled={loading}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: 10,
              textAlign: "center",
              background: loading ? "rgba(23,108,99,0.5)" : "#176c63",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: loading ? "none" : "0 4px 14px rgba(23,108,99,0.4)",
              transition: "all 0.15s",
            }}
          >
            {loading
              ? isExistingSub
                ? "Switching plan…"
                : "Redirecting to checkout…"
              : isExistingSub
                ? `Switch to ${plan.name} →`
                : `Start free trial → ${plan.name}`}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: "12px 20px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "transparent",
              color: "rgba(232,242,243,0.6)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Subscription({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState<Plan | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [switchedBanner, setSwitchedBanner] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    return api<SubscriptionData>("/staff/v1/workspace/subscription")
      .then((d: SubscriptionData) => {
        setData(d);
        if (d.current?.billing_cycle) setCycle(d.current.billing_cycle);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Read ?checkout=success from URL after Stripe redirects back
  useEffect(() => {
    if (searchParams.get("checkout") === "success") {
      setSuccessBanner(
        "Checkout finished. The trial has started — you are not charged until it ends.",
      );
      void fetchData();
      router.replace("/profile/subscription");
    }
  }, [searchParams, router]);

  async function openBillingPortal() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const { url } = await api<{ url: string }>(
        "/staff/v1/workspace/billing-portal",
        {
          method: "POST",
          body: JSON.stringify({ returnUrl: window.location.href }),
        },
      );
      window.location.href = url;
    } catch {
      setPortalError(
        "Billing could not be opened. Try again, or email support@zettaz.com.",
      );
    } finally {
      setPortalLoading(false);
    }
  }

  function handleSwitched(planName: string) {
    setUpgradeTarget(null);
    setSwitchedBanner(
      `Switched to ${planName}. Unused time is prorated on the next invoice.`,
    );
    // Refresh subscription data so the current plan bar updates
    setLoading(true);
    fetchData();
  }

  if (loading) {
    return (
      <div className="section-body">
        <Loading />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="section-body">
        <Notice error>Unable to load subscription data.</Notice>
      </div>
    );
  }

  const { current, plans, billingReady } = data;
  const currentPlan = plans.find((p) => p.id === current?.plan_id);

  // An "existing sub" has a live Stripe subscription (not just a free trial that was never paid)
  const isExistingSub = !!current?.stripe_subscription_id;

  const kind = current ? subKind(current.status) : null;
  const statusColor =
    kind === "active" || kind === "trial"
      ? "#1e6e37"
      : kind === "past_due" || kind === "incomplete"
        ? "#c07000"
        : "#c0392b";
  const cycleLabel =
    current?.billing_cycle === "yearly"
      ? "Yearly — billed in full at the start of each year"
      : "Monthly — invoiced each month";
  const trialEndsLabel = when(current?.trial_ends_at ?? null);
  const periodEndsLabel = when(current?.period_ends_at ?? null);
  const canManage = Boolean(
    billingReady && current?.stripe_subscription_id,
  );

  return (
    <div className={embedded ? "subscription-embedded" : "section-body"}>
      {successBanner && (
        <Notice>
          {successBanner}{" "}
          <button type="button" className="text-button" onClick={() => setSuccessBanner(null)}>
            Dismiss
          </button>
        </Notice>
      )}
      {switchedBanner && (
        <Notice>
          {switchedBanner}{" "}
          <button type="button" className="text-button" onClick={() => setSwitchedBanner(null)}>
            Dismiss
          </button>
        </Notice>
      )}
      {portalError && <Notice error>{portalError}</Notice>}

      {current && (
        <StatusBanner
          current={current}
          canManage={canManage}
          onManage={() => void openBillingPortal()}
          portalBusy={portalLoading}
        />
      )}

      <div className="subscription-current">
        <div>
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              marginBottom: 4,
            }}
          >
            Current plan
          </div>
          <div
            style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.3px" }}
          >
            {currentPlan?.name ?? "No active plan"}
          </div>
          {current && kind && (
            <p>
              <span style={{ fontWeight: 700, color: statusColor }}>
                {statusLabel(kind)}
              </span>
              {" · "}
              {cycleLabel}
              {kind === "trial" && trialEndsLabel
                ? ` · trial ends ${trialEndsLabel}`
                : null}
              {kind === "active" &&
              !current.cancel_at_period_end &&
              periodEndsLabel
                ? ` · next invoice ${periodEndsLabel}`
                : null}
              {kind === "active" &&
              current.cancel_at_period_end &&
              periodEndsLabel
                ? ` · ends ${periodEndsLabel}`
                : null}
              {(kind === "cancelled" || kind === "past_due") &&
              periodEndsLabel
                ? ` · access until ${periodEndsLabel}`
                : null}
            </p>
          )}
        </div>
        <div>
          {canManage ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => void openBillingPortal()}
              disabled={portalLoading}
            >
              {portalLoading ? "Opening…" : "Manage billing"}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {billingReady
                ? "No Stripe subscription yet — choose a plan to start billing."
                : "Card billing is not connected for this environment."}
            </span>
          )}
        </div>
      </div>

      <div className="subscription-plans-heading">
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Available plans
          </h3>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>
            {cycle === "yearly"
              ? "Yearly is billed in full up front. Switching later prorates unused time on the next invoice."
              : "Monthly is invoiced each month. Yearly is billed in full at the start of the year."}{" "}
            New checkouts include a 14-day trial with no charge until it ends.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="billing-cycle">
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={cycle === c ? "selected" : undefined}
              onClick={() => setCycle(c)}
            >
              {c === "monthly" ? "Monthly" : "Yearly · save up to 20%"}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="subscription-plan-grid">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrent={plan.id === current?.plan_id}
            cycle={cycle}
            billingReady={billingReady}
            hasSub={!!current}
            onSelect={() => setUpgradeTarget(plan)}
          />
        ))}
      </div>

      <p className="subscription-note">
        Monthly invoices each month. Yearly is billed in full at the start of
        the year. A failed invoice leaves a short grace window (about three
        days); after that the subscription is cancelled and the tenant is
        treated as suspended until a plan is paid again. Prices in USD,
        excluding taxes. Contact{" "}
        <a href="mailto:support@zettaz.com">support@zettaz.com</a> for volume or
        custom pricing.
      </p>
      {upgradeTarget && (
        <UpgradeModal
          plan={upgradeTarget}
          cycle={cycle}
          isExistingSub={isExistingSub}
          onClose={() => setUpgradeTarget(null)}
          onSwitched={handleSwitched}
        />
      )}
    </div>
  );
}

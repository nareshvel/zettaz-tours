"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { api } from "@/lib/client";

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

type SubStatus =
  "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete";

interface CurrentSubscription {
  plan_id: string;
  status: SubStatus;
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

// ─── Status banner ────────────────────────────────────────────────────────────

function StatusBanner({ current }: { current: CurrentSubscription }) {
  const { status, trial_ends_at, period_ends_at } = current;
  let bg = "",
    border = "",
    emoji = "",
    title = "",
    body = "";

  if (status === "trialing" && trial_ends_at) {
    const days = daysUntil(trial_ends_at);
    if (days !== null && days <= 7) {
      bg = "#fffbeb";
      border = "#fbbf24";
      emoji = "⚠️";
      title = `Trial ends ${days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`;
      body = "Subscribe now to keep access without interruption.";
    }
  } else if (status === "past_due") {
    bg = "#fef2f2";
    border = "#f87171";
    emoji = "🔴";
    title = "Payment overdue";
    body = "Update your billing details to avoid service interruption.";
  } else if (status === "canceled" || status === "unpaid") {
    const days = daysUntil(period_ends_at);
    bg = "#fef2f2";
    border = "#f87171";
    emoji = "🚫";
    title =
      status === "canceled"
        ? "Subscription cancelled"
        : "Subscription suspended";
    body =
      days !== null && days > 0
        ? `Access until ${new Date(period_ends_at!).toLocaleDateString()}. Choose a plan to reactivate.`
        : "Access ended. Choose a plan below to reactivate.";
  } else if (status === "incomplete") {
    bg = "#fffbeb";
    border = "#fbbf24";
    emoji = "⚠️";
    title = "Action required";
    body =
      "Subscription setup is incomplete. Finish payment to activate your plan.";
  }

  if (!title) return null;
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 20,
      }}
    >
      <span style={{ fontSize: 16 }}>{emoji}</span>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong>{title}. </strong>
        {body}
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
              window.location.origin + "/subscription?checkout=success",
            cancelUrl: window.location.origin + "/subscription",
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
        "🎉 Subscription activated! Your free trial has started.",
      );
      // Clean up the query param without a full page reload
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      router.replace(url.pathname + url.search);
    }
  }, [searchParams, router]);

  async function openBillingPortal() {
    setPortalLoading(true);
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
      alert("Unable to open billing portal. Please try again.");
    } finally {
      setPortalLoading(false);
    }
  }

  function handleSwitched(planName: string) {
    setUpgradeTarget(null);
    setSwitchedBanner(
      `✅ Switched to ${planName}. Your next invoice will reflect the change.`,
    );
    // Refresh subscription data so the current plan bar updates
    setLoading(true);
    fetchData();
  }

  if (loading) {
    return (
      <div className="section-body" style={{ padding: "40px 24px" }}>
        <div className="spinner" />
      </div>
    );
  }
  if (!data) {
    return (
      <div
        className="section-body"
        style={{ padding: "40px 24px", color: "var(--muted)" }}
      >
        Unable to load subscription data.
      </div>
    );
  }

  const { current, plans, billingReady } = data;
  const currentPlan = plans.find((p) => p.id === current?.plan_id);

  // An "existing sub" has a live Stripe subscription (not just a free trial that was never paid)
  const isExistingSub = !!current?.stripe_subscription_id;

  const statusColor =
    current?.status === "active" || current?.status === "trialing"
      ? "#1e6e37"
      : current?.status === "past_due" || current?.status === "incomplete"
        ? "#c07000"
        : "#c0392b";

  const trialEndsLabel = current?.trial_ends_at
    ? new Date(current.trial_ends_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const periodEndsLabel = (() => {
    if (!current?.period_ends_at) return null;
    const days = daysUntil(current.period_ends_at);
    return (
      new Date(current.period_ends_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) + (days !== null && days >= 0 && days <= 30 ? ` (${days}d)` : "")
    );
  })();

  return (
    <div className={embedded ? "subscription-embedded" : "section-body"}>
      {/* Checkout success banner */}
      {successBanner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 13, color: "#166534", fontWeight: 600 }}>
            {successBanner}
          </span>
          <button
            onClick={() => setSuccessBanner(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#166534",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Plan-switch success banner */}
      {switchedBanner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 13, color: "#166534", fontWeight: 600 }}>
            {switchedBanner}
          </span>
          <button
            onClick={() => setSwitchedBanner(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#166534",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {current && <StatusBanner current={current} />}

      {/* Current plan bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "18px 22px",
          marginBottom: 28,
          flexWrap: "wrap",
        }}
      >
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
          {current?.status && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              Status:{" "}
              <span style={{ fontWeight: 700, color: statusColor }}>
                {current.status === "trialing"
                  ? "Trial"
                  : current.status.replace("_", " ")}
              </span>
              {current.status === "trialing" &&
                trialEndsLabel &&
                ` · trial ends ${trialEndsLabel}`}
              {current.status === "active" &&
                !current.cancel_at_period_end &&
                periodEndsLabel &&
                ` · renews ${periodEndsLabel}`}
              {current.status === "active" &&
                current.cancel_at_period_end &&
                periodEndsLabel && (
                  <span style={{ color: "#c07000" }}>
                    {" "}
                    · cancels {periodEndsLabel}
                  </span>
                )}
              {(current.status === "canceled" ||
                current.status === "past_due") &&
                periodEndsLabel &&
                ` · access until ${periodEndsLabel}`}
            </div>
          )}
          {current?.cancel_at_period_end && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "#c07000",
                fontWeight: 600,
              }}
            >
              ⚠️ Your subscription will not renew. Reactivate from the billing
              portal.
            </div>
          )}
        </div>
        <div>
          {billingReady && current?.stripe_subscription_id ? (
            <button
              className="btn btn-secondary"
              onClick={openBillingPortal}
              disabled={portalLoading}
            >
              {portalLoading ? "Loading…" : "Manage billing"}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Billing setup in progress
            </span>
          )}
        </div>
      </div>

      {/* Plans header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Available plans
          </h3>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>
            All plans include a 14-day free trial.
          </p>
        </div>

        {/* Billing toggle */}
        <div
          style={{
            display: "inline-flex",
            borderRadius: 9,
            border: "1px solid var(--border)",
            background: "var(--card)",
            overflow: "hidden",
          }}
        >
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              style={{
                padding: "7px 20px",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                background: cycle === c ? "var(--accent)" : "transparent",
                color: cycle === c ? "#fff" : "var(--muted)",
                transition: "background 0.15s, color 0.15s",
              }}
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

      <p
        style={{
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 20,
          maxWidth: 700,
        }}
      >
        Annual plans are billed in full at the start of each billing period.
        Prices in USD, excluding taxes. Contact{" "}
        <a
          href="mailto:support@zettaz.com"
          style={{ color: "inherit", textDecoration: "underline" }}
        >
          support@zettaz.com
        </a>{" "}
        for volume or custom pricing.
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

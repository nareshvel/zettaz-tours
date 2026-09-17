"use client";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Globe,
  LockKeyhole,
  Map,
  Rocket,
  Shield,
  Ship,
  UsersRound,
  Zap,
} from "lucide-react";
import type { DemoTenant } from "@/lib/types";
import {
  COUNTRIES,
  TIMEZONES,
  CURRENCIES,
  defaultTimezoneForCountry,
  currencyForCountry,
} from "@/lib/countries";
import { Loading, Notice } from "./common";
import { LegalDocumentModal, type LegalDoc } from "./legal";

export function Entry({
  login,
  activation,
  recovery,
  signup,
  tenants,
  busy,
  error,
  signIn,
}: {
  login: boolean;
  activation: boolean;
  recovery: boolean;
  signup: boolean;
  tenants: DemoTenant[];
  busy: boolean;
  error: string;
  signIn: (
    tenantId: string | undefined,
    email: string,
    password: string,
  ) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activationToken, setActivationToken] = useState("");
  const [activationError, setActivationError] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  // Pre-fill token from email link on mount
  useEffect(() => {
    if (recovery) {
      const urlToken = new URLSearchParams(window.location.search).get("token");
      if (urlToken) setRecoveryToken(urlToken);
    }
  }, [recovery]);
  if (recovery)
    return (
      <main className="login-page">
        <div className="login-brand">
          <img
            src="/brand/zettaz-logo-dark.svg"
            alt="Zettaz Tours and Charters"
          />
        </div>
        <section className="login-card">
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h1>
            {recoveryToken ? "Choose a new password" : "Reset your password"}
          </h1>
          <p className="subtitle">
            {recoveryToken
              ? "Enter and confirm your new password."
              : "Enter your work email. The response is the same whether or not an account exists."}
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setActivationError("");
              const response = await fetch("/api/recovery", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  recoveryToken
                    ? { token: recoveryToken, password }
                    : { email },
                ),
              });
              const result = await response.json();
              if (!response.ok)
                return setActivationError(result.message ?? "Recovery failed.");
              if (recoveryToken) {
                setRecoveryMessage(
                  "Password updated. All previous sessions were signed out.",
                );
                return;
              }
              setRecoveryMessage(
                "If that account is active, recovery instructions are ready.",
              );
              if (result.token) setRecoveryToken(result.token);
            }}
          >
            {!recoveryToken ? (
              <label className="field">
                <span>Work email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>New password</span>
                  <input
                    type="password"
                    minLength={12}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </>
            )}
            <button className="button">
              {recoveryToken ? "Update password" : "Continue"}{" "}
              <ArrowRight size={17} />
            </button>
          </form>
          {recoveryMessage && <Notice>{recoveryMessage}</Notice>}
          {activationError && <Notice error>{activationError}</Notice>}
          <p className="login-note">
            A recovery email will be sent if that address is linked to an active
            account. Check your inbox and spam folder.
          </p>
          <Link className="text-link" href="/login">
            Return to sign in
          </Link>
        </section>
      </main>
    );
  if (activation)
    return (
      <main className="login-page">
        <div className="login-brand">
          <img
            src="/brand/zettaz-logo-dark.svg"
            alt="Zettaz Tours and Charters"
          />
        </div>
        <section className="login-card">
          <p className="eyebrow">ACCOUNT ACTIVATION</p>
          <h1>Activate your account</h1>
          <p className="subtitle">
            Enter the one-time token supplied by your tenant administrator and
            choose a password.
          </p>
          {busy ? (
            <Loading />
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (password !== confirmPassword) return;
                setActivationError("");
                const response = await fetch("/api/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ activationToken, password }),
                });
                const result = await response.json();
                if (response.ok) window.location.href = "/";
                else setActivationError(result.message ?? "Activation failed.");
              }}
            >
              <label className="field">
                <span>Activation token</span>
                <input
                  required
                  value={activationToken}
                  onChange={(event) => setActivationToken(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  minLength={12}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Confirm password</span>
                <input
                  type="password"
                  minLength={12}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
              {confirmPassword && password !== confirmPassword && (
                <Notice error>Passwords do not match.</Notice>
              )}
              {activationError && <Notice error>{activationError}</Notice>}
              <button
                className="button"
                disabled={password !== confirmPassword}
              >
                Activate account <ArrowRight size={17} />
              </button>
            </form>
          )}
          {error && <Notice error>{error}</Notice>}
        </section>
      </main>
    );
  if (!login)
    return (
      <main className="landing">
        {/* Header */}
        <header className="landing-header">
          <img
            src="/brand/zettaz-logo-dark.svg"
            alt="Zettaz Tours and Charters"
          />
          <nav style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link
              href="/login"
              className="button secondary"
              style={{ fontSize: 14 }}
            >
              Sign in
            </Link>
            <Link href="/signup" className="button" style={{ fontSize: 14 }}>
              Start free trial
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <section className="landing-hero">
          <p className="eyebrow">TOUR OPERATOR PLATFORM</p>
          <h1>Run every departure with confidence.</h1>
          <p>
            From first booking to final check-in — reservations, manifest,
            payments, waivers, crew dispatch, and partner billing in one
            operator-grade workspace.
          </p>
          <div className="landing-cta-row">
            <Link
              href="/signup"
              className="button"
              style={{ fontSize: 16, padding: "13px 28px" }}
            >
              Start your free trial <ArrowRight size={18} />
            </Link>
            <Link
              href="/login"
              className="button secondary"
              style={{ fontSize: 16, padding: "13px 28px" }}
            >
              Sign in to your workspace
            </Link>
          </div>
          <p className="landing-trial-note">
            14-day free trial · No credit card required · Cancel any time
          </p>
        </section>

        {/* Social proof bar */}
        <div className="landing-social-proof">
          <div className="landing-social-proof-inner">
            <div className="landing-stat">
              <strong>2,400+</strong>
              <span>Departures managed</span>
            </div>
            <div className="landing-stat">
              <strong>98%</strong>
              <span>On-time manifests</span>
            </div>
            <div className="landing-stat">
              <strong>$0</strong>
              <span>Setup cost</span>
            </div>
            <div className="landing-stat">
              <strong>14 days</strong>
              <span>Free trial</span>
            </div>
          </div>
        </div>

        {/* Feature grid */}
        <section
          style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px 80px" }}
        >
          <p className="landing-features-title">
            Everything you need to run your operation
          </p>
          <div className="landing-features">
            <div className="feature-card">
              <div className="feature-card-icon">
                <CheckCircle2 size={20} />
              </div>
              <strong>Reservations & manifest</strong>
              <span>
                Take bookings, manage holds, print day manifests and departure
                PDFs — all linked automatically.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <Zap size={20} />
              </div>
              <strong>Payments & balance collection</strong>
              <span>
                Deposits, balances, cash, card links and adjustments. Full audit
                trail for every transaction.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <Map size={20} />
              </div>
              <strong>Dispatch & pickup routing</strong>
              <span>
                Assign vehicles, plan pickup routes and send crew the right
                itinerary before every departure.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <Shield size={20} />
              </div>
              <strong>Digital waivers & check-in</strong>
              <span>
                Customisable waiver templates, guest e-sign flow and real-time
                check-in from any device.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <UsersRound size={20} />
              </div>
              <strong>Role-based staff access</strong>
              <span>
                11 built-in roles — from owner to guide — with permission-level
                controls for every action.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <Globe size={20} />
              </div>
              <strong>Partner & reseller billing</strong>
              <span>
                Track agent attribution, record collections, reconcile partner
                statements and export invoices.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <BarChart3 size={20} />
              </div>
              <strong>Reporting & audit log</strong>
              <span>
                Revenue by product, occupancy trends, and a complete
                tamper-evident audit trail for every event.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <LockKeyhole size={20} />
              </div>
              <strong>Tenant-secure architecture</strong>
              <span>
                Every read and write is scoped to your organisation. Your data
                never touches another operator&apos;s.
              </span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon">
                <Clock size={20} />
              </div>
              <strong>Availability & scheduling</strong>
              <span>
                Define availability rules, seasonal blackouts and capacity by
                option — inventory updates in real time.
              </span>
            </div>
          </div>
        </section>

        {/* Plans overview — no prices until billing is ready to promote */}
        <section className="landing-plans">
          <div className="landing-plans-intro">
            <p className="landing-plans-eyebrow">Workspace plans</p>
            <h2>Built for operators at every stage</h2>
            <p>
              Same platform from day one. Capacity and channels scale with your
              team — start free for 14 days, pick a plan when you&apos;re ready.
            </p>
          </div>

          <div className="landing-plans-grid">
            <article className="landing-plan-card">
              <div className="landing-plan-icon" aria-hidden>
                <Ship size={22} />
              </div>
              <h3>Essentials</h3>
              <p className="landing-plan-blurb">
                Core booking and day-of operations for a focused team.
              </p>
              <dl className="landing-plan-limits">
                <div>
                  <dt>Staff</dt>
                  <dd>3</dd>
                </div>
                <div>
                  <dt>Support</dt>
                  <dd>Standard</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>500 MB</dd>
                </div>
              </dl>
              <ul className="landing-plan-features">
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Reservations &amp; availability
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Manifests &amp; payments
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Email confirmations
                </li>
              </ul>
            </article>

            <article className="landing-plan-card featured">
              <p className="landing-plan-badge">Most popular</p>
              <div className="landing-plan-icon" aria-hidden>
                <Rocket size={22} />
              </div>
              <h3>Operations</h3>
              <p className="landing-plan-blurb">
                Full ops for crews, vehicles, waivers, and guest check-in.
              </p>
              <dl className="landing-plan-limits">
                <div>
                  <dt>Staff</dt>
                  <dd>10</dd>
                </div>
                <div>
                  <dt>Support</dt>
                  <dd>Standard</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>2 GB</dd>
                </div>
              </dl>
              <ul className="landing-plan-features">
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Everything in Essentials
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Dispatch &amp; pickup routes
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Crew app &amp; digital waivers
                </li>
              </ul>
            </article>

            <article className="landing-plan-card">
              <div className="landing-plan-icon" aria-hidden>
                <Building2 size={22} />
              </div>
              <h3>Growth</h3>
              <p className="landing-plan-blurb">
                Partners, channels, and reporting as you expand distribution.
              </p>
              <dl className="landing-plan-limits">
                <div>
                  <dt>Staff</dt>
                  <dd>25</dd>
                </div>
                <div>
                  <dt>Support</dt>
                  <dd>Priority</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>10 GB</dd>
                </div>
              </dl>
              <ul className="landing-plan-features">
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Everything in Operations
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Partner attribution &amp; statements
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Channel integrations
                </li>
              </ul>
            </article>

            <article className="landing-plan-card">
              <div className="landing-plan-icon" aria-hidden>
                <Shield size={22} />
              </div>
              <h3>Enterprise</h3>
              <p className="landing-plan-blurb">
                Custom scale, priority support, and white-label options.
              </p>
              <dl className="landing-plan-limits">
                <div>
                  <dt>Staff</dt>
                  <dd>All</dd>
                </div>
                <div>
                  <dt>Support</dt>
                  <dd>SLA</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>50 GB</dd>
                </div>
              </dl>
              <ul className="landing-plan-features">
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Everything in Growth
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  Priority SLA &amp; onboarding
                </li>
                <li>
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                  API &amp; white-label
                </li>
              </ul>
            </article>
          </div>

          <div className="landing-plans-cta">
            <Link href="/signup" className="button">
              Start free trial <ArrowRight size={17} />
            </Link>
            <p>14 days free · No credit card · Cancel anytime</p>
          </div>
        </section>

        {/* Footer */}
        <footer className="landing-footer">
          <div className="landing-footer-inner">
            <img
              src="/brand/zettaz-logo-dark.svg"
              alt="Zettaz"
              style={{ width: 120 }}
            />
            <small>
              © {new Date().getFullYear()} Zettaz Tours &amp; Charters. All
              rights reserved.
            </small>
            <nav className="landing-footer-links">
              <Link href="/login">Sign in</Link>
              <Link href="/signup">Free trial</Link>
            </nav>
          </div>
        </footer>
      </main>
    );
  return (
    <main className="login-page">
      <div className="login-brand">
        <img
          src="/brand/zettaz-logo-dark.svg"
          alt="Zettaz Tours and Charters"
        />
      </div>
      <section className="login-card">
        <p className="eyebrow">WORKSPACE ACCESS</p>
        <h1>Sign in</h1>
        <p className="subtitle">Use the email assigned to your organization.</p>
        {busy ? (
          <Loading />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              signIn(undefined, email, password);
            }}
          >
            <label className="field">
              <span>Work email</span>
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="button">
              Continue <ArrowRight size={17} />
            </button>
            <Link className="text-link" href="/forgot-password">
              Forgot password?
            </Link>
            <Link
              className="text-link"
              href="/signup"
              style={{ marginTop: "8px" }}
            >
              No account yet? Start free trial →
            </Link>
          </form>
        )}
        {error && <Notice error>{error}</Notice>}
        <p className="login-note">
          Local development uses the persistent workspace database. Invitation
          activation is available; MFA and account recovery remain required
          before production use.
        </p>
      </section>
    </main>
  );
}

// Plan definitions shown in the trial selector
const TRIAL_PLANS = [
  {
    id: "4e0e6cc1-89b1-4dcb-a627-bfccb14f0af9",
    name: "Essentials",
    tagline: "Core booking for small operators",
    features: [
      "Reservations & manual booking",
      "Departure calendar & availability",
      "Day manifest & print / PDF",
      "Payments — deposits, balances, cash & links",
      "Email booking confirmations",
    ],
    recommended: false,
  },
  {
    id: "f7317df1-086a-4ad9-a9c9-c229a5995dcd",
    name: "Operations",
    tagline: "Full ops with crew & digital waivers",
    features: [
      "Everything in Essentials",
      "Dispatch board & pickup routes",
      "Crew mobile app (iOS & Android)",
      "Digital waivers & guest check-in",
      "Resource & fleet basics",
      "Weather & closure controls",
    ],
    recommended: false,
  },
  {
    id: "3e595412-81e5-4c76-8216-25321d7ba56a",
    name: "Growth",
    tagline: "Multi-channel & partner capability",
    features: [
      "Everything in Operations",
      "Partner & reseller attribution",
      "Channel integrations (OTA import)",
      "Customer notifications (SMTP)",
      "Partner statements & invoicing",
      "Advanced reporting",
    ],
    recommended: true,
  },
  {
    id: "70a106d7-1977-48a4-aa6d-d816470e477f",
    name: "Enterprise",
    tagline: "Unlimited scale & priority support",
    features: [
      "Everything in Growth",
      "Unlimited staff & locations",
      "Priority support & SLA",
      "Custom branding & white-label",
      "API access",
      "Dedicated onboarding",
    ],
    recommended: false,
  },
];

export function Signup() {
  const [step, setStep] = useState<1 | 2>(1);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("US");
  const [timezone, setTimezone] = useState(() =>
    defaultTimezoneForCountry("US"),
  );
  const [currency, setCurrency] = useState(() => currencyForCountry("US"));
  const [planId, setPlanId] = useState("3e595412-81e5-4c76-8216-25321d7ba56a");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);

  useEffect(() => {
    setTimezone(defaultTimezoneForCountry(country));
    setCurrency(currencyForCountry(country));
  }, [country]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          country,
          timezone,
          currency,
          planId,
          ownerName,
          email,
          phone,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Registration failed. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <main className="login-page">
        <div className="login-brand">
          <img
            src="/brand/zettaz-logo-dark.svg"
            alt="Zettaz Tours and Charters"
          />
        </div>
        <section
          className="login-card"
          style={{ maxWidth: "460px", textAlign: "center" }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "#edfaf8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}
          >
            <CheckCircle2 size={32} color="#176c63" />
          </div>
          <h1 style={{ fontSize: "22px", marginBottom: 8 }}>
            Check your inbox
          </h1>
          <p className="subtitle" style={{ marginBottom: 24 }}>
            We sent a verification link to <strong>{email}</strong>.<br />
            Click it to activate your 14-day free trial.
          </p>
          <div
            style={{
              background: "#f5f8f7",
              border: "1px solid #ddecea",
              borderRadius: 10,
              padding: "16px 20px",
              textAlign: "left",
              fontSize: 13,
              color: "#45676b",
              marginBottom: 24,
            }}
          >
            <strong style={{ color: "#142f36" }}>Can&apos;t find it?</strong>{" "}
            Check your spam folder. The link expires in 24 hours.
          </div>
          <Link href="/login" className="text-link" style={{ fontSize: 14 }}>
            ← Back to sign in
          </Link>
        </section>
      </main>
    );

  return (
    <main className="login-page" style={{ paddingBottom: 48 }}>
      <div className="login-brand">
        <img
          src="/brand/zettaz-logo-dark.svg"
          alt="Zettaz Tours and Charters"
        />
      </div>
      <section
        className="login-card"
        style={{ maxWidth: step === 1 ? "800px" : "560px" }}
      >
        <p className="eyebrow">FREE 14-DAY TRIAL · NO CARD REQUIRED</p>
        <h1>{step === 1 ? "Set up your workspace" : "Create your account"}</h1>
        <p className="subtitle">
          {step === 1
            ? "Tell us about your operation and choose your trial plan."
            : "You’ll use these credentials to sign in."}
        </p>
        <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
          <span
            style={{
              height: "4px",
              flex: 1,
              borderRadius: "2px",
              background: "#176c63",
            }}
          />
          <span
            style={{
              height: "4px",
              flex: 1,
              borderRadius: "2px",
              background: step >= 2 ? "#176c63" : "#dde3e4",
            }}
          />
        </div>
        {busy ? (
          <Loading />
        ) : step === 1 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStep(2);
            }}
          >
            <label className="field">
              <span>Company / operator name</span>
              <input
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Blue Horizon Tours"
              />
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                marginBottom: "4px",
              }}
            >
              <label className="field" style={{ margin: 0 }}>
                <span>Country</span>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>Booking currency</span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Timezone</span>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>

            {/* Plan selector */}
            <div style={{ margin: "20px 0 8px" }}>
              <p
                style={{
                  margin: "0 0 10px",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#142f36",
                  letterSpacing: ".02em",
                }}
              >
                TRIAL PLAN&nbsp;
                <span
                  style={{ fontWeight: 400, color: "#65777b", fontSize: 12 }}
                >
                  — try any plan free for 14 days, upgrade anytime
                </span>
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2,1fr)",
                  gap: 10,
                }}
              >
                {TRIAL_PLANS.map((plan) => {
                  const sel = planId === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setPlanId(plan.id)}
                      style={{
                        position: "relative",
                        textAlign: "left",
                        border: `2px solid ${sel ? "#176c63" : "#dde3e4"}`,
                        borderRadius: 10,
                        padding: "14px 16px",
                        background: sel ? "#edfaf8" : "#fff",
                        cursor: "pointer",
                        transition: "border-color .15s,background .15s",
                      }}
                    >
                      {plan.recommended && (
                        <span
                          style={{
                            position: "absolute",
                            top: -11,
                            right: 12,
                            background: "#176c63",
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 9px",
                            borderRadius: 20,
                            letterSpacing: ".05em",
                            whiteSpace: "nowrap",
                          }}
                        >
                          DEFAULT TRIAL
                        </span>
                      )}
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          color: "#142f36",
                          marginBottom: 3,
                        }}
                      >
                        {plan.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: sel ? "#176c63" : "#65777b",
                          marginBottom: 8,
                          fontStyle: "italic",
                        }}
                      >
                        {plan.tagline}
                      </div>
                      <ul
                        style={{
                          margin: 0,
                          padding: 0,
                          listStyle: "none",
                          fontSize: 11,
                          color: "#45676b",
                          lineHeight: 1.5,
                        }}
                      >
                        {plan.features.map((f) => (
                          <li key={f} style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
                            <span style={{ color: "#176c63", flexShrink: 0, marginTop: 1 }}>✓</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                      {sel && (
                        <CheckCircle2
                          size={15}
                          color="#176c63"
                          style={{ position: "absolute", top: 12, right: 12 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              className="button"
              type="submit"
              style={{ width: "100%", marginTop: 8 }}
            >
              Continue <ArrowRight size={17} />
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="signup-account-form">
            <div className="form-grid signup-account-grid">
              <label className="field">
                <span>Your full name</span>
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Alex Morgan"
                  autoComplete="name"
                />
              </label>
              <label className="field">
                <span>Phone number</span>
                <input
                  type="tel"
                  required
                  minLength={7}
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 268 555 0100"
                  autoComplete="tel"
                />
              </label>
              <label className="field signup-account-email">
                <span>Work email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>
              <label className="field">
                <span>
                  Password <small>(12+ characters)</small>
                </span>
                <input
                  type="password"
                  minLength={12}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span>Confirm password</span>
                <input
                  type="password"
                  minLength={12}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {confirmPassword && password !== confirmPassword && (
              <Notice error>Passwords do not match.</Notice>
            )}
            <label
              className="checkbox"
              style={{ margin: "8px 0 16px", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                required
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I agree to the{" "}
                <button
                  type="button"
                  className="text-link legal-inline-link"
                  onClick={() => setLegalDoc("terms")}
                >
                  Terms of Service
                </button>{" "}
                and{" "}
                <button
                  type="button"
                  className="text-link legal-inline-link"
                  onClick={() => setLegalDoc("privacy")}
                >
                  Privacy Policy
                </button>
                .
              </span>
            </label>
            {error && <Notice error>{error}</Notice>}
            <button
              className="button"
              disabled={
                password !== confirmPassword ||
                !agreed ||
                phone.trim().length < 7
              }
              type="submit"
              style={{ width: "100%" }}
            >
              Create my workspace <ArrowRight size={17} />
            </button>
            <button
              type="button"
              className="text-link"
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: "8px 0 0",
                display: "block",
              }}
              onClick={() => setStep(1)}
            >
              ← Back
            </button>
          </form>
        )}
        <p className="login-note" style={{ marginTop: 16 }}>
          Already have an account?{" "}
          <Link href="/login" className="text-link">
            Sign in →
          </Link>
        </p>
      </section>
      <LegalDocumentModal
        doc={legalDoc}
        open={Boolean(legalDoc)}
        onClose={() => setLegalDoc(null)}
      />
    </main>
  );
}

// ─── VerifyEmail ──────────────────────────────────────────────────────────────

export function VerifyEmail() {
  const [state, setState] = useState<"verifying" | "success" | "error">(
    "verifying",
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      setErrorMsg("Invalid verification link.");
      return;
    }
    fetch(`/api/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(async ({ ok, body }) => {
        if (!ok) {
          setState("error");
          setErrorMsg(body.message ?? "Verification failed.");
          return;
        }
        const sessionRes = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            _rawToken: body.token,
            tenantId: body.tenantId,
          }),
        });
        if (!sessionRes.ok) {
          const sessionBody = await sessionRes.json().catch(() => null);
          setState("error");
          setErrorMsg(
            sessionBody?.message ??
              "Email verified, but sign-in could not be completed. Try signing in.",
          );
          return;
        }
        setState("success");
        setTimeout(() => {
          window.location.href = "/?welcome=1";
        }, 1200);
      })
      .catch(() => {
        setState("error");
        setErrorMsg("Something went wrong. Please try again.");
      });
  }, []);

  return (
    <main className="login-page">
      <div className="login-brand">
        <img
          src="/brand/zettaz-logo-dark.svg"
          alt="Zettaz Tours and Charters"
        />
      </div>
      <section
        className="login-card"
        style={{ maxWidth: 460, textAlign: "center" }}
      >
        {state === "verifying" && (
          <>
            <Loading />
            <p style={{ marginTop: 16, color: "#65777b" }}>
              Verifying your email…
            </p>
          </>
        )}
        {state === "success" && (
          <>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#edfaf8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <CheckCircle2 size={32} color="#176c63" />
            </div>
            <h1 style={{ fontSize: "22px", marginBottom: 8 }}>
              Email verified!
            </h1>
            <p className="subtitle">
              Your workspace is ready. Taking you to the dashboard…
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <h1 style={{ fontSize: "20px", marginBottom: 8 }}>
              Verification failed
            </h1>
            <p className="subtitle" style={{ color: "#c0392b" }}>
              {errorMsg}
            </p>
            <Link
              href="/signup"
              className="button"
              style={{ marginTop: 20, display: "inline-block" }}
            >
              Start a new trial
            </Link>
            <br />
            <Link
              href="/login"
              className="text-link"
              style={{ marginTop: 12, display: "inline-block" }}
            >
              Back to sign in
            </Link>
          </>
        )}
      </section>
    </main>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ArrowUpRight,
  Activity,
  Building2,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Plus,
  UserRound,
} from "lucide-react";
import type { Session } from "@/lib/types";
import {
  COUNTRIES,
  TIMEZONES,
  currencyForCountry,
  defaultTimezoneForCountry,
} from "@/lib/countries";
import { dateTime, errorText, label, useMutation, useResource } from "@/lib/client";
import {
  Back,
  ConfirmDialog,
  Empty,
  Field,
  FormDialog,
  Heading,
  Loading,
  Notice,
  SearchBox,
  Status,
} from "./common";

type PlatformTenant = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  created_at: string;
  is_mock: boolean;
  plan_id: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  period_ends_at: string | null;
};

type TenantRecord = PlatformTenant & {
  billing_cycle: string | null;
  trial_ends_at: string | null;
  stripe_billed: boolean;
  features: string[] | null;
  limits: Record<string, string | number> | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  country: string | null;
  products: number;
  upcoming_departures: number;
  pickup_locations: number;
  waiver_templates: number;
  members: number;
  assets: number;
  has_logo: boolean;
};

type SupportGrant = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  purpose: string;
  permissions: string[];
  status: string;
  requested_at: string;
  decided_at: string | null;
  expires_at: string | null;
  decision_reason: string | null;
};

type Overview = {
  tenants_total: number;
  tenants_trial: number;
  tenants_active: number;
  tenants_past_due: number;
  tenants_cancelled: number;
  support_pending: number;
  inbox_attention: number;
  outbox_pending: number;
};

type HealthRow = {
  kind: string;
  tenant_id: string;
  tenant_name: string;
  source: string;
  status: string;
  occurred_at: string;
};

type ActivityRow = {
  occurred_at: string;
  action: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  actor_name: string;
};

const SUPPORT_CHOICES = [
  { code: "bookings.read", label: "Reservations" },
  { code: "manifest.read", label: "Manifests" },
  { code: "audit.read", label: "Audit" },
  { code: "integration.inbox.read", label: "Integration inbox" },
] as const;

function slugFromName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "tenant"
  );
}

function operatorConfig(currency: string) {
  return {
    supportedLocales: ["en"],
    locale: "en",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12h",
    weekStartsOn: 1,
    numberFormat: "comma_decimal",
    measurementSystem: "metric",
    bookingCurrency: currency,
    collectionCurrency: currency,
    reportingCurrency: currency,
    holdSeconds: 1800,
    minimumPaidPercent: 100,
    taxBasisPoints: 0,
    taxInclusive: false,
    allowUnresolvedPickup: false,
    allowAmendmentBalance: true,
    overbookPolicy: "authorized" as const,
    manualPaymentMethods: ["cash", "card", "online", "bank_transfer"],
    bookingSources: ["phone", "walk_in", "website", "partner_reseller"],
    documentStorage: {
      hotProvider: "filesystem",
      archiveProvider: "none",
      hotRetentionDays: 7,
    },
    documentLibrary: { quotaBytes: 1073741824 },
  };
}

const AUTH_ENTRY = new Set([
  "login",
  "signup",
  "activate",
  "forgot-password",
  "reset-password",
  "verify-email",
]);

function currentIsOverview(area: string) {
  return !area || area === "overview" || AUTH_ENTRY.has(area);
}

function setupFlag(ok: boolean, done: string, missing: string) {
  return { ok, label: ok ? done : missing };
}

export function PlatformConsole({
  session,
  loading,
  error,
  logout,
  onSupportSession,
}: {
  session: Session;
  loading: boolean;
  error: string;
  logout: () => void;
  onSupportSession: (session: Session) => void;
}) {
  const path = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [menu, setMenu] = useState(false);
  const segments = path.split("/").filter(Boolean);
  const area = AUTH_ENTRY.has(segments[0] ?? "")
    ? "overview"
    : (segments[0] ?? "overview");
  const tenantId =
    area === "tenants" && segments[1] && /^[a-f0-9-]{36}$/i.test(segments[1])
      ? segments[1]
      : "";
  const tenants = useResource<{ items: PlatformTenant[] }>(
    "platform/v1/tenants",
  );
  const grants = useResource<{ items: SupportGrant[] }>(
    "platform/v1/support-access",
  );
  const overview = useResource<Overview>(
    currentIsOverview(area) ? "platform/v1/overview" : null,
  );
  const health = useResource<{ items: HealthRow[] }>(
    area === "health" || currentIsOverview(area) ? "platform/v1/health" : null,
  );
  const activity = useResource<{ items: ActivityRow[] }>(
    area === "activity" || currentIsOverview(area)
      ? "platform/v1/activity"
      : null,
  );
  const detail = useResource<TenantRecord>(
    tenantId ? `platform/v1/tenants/${tenantId}` : null,
  );
  const createTenant = useMutation();
  const requestAccess = useMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestTenantId, setRequestTenantId] = useState("");
  const [useError, setUseError] = useState("");
  const [useBusy, setUseBusy] = useState(false);
  const [country, setCountry] = useState("AG");
  const [timezone, setTimezone] = useState(defaultTimezoneForCountry("AG"));
  const [form, setForm] = useState({
    name: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
  });
  const [purpose, setPurpose] = useState("");
  const [perms, setPerms] = useState<string[]>(["bookings.read"]);
  const currency = currencyForCountry(country);
  const tenantOptions = tenants.data?.items ?? [];

  useEffect(() => {
    const first = path.split("/").filter(Boolean)[0] ?? "";
    if (AUTH_ENTRY.has(first)) router.replace("/");
  }, [path, router]);

  useEffect(() => {
    if (area !== "support") return;
    const tenant = searchParams.get("tenant");
    if (!tenant) return;
    if (!tenantOptions.some((item) => item.id === tenant)) return;
    setRequestTenantId(tenant);
    setRequestOpen(true);
    router.replace("/support");
  }, [area, searchParams, tenantOptions, router]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menu]);

  const nav = useMemo(
    () => [
      { href: "/", name: "Overview", icon: LayoutDashboard, key: "overview" },
      { href: "/tenants", name: "Tenants", icon: Building2, key: "tenants" },
      { href: "/support", name: "Support", icon: LifeBuoy, key: "support" },
      { href: "/health", name: "Health", icon: HeartPulse, key: "health" },
      { href: "/activity", name: "Activity", icon: Activity, key: "activity" },
      { href: "/account", name: "Account", icon: UserRound, key: "account" },
    ],
    [],
  );
  const navGroups = [
    { label: "Workspaces", keys: ["overview", "tenants"] },
    { label: "Support", keys: ["support", "health"] },
    { label: "Audit", keys: ["activity"] },
  ];

  async function submitTenant() {
    const created = await createTenant.run<{ tenantId: string }>(
      "platform/v1/tenants",
      {
      slug: `${slugFromName(form.name)}-${Date.now().toString(36)}`,
      name: form.name.trim(),
      timezone,
      ownerName: form.ownerName.trim(),
      ownerEmail: form.ownerEmail.trim(),
      ownerPhone: form.ownerPhone.trim(),
      country,
      config: operatorConfig(currency),
    });
    if (!created) return;
    setCreateOpen(false);
    setForm({ name: "", ownerName: "", ownerEmail: "", ownerPhone: "" });
    tenants.reload();
    overview.reload();
    if (created.tenantId) router.push(`/tenants/${created.tenantId}`);
  }

  async function submitRequest() {
    const created = await requestAccess.run(
      "platform/v1/support-access/requests",
      {
        requestId: crypto.randomUUID(),
        tenantId: requestTenantId,
        purpose: purpose.trim(),
        permissions: perms,
      },
    );
    if (!created) return;
    setRequestOpen(false);
    setPurpose("");
    grants.reload();
    overview.reload();
    router.push("/support");
  }

  async function useGrant(grantId: string) {
    setUseBusy(true);
    setUseError("");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(data));
      onSupportSession(data.session);
    } catch (e) {
      setUseError((e as Error).message);
    } finally {
      setUseBusy(false);
    }
  }

  const current = area === "overview" || !area ? "overview" : area;

  return (
    <div className="app-shell platform-console">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        className={"sidebar " + (menu ? "open" : "")}
        aria-label="Platform navigation"
        id="platform-navigation"
      >
        <Link href="/" className="brand" onClick={() => setMenu(false)}>
          <img
            className="brand-logo sidebar-logo"
            src="/brand/zettaz-logo-light.svg"
            alt="Zettaz Tours and Charters"
          />
        </Link>
        <div className="sidebar-nav-scroll">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              <nav aria-label={group.label}>
                {nav
                  .filter((item) => group.keys.includes(item.key))
                  .map(({ href, name, icon: Icon, key }) => (
                    <Link
                      key={href}
                      href={href}
                      aria-current={current === key ? "page" : undefined}
                      className={current === key ? "active" : ""}
                      onClick={() => setMenu(false)}
                    >
                      <Icon size={18} />
                      {name}
                    </Link>
                  ))}
              </nav>
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="user-row">
            <span className="avatar">
              {session.actorName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{session.actorName}</strong>
              <small>Platform</small>
            </div>
            <Link
              href="/account"
              aria-label="Account"
              title="Account"
              onClick={() => setMenu(false)}
            >
              <UserRound size={18} />
            </Link>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={logout}
            disabled={loading}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      {menu ? (
        <button
          className="menu-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      ) : null}
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              type="button"
              aria-controls="platform-navigation"
              aria-expanded={menu}
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>Platform</span>
            <span>/</span>
            <strong>
              {nav.find((item) => item.key === (tenantId ? "tenants" : current))
                ?.name ?? "Overview"}
            </strong>
          </div>
        </header>
        <main id="main" className="page">
          {error ? <Notice error>{error}</Notice> : null}
          {useError ? <Notice error>{useError}</Notice> : null}
          {current === "overview" ? (
            <OverviewPage
              session={session}
              data={overview.data}
              error={overview.error}
              pending={
                grants.data?.items.filter((g) => g.status === "pending").length
              }
              grants={grants.data?.items ?? []}
              health={health.data?.items ?? []}
              healthLoaded={Boolean(health.data)}
              activity={activity.data?.items ?? []}
              activityLoaded={Boolean(activity.data)}
              onCreate={() => setCreateOpen(true)}
            />
          ) : tenantId ? (
            <TenantDetailPage
              data={detail.data}
              error={detail.error}
              grants={(grants.data?.items ?? []).filter(
                (grant) => grant.tenant_id === tenantId,
              )}
              grantsLoaded={Boolean(grants.data)}
              useBusy={useBusy}
              onUse={(idValue) => void useGrant(idValue)}
              onChanged={() => {
                detail.reload();
                overview.reload();
                tenants.reload();
                activity.reload();
              }}
            />
          ) : current === "tenants" ? (
            <TenantsPage
              items={tenantOptions}
              error={tenants.error}
              loaded={Boolean(tenants.data)}
              onCreate={() => setCreateOpen(true)}
            />
          ) : current === "support" ? (
            <SupportPage
              items={grants.data?.items ?? []}
              error={grants.error}
              loaded={Boolean(grants.data)}
              canRequest={tenantOptions.length > 0}
              useBusy={useBusy}
              onRequest={() => {
                setRequestTenantId(tenantOptions[0]?.id ?? "");
                setRequestOpen(true);
              }}
              onUse={(idValue) => void useGrant(idValue)}
            />
          ) : current === "health" ? (
            <HealthPage
              items={health.data?.items ?? []}
              error={health.error}
              loaded={Boolean(health.data)}
            />
          ) : current === "activity" ? (
            <ActivityPage
              items={activity.data?.items ?? []}
              error={activity.error}
              loaded={Boolean(activity.data)}
            />
          ) : current === "account" ? (
            <AccountPage
              session={session}
              logout={logout}
              loading={loading}
            />
          ) : (
            <Notice error>
              This page is not available. <Link href="/">Return to overview</Link>
            </Notice>
          )}
        </main>
      </div>
      <FormDialog
        open={createOpen}
        title="Provision tenant"
        description="Creates the operator workspace and owner membership. The owner still verifies email and signs in as staff."
        busy={createTenant.busy}
        error={createTenant.error}
        submitLabel="Create tenant"
        onClose={() => setCreateOpen(false)}
        onSubmit={submitTenant}
      >
        <Field label="Company name" required>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            minLength={2}
          />
        </Field>
        <Field label="Country" required>
          <select
            value={country}
            onChange={(e) => {
              const next = e.target.value;
              setCountry(next);
              setTimezone(defaultTimezoneForCountry(next));
            }}
          >
            {COUNTRIES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Timezone" required>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner name" required>
          <input
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
            required
          />
        </Field>
        <Field label="Owner email" required>
          <input
            type="email"
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            required
          />
        </Field>
        <Field label="Owner phone" required>
          <input
            value={form.ownerPhone}
            onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
            required
            minLength={7}
          />
        </Field>
      </FormDialog>
      <FormDialog
        open={requestOpen}
        title="Request support access"
        description="catalog.read is always included so the workspace can render. A tenant owner must approve before you can open it."
        busy={requestAccess.busy}
        error={requestAccess.error}
        submitLabel="Send request"
        onClose={() => setRequestOpen(false)}
        onSubmit={submitRequest}
      >
        <Field label="Tenant" required>
          <select
            value={requestTenantId}
            onChange={(e) => setRequestTenantId(e.target.value)}
            required
          >
            <option value="">Select a tenant</option>
            {tenantOptions.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Purpose" required>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            required
            minLength={8}
            rows={4}
          />
        </Field>
        <fieldset className="field">
          <legend>Read permissions</legend>
          <label>
            <input type="checkbox" checked disabled /> Catalog
          </label>
          {SUPPORT_CHOICES.map((choice) => (
            <label key={choice.code}>
              <input
                type="checkbox"
                checked={perms.includes(choice.code)}
                onChange={(e) =>
                  setPerms((currentPerms) =>
                    e.target.checked
                      ? [...currentPerms, choice.code]
                      : currentPerms.filter((code) => code !== choice.code),
                  )
                }
              />{" "}
              {choice.label}
            </label>
          ))}
        </fieldset>
      </FormDialog>
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function describePlatform(data: Overview, pending: number) {
  const waiting = pending || data.support_pending;
  const exceptions = data.inbox_attention;
  const decisions = waiting + data.tenants_past_due;
  return `${data.tenants_total} operator workspace${data.tenants_total === 1 ? "" : "s"} · ${decisions} needing a decision · ${exceptions} service exception${exceptions === 1 ? "" : "s"}.`;
}

function OverviewPage({
  session,
  data,
  error,
  pending,
  grants,
  health,
  healthLoaded,
  activity,
  activityLoaded,
  onCreate,
}: {
  session: Session;
  data: Overview | null;
  error: string;
  pending?: number;
  grants: SupportGrant[];
  health: HealthRow[];
  healthLoaded: boolean;
  activity: ActivityRow[];
  activityLoaded: boolean;
  onCreate: () => void;
}) {
  const waiting = pending ?? data?.support_pending ?? 0;
  const pendingGrants = grants.filter((grant) => grant.status === "pending");
  const queue: {
    key: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
    href: string;
    action: string;
  }[] = [];
  if (data?.tenants_past_due) {
    queue.push({
      key: "past-due",
      severity: "critical",
      title: `${data.tenants_past_due} subscription${data.tenants_past_due === 1 ? "" : "s"} past due`,
      detail:
        "Open the tenant record, then the operator changes plan on Subscription. Platform billing admin is later.",
      href: "/tenants",
      action: "Open tenants",
    });
  }
  for (const grant of pendingGrants.slice(0, 5)) {
    queue.push({
      key: grant.id,
      severity: "warning",
      title: `${grant.tenant_name} support waiting`,
      detail: grant.purpose,
      href: "/support",
      action: "Open support",
    });
  }
  for (const row of health.slice(0, 5)) {
    queue.push({
      key: `${row.kind}-${row.tenant_id}-${row.occurred_at}`,
      severity: row.kind === "inbox" ? "warning" : "info",
      title: `${row.tenant_name} · ${label(row.kind)}`,
      detail: `${label(row.source)} · ${label(row.status)}`,
      href: `/tenants/${row.tenant_id}`,
      action: "Open tenant",
    });
  }
  return (
    <>
      <Heading
        eyebrow="Platform administrator"
        title={`Good ${greeting()}, ${session.actorName.split(" ")[0]}`}
        description={
          data
            ? describePlatform(data, waiting)
            : "Your permitted view of operator workspaces. Guest records stay behind a support grant."
        }
        action={
          <button type="button" className="button" onClick={onCreate}>
            <Plus size={17} />
            <span className="button-label">New tenant</span>
            <span className="button-label-short">New</span>
          </button>
        }
      />
      {error ? <Notice error>{error}</Notice> : null}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="briefing-today">
            <Link className="briefing-tile" href="/tenants">
              <span>Workspaces</span>
              <strong>{data.tenants_total}</strong>
              <small>
                {data.tenants_trial} trial · {data.tenants_active} paid
              </small>
            </Link>
            <Link
              className={
                "briefing-tile" + (waiting ? " attention" : "")
              }
              href="/support"
            >
              <span>Support waiting</span>
              <strong className={waiting ? "attention" : undefined}>
                {waiting}
              </strong>
              <small>Owner must approve before you can open a workspace</small>
            </Link>
            <Link
              className={
                "briefing-tile" +
                (data.tenants_past_due ? " attention" : "")
              }
              href="/tenants"
            >
              <span>Past due</span>
              <strong
                className={data.tenants_past_due ? "attention" : undefined}
              >
                {data.tenants_past_due}
              </strong>
              <small>
                {data.tenants_cancelled} cancelled · plan changes stay on the
                tenant
              </small>
            </Link>
            <Link
              className={
                "briefing-tile" + (data.inbox_attention ? " attention" : "")
              }
              href="/health"
            >
              <span>Inbox exceptions</span>
              <strong
                className={data.inbox_attention ? "attention" : undefined}
              >
                {data.inbox_attention}
              </strong>
              <small>Quarantined or dead-letter connector events</small>
            </Link>
          </div>
          <section className="panel briefing-queue" aria-label="Needs a decision">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">NOW</p>
                <h2>Needs a decision</h2>
              </div>
              <Link href="/support">
                Support <ArrowUpRight size={15} />
              </Link>
            </div>
            {!healthLoaded && !pendingGrants.length ? (
              <Loading />
            ) : !queue.length ? (
              <div className="briefing-queue-clear">
                <strong>Nothing waiting</strong>
                <p>
                  No pending support, past-due subscriptions, or redacted
                  connector exceptions.
                </p>
              </div>
            ) : (
              <ul>
                {queue.slice(0, 8).map((item) => (
                  <li key={item.key}>
                    <span className={"severity " + item.severity} />
                    <div className="briefing-queue-subject">
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </div>
                    <Link className="button secondary" href={item.href}>
                      {item.action}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="briefing-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">SUBSCRIPTIONS</p>
                  <h2>How workspaces are billed</h2>
                </div>
              </div>
              <div className="briefing-today platform-sub-tiles">
                <div className="briefing-tile">
                  <span>Trial</span>
                  <strong>{data.tenants_trial}</strong>
                  <small>Still in trial</small>
                </div>
                <div className="briefing-tile">
                  <span>Paid</span>
                  <strong>{data.tenants_active}</strong>
                  <small>Active Stripe Billing</small>
                </div>
                <div className="briefing-tile">
                  <span>Past due</span>
                  <strong className={data.tenants_past_due ? "attention" : undefined}>
                    {data.tenants_past_due}
                  </strong>
                  <small>Operator Subscription page</small>
                </div>
                <div className="briefing-tile">
                  <span>Cancelled</span>
                  <strong>{data.tenants_cancelled}</strong>
                  <small>No new entitlements</small>
                </div>
              </div>
              <p className="muted platform-panel-note">
                Zettaz SaaS billing stays on the tenant Subscription page. This
                console does not mix those keys with Zettaz Pay.
              </p>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">AUDIT</p>
                  <h2>Recent activity</h2>
                </div>
                <Link href="/activity">
                  All activity <ArrowUpRight size={15} />
                </Link>
              </div>
              {!activityLoaded ? (
                <Loading />
              ) : !activity.length ? (
                <Empty title="No platform activity yet">
                  Provisioning a tenant or requesting support writes the first
                  rows.
                </Empty>
              ) : (
                <ul className="briefing-queue platform-mini-queue">
                  {activity.slice(0, 6).map((row, index) => (
                    <li key={`${row.tenant_id}-${row.occurred_at}-${index}`}>
                      <span className="severity info" />
                      <div className="briefing-queue-subject">
                        <strong>
                          <Link href={`/tenants/${row.tenant_id}`}>
                            {row.tenant_name}
                          </Link>
                        </strong>
                        <small>
                          {label(row.action)} · {row.actor_name} ·{" "}
                          {dateTime(row.occurred_at, "UTC")}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function TenantsPage({
  items,
  error,
  loaded,
  onCreate,
}: {
  items: PlatformTenant[];
  error: string;
  loaded: boolean;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const filtered = items.filter((tenant) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      tenant.name.toLowerCase().includes(q) ||
      tenant.slug.toLowerCase().includes(q);
    const matchesStatus =
      !status || (tenant.subscription_status || "none") === status;
    return matchesSearch && matchesStatus;
  });
  return (
    <>
      <Heading
        eyebrow="Workspaces"
        title="Tenants"
        description="Provision operator workspaces and see plan status. Support access is requested from Support, not from this list."
        action={
          <button
            type="button"
            className="button"
            onClick={onCreate}
            aria-label="New tenant"
          >
            <Plus size={17} />
            <span className="button-label">New tenant</span>
          </button>
        }
      />
      {error ? <Notice error>{error}</Notice> : null}
      <div className="staff-list-tools fleet-asset-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search name or slug"
        />
        <select
          className="fleet-status-filter"
          aria-label="Filter by subscription"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All plans</option>
          <option value="trial">Trial</option>
          <option value="active">Paid</option>
          <option value="past_due">Past due</option>
          <option value="cancelled">Cancelled</option>
          <option value="none">None</option>
        </select>
      </div>
      <section className="panel" aria-label="Tenants">
        {!loaded ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="No tenants yet">
            Provision the first operator workspace from this console.
          </Empty>
        ) : !filtered.length ? (
          <Empty title="No matching tenants">
            Try a different name, slug, or plan status.
          </Empty>
        ) : (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Workspace</th>
                    <th>Plan</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>
                        <Link
                          className="text-link resource-name-btn"
                          href={`/tenants/${tenant.id}`}
                        >
                          <strong>{tenant.name}</strong>
                          <small>
                            {tenant.slug} · {tenant.timezone}
                            {tenant.is_mock ? " · Sample" : ""}
                          </small>
                        </Link>
                      </td>
                      <td>
                        <Status
                          state={tenant.subscription_status || "none"}
                        />
                        <small>
                          {tenant.plan_name || "No plan"}
                          {tenant.period_ends_at
                            ? ` · ${dateTime(tenant.period_ends_at, tenant.timezone)}`
                            : ""}
                        </small>
                      </td>
                      <td>{dateTime(tenant.created_at, tenant.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {filtered.map((tenant) => (
                <article key={tenant.id} className="resource-card">
                  <div className="resource-card-head">
                    <Link
                      className="text-link resource-name-btn"
                      href={`/tenants/${tenant.id}`}
                    >
                      <strong>{tenant.name}</strong>
                    </Link>
                    <Status state={tenant.subscription_status || "none"} />
                  </div>
                  <small>
                    {tenant.slug} · {tenant.plan_name || "No plan"}
                  </small>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function TenantDetailPage({
  data,
  error,
  grants,
  grantsLoaded,
  useBusy,
  onUse,
  onChanged,
}: {
  data: TenantRecord | null;
  error: string;
  grants: SupportGrant[];
  grantsLoaded: boolean;
  useBusy: boolean;
  onUse: (id: string) => void;
  onChanged: () => void;
}) {
  const adjust = useMutation();
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDays, setExtendDays] = useState("14");
  const [suspendOpen, setSuspendOpen] = useState(false);
  if (error) {
    return (
      <>
        <Back href="/tenants">Tenants</Back>
        <Notice error>{error}</Notice>
      </>
    );
  }
  if (!data) return <Loading />;
  const flags = [
    setupFlag(data.products > 0, "Products ready", "No active products"),
    setupFlag(
      data.upcoming_departures > 0,
      "Upcoming departures",
      "No upcoming departures",
    ),
    setupFlag(
      data.pickup_locations > 0,
      "Pickup locations",
      "No pickup locations",
    ),
    setupFlag(data.waiver_templates > 0, "Waiver published", "No waiver"),
    setupFlag(data.members > 1, "Team started", "Owner only"),
    setupFlag(data.has_logo, "Logo on file", "No logo"),
  ];
  const tenantId = data.id;
  const missing = flags.filter((flag) => !flag.ok).length;
  const features = Array.isArray(data.features) ? data.features : [];
  const limits = data.limits ?? {};
  const localTrial =
    data.subscription_status === "trial" && !data.stripe_billed;
  const canSuspend =
    !data.stripe_billed &&
    data.subscription_status !== "suspended" &&
    data.subscription_status !== "cancelled" &&
    Boolean(data.subscription_status);
  async function runAdjust(
    action: "extend_trial" | "suspend" | "resume",
    days?: number,
    reason?: string,
  ) {
    const result = await adjust.run(
      `platform/v1/tenants/${tenantId}/subscription`,
      {
        action,
        days,
        reason:
          reason?.trim() ||
          (action === "extend_trial"
            ? `Extended trial by ${days} days`
            : action === "suspend"
              ? "Suspended from platform console"
              : "Resumed from platform console"),
      },
    );
    if (!result) return;
    setExtendOpen(false);
    setSuspendOpen(false);
    onChanged();
  }
  return (
    <>
      <Back href="/tenants">Tenants</Back>
      <Heading
        eyebrow={data.is_mock ? "Sample workspace" : "Operator workspace"}
        title={data.name}
        description={`${data.slug} · ${data.timezone}`}
      />
      <div className="briefing-today">
        <div className="briefing-tile">
          <span>Subscription</span>
          <strong>
            <Status state={data.subscription_status || "none"} />
          </strong>
          <small>
            {data.plan_name || "No plan"}
            {data.period_ends_at
              ? ` · through ${dateTime(data.period_ends_at, data.timezone)}`
              : ""}
          </small>
        </div>
        <div className="briefing-tile">
          <span>Owner</span>
          <strong className="platform-tile-text">
            {data.owner_name || "—"}
          </strong>
          <small>
            {[data.owner_email, data.owner_phone].filter(Boolean).join(" · ") ||
              "No contact on file"}
          </small>
        </div>
        <div className="briefing-tile">
          <span>Setup</span>
          <strong className={missing ? "attention" : undefined}>
            {flags.length - missing}/{flags.length}
          </strong>
          <small>{missing ? `${missing} still open` : "Ready to operate"}</small>
        </div>
        <div className="briefing-tile">
          <span>Country</span>
          <strong className="platform-tile-text">{data.country || "—"}</strong>
          <small>{dateTime(data.created_at, data.timezone)}</small>
        </div>
      </div>
      {adjust.error ? <Notice error>{adjust.error}</Notice> : null}
      <section className="panel" aria-label="Subscription">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SUBSCRIPTION</p>
            <h2>{data.plan_name || "No plan"}</h2>
          </div>
          <Status state={data.subscription_status || "none"} />
        </div>
        <dl className="platform-detail-grid" style={{ padding: "16px 24px 0" }}>
          <div>
            <dt>Billing</dt>
            <dd>
              {data.stripe_billed
                ? "Stripe Billing"
                : label(data.billing_cycle || "monthly")}
            </dd>
          </div>
          <div>
            <dt>Trial ends</dt>
            <dd>
              {data.trial_ends_at
                ? dateTime(data.trial_ends_at, data.timezone)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Period ends</dt>
            <dd>
              {data.period_ends_at
                ? dateTime(data.period_ends_at, data.timezone)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Usage</dt>
            <dd>
              {data.members} staff · {data.assets} assets · {data.products}{" "}
              products
            </dd>
          </div>
        </dl>
        <div className="subscription-current-split" style={{ padding: "8px 24px 16px" }}>
          <div>
            <h4>Included</h4>
            {features.length ? (
              <ul className="subscription-current-features">
                {features.map((feature) => (
                  <li key={feature}>
                    <Check size={16} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No feature list on this plan.</p>
            )}
          </div>
          <div>
            <h4>Limits</h4>
            {Object.keys(limits).length ? (
              <dl className="subscription-current-limits">
                {Object.entries(limits).map(([key, val]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(val)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted">No limits recorded.</p>
            )}
          </div>
        </div>
        {data.stripe_billed ? (
          <p className="muted platform-panel-note">
            Paid in Stripe Billing. Extend trial or suspend there so Zettaz Pay
            keys stay unmixed.
          </p>
        ) : (
          <div className="button-row" style={{ padding: "0 24px 20px" }}>
            {localTrial ? (
              <button
                type="button"
                className="button"
                onClick={() => setExtendOpen(true)}
              >
                Extend trial
              </button>
            ) : null}
            {canSuspend ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => setSuspendOpen(true)}
              >
                Suspend
              </button>
            ) : null}
            {data.subscription_status === "suspended" ? (
              <button
                type="button"
                className="button"
                disabled={adjust.busy}
                onClick={() => void runAdjust("resume")}
              >
                Resume trial
              </button>
            ) : null}
          </div>
        )}
      </section>
      <section className="panel overview-setup" aria-label="Setup">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TENANT SETUP</p>
            <h2>Can they run a booking?</h2>
          </div>
          <span className="muted">
            {flags.length - missing} of {flags.length} complete
          </span>
        </div>
        <ul className="overview-setup-list">
          {flags.map((flag) => (
            <li key={flag.label}>
              <span className={"briefing-flag " + (flag.ok ? "ok" : "missing")}>
                {flag.label}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-label="Support grants">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SUPPORT</p>
            <h2>Grants for this tenant</h2>
          </div>
          <Link className="button secondary" href={`/support?tenant=${data.id}`}>
            Request on Support
          </Link>
        </div>
        {!grantsLoaded ? (
          <Loading />
        ) : !grants.length ? (
          <Empty title="No support grants for this tenant">
            Create the request on Support. The owner still has to approve it.
          </Empty>
        ) : (
          <div className="stack-list support-grants resource-table">
            {grants.map((grant) => (
              <GrantRow
                key={grant.id}
                grant={grant}
                useBusy={useBusy}
                onUse={onUse}
              />
            ))}
          </div>
        )}
      </section>
      <FormDialog
        open={extendOpen}
        title="Extend trial"
        description="Adds days to the local trial. Paid Stripe subscriptions stay on the tenant Subscription page."
        busy={adjust.busy}
        error={adjust.error}
        submitLabel="Extend"
        onClose={() => setExtendOpen(false)}
        onSubmit={() => runAdjust("extend_trial", Number(extendDays))}
      >
        <Field label="Extra days" required>
          <select
            value={extendDays}
            onChange={(e) => setExtendDays(e.target.value)}
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </select>
        </Field>
      </FormDialog>
      <ConfirmDialog
        open={suspendOpen}
        title="Suspend this workspace?"
        description="The operator keeps their data. Limits treat them as not on an active plan until you resume."
        confirmLabel="Suspend"
        reasonRequired
        reasonLabel="Why"
        busy={adjust.busy}
        error={adjust.error}
        onClose={() => setSuspendOpen(false)}
        onConfirm={(reason) => runAdjust("suspend", undefined, reason)}
      />
    </>
  );
}

function SupportPage({
  items,
  error,
  loaded,
  canRequest,
  useBusy,
  onRequest,
  onUse,
}: {
  items: SupportGrant[];
  error: string;
  loaded: boolean;
  canRequest: boolean;
  useBusy: boolean;
  onRequest: () => void;
  onUse: (id: string) => void;
}) {
  const [status, setStatus] = useState("");
  const filtered = status
    ? items.filter((grant) => grantDisplayStatus(grant) === status)
    : items;
  return (
    <>
      <Heading
        eyebrow="Support"
        title="Support access"
        description="Ask an owner to approve a time-limited read-only grant. Using it parks this console and opens that workspace until the grant expires."
        action={
          <button
            type="button"
            className="button"
            onClick={onRequest}
            disabled={!canRequest}
          >
            Request access
          </button>
        }
      />
      {error ? <Notice error>{error}</Notice> : null}
      {items.length ? (
        <div className="staff-list-tools fleet-asset-bar">
          <select
            className="fleet-status-filter"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revoked">Revoked</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      ) : null}
      <section className="panel" aria-label="Support grants">
        {!loaded ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="No support requests">
            Request access from a tenant when an operator needs help.
          </Empty>
        ) : !filtered.length ? (
          <Empty title="No grants in this status">
            Clear the filter to see every request.
          </Empty>
        ) : (
          <div className="stack-list support-grants resource-table">
            {filtered.map((grant) => (
              <GrantRow
                key={grant.id}
                grant={grant}
                useBusy={useBusy}
                onUse={onUse}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function grantDisplayStatus(grant: SupportGrant) {
  if (
    grant.status === "approved" &&
    grant.expires_at &&
    new Date(grant.expires_at).getTime() <= Date.now()
  )
    return "expired";
  return grant.status;
}

function GrantRow({
  grant,
  useBusy,
  onUse,
}: {
  grant: SupportGrant;
  useBusy: boolean;
  onUse: (id: string) => void;
}) {
  const display = grantDisplayStatus(grant);
  const canUse = display === "approved";
  return (
    <div className="detail-row">
      <span>
        <strong>
          <Link href={`/tenants/${grant.tenant_id}`}>{grant.tenant_name}</Link>
        </strong>
        <small>{grant.purpose}</small>
        <small>
          {grant.permissions.map(label).join(" · ")}
          {grant.expires_at
            ? ` · Until ${dateTime(grant.expires_at, "UTC")}`
            : ""}
        </small>
        {grant.decision_reason ? <small>{grant.decision_reason}</small> : null}
      </span>
      <span className="support-grant-actions">
        <Status state={display} />
        {canUse ? (
          <button
            type="button"
            className="button"
            disabled={useBusy}
            onClick={() => onUse(grant.id)}
          >
            Open workspace
          </button>
        ) : null}
      </span>
    </div>
  );
}

function AccountPage({
  session,
  logout,
  loading,
}: {
  session: Session;
  logout: () => void;
  loading: boolean;
}) {
  return (
    <div className="account-profile-page">
      <Heading
        eyebrow="Account"
        title={session.actorName}
        description="This principal is a Zettaz staff login. It is not a tenant membership and cannot take bookings."
      />
      <div className="panel form-panel account-profile-panel">
        <div className="settings-card-head">
          <UserRound size={20} />
          <div>
            <h2>Platform identity</h2>
            <p>
              Email is how you sign in. Permissions are fixed for this
              principal until extra platform users ship.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Full name">
            <input value={session.actorName} readOnly />
          </Field>
          <Field label="Email">
            <input type="email" value={session.actorEmail} readOnly />
          </Field>
          <Field label="Role">
            <input value={label(session.role)} readOnly />
          </Field>
          <Field label="Permissions">
            <input
              value={session.permissions.map(label).join(", ")}
              readOnly
            />
          </Field>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            onClick={logout}
            disabled={loading}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthPage({
  items,
  error,
  loaded,
}: {
  items: HealthRow[];
  error: string;
  loaded: boolean;
}) {
  return (
    <>
      <Heading
        eyebrow="Support"
        title="Health"
        description="Connector inbox rows that need a person: quarantined, retry pending, or dead letter. The transactional outbox is a drain queue, not an incident. Payloads and guest identifiers are not shown."
      />
      {error ? <Notice error>{error}</Notice> : null}
      <section className="panel" aria-label="Health">
        {!loaded ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="No connector exceptions">
            Inbound connectors are clear across tenants.
          </Empty>
        ) : (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Connector</th>
                    <th>Status</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, index) => (
                    <tr key={`${row.tenant_id}-${row.occurred_at}-${index}`}>
                      <td>
                        <Link
                          className="text-link"
                          href={`/tenants/${row.tenant_id}`}
                        >
                          <strong>{row.tenant_name}</strong>
                        </Link>
                      </td>
                      <td>{label(row.source)}</td>
                      <td>
                        <Status state={row.status} />
                      </td>
                      <td>{dateTime(row.occurred_at, "UTC")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {items.map((row, index) => (
                <article
                  key={`${row.tenant_id}-${index}`}
                  className="resource-card"
                >
                  <div className="resource-card-head">
                    <Link href={`/tenants/${row.tenant_id}`}>
                      <strong>{row.tenant_name}</strong>
                    </Link>
                    <Status state={row.status} />
                  </div>
                  <small>
                    {label(row.source)} · {dateTime(row.occurred_at, "UTC")}
                  </small>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function ActivityPage({
  items,
  error,
  loaded,
}: {
  items: ActivityRow[];
  error: string;
  loaded: boolean;
}) {
  return (
    <>
      <Heading
        eyebrow="Audit"
        title="Activity"
        description="Tenant provisioning and support-access decisions. Guest booking history is not listed here."
      />
      {error ? <Notice error>{error}</Notice> : null}
      <section className="panel" aria-label="Activity">
        {!loaded ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="No platform activity yet">
            Provisioning a tenant or requesting support writes the first rows.
          </Empty>
        ) : (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, index) => (
                    <tr key={`${row.tenant_id}-${row.occurred_at}-${index}`}>
                      <td>
                        <Link
                          className="text-link"
                          href={`/tenants/${row.tenant_id}`}
                        >
                          <strong>{row.tenant_name}</strong>
                          <small>{row.tenant_slug}</small>
                        </Link>
                      </td>
                      <td>{label(row.action)}</td>
                      <td>{row.actor_name}</td>
                      <td>{dateTime(row.occurred_at, "UTC")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {items.map((row, index) => (
                <article
                  key={`${row.tenant_id}-${index}`}
                  className="resource-card"
                >
                  <div className="resource-card-head">
                    <Link href={`/tenants/${row.tenant_id}`}>
                      <strong>{row.tenant_name}</strong>
                    </Link>
                    <small>{label(row.action)}</small>
                  </div>
                  <small>
                    {row.actor_name} · {dateTime(row.occurred_at, "UTC")}
                  </small>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}


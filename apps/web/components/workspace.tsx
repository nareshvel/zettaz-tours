"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Tickets,
  CalendarDays,
  ClipboardList,
  BookOpen,
  UsersRound,
  SlidersHorizontal,
  ShieldCheck,
  LogOut,
  Menu,
  Bell,
  ArrowRight,
  Building2,
  Settings as SettingsIcon,
  UserRound,
  Check,
  CreditCard,
  Landmark,
  BarChart3,
  Route,
  CheckCircle2,
  FileText,
} from "lucide-react";
import type { DemoTenant, Session } from "@/lib/types";
import {
  currentReachability,
  errorText,
  label,
  setFormatContext,
  setTenantContext,
  subscribeReachability,
  useResource,
} from "@/lib/client";
import { Loading, Notice } from "./common";
import { LegalPage } from "./legal";
import { Entry, Signup, VerifyEmail } from "./auth";
import {
  Overview,
  Reservations,
  Departures,
  ManifestView,
  AuditView,
} from "./views";
import { BookingChangePage } from "./booking-changes";
import {
  OperationsBoard,
  PickupPlanPage,
  PrintablePickupListPage,
  RebookingPage,
} from "./dispatch";
import { AmendReservationPage, NewReservation, BookingDetail } from "./booking";
import {
  AvailabilityDetail,
  Catalog,
  NewProduct,
  NewSchedule,
  ProductDetail,
  Settings,
  Team,
  RolesPermissions,
} from "./administration";
import { Profile } from "./profile";
import { Resources } from "./resources";
import { DocumentLibrary } from "./document-library";
import { Finance, type FinanceSection } from "./finance";
import { Integrations } from "./integrations";
import { Reports } from "./reports";
import { CustomerDetailPage, Customers } from "./customers";
import { CrewWorkspace } from "./crew";

let retainedSession: Session | null = null;
let retainedTenants: DemoTenant[] = [];

function clientRetainedSession() {
  // Module retention is browser-only. Reading it during SSR leaks one request's
  // session into the next and causes hydration mismatches after logout/refresh.
  return typeof window !== "undefined" ? retainedSession : null;
}

function clientRetainedTenants() {
  return typeof window !== "undefined" ? retainedTenants : [];
}

function normalizeBootstrap(value: Session | null): Session | null {
  if (!value) return null;
  return {
    ...value,
    actorName:
      value.actorName ||
      value.tenant.authorized_contact?.name ||
      "Tenant owner",
    actorEmail:
      value.actorEmail ||
      value.tenant.authorized_contact?.email ||
      "No email address on file",
  };
}

const navigation = [
  {
    href: "/crew",
    name: "My trips",
    icon: Route,
    permission: "crew.trip.read",
  },
  {
    href: "/",
    name: "Overview",
    icon: LayoutDashboard,
    permission: "authenticated",
  },
  {
    href: "/operations",
    name: "Day Board",
    icon: ClipboardList,
    permission: "manifest.read",
  },
  {
    href: "/departures",
    name: "Departures",
    icon: CalendarDays,
    permission: "catalog.read",
  },
  {
    href: "/reservations",
    name: "Reservations",
    icon: Tickets,
    permission: "bookings.read",
  },
  {
    href: "/catalog",
    name: "Catalog",
    icon: BookOpen,
    permission: "catalog.read",
  },
  {
    href: "/customers",
    name: "Customers",
    icon: UserRound,
    permission: "bookings.read",
  },
  {
    href: "/reports",
    name: "Reports",
    icon: BarChart3,
    permission: "bookings.read",
  },
  {
    href: "/finance",
    name: "Finance",
    icon: Landmark,
    permission: "partner.collection.verify",
  },
  {
    href: "/resources",
    name: "Fleet",
    icon: UsersRound,
    permission: "resources.write",
  },
  {
    href: "/team",
    name: "Staff & access",
    icon: UsersRound,
    permission: "members.write",
  },
  {
    href: "/settings",
    name: "Tenant settings",
    icon: SlidersHorizontal,
    permission: "config.write",
  },
  {
    href: "/document-library",
    name: "Document library",
    icon: FileText,
    permission: "documents.expiry.manage",
  },
  {
    href: "/audit",
    name: "Audit trail",
    icon: ShieldCheck,
    permission: "audit.read",
  },
];
export function Workspace({
  initialSession = null,
  initialTenants = [],
}: {
  initialSession?: Session | null;
  initialTenants?: DemoTenant[];
} = {}) {
  const [session, setSessionState] = useState<Session | null>(() => {
      const seed =
        clientRetainedSession() ?? normalizeBootstrap(initialSession);
      if (typeof window !== "undefined") retainedSession = seed;
      return seed;
    }),
    [tenants, setTenantsState] = useState<DemoTenant[]>(() => {
      const retained = clientRetainedTenants();
      const seed = retained.length ? retained : initialTenants;
      if (typeof window !== "undefined") retainedTenants = seed;
      return seed;
    }),
    [loading, setLoading] = useState(
      () =>
        !Boolean(clientRetainedSession() ?? normalizeBootstrap(initialSession)),
    ),
    [error, setError] = useState(""),
    [menu, setMenu] = useState(false),
    [accountMenu, setAccountMenu] = useState(false),
    [showWelcome, setShowWelcome] = useState(false),
    [topbarDate, setTopbarDate] = useState("");
  const path = usePathname(),
    router = useRouter(),
    searchParams = useSearchParams();
  const setSession = (value: Session | null) => {
    retainedSession = value;
    setSessionState(value);
  };
  const setTenants = (value: DemoTenant[]) => {
    retainedTenants = value;
    setTenantsState(value);
  };
  const normalizeSession = (value: Session | null): Session | null =>
    normalizeBootstrap(value);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("welcome") === "1")
      setShowWelcome(true);
  }, []);
  useEffect(() => {
    if (!session?.tenant.timezone) {
      setTopbarDate("");
      return;
    }
    setTopbarDate(
      new Intl.DateTimeFormat("en", {
        timeZone: session.tenant.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date()),
    );
  }, [session?.tenant.timezone]);
  const load = async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) setSession(null);
        throw new Error(errorText(data));
      }
      setTenants(data.tenants);
      setSession(normalizeSession(data.session ?? null));
    } catch (e) {
      setError((e as Error).message);
      if (!silent) setSession(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load({
      silent: Boolean(clientRetainedSession() ?? initialSession),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (
      session &&
      path === "/" &&
      session.permissions.includes("crew.trip.read") &&
      !session.permissions.includes("bookings.read")
    )
      router.replace("/crew");
  }, [path, router, session]);
  useEffect(() => {
    if (!menu && !accountMenu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        setAccountMenu(false);
      }
    };
    document.addEventListener("keydown", close);
    const lockPage = menu && window.matchMedia("(max-width: 850px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (lockPage) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      if (lockPage) document.body.style.overflow = previousOverflow;
    };
  }, [accountMenu, menu]);
  async function select(tenantId?: string, email?: string, password?: string) {
    if (session && tenantId === session.tenant.id) return;
    if (
      session &&
      (path.includes("/new") || path === "/settings") &&
      !window.confirm(
        "Switch tenant? Any unsaved form changes will be discarded.",
      )
    )
      return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          email: email ?? session?.actorEmail,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(data));
      setSession(normalizeSession(data.session ?? null));
      if (data.tenants) setTenants(data.tenants);
      router.replace(
        data.session?.permissions?.includes("crew.trip.read") &&
          !data.session?.permissions?.includes("bookings.read")
          ? "/crew"
          : "/",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function logout() {
    setLoading(true);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Sign out failed. Please retry.");
      setSession(null);
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  setTenantContext(
    session ? { id: session.tenant.id, name: session.tenant.name } : null,
  );
  // Set alongside the tenant context and before anything renders, so every
  // money() and date helper in the tree formats the tenant's way without each
  // call site having to pass the config down.
  setFormatContext(session ? session.tenant.config : null);
  if (loading && !session) {
    return (
      <main className="workspace-boot" aria-busy="true">
        <Loading />
      </main>
    );
  }
  // Public marketing / legal / signup pages — accessible without a session
  if (path === "/terms") return <LegalPage doc="terms" />;
  if (path === "/privacy") return <LegalPage doc="privacy" />;
  if (path === "/signup") return <Signup />;
  if (path === "/verify-email") return <VerifyEmail />;

  if (!session)
    return (
      <Entry
        login={path === "/login"}
        activation={path === "/activate"}
        recovery={path === "/forgot-password" || path === "/reset-password"}
        signup={path === "/signup"}
        tenants={tenants}
        busy={loading}
        error={error}
        signIn={select}
      />
    );
  // After sign-in, session is set before router.replace("/") settles. Avoid a
  // one-frame "This page is not available" flash on /login and related routes.
  if (
    path === "/login" ||
    path === "/activate" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path === "/signup" ||
    path === "/terms" ||
    path === "/privacy"
  ) {
    return (
      <main className="workspace-boot" aria-busy="true">
        <Loading />
      </main>
    );
  }
  const can = (permission: string) =>
    permission === "authenticated" || session.permissions.includes(permission);
  const canOpen = (href: string, permission: string) => {
    const alternatives: Record<string, string[]> = {
      "/finance": [
        "payment.write",
        "payment.correct",
        "partner.statement.read",
        "partner.collection.verify",
      ],
      "/resources": ["resources.write"],
    };
    return (alternatives[href] ?? [permission]).some(can);
  };
  const navigationGroups = [
    { label: "WORKSPACE", links: ["/", "/crew"] },
    {
      label: "OPERATIONS",
      links: ["/operations", "/departures", "/reservations", "/catalog"],
    },
    { label: "INSIGHTS", links: ["/reports", "/customers"] },
    {
      label: "ADMINISTRATION",
      links: [
        "/finance",
        "/resources",
        "/team",
        "/settings",
        "/document-library",
        "/audit",
      ],
    },
  ];
  const accountTenants = tenants.filter(
    (tenant, index, list) =>
      tenant.email.toLowerCase() === session.actorEmail.toLowerCase() &&
      list.findIndex(
        (candidate) =>
          candidate.email.toLowerCase() === tenant.email.toLowerCase() &&
          candidate.tenantId === tenant.tenantId,
      ) === index,
  );
  const segments = path.split("/").filter(Boolean),
    area = segments[0] ?? "overview";
  const fromDayBoardManifest =
    area === "departures" &&
    segments[2] === "manifest" &&
    searchParams.get("from") === "operations";
  const operationsLeaf =
    area === "operations" && segments[2] === "pickups"
      ? "Plan pickups"
      : area === "operations" && segments[2] === "pickup-list"
        ? "Pickup list"
        : area === "operations" && segments[2] === "rebook"
          ? "Recovery"
          : null;
  const breadcrumbHref = fromDayBoardManifest
    ? "/operations"
    : operationsLeaf
      ? "/operations"
      : "/" + area;
  const breadcrumbLabel = fromDayBoardManifest
    ? "Day Board"
    : operationsLeaf
      ? "Day Board"
      : (navigation.find((n) => n.href === "/" + area)?.name ?? "Overview");
  const breadcrumbCurrent = operationsLeaf;
  let content: React.ReactNode;
  let permission = "bookings.read";
  if (
    area === "crew" ||
    (area === "overview" && can("crew.trip.read") && !can("bookings.read"))
  ) {
    permission = "crew.trip.read";
    content = <CrewWorkspace session={session} />;
  } else if (area === "overview") {
    permission = "authenticated";
    content = <Overview session={session} />;
  } else if (area === "reservations" && segments[1] === "new") {
    permission = "bookings.write";
    content = <NewReservation session={session} />;
  } else if (
    area === "reservations" &&
    segments[1] &&
    segments[2] === "amend"
  ) {
    permission = "bookings.write";
    content = (
      <AmendReservationPage session={session} bookingId={segments[1]} />
    );
  } else if (
    area === "reservations" &&
    segments[1] &&
    segments[2] === "cancel"
  ) {
    permission = "bookings.write";
    content = (
      <BookingChangePage session={session} bookingId={segments[1]} cancel />
    );
  } else if (area === "reservations" && segments[1])
    content = <BookingDetail session={session} bookingId={segments[1]} />;
  else if (area === "reservations")
    content = <Reservations session={session} />;
  else if (area === "customers" && segments[1])
    content = <CustomerDetailPage session={session} customerId={segments[1]} />;
  else if (area === "customers") content = <Customers session={session} />;
  else if (area === "departures" && segments[2] === "manifest") {
    permission = "manifest.read";
    content = <ManifestView session={session} departureId={segments[1]} />;
  } else if (area === "departures" && segments[1] === "new") {
    permission = "catalog.write";
    content = <NewSchedule session={session} />;
  } else if (area === "departures") {
    permission = "catalog.read";
    content = <Departures session={session} />;
  } else if (area === "operations" && segments[2] === "pickups") {
    permission = "operations.write";
    content = <PickupPlanPage session={session} departureId={segments[1]} />;
  } else if (area === "operations" && segments[2] === "pickup-list") {
    permission = "manifest.read";
    content = (
      <PrintablePickupListPage session={session} departureId={segments[1]} />
    );
  } else if (area === "operations" && segments[2] === "rebook") {
    permission = "operations.write";
    content = <RebookingPage session={session} departureId={segments[1]} />;
  } else if (area === "operations") {
    permission = "manifest.read";
    content = <OperationsBoard session={session} />;
  } else if (
    area === "catalog" &&
    segments[1] === "availability" &&
    segments[2] === "new"
  ) {
    permission = "catalog.write";
    content = <NewSchedule session={session} />;
  } else if (
    area === "catalog" &&
    segments[1] === "availability" &&
    segments[2]
  ) {
    permission = "catalog.read";
    content = <AvailabilityDetail session={session} ruleId={segments[2]} />;
  } else if (area === "catalog" && segments[1] === "new") {
    permission = "catalog.write";
    content = <NewProduct session={session} />;
  } else if (area === "catalog" && segments[1]) {
    permission = "catalog.read";
    content = <ProductDetail session={session} productId={segments[1]} />;
  } else if (area === "catalog") {
    permission = "catalog.read";
    content = <Catalog session={session} />;
  } else if (area === "resources") {
    permission = "resources.write";
    content = <Resources session={session} />;
  } else if (area === "document-library") {
    permission = "documents.expiry.manage";
    content = <DocumentLibrary session={session} />;
  } else if (area === "settings") {
    permission = "config.write";
    content = <Settings session={session} refresh={load} />;
  } else if (area === "profile") {
    permission = "authenticated";
    content = (
      <Profile
        session={session}
        section={segments[1] ?? "profile"}
        onSessionReload={() => load({ silent: true })}
      />
    );
  } else if (area === "subscription") {
    permission = "authenticated";
    content = (
      <Profile
        session={session}
        section="subscription"
        onSessionReload={() => load({ silent: true })}
      />
    );
  } else if (area === "finance") {
    // Finance sub-sections: overview | partners | expenses | reports
    permission =
      [
        "payment.write",
        "payment.correct",
        "partner.statement.read",
        "partner.collection.verify",
      ].find(can) ?? "partner.collection.verify";
    const financeSection = (
      segments[1] === "overview" ||
      segments[1] === "partners" ||
      segments[1] === "expenses" ||
      segments[1] === "reports"
        ? segments[1]
        : "overview"
    ) as FinanceSection;
    // /finance/partners/:id → pass partnerId to Finance
    const financePartnerId =
      segments[1] === "partners" && segments[2] ? segments[2] : undefined;
    content = (
      <Finance
        session={session}
        section={financeSection}
        partnerId={financePartnerId}
      />
    );
  } else if (area === "integrations") {
    permission = "integration.manage";
    content = <Integrations />;
  } else if (area === "reports") {
    permission = "bookings.read";
    content = <Reports session={session} />;
  } else if (area === "team") {
    permission = "members.write";
    content = <Team session={session} />;
  } else if (area === "roles") {
    permission = "members.write";
    content = <RolesPermissions />;
  } else if (area === "audit") {
    permission = "audit.read";
    content = <AuditView session={session} />;
  } else
    content = (
      <Notice error>
        This page is not available. <Link href="/">Return to overview</Link>
      </Notice>
    );
  return (
    <div className="app-shell" onClick={() => setAccountMenu(false)}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        aria-label="Workspace navigation"
        className={"sidebar " + (menu ? "open" : "")}
        id="workspace-navigation"
      >
        <Link href="/" className="brand">
          <img
            className="brand-logo sidebar-logo"
            src="/brand/zettaz-logo-light.svg"
            alt="Zettaz Tours and Charters"
          />
        </Link>
        <div className="sidebar-nav-scroll">
          {navigationGroups.map((group) => {
            const items = navigation.filter(
              (item) =>
                group.links.includes(item.href) &&
                canOpen(item.href, item.permission),
            );
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <p className="nav-label">{group.label}</p>
                <nav aria-label={`${group.label.toLowerCase()} navigation`}>
                  {items.map(({ href, name, icon: Icon }) => (
                    <Link
                      aria-current={
                        (href === "/" ? path === "/" : path.startsWith(href))
                          ? "page"
                          : undefined
                      }
                      key={href}
                      href={href}
                      onClick={() => setMenu(false)}
                      className={
                        (href === "/" ? path === "/" : path.startsWith(href))
                          ? "active"
                          : ""
                      }
                    >
                      <Icon size={19} />
                      {name}
                    </Link>
                  ))}
                </nav>
              </div>
            );
          })}
        </div>
        <div className="sidebar-bottom">
          {accountMenu && (
            <div
              className="account-popover"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="account-summary">
                <span className="avatar">
                  {session.actorName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{session.actorName}</strong>
                  <small>{session.actorEmail}</small>
                  <em>{label(session.role)}</em>
                </div>
              </div>
              {accountTenants.length > 1 && (
                <div className="account-tenants">
                  <p>Switch tenant</p>
                  {accountTenants.map((tenant) => (
                    <button
                      key={tenant.tenantId + ":" + tenant.email}
                      type="button"
                      className={
                        tenant.tenantId === session.tenant.id ? "active" : ""
                      }
                      disabled={loading}
                      onClick={() => {
                        setAccountMenu(false);
                        void select(tenant.tenantId);
                      }}
                    >
                      <Building2 size={16} />
                      <span>{tenant.name}</span>
                      {tenant.tenantId === session.tenant.id && (
                        <Check size={16} />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="account-actions">
                <Link href="/profile" onClick={() => setAccountMenu(false)}>
                  <UserRound size={17} /> My profile
                </Link>
                {session.role === "owner" && (
                  <Link
                    href="/profile/subscription"
                    onClick={() => setAccountMenu(false)}
                  >
                    <CreditCard size={17} /> My subscription
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenu(false);
                    void logout();
                  }}
                >
                  <LogOut size={17} /> Sign out
                </button>
              </div>
            </div>
          )}
          <div
            className="user-row"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="avatar">
              {session.actorName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{session.actorName}</strong>
              <small>{label(session.role)}</small>
            </div>
            <button
              aria-label="Open account menu"
              aria-expanded={accountMenu}
              title="Account and tenant switcher"
              onClick={() => setAccountMenu((open) => !open)}
            >
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="menu-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              aria-controls="workspace-navigation"
              aria-expanded={menu}
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            {segments.length > 1 && area !== "overview" ? (
              <>
                <Link className="breadcrumb-link" href={breadcrumbHref}>
                  {breadcrumbLabel}
                </Link>
                {breadcrumbCurrent ? (
                  <>
                    <span>/</span>
                    <strong>{breadcrumbCurrent}</strong>
                  </>
                ) : null}
              </>
            ) : (
              <strong>
                {navigation.find((n) => n.href === "/" + area)?.name ??
                  "Overview"}
              </strong>
            )}
          </div>
          <div className="topbar-meta">
            <ConnectionDot />
            <span className="topbar-date" suppressHydrationWarning>
              {topbarDate}
            </span>
            <NotificationBell session={session} />
          </div>
        </header>
        {session.supportAccess && (
          <div className="support-access-banner" role="status">
            <ShieldCheck size={17} />
            <strong>Zettaz support access</strong>
            <span>{session.supportAccess.purpose}</span>
            <span suppressHydrationWarning>
              Expires{" "}
              {new Intl.DateTimeFormat("en", {
                timeZone: session.tenant.timezone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(session.supportAccess.expires_at))}
            </span>
          </div>
        )}
        <main id="main" className="page" key={session.tenant.id + path}>
          {showWelcome && (
            <div className="welcome-banner" role="status">
              <CheckCircle2 size={18} aria-hidden />
              <div className="welcome-banner-copy">
                <strong>Welcome to Zettaz</strong>
                <span>Your workspace is ready.</span>
              </div>
              <div className="welcome-banner-actions">
                <button
                  type="button"
                  className="welcome-banner-dismiss"
                  onClick={() => {
                    setShowWelcome(false);
                    const u = new URL(window.location.href);
                    u.searchParams.delete("welcome");
                    window.history.replaceState({}, "", u.toString());
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {error && <Notice error>{error}</Notice>}
          {loading ? (
            <Loading />
          ) : can(permission) ? (
            content
          ) : (
            <Notice error>You do not have permission to open this page.</Notice>
          )}
        </main>
        <footer className="page-footer">
          <span>Zettaz Tours & Charters</span>
          <span>
            {session.tenant.timezone} · {session.tenant.config.bookingCurrency}
          </span>
        </footer>
      </div>
    </div>
  );
}

/**
 * Live-connection indicator, replacing the "Live operational view" strip that
 * used to sit on the Overview page. That strip restated the tenant name and
 * timezone already shown elsewhere and claimed "live" without ever checking.
 * This is the claim made honestly, in one dot, on every page.
 */
function ConnectionDot() {
  const [state, setState] = useState<"online" | "offline">("online");
  useEffect(() => {
    setState(navigator.onLine ? currentReachability() : "offline");
    const unsubscribe = subscribeReachability(setState);
    const goOffline = () => setState("offline");
    const goOnline = () => setState(currentReachability());
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      unsubscribe();
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);
  const live = state === "online";
  return (
    <span
      className={`status-dot ${live ? "live" : "lost"}`}
      role="status"
      aria-label={live ? "Connected to the workspace" : "Connection lost"}
      title={
        live
          ? "Connected — data is live"
          : "Connection lost — what you see may be out of date"
      }
    />
  );
}

type WorkspaceAlert = {
  kind: string;
  severity: "critical" | "warning" | "info";
  subject: string;
  detail: string;
  href: string;
  action: string;
  /** A date for a document, an instant for a hold, null for a standing item. */
  at: string | null;
};

/**
 * Cross-cutting alerts, in the top bar rather than on the Overview.
 *
 * An expiring compliance document is not what the Overview is for, and it
 * follows the reader onto every page — which is exactly what a bell is. The
 * list is served already filtered by what this role may act on, so a partner
 * manager is never shown the day's takings.
 */
function NotificationBell({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const alerts = useResource<{ items: WorkspaceAlert[]; count: number }>(
    session.permissions.includes("catalog.read")
      ? "staff/v1/workspace/notifications"
      : null,
  );
  const items = alerts.data?.items ?? [];
  const unread = items.filter((item) => item.severity !== "info").length;
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const timer = setTimeout(() => {
      document.addEventListener("click", close);
      document.addEventListener("keydown", close);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className="topbar-bell" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={
          items.length ? `Notifications, ${items.length} open` : "Notifications"
        }
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="topbar-bell-count" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="topbar-bell-panel"
          role="dialog"
          aria-label="Notifications"
        >
          <p className="topbar-bell-head">Notifications</p>
          {!items.length ? (
            <p className="topbar-bell-empty">
              Nothing needs your attention. Expiring documents, lapsing holds
              and balances due today appear here.
            </p>
          ) : (
            <ul>
              {items.slice(0, 8).map((item, index) => (
                <li key={`${item.kind}-${index}`}>
                  <Link href={item.href} onClick={() => setOpen(false)}>
                    <span
                      className={`bell-dot ${item.severity}`}
                      aria-hidden="true"
                    />
                    <span className="bell-body">
                      <strong>{item.subject}</strong>
                      <small>
                        {item.detail}
                        {item.at ? ` · ${alertWhen(item.at, session)}` : ""}
                      </small>
                    </span>
                    <span className="bell-action">{item.action}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}

/** A date-only value stays a date; an instant gets its clock time. */
function alertWhen(value: string, session: Session) {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const at = new Date(isDateOnly ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat(session.tenant.config.locale || "en", {
    day: "numeric",
    month: "short",
    ...(isDateOnly
      ? { timeZone: "UTC" }
      : {
          hour: "numeric",
          minute: "2-digit",
          hour12: session.tenant.config.timeFormat === "12h",
          timeZone: session.tenant.timezone,
        }),
  }).format(at);
}

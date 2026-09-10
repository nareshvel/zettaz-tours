"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  ArrowRight,
  Building2,
  Settings as SettingsIcon,
  UserRound,
  Check,
  CreditCard,
  Landmark,
  BarChart3,
} from "lucide-react";
import type { DemoTenant, Session } from "@/lib/types";
import { errorText, label, setTenantContext } from "@/lib/client";
import { Loading, Notice } from "./common";
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
import { NewReservation, BookingDetail } from "./booking";
import {
  Catalog,
  NewProduct,
  NewSchedule,
  Settings,
  Team,
  RolesPermissions,
} from "./administration";
import { Profile } from "./profile";
import { Subscription } from "./subscription";
import { Entry } from "./auth";
import { Resources } from "./resources";
import { Finance } from "./finance";
import { Integrations } from "./integrations";
import { Reports } from "./reports";
import { CustomerDetailPage, Customers } from "./customers";

let retainedSession: Session | null = null;
let retainedTenants: DemoTenant[] = [];

const navigation = [
  {
    href: "/",
    name: "Overview",
    icon: LayoutDashboard,
    permission: "bookings.read",
  },
  {
    href: "/reservations",
    name: "Reservations",
    icon: Tickets,
    permission: "bookings.read",
  },
  {
    href: "/customers",
    name: "Customers",
    icon: UserRound,
    permission: "bookings.read",
  },
  {
    href: "/departures",
    name: "Departures",
    icon: CalendarDays,
    permission: "catalog.read",
  },
  {
    href: "/operations",
    name: "Operations",
    icon: ClipboardList,
    permission: "manifest.read",
  },
  {
    href: "/catalog",
    name: "Catalog",
    icon: BookOpen,
    permission: "catalog.read",
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
    name: "Team & resources",
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
    href: "/subscription",
    name: "Subscription",
    icon: CreditCard,
    permission: "config.write",
  },
  {
    href: "/audit",
    name: "Audit trail",
    icon: ShieldCheck,
    permission: "audit.read",
  },
];
export function Workspace() {
  const [session, setSessionState] = useState<Session | null>(retainedSession),
    [tenants, setTenantsState] = useState<DemoTenant[]>(retainedTenants),
    [loading, setLoading] = useState(!retainedSession),
    [error, setError] = useState(""),
    [menu, setMenu] = useState(false),
    [accountMenu, setAccountMenu] = useState(false);
  const path = usePathname(),
    router = useRouter();
  const setSession = (value: Session | null) => {
    retainedSession = value;
    setSessionState(value);
  };
  const setTenants = (value: DemoTenant[]) => {
    retainedTenants = value;
    setTenantsState(value);
  };
  const normalizeSession = (value: Session | null): Session | null => {
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
  };
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(data));
      setTenants(data.tenants);
      setSession(normalizeSession(data.session ?? null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
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
    setSession(null);
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
      router.replace("/");
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
  setTenantContext(session?.tenant.id ?? null);
  if (!session)
    return (
      <Entry
        login={path === "/login"}
        activation={path === "/activate"}
        recovery={path === "/forgot-password"||path === "/reset-password"}
        tenants={tenants}
        busy={loading}
        error={error}
        signIn={select}
      />
    );
  const can = (permission: string) => session.permissions.includes(permission);
  const administrationLinks = new Set([
    "/resources",
    "/team",
    "/settings",
    "/subscription",
    "/audit",
    "/finance",
  ]);
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
  let content: React.ReactNode;
  let permission = "bookings.read";
  if (area === "overview") content = <Overview session={session} />;
  else if (area === "reservations" && segments[1] === "new") {
    permission = "bookings.write";
    content = <NewReservation session={session} />;
  } else if (
    area === "reservations" &&
    segments[1] &&
    ["amend", "cancel"].includes(segments[2] ?? "")
  ) {
    permission = "bookings.write";
    content = (
      <BookingChangePage
        session={session}
        bookingId={segments[1]}
        cancel={segments[2] === "cancel"}
      />
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
  } else if (area === "catalog" && segments[1] === "new") {
    permission = "catalog.write";
    content = <NewProduct session={session} />;
  } else if (area === "catalog") {
    permission = "catalog.read";
    content = <Catalog session={session} />;
  } else if (area === "resources") {
    permission = "resources.write";
    content = <Resources />;
  } else if (area === "settings") {
    permission = "config.write";
    content = <Settings session={session} refresh={load} />;
  } else if (area === "profile") {
    permission = "catalog.read";
    content = <Profile session={session} />;
  } else if (area === "subscription") {
    permission = "config.write";
    content = <Subscription session={session} />;
  } else if (area === "finance") {
    permission = "partner.collection.verify";
    content = <Finance session={session} />;
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
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Link href="/" className="brand">
          <img
            className="brand-logo sidebar-logo"
            src="/brand/zettaz-logo-light.svg"
            alt="Zettaz Tours and Charters"
          />
        </Link>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation
            .filter(
              (n) => can(n.permission) && !administrationLinks.has(n.href),
            )
            .map(({ href, name, icon: Icon }) => (
              <Link
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
        <p className="nav-label">ADMINISTRATION</p>
        <nav aria-label="Administration navigation">
          {navigation
            .filter((n) => can(n.permission) && administrationLinks.has(n.href))
            .map(({ href, name, icon: Icon }) => (
              <Link
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
                {can("config.write") && (
                  <Link
                    href="/subscription"
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
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>
              {navigation.find((n) => n.href === "/" + area)?.name ??
                "Overview"}
            </strong>
          </div>
          <span className="topbar-date">
            {new Intl.DateTimeFormat("en", {
              timeZone: session.tenant.timezone,
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            }).format(new Date())}
          </span>
        </header>
        {session.supportAccess && (
          <div className="support-access-banner" role="status">
            <ShieldCheck size={17} />
            <strong>Zettaz support access</strong>
            <span>{session.supportAccess.purpose}</span>
            <span>
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

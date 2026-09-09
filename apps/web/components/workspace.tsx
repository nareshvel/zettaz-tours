"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Compass,
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
} from "./dispatch";
import { NewReservation, BookingDetail } from "./booking";
import {
  Catalog,
  NewProduct,
  NewSchedule,
  Settings,
  Team,
} from "./administration";

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
    href: "/team",
    name: "Team & access",
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
    href: "/audit",
    name: "Audit trail",
    icon: ShieldCheck,
    permission: "audit.read",
  },
];
export function Workspace() {
  const [session, setSession] = useState<Session | null>(null),
    [tenants, setTenants] = useState<DemoTenant[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [menu, setMenu] = useState(false);
  const path = usePathname(),
    router = useRouter();
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(data));
      setTenants(data.tenants);
      setSession(data.session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  async function select(tenantId: string) {
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
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(data));
      setSession(data.session);
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
      <main className="entry">
        <div className="entry-brand">
          <Compass size={30} />
          <span>
            Zettaz<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="entry-content">
          <p className="eyebrow">TOURS & CHARTERS · DEMO</p>
          <h1>
            A clear view of
            <br />
            your operation.
          </h1>
          <p className="subtitle">
            Choose a mock tenant to explore reservations, departures and
            administration.
          </p>
          {loading ? (
            <Loading />
          ) : (
            <div className="tenant-options">
              {tenants.map((t) => (
                <button key={t.tenantId} onClick={() => select(t.tenantId)}>
                  <span className="tenant-monogram">
                    {t.name.replace("Mock ", "").slice(0, 1)}
                  </span>
                  <span>
                    <strong>{t.name}</strong>
                    <small>Open as tenant owner</small>
                  </span>
                  <ArrowRight size={20} />
                </button>
              ))}
            </div>
          )}
          {error && (
            <Notice error>
              {error}{" "}
              <button className="text-button" onClick={load}>
                Retry
              </button>
            </Notice>
          )}
          <p className="entry-note">
            Synthetic data only. No live payments or customer messages.
          </p>
        </div>
        <div className="entry-footer">
          Zettaz Tours & Charters <span>Operator workspace</span>
        </div>
      </main>
    );
  const can = (permission: string) => session.permissions.includes(permission);
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
  } else if (area === "operations") {
    permission = "manifest.read";
    content = <OperationsBoard session={session} />;
  } else if (area === "catalog" && segments[1] === "new") {
    permission = "catalog.write";
    content = <NewProduct session={session} />;
  } else if (area === "catalog") {
    permission = "catalog.read";
    content = <Catalog session={session} />;
  } else if (area === "settings") {
    permission = "config.write";
    content = <Settings session={session} refresh={load} />;
  } else if (area === "team") {
    permission = "members.write";
    content = <Team session={session} />;
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
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Link href="/" className="brand">
          <Compass size={27} />
          <span>
            Zettaz<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="tenant-switch">
          <label htmlFor="tenant">CURRENT TENANT</label>
          <select
            id="tenant"
            value={session.tenant.id}
            onChange={(e) => select(e.target.value)}
            disabled={loading}
          >
            {tenants.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="tenant-caption">Tours & excursions</span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation
            .filter((n) => can(n.permission))
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
          <div className="demo-tag">
            <span />
            Mock environment
          </div>
          <div className="user-row">
            <span className="avatar">{label(session.role).slice(0, 1)}</span>
            <div>
              <strong>Tenant {session.role}</strong>
              <small>Demo session</small>
            </div>
            <button aria-label="Sign out" title="Sign out" onClick={logout}>
              <LogOut size={18} />
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
        <div className="mock-banner">
          <span className="demo-pill">DEMO</span>All records are mock data. Live
          payments are disabled.
        </div>
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

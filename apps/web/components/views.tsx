"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  Printer,
  CalendarDays,
  Activity,
  AlertTriangle,
  ListFilter,
  MapPin,
  QrCode,
  ScanLine,
  ShieldCheck,
  FileText,
  Users,
} from "lucide-react";
import type {
  Session,
  Departure,
  Product,
  Reservation,
  Manifest,
  Audit,
  Page,
} from "@/lib/types";
import {
  dateTime,
  downloadApiFile,
  friendlyDateTime,
  label,
  money,
  useMutation,
  usePaged,
  useResource,
} from "@/lib/client";
import {
  Back,
  Empty,
  Heading,
  Loading,
  More,
  Notice,
  readablePickup,
  SearchBox,
  Status,
  TenantDateInput,
} from "./common";
import { BoardingPaymentModal } from "./boarding-payment";
import { BoardingWaiverModal } from "./boarding-waiver";

export function Overview({ session }: { session: Session }) {
  const can = (permission: string) => session.permissions.includes(permission);
  const canBookings = can("bookings.read");
  const canDepartures = can("catalog.read") || can("manifest.read");
  const canResources = can("resources.write");
  const canFinance = can("payment.correct") || can("partner.collection.verify");
  const summary = useResource<{
    upcoming_departures: number;
    confirmed_bookings: number;
    confirmed_guests: number;
    held_bookings: number;
  }>(canBookings ? "staff/v1/workspace/summary" : null);
  const departures = useResource<Page<Departure>>(
    canDepartures
      ? "staff/v1/workspace/departures?limit=7&view=upcoming"
      : null,
  );
  const reservations = useResource<Page<Reservation>>(
    canBookings ? "staff/v1/workspace/reservations?limit=5" : null,
  );
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  const report = useResource<{
    currency: string;
    commercial: {
      confirmed: number;
      receivedMinor: number;
      guestBalanceMinor: number;
      partnerDueMinor: number;
    };
    operations: {
      weatherHolds: number;
      closed: number;
      unassigned: number;
      unresolvedPickups: number;
    };
  }>(canBookings ? `reports/v1/overview?from=${from}&to=${to}` : null);
  const resources = useResource<{ active: boolean }[]>(
    canResources ? "ops/v1/resources" : null,
  );
  const crew = useResource<{ active: boolean }[]>(
    canResources ? "ops/v1/crew" : null,
  );
  const documents = useResource<{ expires_on: string }[]>(
    canResources ? "ops/v1/compliance-documents" : null,
  );
  const stats = summary.data;
  const today = new Date().toISOString().slice(0, 10);
  const inThirtyDays = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const expired =
    documents.data?.filter((item) => item.expires_on < today).length ?? 0;
  const expiring =
    documents.data?.filter(
      (item) => item.expires_on >= today && item.expires_on <= inThirtyDays,
    ).length ?? 0;
  const roleFocus: Record<string, string> = {
    owner: "Business health, exceptions, and today’s operating picture.",
    admin: "Bookings, departures, team readiness, and items needing action.",
    reservations: "Booking momentum, active holds, and upcoming guest demand.",
    dispatcher: "Departure load, pickup readiness, and operating exceptions.",
    operations_manager: "Capacity, assignments, and departure readiness.",
    finance: "Collections, outstanding balances, and partner obligations.",
    auditor: "Operational facts and records available for review.",
    resource_manager: "Crew, asset, and compliance readiness.",
    partner_manager: "Partner-attributed operations and upcoming bookings.",
  };
  const metrics: {
    title: string;
    value: string | number;
    note: string;
    tone?: string;
  }[] =
    canFinance && report.data
      ? [
          {
            title: "Received this month",
            value: money(
              report.data.commercial.receivedMinor,
              report.data.currency,
            ),
            note: "Settled receipts",
          },
          {
            title: "Guest balances",
            value: money(
              report.data.commercial.guestBalanceMinor,
              report.data.currency,
            ),
            note: "Confirmed bookings",
            tone: report.data.commercial.guestBalanceMinor ? "attention" : "",
          },
          {
            title: "Partner obligations",
            value: money(
              report.data.commercial.partnerDueMinor,
              report.data.currency,
            ),
            note: "Recorded statement lines",
          },
          {
            title: "Confirmed bookings",
            value: report.data.commercial.confirmed,
            note: "Current month",
          },
        ]
      : canResources
        ? [
            {
              title: "Active resources",
              value:
                resources.data?.filter((item) => item.active).length ?? "—",
              note: "Vehicles and vessels",
            },
            {
              title: "Active crew",
              value: crew.data?.filter((item) => item.active).length ?? "—",
              note: "Operational profiles",
            },
            {
              title: "Expired documents",
              value: expired,
              note: "Assignment blocking",
              tone: expired ? "critical" : "",
            },
            {
              title: "Expiring in 30 days",
              value: expiring,
              note: "Review before dispatch",
              tone: expiring ? "attention" : "",
            },
          ]
        : [
            {
              title: "Upcoming departures",
              value: stats?.upcoming_departures ?? "—",
              note: "Scheduled ahead",
            },
            {
              title: "Confirmed bookings",
              value: stats?.confirmed_bookings ?? "—",
              note: "All departure dates",
            },
            {
              title: "Confirmed guests",
              value: stats?.confirmed_guests ?? "—",
              note: "Expected passengers",
            },
            {
              title: "Reservations on hold",
              value: stats?.held_bookings ?? "—",
              note: "Unexpired holds",
              tone: stats?.held_bookings ? "attention" : "",
            },
          ];
  return (
    <>
      <Heading
        eyebrow={`${label(session.role)} WORKSPACE`}
        title={`Welcome, ${session.actorName.split(" ")[0]}`}
        description={
          roleFocus[session.role] ??
          `Your permitted view of ${session.tenant.name}.`
        }
        action={
          session.permissions.includes("bookings.write") && (
            <Link href="/reservations/new" className="button">
              <Plus size={17} />
              New reservation
            </Link>
          )
        }
      />
      {[
        summary.error,
        departures.error,
        reservations.error,
        report.error,
        resources.error,
        crew.error,
        documents.error,
      ]
        .filter(Boolean)
        .map((error) => (
          <Notice error key={error}>
            {error}
          </Notice>
        ))}
      <div className="dashboard-context">
        <Activity size={18} />
        <span>Live operational view</span>
        <strong>{session.tenant.name}</strong>
        <small>{session.tenant.timezone}</small>
      </div>
      <div className="stats-grid dashboard-stats">
        {metrics.map((metric) => (
          <div className={`stat ${metric.tone ?? ""}`} key={metric.title}>
            <span>{metric.title}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </div>
        ))}
      </div>
      {canDepartures && (
        <div className="overview-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">DEPARTURE CALENDAR</p>
                <h2>Capacity outlook</h2>
              </div>
              <Link className="text-link" href="/departures">
                View all <ArrowUpRight size={15} />
              </Link>
            </div>
            {departures.error ? (
              <Notice error>{departures.error}</Notice>
            ) : !departures.data ? (
              <Loading />
            ) : !departures.data.items.length ? (
              <Empty title="No departures yet">
                <Link href="/catalog/availability/new">Create a schedule</Link>
              </Empty>
            ) : (
              <div className="departure-list dashboard-capacity">
                {departures.data.items.map((d) => (
                  <div className="departure-row" key={d.id}>
                    <div className="date-tile">
                      <span>
                        {new Intl.DateTimeFormat("en", {
                          month: "short",
                          timeZone: session.tenant.timezone,
                        }).format(new Date(d.starts_at))}
                      </span>
                      <strong>
                        {new Intl.DateTimeFormat("en", {
                          day: "numeric",
                          timeZone: session.tenant.timezone,
                        }).format(new Date(d.starts_at))}
                      </strong>
                    </div>
                    <div className="departure-info">
                      <h3>{d.product_name}</h3>
                      <p>{dateTime(d.starts_at, session.tenant.timezone)}</p>
                      <div className="capacity-line">
                        <span className="capacity-track">
                          <i
                            style={{
                              width: `${Math.min(100, (d.committed / d.capacity) * 100)}%`,
                            }}
                          />
                        </span>
                        <small>
                          {d.committed}/{d.capacity} seats committed
                        </small>
                      </div>
                    </div>
                    <Link
                      className="icon-link"
                      aria-label={`Open ${d.product_name} manifest`}
                      href={
                        session.permissions.includes("manifest.read")
                          ? `/departures/${d.id}/manifest`
                          : "/departures"
                      }
                    >
                      <ChevronRight size={19} />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel quick-panel dashboard-priorities">
            <p className="eyebrow">PRIORITY CENTRE</p>
            <h2>What needs attention</h2>
            <p>
              Shortcuts and exceptions are filtered to your responsibilities.
            </p>
            {report.data &&
              report.data.operations.weatherHolds +
                report.data.operations.closed +
                report.data.operations.unassigned +
                report.data.operations.unresolvedPickups >
                0 && (
                <div className="priority-alert">
                  <AlertTriangle size={18} />
                  <span>
                    <strong>
                      {report.data.operations.weatherHolds +
                        report.data.operations.closed +
                        report.data.operations.unassigned +
                        report.data.operations.unresolvedPickups}{" "}
                      operating exceptions
                    </strong>
                    <small>
                      Weather, closure, assignment, or pickup review
                    </small>
                  </span>
                </div>
              )}
            {[
              [
                "/reservations",
                "Reservations",
                "Find guests and review booking state.",
                "bookings.read",
              ],
              [
                "/operations",
                "Day Board",
                "Today’s trips, pickups, and board guests.",
                "manifest.read",
              ],
              [
                "/finance",
                "Finance",
                "Review collections and partner obligations.",
                "payment.write",
              ],
              [
                "/resources",
                "Team & resources",
                "Review crew, assets, and compliance.",
                "resources.write",
              ],
              [
                "/settings",
                "Tenant configuration",
                "Manage policies and integrations.",
                "config.write",
              ],
            ]
              .filter(([, , , permission]) => can(permission))
              .slice(0, 4)
              .map(([href, title, note]) => (
                <Link className="quick-link" key={href} href={href}>
                  <div>
                    <strong>{title}</strong>
                    <small>{note}</small>
                  </div>
                  <ArrowUpRight size={18} />
                </Link>
              ))}
            <div className="policy-note">
              <CalendarDays size={19} />
              <span>
                Dates and departure times follow
                <br />
                <strong>{session.tenant.timezone}</strong>
              </span>
            </div>
          </section>
        </div>
      )}
      {canBookings && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Reservation snapshot</h2>
            <Link className="text-link" href="/reservations">
              View all <ArrowUpRight size={15} />
            </Link>
          </div>
          {reservations.error ? (
            <Notice error>{reservations.error}</Notice>
          ) : !reservations.data ? (
            <Loading />
          ) : (
            <ReservationTable
              items={reservations.data.items}
              session={session}
            />
          )}
        </section>
      )}
      {!canBookings && !canDepartures && !canResources && (
        <section className="panel">
          <Empty title="Your workspace is ready">
            <p>
              Your administrator can add module permissions to your role. Your
              profile and account controls are available now.
            </p>
          </Empty>
        </section>
      )}
    </>
  );
}
type ReservationSort =
  | "created_at"
  | "starts_at"
  | "lead_name"
  | "state"
  | "guests"
  | "balance";

function ReservationTable({
  items,
  session,
  sort,
  dir,
  onSort,
}: {
  items: Reservation[];
  session: Session;
  sort?: ReservationSort;
  dir?: "asc" | "desc";
  onSort?: (column: ReservationSort) => void;
}) {
  function header(column: ReservationSort, labelText: string, numeric = false) {
    if (!onSort) return <th className={numeric ? "numeric" : undefined}>{labelText}</th>;
    const active = sort === column;
    return (
      <th className={numeric ? "numeric" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className={"sortable-th" + (active ? " is-active" : "")}
          onClick={() => onSort(column)}
        >
          <span>{labelText}</span>
          {active ? (
            dir === "asc" ? (
              <ArrowUp size={14} aria-hidden="true" />
            ) : (
              <ArrowDown size={14} aria-hidden="true" />
            )
          ) : null}
        </button>
      </th>
    );
  }
  return !items.length ? (
    <Empty title="No reservations found">
      <p>Create a reservation or adjust your search.</p>
    </Empty>
  ) : (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {header("lead_name", "Guest / reference")}
            {header("starts_at", "Tour & departure")}
            {header("created_at", "Booked")}
            {header("guests", "Guests")}
            {header("state", "Status")}
            {header("balance", "Balance due", true)}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>
                <Link className="cell-title" href={"/reservations/" + r.id}>
                  {r.lead_name}
                </Link>
                <small className="mono">
                  {r.id.slice(0, 8).toUpperCase()} · {label(r.source)}
                </small>
              </td>
              <td>
                <strong>{r.product_name}</strong>
                <small>
                  {friendlyDateTime(
                    r.starts_at,
                    session.tenant.timezone,
                    session.tenant.config.locale,
                    session.tenant.config.timeFormat,
                  )}
                </small>
              </td>
              <td>
                <small>
                  {r.created_at
                    ? friendlyDateTime(
                        r.created_at,
                        session.tenant.timezone,
                        session.tenant.config.locale,
                        session.tenant.config.timeFormat,
                      )
                    : "—"}
                </small>
              </td>
              <td>{Object.values(r.party).reduce((s, v) => s + v, 0)}</td>
              <td>
                <Status state={r.state} />
              </td>
              <td className="numeric">
                {r.state === "cancelled"
                  ? "—"
                  : money(
                      r.total_minor - r.paid_minor,
                      r.currency,
                      session.tenant.config.locale,
                    )}
              </td>
              <td>
                <Link
                  className="icon-link"
                  href={"/reservations/" + r.id}
                  aria-label={`View ${r.lead_name}`}
                >
                  <ChevronRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function tenantDay(timezone: string, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function mondayOf(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = date.getUTCDay();
  return shiftDay(day, weekday === 0 ? -6 : 1 - weekday);
}
function sundayOf(day: string) {
  return shiftDay(mondayOf(day), 6);
}
function monthBounds(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return [start, end];
}
function lastMonthBounds(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number);
  const prevMonth = month === 1 ? 12 : month! - 1;
  const prevYear = month === 1 ? year! - 1 : year!;
  return monthBounds(
    `${prevYear}-${String(prevMonth).padStart(2, "0")}-15`,
  );
}
type DateRangePreset =
  | "today"
  | "week"
  | "month"
  | "last_month"
  | "past"
  | "custom";
function rangeBounds(
  preset: DateRangePreset,
  today: string,
  customFrom: string,
  customTo: string,
): [string, string] {
  if (preset === "today") return [today, today];
  if (preset === "week") return [mondayOf(today), sundayOf(today)];
  if (preset === "month") return monthBounds(today);
  if (preset === "last_month") return lastMonthBounds(today);
  if (preset === "past") return ["", shiftDay(today, -1)];
  return [customFrom || today, customTo || today];
}

export function Reservations({ session }: { session: Session }) {
  const today = tenantDay(session.tenant.timezone);
  const weekStart = mondayOf(today);
  const weekEnd = sundayOf(today);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [range, setRange] = useState<DateRangePreset>("month");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(shiftDay(today, 13));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [from, to] = rangeBounds(range, today, customFrom, customTo);
  const [sort, setSort] = useState<ReservationSort>("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const filters = { state, source, from, to, sort, dir };
  const list = usePaged<Reservation>(
    "staff/v1/workspace/reservations",
    search,
    filters,
    25,
  );
  function toggleSort(column: ReservationSort) {
    if (sort === column) setDir((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSort(column);
      setDir(column === "lead_name" || column === "state" ? "asc" : "desc");
    }
  }
  useEffect(() => {
    if (!filtersOpen) return;
    function onPointer(event: MouseEvent) {
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node)
      ) {
        setFiltersOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);
  const guests = list.items.reduce(
    (sum, item) => sum + Object.values(item.party).reduce((a, b) => a + b, 0),
    0,
  );
  const balances = list.items.reduce(
    (sum, item) =>
      sum +
      (item.state === "cancelled" ? 0 : item.total_minor - item.paid_minor),
    0,
  );
  const currencies = [...new Set(list.items.map((item) => item.currency))];
  const activeFilters =
    (state ? 1 : 0) + (source ? 1 : 0) + (range === "month" ? 0 : 1);
  const rangeLabel =
    range === "today"
      ? "Today"
      : range === "week"
        ? "This week"
        : range === "month"
          ? "This month"
          : range === "last_month"
            ? "Last month"
            : range === "past"
              ? "All past"
              : "Custom range";
  function selectRange(next: DateRangePreset) {
    setRange(next);
    if (next === "custom") {
      setCustomFrom(from || today);
      setCustomTo(to || today);
    }
  }
  const clearFilters = () => {
    setState("");
    setSource("");
    setRange("month");
    setCustomFrom(today);
    setCustomTo(shiftDay(today, 13));
  };
  const resetView = () => {
    setSearch("");
    clearFilters();
    setFiltersOpen(false);
  };
  const canBook = session.permissions.includes("bookings.write");
  return (
    <>
      <Heading
        title="Reservations"
        description="Find and manage bookings — guest details, money, amendments, and status."
      />
      <div
        className="catalog-metrics reservation-insights"
        aria-label="Loaded reservation summary"
      >
        <div>
          <strong>{list.items.length}</strong>
          <span>Reservations loaded</span>
        </div>
        <div>
          <strong>{guests}</strong>
          <span>Guests in view</span>
        </div>
        <div>
          <strong>
            {list.items.filter((item) => item.state === "confirmed").length}
          </strong>
          <span>Confirmed</span>
        </div>
        <div>
          <strong>
            {currencies.length === 1
              ? money(balances, currencies[0]!, session.tenant.config.locale)
              : currencies.length
                ? "Multiple"
                : money(
                    0,
                    session.tenant.config.bookingCurrency,
                    session.tenant.config.locale,
                  )}
          </strong>
          <span>
            {currencies.length > 1 ? "Currencies in view" : "Balance in view"}
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="list-action-bar">
          <div className="list-action-search">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search guest or booking reference"
            />
          </div>
          <div className="departure-view-actions">
            <div className="filter-menu" ref={filterRef}>
              <button
                type="button"
                className={
                  "button secondary catalog-add-btn" +
                  (filtersOpen || activeFilters ? " active-filter" : "")
                }
                aria-label="Filter reservations"
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <ListFilter size={17} />
                <span className="button-label">Filter</span>
                {activeFilters > 0 && (
                  <span className="filter-count">{activeFilters}</span>
                )}
              </button>
              {filtersOpen && (
                <div
                  className="filter-popover"
                  role="dialog"
                  aria-label="Reservation filters"
                >
                  <div className="filter-popover-head">
                    <strong>Filters</strong>
                    <span>
                      {rangeLabel}
                      {activeFilters
                        ? ` · ${activeFilters} active`
                        : ""}
                    </span>
                  </div>
                  <label className="compact-control">
                    <span>Status</span>
                    <select
                      value={state}
                      onChange={(event) => setState(event.target.value)}
                    >
                      <option value="">All statuses</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="held">On hold</option>
                      <option value="expired">Expired</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <label className="compact-control">
                    <span>Source</span>
                    <select
                      value={source}
                      onChange={(event) => setSource(event.target.value)}
                    >
                      <option value="">All sources</option>
                      {session.tenant.config.bookingSources
                        .filter(
                          (item) =>
                            item !== "viator" && item !== "get_your_guide",
                        )
                        .map((item) => (
                          <option key={item} value={item}>
                            {item === "partner_reseller"
                              ? "Partner / reseller"
                              : label(item)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="compact-control">
                    <span>Date range</span>
                    <div
                      className="filter-range-options"
                      role="radiogroup"
                      aria-label="Date range"
                    >
                      {(
                        [
                          ["today", "Today"],
                          ["week", "This week"],
                          ["month", "This month"],
                          ["last_month", "Last month"],
                          ["past", "All past"],
                          ["custom", "Custom range"],
                        ] as const
                      ).map(([value, caption]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={range === value}
                          className={
                            "filter-range-option" +
                            (range === value ? " selected" : "")
                          }
                          onClick={() => selectRange(value)}
                        >
                          {caption}
                        </button>
                      ))}
                    </div>
                  </div>
                  {range === "custom" && (
                    <div className="filter-custom-range">
                      <TenantDateInput
                        label="From"
                        value={customFrom}
                        max={customTo || undefined}
                        onChange={setCustomFrom}
                        locale={session.tenant.config.locale}
                        dateFormat={session.tenant.config.dateFormat}
                        compact
                      />
                      <TenantDateInput
                        label="To"
                        value={customTo}
                        min={customFrom || undefined}
                        onChange={setCustomTo}
                        locale={session.tenant.config.locale}
                        dateFormat={session.tenant.config.dateFormat}
                        compact
                      />
                    </div>
                  )}
                  {range !== "custom" && (
                    <p className="filter-range-hint muted">
                      {range === "today"
                        ? today
                        : range === "week"
                          ? `${weekStart} – ${weekEnd}`
                          : range === "last_month"
                            ? `${lastMonthBounds(today)[0]} – ${lastMonthBounds(today)[1]}`
                            : range === "past"
                              ? `Through ${shiftDay(today, -1)}`
                              : `${monthBounds(today)[0]} – ${monthBounds(today)[1]}`}
                    </p>
                  )}
                  <div className="filter-popover-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={clearFilters}
                      disabled={!activeFilters}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setFiltersOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
            {canBook && (
              <Link
                className="button catalog-add-btn"
                href="/reservations/new"
                aria-label="New reservation"
              >
                <Plus size={17} />
                <span className="button-label">New reservation</span>
              </Link>
            )}
          </div>
        </div>
        {list.error && <Notice error>{list.error}</Notice>}
        {list.busy && !list.items.length ? (
          <Loading />
        ) : !list.items.length ? (
          <Empty title="No reservations found">
            <p>Try changing the search or filters.</p>
            {(activeFilters > 0 || search) && (
              <button
                type="button"
                className="button secondary"
                onClick={resetView}
              >
                Clear search and filters
              </button>
            )}
          </Empty>
        ) : (
          <>
            <ReservationTable
              items={list.items}
              session={session}
              sort={sort}
              dir={dir}
              onSort={toggleSort}
            />
            <div className="reservation-cards">
              {list.items.map((item) => {
                const party = Object.values(item.party).reduce(
                  (a, b) => a + b,
                  0,
                );
                return (
                  <Link
                    className="reservation-card"
                    href={`/reservations/${item.id}`}
                    key={item.id}
                  >
                    <div className="reservation-card-head">
                      <div>
                        <strong>{item.lead_name}</strong>
                        <small className="mono">
                          {item.id.slice(0, 8).toUpperCase()} ·{" "}
                          {label(item.source)}
                        </small>
                      </div>
                      <Status state={item.state} />
                    </div>
                    <div className="reservation-card-tour">
                      <span>{item.product_name}</span>
                      <small>
                        {friendlyDateTime(
                          item.starts_at,
                          session.tenant.timezone,
                          session.tenant.config.locale,
                          session.tenant.config.timeFormat,
                        )}
                      </small>
                    </div>
                    <div className="reservation-card-foot">
                      <span>
                        {party} {party === 1 ? "guest" : "guests"}
                      </span>
                      <strong>
                        {item.state === "cancelled"
                          ? "Cancelled"
                          : `${money(item.total_minor - item.paid_minor, item.currency, session.tenant.config.locale)} due`}
                      </strong>
                      <ChevronRight size={18} aria-hidden="true" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
        <More {...list} count={list.items.length} />
      </section>
    </>
  );
}

function departureClock(
  startsAt: string,
  timezone: string,
  locale: string,
  timeFormat?: "12h" | "24h",
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    ...(timeFormat ? { hour12: timeFormat === "12h" } : {}),
  }).format(new Date(startsAt));
}

export function Departures({ session }: { session: Session }) {
  const today = tenantDay(session.tenant.timezone);
  const weekStart = mondayOf(today);
  const weekEnd = sundayOf(today);
  const [productId, setProductId] = useState(""),
    [range, setRange] = useState<DateRangePreset>("today"),
    [customFrom, setCustomFrom] = useState(today),
    [customTo, setCustomTo] = useState(shiftDay(today, 13)),
    [filtersOpen, setFiltersOpen] = useState(false),
    [view, setView] = useState<"agenda" | "week" | "list">("agenda");
  const filterRef = useRef<HTMLDivElement>(null);
  const [from, to] = rangeBounds(range, today, customFrom, customTo);
  const products = useResource<Product[]>("admin/v1/products");
  const list = usePaged<Departure>(
    "staff/v1/workspace/departures",
    "",
    {
      view: "upcoming",
      from,
      to,
      ...(productId ? { productId } : {}),
    },
    100,
  );
  useEffect(() => {
    if (!filtersOpen) return;
    function onPointer(event: MouseEvent) {
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node)
      ) {
        setFiltersOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);
  const booked = list.items.reduce((sum, item) => sum + item.committed, 0);
  const held = list.items.reduce((sum, item) => sum + (item.held ?? 0), 0);
  const days = list.items.reduce<Record<string, Departure[]>>((result, item) => {
    const day = tenantDay(session.tenant.timezone, new Date(item.starts_at));
    (result[day] ??= []).push(item);
    return result;
  }, {});
  const filterCount = (productId ? 1 : 0) + (range === "today" ? 0 : 1);
  function resetView() {
    setProductId("");
    setRange("today");
    setCustomFrom(today);
    setCustomTo(shiftDay(today, 13));
    setFiltersOpen(false);
  }
  function selectRange(next: DateRangePreset) {
    setRange(next);
    if (next === "custom") {
      setCustomFrom(from);
      setCustomTo(to);
    }
  }
  const weekDays: string[] = [];
  if (from && to && from <= to) {
    for (let day = mondayOf(from); day <= to; day = shiftDay(day, 1)) {
      weekDays.push(day);
      if (weekDays.length > 42) break;
    }
    while (weekDays.length % 7)
      weekDays.push(shiftDay(weekDays.at(-1)!, 1));
  }
  const weeks: string[][] = [];
  for (let i = 0; i < weekDays.length; i += 7) weeks.push(weekDays.slice(i, i + 7));
  const canBook = session.permissions.includes("bookings.write");
  const canManifest = session.permissions.includes("manifest.read");
  const rangeLabel =
    range === "today"
      ? "Today"
      : range === "week"
        ? "This week"
        : range === "month"
          ? "This month"
          : "Custom range";
  return (
    <>
      <Heading
        title="Departures"
        description="Calendar of sellable trips, capacity, Book into a departure, and open Manifest."
      />
      <div className="catalog-metrics departure-metrics">
        <div>
          <strong>{list.busy && !list.items.length ? "—" : list.items.length}</strong>
          <span>Departures in view</span>
        </div>
        <div>
          <strong>{list.busy && !list.items.length ? "—" : booked}</strong>
          <span>Guests booked</span>
        </div>
        <div>
          <strong>{list.busy && !list.items.length ? "—" : held}</strong>
          <span>Seats held</span>
        </div>
        <div>
          <strong>
            {list.busy && !list.items.length
              ? "—"
              : list.items.filter((d) => d.available === 0).length}
          </strong>
          <span>Sold out</span>
        </div>
      </div>
      <section className="panel">
        <div className="departure-view-bar view-action-bar">
          <div className="view-tabs compact" role="tablist" aria-label="Departure views">
            {(["agenda", "week", "list"] as const).map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={view === item}
                onClick={() => setView(item)}
              >
                {item === "week" ? "Week" : label(item)}
              </button>
            ))}
          </div>
          <div className="departure-view-actions">
            <div className="filter-menu" ref={filterRef}>
              <button
                type="button"
                className={
                  "button secondary catalog-add-btn" +
                  (filtersOpen || filterCount ? " active-filter" : "")
                }
                aria-label="Filter departures"
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <ListFilter size={17} />
                <span className="button-label">Filter</span>
                {filterCount > 0 && (
                  <span className="filter-count">{filterCount}</span>
                )}
              </button>
              {filtersOpen && (
                <div
                  className="filter-popover"
                  role="dialog"
                  aria-label="Departure filters"
                >
                  <div className="filter-popover-head">
                    <strong>Filters</strong>
                    <span>
                      {rangeLabel}
                      {productId ? " · 1 product" : ""}
                    </span>
                  </div>
                  <label className="compact-control">
                    <span>Product</span>
                    <select
                      value={productId}
                      onChange={(event) => setProductId(event.target.value)}
                    >
                      <option value="">All products</option>
                      {products.data
                        ?.filter(
                          (item) => (item.status ?? "active") === "active",
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.customer_title ?? item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="compact-control">
                    <span>Date range</span>
                    <div
                      className="filter-range-options"
                      role="radiogroup"
                      aria-label="Date range"
                    >
                      {(
                        [
                          ["today", "Today"],
                          ["week", "This week"],
                          ["month", "This month"],
                          ["custom", "Custom range"],
                        ] as const
                      ).map(([value, caption]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={range === value}
                          className={
                            "filter-range-option" +
                            (range === value ? " selected" : "")
                          }
                          onClick={() => selectRange(value)}
                        >
                          {caption}
                        </button>
                      ))}
                    </div>
                  </div>
                  {range === "custom" && (
                    <div className="filter-custom-range">
                      <TenantDateInput
                        label="From"
                        value={customFrom}
                        max={customTo || undefined}
                        onChange={setCustomFrom}
                        locale={session.tenant.config.locale}
                        dateFormat={session.tenant.config.dateFormat}
                        compact
                      />
                      <TenantDateInput
                        label="To"
                        value={customTo}
                        min={customFrom || undefined}
                        onChange={setCustomTo}
                        locale={session.tenant.config.locale}
                        dateFormat={session.tenant.config.dateFormat}
                        compact
                      />
                    </div>
                  )}
                  {range !== "custom" && (
                    <p className="filter-range-hint muted">
                      {range === "today"
                        ? today
                        : range === "week"
                          ? `${weekStart} – ${weekEnd}`
                          : `${monthBounds(today)[0]} – ${monthBounds(today)[1]}`}
                    </p>
                  )}
                  <div className="filter-popover-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={resetView}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setFiltersOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
            {canBook && (
              <Link
                className="button catalog-add-btn"
                href="/reservations/new"
                aria-label="New reservation"
              >
                <Plus size={17} />
                <span className="button-label">New reservation</span>
              </Link>
            )}
          </div>
        </div>
        {list.error && <Notice error>{list.error}</Notice>}
        {list.busy && !list.items.length ? (
          <Loading />
        ) : !list.items.length ? (
          <Empty title="No departures in this range">
            <p>Try another date range or product, or add availability in Catalog.</p>
            <div className="button-row">
              <button type="button" className="button secondary" onClick={resetView}>
                Reset filters
              </button>
              {session.permissions.includes("catalog.write") && (
                <Link className="button secondary" href="/catalog/availability/new">
                  Add availability
                </Link>
              )}
            </div>
          </Empty>
        ) : view === "week" ? (
          <div className="departure-week">
            {weeks.map((week) => (
              <div className="departure-week-row" key={week[0]}>
                {week.map((day) => {
                  const items = days[day] ?? [];
                  const inRange = day >= from && day <= to;
                  return (
                    <article
                      key={day}
                      className={
                        "departure-week-day" +
                        (day === today ? " today" : "") +
                        (inRange ? "" : " outside")
                      }
                    >
                      <header>
                        <strong>
                          {new Intl.DateTimeFormat(session.tenant.config.locale, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                          }).format(new Date(`${day}T12:00:00Z`))}
                        </strong>
                        <span>{items.length}</span>
                      </header>
                      {items.map((d) => (
                        <Link
                          href={`/departures/${d.id}/manifest`}
                          key={d.id}
                          className="calendar-departure"
                        >
                          <time>
                            {departureClock(
                              d.starts_at,
                              session.tenant.timezone,
                              session.tenant.config.locale,
                              session.tenant.config.timeFormat,
                            )}
                          </time>
                          <span>
                            <strong>{d.product_name}</strong>
                            <small>
                              {d.committed}/{d.capacity}
                              {d.available === 0 ? " · Sold out" : ""}
                            </small>
                          </span>
                        </Link>
                      ))}
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        ) : view === "agenda" ? (
          <div className="departure-agenda">
            {Object.entries(days).map(([day, departures]) => (
              <section key={day}>
                <header>
                  <strong>
                    {new Intl.DateTimeFormat(session.tenant.config.locale, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      timeZone: session.tenant.timezone,
                    }).format(new Date(departures[0]!.starts_at))}
                  </strong>
                  <span>
                    {departures.length}{" "}
                    {departures.length === 1 ? "departure" : "departures"}
                  </span>
                </header>
                {departures.map((d) => (
                  <article key={d.id} className="departure-agenda-row">
                    <Link
                      href={`/departures/${d.id}/manifest`}
                      className="departure-agenda-main"
                    >
                      <time>
                        {departureClock(
                          d.starts_at,
                          session.tenant.timezone,
                          session.tenant.config.locale,
                          session.tenant.config.timeFormat,
                        )}
                      </time>
                      <div>
                        <strong>{d.product_name}</strong>
                        <small>
                          {d.option_name} · {d.duration_minutes ?? "—"} min
                          {d.status && d.status !== "scheduled"
                            ? ` · ${label(d.status)}`
                            : ""}
                        </small>
                      </div>
                      <div className="capacity-meter">
                        <span
                          style={{
                            width: `${Math.min(100, d.capacity ? (d.committed / d.capacity) * 100 : 0)}%`,
                          }}
                        />
                        <small>
                          {d.committed} of {d.capacity} booked
                          {(d.held ?? 0) > 0 ? ` · ${d.held} held` : ""}
                          {d.available === 0 ? " · Sold out" : ""}
                        </small>
                      </div>
                    </Link>
                    {canBook && d.available > 0 && (
                      <Link
                        className="button secondary departure-book"
                        href={`/reservations/new?departure=${d.id}&product=${d.product_id}&date=${tenantDay(session.tenant.timezone, new Date(d.starts_at))}&returnTo=${encodeURIComponent(`/departures/${d.id}/manifest`)}`}
                      >
                        Book
                      </Link>
                    )}
                  </article>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Departure</th>
                    <th>Booked</th>
                    <th>Held</th>
                    <th>Available</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/departures/${d.id}/manifest`}>
                          <strong>{d.product_name}</strong>
                          <small>{d.option_name}</small>
                        </Link>
                      </td>
                      <td>
                        {friendlyDateTime(
                          d.starts_at,
                          session.tenant.timezone,
                          session.tenant.config.locale,
                          session.tenant.config.timeFormat,
                        )}
                      </td>
                      <td>
                        {d.committed} / {d.capacity}
                      </td>
                      <td>{d.held ?? 0}</td>
                      <td>
                        <span className="seat-count">
                          {d.available === 0 ? "Sold out" : d.available}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {canManifest && (
                            <Link
                              className="text-link"
                              href={`/departures/${d.id}/manifest`}
                            >
                              Manifest
                            </Link>
                          )}
                          {canBook && d.available > 0 && (
                            <Link
                              className="text-link"
                              href={`/reservations/new?departure=${d.id}&product=${d.product_id}&date=${tenantDay(session.tenant.timezone, new Date(d.starts_at))}&returnTo=${encodeURIComponent(`/departures/${d.id}/manifest`)}`}
                            >
                              Book
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="reservation-cards departure-cards">
              {list.items.map((d) => (
                <Link
                  className="reservation-card"
                  href={`/departures/${d.id}/manifest`}
                  key={d.id}
                >
                  <div className="reservation-card-head">
                    <div>
                      <strong>{d.product_name}</strong>
                      <small>{d.option_name}</small>
                    </div>
                    <Status state={d.available === 0 ? "sold_out" : (d.status ?? "scheduled")} />
                  </div>
                  <div className="reservation-card-tour">
                    <span>
                      {friendlyDateTime(
                        d.starts_at,
                        session.tenant.timezone,
                        session.tenant.config.locale,
                        session.tenant.config.timeFormat,
                      )}
                    </span>
                    <small>
                      {d.committed} of {d.capacity} booked
                      {(d.held ?? 0) > 0 ? ` · ${d.held} held` : ""}
                    </small>
                  </div>
                  <div className="reservation-card-foot">
                    <span>
                      {d.available === 0
                        ? "Sold out"
                        : `${d.available} available`}
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
        <More {...list} count={list.items.length} />
      </section>
    </>
  );
}
export function ManifestView({
  session,
  departureId,
}: {
  session: Session;
  departureId: string;
}) {
  const { data, error, reload } = useResource<Manifest>(
    `ops/v1/departures/${departureId}/manifest`,
  );
  const searchParams = useSearchParams();
  const fromDayBoard = searchParams.get("from") === "operations";
  const assignments = useResource<{
    readiness: "unassigned" | "ready" | "blocked";
    items: {
      id: string;
      assignment_role: string;
      resource_name: string | null;
      crew_name: string | null;
    }[];
    expiredDocuments: {
      id: string;
      document_type: string;
      expires_on: string;
    }[];
  }>(`ops/v1/departures/${departureId}/assignments`);
  const checkin = useMutation();
  const printJob = useMutation();
  const itineraryMutation = useMutation();
  const [checkinMessage, setCheckinMessage] = useState("");
  const [scanToken, setScanToken] = useState("");
  const [scanResult, setScanResult] = useState<{
    passengerId: string;
    name: string;
    category: string;
  } | null>(null);
  const [addingItinerary, setAddingItinerary] = useState(false);
  const [waiverTarget, setWaiverTarget] = useState<{
    booking: Manifest["bookings"][number];
    passenger: Manifest["bookings"][number]["passengers"][number];
    mode: "sign" | "view";
  } | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<{
    booking: Manifest["bookings"][number];
    passenger?: Manifest["bookings"][number]["passengers"][number];
  } | null>(null);
  const [itineraryPoint, setItineraryPoint] = useState({
    name: "",
    address: "",
    directions: "",
    latitude: "",
    longitude: "",
    mapUrl: "",
    visibility: "internal" as "internal" | "guest",
  });
  const canCheckin = session.permissions.includes("checkin.write");
  const canPay = session.permissions.includes("payment.write");
  const canOps = session.permissions.includes("operations.write");

  function guestBalanceMinor(booking: Manifest["bookings"][number]) {
    return booking.guest_balance_minor ?? 0;
  }

  function balanceBadge(booking: Manifest["bookings"][number], state: string) {
    if (state === "balance_pending" && guestBalanceMinor(booking) > 0) {
      return (
        <span className="status balance_pending">
          Balance ·{" "}
          {money(
            guestBalanceMinor(booking),
            booking.currency ?? session.tenant.config.bookingCurrency,
            session.tenant.config.locale,
          )}
        </span>
      );
    }
    if (state === "balance_pending")
      return <Status state="arrived" />;
    return <Status state={state} />;
  }

  function openWaiverIfNeeded(
    booking: Manifest["bookings"][number],
    passenger: Manifest["bookings"][number]["passengers"][number],
    state: string,
    waiverSigned?: boolean,
  ) {
    const needsWaiver =
      !waiverSigned &&
      ["arrived", "waiver_pending"].includes(state);
    if (needsWaiver) setWaiverTarget({ booking, passenger, mode: "sign" });
  }

  async function recordCheckin(
    booking: Manifest["bookings"][number],
    state: "arrived" | "cleared_to_board" | "boarded" | "no_show",
  ) {
    const result = await checkin.run<{
      state: string;
      version: number;
      waiverSigned?: boolean;
    }>(`ops/v1/bookings/${booking.booking_id}/checkin`, {
      state,
      ...(booking.checkin_version ? { version: booking.checkin_version } : {}),
    });
    if (result) {
      setCheckinMessage(
        `${booking.lead_name}: ${label(result.state)} recorded.`,
      );
      reload();
      if (state === "arrived" && booking.passengers.length === 1) {
        openWaiverIfNeeded(
          booking,
          booking.passengers[0]!,
          result.state,
          result.waiverSigned,
        );
      }
    }
  }

  async function recordPassengerCheckin(
    booking: Manifest["bookings"][number],
    passenger: Manifest["bookings"][number]["passengers"][number],
    state: "arrived" | "cleared_to_board" | "boarded" | "no_show",
  ) {
    const result = await checkin.run<{
      state: string;
      waiverSigned?: boolean;
    }>(`staff/v1/passengers/${passenger.id}/checkin`, { state });
    if (result) {
      setCheckinMessage(`${passenger.name}: ${label(result.state)} recorded.`);
      reload();
      if (state === "arrived") {
        openWaiverIfNeeded(
          booking,
          passenger,
          result.state,
          result.waiverSigned ?? passenger.waiver_signed,
        );
      }
    }
  }

  async function printManifest() {
    if (!data) return;
    if (!session.permissions.includes("print.jobs.create")) {
      window.print();
      return;
    }
    const result = await printJob.run("ops/v1/print-jobs", {
      documentType: "manifest",
      sourceType: "departure",
      sourceId: data.departure.id,
    });
    if (result) window.print();
  }

  async function downloadManifest() {
    if (!data) return;
    const result = await printJob.run<{ id: string }>("ops/v1/print-jobs", {
      documentType: "manifest",
      sourceType: "departure",
      sourceId: data.departure.id,
    });
    if (result)
      await downloadApiFile(
        `ops/v1/print-jobs/${result.id}/pdf`,
        `manifest-${data.departure.id.slice(0, 8)}.pdf`,
      );
  }

  async function resolveScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await checkin.run<{
      passengerId: string;
      name: string;
      category: string;
    }>("staff/v1/crew/checkin-token/resolve", { token: scanToken });
    if (result) setScanResult(result);
  }

  const guestTotal =
    data?.bookings.reduce((sum, booking) => sum + booking.party_size, 0) ?? 0;
  const arrivedCount =
    data?.bookings.reduce(
      (sum, booking) =>
        sum +
        booking.passengers.filter((passenger) =>
          ["arrived", "waiver_pending", "balance_pending", "cleared_to_board", "boarded"].includes(
            passenger.checkin_state ?? "",
          ),
        ).length,
      0,
    ) ?? 0;
  const boardedCount =
    data?.bookings.reduce(
      (sum, booking) =>
        sum +
        booking.passengers.filter(
          (passenger) => passenger.checkin_state === "boarded",
        ).length,
      0,
    ) ?? 0;
  const waiverDue =
    data?.bookings.reduce(
      (sum, booking) =>
        sum +
        booking.passengers.filter(
          (passenger) =>
            !passenger.waiver_signed &&
            ["arrived", "waiver_pending"].includes(passenger.checkin_state ?? ""),
        ).length,
      0,
    ) ?? 0;
  const balanceDueCount =
    data?.bookings.filter(
      (booking) =>
        (booking.guest_balance_minor ?? 0) > 0 &&
        booking.passengers.some((passenger) =>
          ["arrived", "balance_pending", "waiver_pending", "not_arrived"].includes(
            passenger.checkin_state ?? "not_arrived",
          ),
        ),
    ).length ?? 0;

  function passengerActions(
    booking: Manifest["bookings"][number],
    passenger: Manifest["bookings"][number]["passengers"][number],
  ) {
    if (!canCheckin) return null;
    const state = passenger.checkin_state ?? "not_arrived";
    const readyToBoard =
      state === "cleared_to_board" ||
      (Boolean(passenger.waiver_signed) &&
        ["arrived", "waiver_pending"].includes(state));
    if (readyToBoard)
      return (
        <button
          className="button"
          disabled={checkin.busy}
          onClick={() => void recordPassengerCheckin(booking, passenger, "boarded")}
        >
          Board
        </button>
      );
    if (state === "boarded")
      return (
        <button
          className="button secondary"
          disabled={checkin.busy}
          onClick={() =>
            void recordPassengerCheckin(booking, passenger, "cleared_to_board")
          }
        >
          Undo board
        </button>
      );
    if (state === "no_show") return null;
    if (state === "balance_pending")
      return guestBalanceMinor(booking) > 0 ? (
        canPay ? (
          <button
            className="button"
            type="button"
            onClick={() => setPaymentTarget({ booking, passenger })}
          >
            Pay
          </button>
        ) : (
          <span className="muted">Balance due before boarding</span>
        )
      ) : !passenger.waiver_signed ? (
        <button
          className="button"
          type="button"
          onClick={() => openWaiver(booking, passenger)}
        >
          Waiver
        </button>
      ) : (
        <button
          className="button"
          disabled={checkin.busy}
          onClick={() =>
            void recordPassengerCheckin(booking, passenger, "arrived")
          }
        >
          Continue
        </button>
      );
    if (state === "arrived" || state === "waiver_pending")
      return passenger.waiver_signed ? (
        <span className="muted">Ready to board</span>
      ) : (
        <button
          className="button"
          type="button"
          onClick={() => openWaiver(booking, passenger)}
        >
          Waiver
        </button>
      );
    return (
      <button
        className="button"
        disabled={checkin.busy}
        onClick={() => void recordPassengerCheckin(booking, passenger, "arrived")}
      >
        Arrived
      </button>
    );
  }

  function openWaiver(
    booking: Manifest["bookings"][number],
    passenger: Manifest["bookings"][number]["passengers"][number],
  ) {
    setWaiverTarget({
      booking,
      passenger,
      mode: passenger.waiver_signed ? "view" : "sign",
    });
  }

  return (
    <div className="boarding-page">
      <Back href={fromDayBoard ? "/operations" : "/departures"}>
        {fromDayBoard ? "Day Board" : "Departures"}
      </Back>
      <Heading
        eyebrow="BOARDING"
        title={data?.departure.product_name ?? "Departure manifest"}
        description={
          data
            ? `${dateTime(data.departure.starts_at, session.tenant.timezone)} · Arrive → Pay if needed → Waiver → Board`
            : undefined
        }
        action={
          <div className="button-row no-print doc-actions boarding-doc-actions">
            <button
              type="button"
              className="button secondary"
              aria-label="Print manifest"
              title="Print"
              onClick={() => void printManifest()}
              disabled={!data || printJob.busy}
            >
              <Printer size={17} aria-hidden="true" />
              <span className="button-label">Print</span>
            </button>
            <button
              type="button"
              className="button"
              aria-label="Download PDF"
              title={printJob.busy ? "Preparing PDF" : "Download PDF"}
              onClick={() => void downloadManifest()}
              disabled={!data || printJob.busy}
            >
              <Download size={17} aria-hidden="true" />
              <span className="button-label">
                {printJob.busy ? "Preparing…" : "PDF"}
              </span>
            </button>
          </div>
        }
      />
      <div className="print-only">
        {session.tenant.name} · Mock data · {session.tenant.timezone}
      </div>

      {data && (
        <div className="boarding-metrics no-print">
          <div>
            <strong>{guestTotal}</strong>
            <span>Guests</span>
          </div>
          <div>
            <strong>{arrivedCount}</strong>
            <span>On site</span>
          </div>
          <div>
            <strong>{boardedCount}</strong>
            <span>Boarded</span>
          </div>
          <div className={balanceDueCount ? "attention" : ""}>
            <strong>{balanceDueCount}</strong>
            <span>Balance due</span>
          </div>
          <div className={waiverDue ? "attention" : ""}>
            <strong>{waiverDue}</strong>
            <span>Waiver due</span>
          </div>
        </div>
      )}

      <div className="boarding-ops no-print">
        {assignments.data && (
          <section className="panel boarding-ops-card">
            <div className="boarding-ops-head">
              <span className="boarding-ops-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h2>Operational readiness</h2>
                <span className={`status ${assignments.data.readiness}`}>
                  {assignments.data.readiness}
                </span>
              </div>
            </div>
            {assignments.data.expiredDocuments.length ? (
              <Notice error>
                Blocked by expired documents:{" "}
                {assignments.data.expiredDocuments
                  .map((item) => item.document_type)
                  .join(", ")}
                .
              </Notice>
            ) : assignments.data.items.length ? (
              <ul className="boarding-ops-list">
                {assignments.data.items.map((item) => (
                  <li key={item.id}>
                    <strong>{label(item.assignment_role)}</strong>
                    <span>{item.resource_name ?? item.crew_name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No crew or resources assigned yet.</p>
            )}
          </section>
        )}

        <section className="panel boarding-ops-card">
          <div className="boarding-ops-head">
            <span className="boarding-ops-icon">
              <MapPin size={18} />
            </span>
            <div>
              <h2>Itinerary & locations</h2>
              <span className="muted">
                {(data?.itinerary.length ?? 0) || "No"} route{" "}
                {(data?.itinerary.length ?? 0) === 1 ? "point" : "points"}
              </span>
            </div>
            {canOps && (
              <button
                className="button secondary"
                type="button"
                onClick={() => setAddingItinerary((value) => !value)}
              >
                <Plus size={16} /> Add
              </button>
            )}
          </div>
          {data?.itinerary.length ? (
            <ol className="boarding-itinerary">
              {data.itinerary.map((point) => (
                <li key={point.id}>
                  <div>
                    <strong>
                      {point.sequence}. {point.name}
                    </strong>
                    <small>
                      {[point.address, point.directions]
                        .filter(Boolean)
                        .join(" · ") || "Directions not recorded"}
                    </small>
                  </div>
                  {point.map_url && (
                    <a
                      className="text-link"
                      target="_blank"
                      rel="noreferrer"
                      href={point.map_url}
                    >
                      Map <ArrowUpRight size={14} />
                    </a>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              Add meeting point and route notes for tablet/mobile boarding.
            </p>
          )}
        </section>

        {canCheckin && (
          <section className="panel boarding-ops-card boarding-scan-card">
            <div className="boarding-ops-head">
              <span className="boarding-ops-icon">
                <ScanLine size={18} />
              </span>
              <div>
                <h2>Scan or enter check-in code</h2>
                <span className="muted">QR token or paste code</span>
              </div>
            </div>
            <form onSubmit={resolveScan} className="boarding-scan-form">
              <input
                aria-label="Check-in token"
                required
                value={scanToken}
                onChange={(event) => setScanToken(event.target.value)}
                placeholder="Scan QR or paste token"
                autoComplete="off"
              />
              <button className="button" disabled={checkin.busy}>
                <QrCode size={16} /> Find
              </button>
            </form>
            {scanResult && (
              <div className="boarding-scan-hit">
                <div>
                  <strong>{scanResult.name}</strong>
                  <small>{label(scanResult.category)}</small>
                </div>
                <button
                  className="button"
                  type="button"
                  disabled={checkin.busy}
                  onClick={() => {
                    const booking = data?.bookings.find((row) =>
                      row.passengers.some(
                        (passenger) => passenger.id === scanResult.passengerId,
                      ),
                    );
                    const passenger = booking?.passengers.find(
                      (row) => row.id === scanResult.passengerId,
                    );
                    if (!booking || !passenger) {
                      setCheckinMessage(
                        "Passenger found, but not on this departure manifest.",
                      );
                      return;
                    }
                    void recordPassengerCheckin(booking, passenger, "arrived");
                  }}
                >
                  Arrived
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {addingItinerary && canOps && (
        <section className="panel form-panel no-print boarding-setup-form">
          <h2>Add itinerary point</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await itineraryMutation.run(
                `ops/v1/departures/${departureId}/itinerary`,
                {
                  ...itineraryPoint,
                  sequence: (data?.itinerary.length ?? 0) + 1,
                  latitude: itineraryPoint.latitude
                    ? Number(itineraryPoint.latitude)
                    : null,
                  longitude: itineraryPoint.longitude
                    ? Number(itineraryPoint.longitude)
                    : null,
                },
              );
              if (result) {
                setAddingItinerary(false);
                setItineraryPoint({
                  name: "",
                  address: "",
                  directions: "",
                  latitude: "",
                  longitude: "",
                  mapUrl: "",
                  visibility: "internal",
                });
                reload();
              }
            }}
          >
            <div className="form-grid three">
              <label className="field">
                <span>Name</span>
                <input
                  required
                  value={itineraryPoint.name}
                  onChange={(e) =>
                    setItineraryPoint({
                      ...itineraryPoint,
                      name: e.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Address</span>
                <input
                  value={itineraryPoint.address}
                  onChange={(e) =>
                    setItineraryPoint({
                      ...itineraryPoint,
                      address: e.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Map link</span>
                <input
                  type="url"
                  value={itineraryPoint.mapUrl}
                  onChange={(e) =>
                    setItineraryPoint({
                      ...itineraryPoint,
                      mapUrl: e.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Latitude</span>
                <input
                  type="number"
                  step="any"
                  value={itineraryPoint.latitude}
                  onChange={(e) =>
                    setItineraryPoint({
                      ...itineraryPoint,
                      latitude: e.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Longitude</span>
                <input
                  type="number"
                  step="any"
                  value={itineraryPoint.longitude}
                  onChange={(e) =>
                    setItineraryPoint({
                      ...itineraryPoint,
                      longitude: e.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Visibility</span>
                <select
                  value={itineraryPoint.visibility}
                  onChange={(e) =>
                    setItineraryPoint({
                      ...itineraryPoint,
                      visibility: e.target.value as "internal" | "guest",
                    })
                  }
                >
                  <option value="internal">Internal</option>
                  <option value="guest">Guest-visible</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>Directions</span>
              <textarea
                rows={3}
                value={itineraryPoint.directions}
                onChange={(e) =>
                  setItineraryPoint({
                    ...itineraryPoint,
                    directions: e.target.value,
                  })
                }
              />
            </label>
            {itineraryMutation.error && (
              <Notice error>{itineraryMutation.error}</Notice>
            )}
            <div className="form-actions">
              <button className="button" disabled={itineraryMutation.busy}>
                {itineraryMutation.busy ? "Saving…" : "Save point"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setAddingItinerary(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {error ? (
        <Notice error>{error}</Notice>
      ) : !data ? (
        <Loading />
      ) : (
        <section className="panel boarding-manifest">
          {printJob.error && <Notice error>{printJob.error}</Notice>}
          <div className="panel-heading">
            <div>
              <h2>
                <Users size={18} /> Board guests
              </h2>
              <p className="muted">
                Arrive → Pay if needed → Waiver → Board. One action per guest.
              </p>
            </div>
            <span className="status confirmed">{guestTotal} guests</span>
          </div>
          {!data.bookings.length ? (
            <Empty title="No confirmed bookings yet">
              <p>Held reservations appear here only after confirmation.</p>
            </Empty>
          ) : (
            <>
              {(checkin.error || checkinMessage) && (
                <Notice error={Boolean(checkin.error)}>
                  {checkin.error || checkinMessage}
                </Notice>
              )}
              <div className="boarding-guest-list">
                {data.bookings.map((booking) => (
                  <article className="boarding-party" key={booking.booking_id}>
                    <header className="boarding-party-head">
                      <div>
                        <strong>{booking.lead_name}</strong>
                        <small>
                          {booking.booking_id.slice(0, 8).toUpperCase()} ·{" "}
                          {readablePickup(booking.pickup)}
                        </small>
                      </div>
                      <div className="boarding-party-meta">
                        <Status state={booking.checkin_state ?? "not_arrived"} />
                        <span className="boarding-party-count">
                          {booking.party_size}{" "}
                          {booking.party_size === 1 ? "guest" : "guests"}
                        </span>
                      </div>
                    </header>
                    {booking.passengers.length ? (
                      <ul className="boarding-passenger-rows">
                        {booking.passengers.map((passenger) => (
                          <li key={passenger.id}>
                            <div className="boarding-passenger-copy">
                              <strong>
                                {passenger.identity_pending
                                  ? "Name pending"
                                  : passenger.name}
                              </strong>
                              <small>
                                {label(passenger.category)}
                                {passenger.is_minor ? " · minor" : ""}
                                {passenger.waiver_signed
                                  ? " · waiver signed"
                                  : " · waiver needed"}
                              </small>
                            </div>
                            <div className="boarding-passenger-actions no-print">
                              <button
                                type="button"
                                className={
                                  "button secondary icon-only" +
                                  (passenger.waiver_signed
                                    ? " waiver-ready"
                                    : "")
                                }
                                aria-label={
                                  passenger.waiver_signed
                                    ? "View waiver"
                                    : "Sign waiver"
                                }
                                title={
                                  passenger.waiver_signed
                                    ? "View waiver"
                                    : "Sign waiver"
                                }
                                onClick={() => openWaiver(booking, passenger)}
                              >
                                <FileText size={17} />
                              </button>
                              {balanceBadge(
                                booking,
                                passenger.checkin_state ?? "not_arrived",
                              )}
                              {passengerActions(booking, passenger)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="boarding-party-fallback">
                        <p className="muted">
                          Roster not recorded ·{" "}
                          {Object.entries(booking.party)
                            .filter(([, value]) => value > 0)
                            .map(([key, value]) => `${value} ${label(key)}`)
                            .join(", ")}
                        </p>
                        {canCheckin && (
                          <div className="row-actions no-print">
                            {balanceBadge(
                              booking,
                              booking.checkin_state ?? "not_arrived",
                            )}
                            {booking.checkin_state === "cleared_to_board" ? (
                              <button
                                className="button"
                                disabled={checkin.busy}
                                onClick={() =>
                                  void recordCheckin(booking, "boarded")
                                }
                              >
                                Board
                              </button>
                            ) : booking.checkin_state === "boarded" ? (
                              <button
                                className="button secondary"
                                disabled={checkin.busy}
                                onClick={() =>
                                  void recordCheckin(
                                    booking,
                                    "cleared_to_board",
                                  )
                                }
                              >
                                Undo board
                              </button>
                            ) : booking.checkin_state === "no_show" ? null : booking.checkin_state ===
                              "balance_pending" &&
                              canPay &&
                              guestBalanceMinor(booking) > 0 ? (
                              <button
                                className="button"
                                type="button"
                                onClick={() => setPaymentTarget({ booking })}
                              >
                                Pay
                              </button>
                            ) : booking.checkin_state === "arrived" ||
                              booking.checkin_state === "waiver_pending" ||
                              booking.checkin_state === "balance_pending" ? (
                              <span className="muted">
                                Record passenger roster to complete waiver and
                                board
                              </span>
                            ) : (
                              <button
                                className="button"
                                disabled={checkin.busy}
                                onClick={() =>
                                  void recordCheckin(booking, "arrived")
                                }
                              >
                                Arrived
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {paymentTarget && (
        <BoardingPaymentModal
          session={session}
          booking={paymentTarget.booking}
          passenger={paymentTarget.passenger}
          onClose={() => setPaymentTarget(null)}
          onPaid={() => {
            const target = paymentTarget;
            setPaymentTarget(null);
            setCheckinMessage(
              `${target.passenger?.name || target.booking.lead_name}: payment recorded.`,
            );
            if (target.passenger) {
              void recordPassengerCheckin(
                target.booking,
                target.passenger,
                "arrived",
              );
            } else {
              void recordCheckin(target.booking, "arrived");
            }
          }}
        />
      )}
      {waiverTarget && (
        <BoardingWaiverModal
          booking={waiverTarget.booking}
          passenger={waiverTarget.passenger}
          mode={waiverTarget.mode}
          adultGuardians={waiverTarget.booking.passengers.filter(
            (person) => !person.is_minor && !person.identity_pending,
          )}
          onClose={() => setWaiverTarget(null)}
          onSigned={() => {
            setCheckinMessage(
              `${waiverTarget.passenger.name || "Guest"}: waiver signed. Check-in advanced.`,
            );
            setWaiverTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

export function AuditView({ session }: { session: Session }) {
  const { data, error } = useResource<Audit[]>("ops/v1/audit");
  return (
    <>
      <Heading
        title="Audit trail"
        description="The latest 100 recorded changes in this tenant."
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : !data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Record</th>
                  <th>Actor</th>
                  <th>Recorded at</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{label(e.action.replaceAll(".", " "))}</strong>
                    </td>
                    <td className="mono">{e.aggregate_id.slice(0, 8)}</td>
                    <td className="mono">{e.actor_id.slice(0, 8)}</td>
                    <td>{dateTime(e.occurred_at, session.tenant.timezone)}</td>
                    <td>{e.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

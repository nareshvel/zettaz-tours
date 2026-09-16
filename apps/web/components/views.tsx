"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  Printer,
  AlertTriangle,
  Check,
  Clock,
  CircleDollarSign,
  ListFilter,
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
  bookingSourceLabel,
  dateTime,
  downloadApiFile,
  fetchApiFile,
  friendlyDateTime,
  label,
  money,
  useMutation,
  usePaged,
  useResource,
} from "@/lib/client";
import { printDocument } from "@/lib/print-agent";
import {
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
import { BoardingGateToolbar } from "./boarding-gate-toolbar";
import { StartTripButton } from "./start-trip";
import { DepartureOptionsMenu } from "./dispatch";

type BriefingQueueItem = {
  kind: string;
  severity: "critical" | "warning" | "info";
  subject: string;
  detail: string;
  startsAt: string | null;
  href: string;
  expiresOn?: string;
  action?: string;
};
type BriefingDeparture = {
  id: string;
  starts_at: string;
  local_date: string;
  capacity: number;
  committed: number;
  operational_status: "open" | "weather_hold" | "closed";
  product_name: string;
  crew_assigned: boolean;
  pickup_unresolved: number;
  pickup_required: number;
  pickup_planned: number;
};
type Briefing = {
  day: string;
  timezone: string;
  currency: string;
  today: {
    departures: number;
    guests: number;
    boarded: number;
    expected: number;
    outstandingMinor: string;
    outstandingBookings: number;
    nextDeparture: {
      id: string;
      startsAt: string;
      productName: string;
    } | null;
  };
  month: {
    bookedMinor: string;
    receivedMinor: string;
    outstandingMinor: string;
    bookings: number;
  };
  quiet: {
    id: string;
    starts_at: string;
    local_date: string;
    capacity: number;
    committed: number;
    days_out: number;
    product_name: string;
  }[];
  queue: BriefingQueueItem[];
  queueTotal: number;
  timeline: BriefingDeparture[];
  demand: {
    date: string;
    departures: number;
    guests: number;
    capacity: number;
  }[];
};
type Readiness = {
  products: boolean;
  departures: boolean;
  pickupLocations: boolean;
  waiver: boolean;
  team: boolean;
  logo: boolean;
};

/**
 * The Overview is a shift briefing, not a report.
 *
 * It answers three questions and nothing else: what is running now, what breaks
 * if nobody acts, and what the week looks like. The page it replaced led with
 * lifetime totals — counts that only ever rise and can never prompt an action —
 * and summed four unrelated exception types into a single number that linked
 * nowhere. Anything that cannot finish the sentence "…and then I would do X"
 * belongs on Reports instead.
 */
/** The payload as it actually arrives: any section may be missing. */
type RawBriefing = Partial<Omit<Briefing, "today" | "month">> & {
  today?: Partial<Briefing["today"]>;
  month?: Partial<Briefing["month"]>;
};

/**
 * Fills in anything the server did not send.
 *
 * During development the web app hot-reloads the moment a file is saved while
 * the API is still serving its previous build, so a payload that is one field
 * behind the page is a normal state, not an exceptional one. A briefing panel
 * reading straight into `data.week.receivedMinor` turns that skew into a blank
 * screen; defaulting here keeps the rest of the page up and shows the affected
 * panel's empty state instead.
 */
function normalizeBriefing(raw: RawBriefing | null): Briefing | null {
  if (!raw) return null;
  return {
    day: "",
    timezone: "",
    currency: "USD",
    ...raw,
    today: {
      departures: 0,
      guests: 0,
      boarded: 0,
      expected: 0,
      outstandingMinor: "0",
      outstandingBookings: 0,
      nextDeparture: null,
      ...(raw.today ?? {}),
    },
    month: {
      bookedMinor: "0",
      receivedMinor: "0",
      outstandingMinor: "0",
      bookings: 0,
      ...(raw.month ?? {}),
    },
    quiet: raw.quiet ?? [],
    queue: raw.queue ?? [],
    queueTotal: raw.queueTotal ?? 0,
    timeline: raw.timeline ?? [],
    demand: raw.demand ?? [],
  };
}

/**
 * What each role opens this page for.
 *
 * Same components, different order and subset. An owner is not working the
 * queue — they want the shape of the week and a short list of what is going
 * wrong; a dispatcher wants the queue first and the money hidden; a resource
 * manager cares about readiness flags, not demand. One page that reorders
 * beats five pages that drift apart.
 */
type OverviewPlan = {
  /** Panels in render order. */
  order: ("today" | "timeline" | "quiet" | "demand" | "money")[];
  /** Rows before a "View all" takes over. */
  rows: number;
};

function planFor(role: string, canMoney: boolean): OverviewPlan {
  switch (role) {
    case "dispatcher":
    case "operations_manager":
      // Running the day: readiness first, and the sell-side is not their call.
      return { order: ["timeline", "today", "demand"], rows: 5 };
    case "finance":
      return { order: ["money", "today", "timeline"], rows: 5 };
    case "reservations":
      // Selling: where the week is thin, then which trips need pushing.
      return { order: ["today", "demand", "quiet", "timeline"], rows: 5 };
    case "resource_manager":
      return { order: ["today", "timeline"], rows: 6 };
    case "auditor":
    case "partner_manager":
      return { order: ["today", "demand", "timeline"], rows: 5 };
    default:
      // Owner and admin: the month at a glance, then what is running, then
      // what is not selling.
      return {
        order: canMoney
          ? ["today", "demand", "money", "timeline", "quiet"]
          : ["today", "demand", "timeline", "quiet"],
        rows: 5,
      };
  }
}

export function Overview({ session }: { session: Session }) {
  const can = (permission: string) => session.permissions.includes(permission);
  const canBookings = can("bookings.read");
  const canMoney =
    can("payment.write") || can("payment.correct") || can("config.write");
  const briefing = useResource<RawBriefing>(
    canBookings ? "staff/v1/workspace/briefing" : null,
  );
  const readiness = useResource<Readiness>(
    can("catalog.read") ? "admin/v1/tenant/readiness" : null,
  );
  const data = normalizeBriefing(briefing.data);
  const plan = planFor(session.role, canMoney);
  const outstanding = Number(data?.today.outstandingMinor ?? 0);
  const setupIncomplete =
    readiness.data && (!readiness.data.products || !readiness.data.departures);

  function panel(name: OverviewPlan["order"][number]) {
    if (!data) return null;
    switch (name) {
      case "today":
        return (
          <TodayStrip
            key="today"
            data={data}
            session={session}
            canMoney={canMoney}
            outstanding={outstanding}
          />
        );
      case "quiet":
        return <QuietDepartures key="quiet" data={data} session={session} />;
      case "timeline":
        return (
          <Timeline
            key="timeline"
            data={data}
            session={session}
            rows={plan.rows}
          />
        );
      case "demand":
        return <DemandChart key="demand" data={data} session={session} />;
      case "money":
        return <MoneyBar key="money" data={data} />;
    }
  }

  // Consecutive charts share a row; everything else is full width, because a
  // queue row needs the room for its action.
  function composed() {
    const out: React.ReactNode[] = [];
    let index = 0;
    while (index < plan.order.length) {
      const name = plan.order[index];
      const isChart = name === "demand" || name === "money";
      const next = plan.order[index + 1];
      if (isChart && (next === "demand" || next === "money")) {
        out.push(
          <div className="briefing-grid" key={`charts-${index}`}>
            {panel(name)}
            {panel(next)}
          </div>,
        );
        index += 2;
        continue;
      }
      out.push(panel(name));
      index += 1;
    }
    return out;
  }

  return (
    <>
      <Heading
        eyebrow={`${label(session.role)} WORKSPACE`}
        title={`Good ${greeting()}, ${session.actorName.split(" ")[0]}`}
        description={
          data
            ? describeDay(data, session)
            : `Your permitted view of ${session.tenant.name}.`
        }
        action={
          can("bookings.write") && (
            <Link href="/reservations/new" className="button">
              <Plus size={17} />
              <span className="button-label">New reservation</span>
              <span className="button-label-short">Book</span>
            </Link>
          )
        }
      />
      {briefing.error && <Notice error>{briefing.error}</Notice>}

      {!canBookings ? (
        <section className="panel">
          <Empty title="Your workspace is ready">
            <p>
              Your administrator can add module permissions to your role. Your
              profile and account controls are available now.
            </p>
          </Empty>
        </section>
      ) : !data ? (
        <Loading />
      ) : setupIncomplete ? (
        // Zeros are the wrong first impression for a tenant that has not
        // published anything yet; say what is missing instead.
        <section className="panel">
          <Empty title="Finish setting up before the briefing is useful">
            <p>
              The Overview reports on departures and bookings. Publish a product
              and schedule a departure, and this page fills in.
            </p>
            <Link className="button" href="/catalog">
              Open catalog <ArrowUpRight size={16} />
            </Link>
          </Empty>
        </section>
      ) : (
        composed()
      )}
    </>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function describeDay(data: Briefing, session: Session) {
  if (!data.today.departures)
    return `No departures today in ${session.tenant.timezone}.`;
  const critical = data.queue.filter(
    (item) => item.severity === "critical",
  ).length;
  return `${data.today.departures} departure${data.today.departures === 1 ? "" : "s"} today, ${data.today.guests} guest${data.today.guests === 1 ? "" : "s"} expected${critical ? ` · ${critical} needing a decision` : ""}.`;
}

/**
 * Formats a local date string ("2026-09-15") for display.
 *
 * Defensive on purpose: Intl throws a RangeError on an unparseable value, and
 * inside a map that takes the whole page down. One malformed day should cost a
 * label, not the briefing. (It has already happened once — a Postgres
 * generate_series returned timestamps, not dates.)
 */
/** "Today 9:00 AM" / "Tomorrow 1:00 PM" / "Thu 9:00 AM" — short enough for a
 *  column, specific enough to tell two rows of the same tour apart. */
function whenLabel(value: string, day: string, session: Session) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  const localDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: session.tenant.timezone,
  }).format(at);
  const tomorrow = new Date(`${String(day).slice(0, 10)}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const prefix =
    localDay === String(day).slice(0, 10)
      ? "Today"
      : localDay === tomorrow.toISOString().slice(0, 10)
        ? "Tomorrow"
        : new Intl.DateTimeFormat(session.tenant.config.locale, {
            weekday: "short",
            timeZone: session.tenant.timezone,
          }).format(at);
  return `${prefix} ${clockLabel(value, session)}`;
}

/** Departure clock time, or a dash rather than a thrown RangeError. */
function clockLabel(value: string, session: Session) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  return new Intl.DateTimeFormat(session.tenant.config.locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: session.tenant.config.timeFormat === "12h",
    timeZone: session.tenant.timezone,
  }).format(at);
}

function localDayLabel(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...options,
  }).format(date);
}

/**
 * Time to the next departure, counting down.
 *
 * Inside a day it is a running clock — `6:41:09` — because that is the shape
 * people read a countdown in, and a second hand makes it obvious the page is
 * live rather than a screenshot from this morning. Beyond a day the seconds
 * are noise, so it degrades to whole days.
 */
function countdown(value: string) {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return { text: "—", running: false };
  const seconds = Math.floor((at - Date.now()) / 1000);
  if (seconds <= 0) return { text: "Departing now", running: false };
  if (seconds >= 172800)
    return { text: `In ${Math.floor(seconds / 86400)} days`, running: false };
  if (seconds >= 86400) return { text: "Tomorrow", running: false };
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    text: `${hours}:${pad(minutes)}:${pad(seconds % 60)}`,
    running: true,
  };
}

function TodayStrip({
  data,
  session,
  canMoney,
  outstanding,
}: {
  data: Briefing;
  session: Session;
  canMoney: boolean;
  outstanding: number;
}) {
  // One tick a second: this is a countdown, and a page left open all day
  // should not be showing a number from the morning.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const next = data.today.nextDeparture;
  const clock = next ? countdown(next.startsAt) : null;
  const boardingShare = data.today.expected
    ? Math.round((data.today.boarded / data.today.expected) * 100)
    : 0;
  return (
    <div className="briefing-today">
      <article className="briefing-tile briefing-next">
        <span>Next departure</span>
        {next && clock ? (
          <>
            <strong
              className={clock.running ? "is-counting" : ""}
              suppressHydrationWarning
            >
              {clock.text}
            </strong>
            <small className="briefing-next-name">{next.productName}</small>
            <small className="briefing-next-when">
              {friendlyDateTime(
                next.startsAt,
                session.tenant.timezone,
                session.tenant.config.locale,
                session.tenant.config.timeFormat,
              )}
            </small>
          </>
        ) : (
          <>
            <strong>—</strong>
            <small>Nothing scheduled ahead</small>
          </>
        )}
      </article>
      <Link className="briefing-tile" href="/operations">
        <span>Running today</span>
        <strong>{data.today.departures}</strong>
        <small>
          {data.today.guests} guest{data.today.guests === 1 ? "" : "s"} expected
        </small>
      </Link>
      <Link className="briefing-tile" href="/operations">
        <span>Boarded</span>
        <strong>
          {data.today.boarded}
          <em>/{data.today.expected}</em>
        </strong>
        <Meter share={boardingShare} label="Boarding progress" />
      </Link>
      {canMoney && (
        <Link className="briefing-tile briefing-money" href="/reservations">
          <span>Still to collect today</span>
          <strong className={outstanding ? "attention" : ""}>
            {money(outstanding, data.currency)}
          </strong>
          <small>
            {data.today.outstandingBookings} booking
            {data.today.outstandingBookings === 1 ? "" : "s"} with a balance
          </small>
        </Link>
      )}
    </div>
  );
}

/** A ratio against a limit is a meter, never a chart. */
function Meter({ share, label: caption }: { share: number; label: string }) {
  return (
    <span
      className="briefing-meter"
      role="img"
      aria-label={`${caption}: ${share}%`}
    >
      <i style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
    </span>
  );
}

/**
 * Departures that are running but not selling.
 *
 * Readiness answers "can this run"; this answers "should it". A trip leaving
 * in a few days with most seats unsold is the promote-or-cancel decision, and
 * nothing else on the page surfaces it. Today is deliberately excluded — by
 * the morning of departure that decision has already been made.
 */
function QuietDepartures({
  data,
  session,
}: {
  data: Briefing;
  session: Session;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">SELLING SLOWLY</p>
          <h2>Under 40% sold, next 14 days</h2>
        </div>
        <Link className="text-link" href="/departures">
          All departures <ArrowUpRight size={15} />
        </Link>
      </div>
      {!data.quiet.length ? (
        <Empty title="Nothing sitting quiet">
          <p>
            Every departure in the next two weeks is at least 40% sold, or has
            been closed.
          </p>
        </Empty>
      ) : (
        <div className="briefing-day">
          {data.quiet.slice(0, 5).map((item) => (
            <div className="briefing-departure is-quiet" key={item.id}>
              <span className="briefing-time">
                {item.days_out === 1 ? "Tomorrow" : `In ${item.days_out}d`}
              </span>
              <div className="briefing-departure-main">
                <strong>{item.product_name}</strong>
                <span className="briefing-load">
                  <Meter
                    share={
                      item.capacity
                        ? Math.round((item.committed / item.capacity) * 100)
                        : 0
                    }
                    label={`${item.committed} of ${item.capacity} seats`}
                  />
                  <small>
                    {item.committed}/{item.capacity} seats ·{" "}
                    {localDayLabel(
                      item.local_date,
                      session.tenant.config.locale,
                      { weekday: "short", day: "numeric", month: "short" },
                    )}
                  </small>
                </span>
              </div>
              <Link
                className="button secondary"
                href={`/departures/${item.id}/manifest`}
              >
                Open
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Timeline({
  data,
  session,
  rows,
}: {
  data: Briefing;
  session: Session;
  rows: number;
}) {
  const shown = data.timeline.slice(0, rows);
  const days = [...new Set(shown.map((item) => item.local_date))];
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NEXT 72 HOURS</p>
          <h2>Readiness</h2>
        </div>
        <Link className="text-link" href="/departures">
          All departures <ArrowUpRight size={15} />
        </Link>
      </div>
      {!data.timeline.length ? (
        <Empty title="Nothing scheduled in the next three days">
          <Link href="/catalog/availability/new">Create a schedule</Link>
        </Empty>
      ) : (
        days.map((day) => (
          <div className="briefing-day" key={day}>
            <p className="briefing-day-label">
              {day === data.day
                ? "Today"
                : localDayLabel(day, session.tenant.config.locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })}
            </p>
            {shown
              .filter((item) => item.local_date === day)
              .map((item) => (
                <div className="briefing-departure" key={item.id}>
                  <span className="briefing-time">
                    {clockLabel(item.starts_at, session)}
                  </span>
                  <div className="briefing-departure-main">
                    <strong>
                      {item.product_name}
                      {item.operational_status !== "open" && (
                        <Status state={item.operational_status} />
                      )}
                    </strong>
                    <span className="briefing-load">
                      <Meter
                        share={
                          item.capacity
                            ? Math.round((item.committed / item.capacity) * 100)
                            : 0
                        }
                        label={`${item.committed} of ${item.capacity} seats`}
                      />
                      <small>
                        {item.committed}/{item.capacity} seats
                      </small>
                    </span>
                  </div>
                  <div className="briefing-flags">
                    <Flag ok={item.crew_assigned} label="Crew" />
                    <Flag
                      ok={
                        item.pickup_unresolved === 0 &&
                        (item.pickup_required === 0 ||
                          item.pickup_planned >= item.pickup_required)
                      }
                      label="Pickups"
                    />
                  </div>
                  <Link
                    className="icon-link"
                    aria-label={`Open ${item.product_name}`}
                    href={
                      session.permissions.includes("manifest.read")
                        ? `/departures/${item.id}/manifest`
                        : "/departures"
                    }
                  >
                    <ChevronRight size={19} />
                  </Link>
                </div>
              ))}
          </div>
        ))
      )}
      {data.timeline.length > shown.length && (
        <div className="briefing-more">
          <span>
            {data.timeline.length - shown.length} more departure
            {data.timeline.length - shown.length === 1 ? "" : "s"} in the next
            three days
          </span>
          <Link className="button secondary" href="/departures">
            View all <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
    </section>
  );
}

/** Status is never colour alone: each flag carries its own word. */
function Flag({ ok, label: caption }: { ok: boolean; label: string }) {
  return (
    <span className={`briefing-flag ${ok ? "ok" : "missing"}`}>
      {ok ? <Check size={13} /> : <AlertTriangle size={13} />}
      {caption}
    </span>
  );
}

/**
 * The month's money as one bar: received against still owed.
 *
 * Two parts, so a stacked bar rather than a pie — a two-slice pie is always a
 * worse bar, and the eye reads a length far better than an angle. The segments
 * are separated by a gap in the surface colour rather than a stroke, and both
 * are labelled, so the split survives greyscale and colour-blind readers.
 */
function MoneyBar({ data }: { data: Briefing }) {
  const received = Number(data.month.receivedMinor);
  const outstanding = Number(data.month.outstandingMinor);
  const total = received + outstanding;
  const share = total ? Math.round((received / total) * 100) : 0;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">THIS MONTH</p>
          <h2>Collected against outstanding</h2>
        </div>
        <Link className="text-link" href="/finance">
          Finance <ArrowUpRight size={15} />
        </Link>
      </div>
      {!total ? (
        <Empty title="No money booked this month">
          <p>Confirmed bookings on this month&apos;s departures.</p>
        </Empty>
      ) : (
        <>
          <div
            className="money-bar"
            role="img"
            aria-label={`${share}% of this month's booked value has been received`}
          >
            <i className="received" style={{ width: `${share}%` }} />
            <i className="outstanding" style={{ width: `${100 - share}%` }} />
          </div>
          <dl className="money-legend">
            <div>
              <dt>
                <span className="key received" aria-hidden="true" />
                Received
              </dt>
              <dd>{money(received, data.currency)}</dd>
            </div>
            <div>
              <dt>
                <span className="key outstanding" aria-hidden="true" />
                Outstanding
              </dt>
              <dd>{money(outstanding, data.currency)}</dd>
            </div>
          </dl>
          <p className="muted demand-note">
            {data.month.bookings} confirmed booking
            {data.month.bookings === 1 ? "" : "s"} on departures this calendar
            month.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Guests booked per day for the week ahead — the one real chart on this page.
 *
 * Single series, so no legend: the heading names what is plotted. Today is the
 * accent step and the rest sit in a lighter step of the same hue, because the
 * question is "where is the pressure this week", not "tell these seven days
 * apart". Only the tallest column is labelled; the rest are in the tooltip.
 */
function DemandChart({ data, session }: { data: Briefing; session: Session }) {
  const peak = Math.max(1, ...data.demand.map((day) => day.guests));
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NEXT 7 DAYS</p>
          <h2>Guests booked per day</h2>
        </div>
        <Link className="text-link" href="/reports">
          Reports <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="demand-chart">
        {data.demand.map((day) => {
          const height = Math.round((day.guests / peak) * 100);
          // Compared on the date part only, so a timestamp-shaped value
          // still highlights the right column.
          const isToday =
            String(day.date).slice(0, 10) === String(data.day).slice(0, 10);
          return (
            <div
              className={`demand-column${isToday ? " is-today" : ""}`}
              key={day.date}
              title={`${day.guests} guest${day.guests === 1 ? "" : "s"} · ${day.departures} departure${day.departures === 1 ? "" : "s"}${day.capacity ? ` · ${day.capacity} seats` : ""}`}
            >
              <span className="demand-value">
                {day.guests === peak && day.guests > 0 ? day.guests : ""}
              </span>
              <span className="demand-track">
                <i
                  style={{ height: `${day.guests ? Math.max(3, height) : 0}%` }}
                />
              </span>
              <small>
                {localDayLabel(day.date, session.tenant.config.locale, {
                  weekday: "narrow",
                })}
              </small>
            </div>
          );
        })}
      </div>
      <p className="muted demand-note">
        Confirmed guests by departure day, {session.tenant.timezone}.
      </p>
    </section>
  );
}

type ReservationSort =
  "created_at" | "starts_at" | "lead_name" | "state" | "guests" | "balance";

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
    if (!onSort)
      return <th className={numeric ? "numeric" : undefined}>{labelText}</th>;
    const active = sort === column;
    return (
      <th
        className={numeric ? "numeric" : undefined}
        aria-sort={
          active ? (dir === "asc" ? "ascending" : "descending") : "none"
        }
      >
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
  return monthBounds(`${prevYear}-${String(prevMonth).padStart(2, "0")}-15`);
}
type DateRangePreset =
  "today" | "week" | "month" | "last_month" | "past" | "custom";
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
        !filterRef.current.contains(event.target as Node) &&
        !document.getElementById("tdp-popup")?.contains(event.target as Node)
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
              ? money(balances, currencies[0]!)
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
                      {activeFilters ? ` · ${activeFilters} active` : ""}
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
                            {bookingSourceLabel(item)}
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
                          : `${money(item.total_minor - item.paid_minor, item.currency)} due`}
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
        !filterRef.current.contains(event.target as Node) &&
        !document.getElementById("tdp-popup")?.contains(event.target as Node)
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
  const days = list.items.reduce<Record<string, Departure[]>>(
    (result, item) => {
      const day = tenantDay(session.tenant.timezone, new Date(item.starts_at));
      (result[day] ??= []).push(item);
      return result;
    },
    {},
  );
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
    while (weekDays.length % 7) weekDays.push(shiftDay(weekDays.at(-1)!, 1));
  }
  const weeks: string[][] = [];
  for (let i = 0; i < weekDays.length; i += 7)
    weeks.push(weekDays.slice(i, i + 7));
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
          <strong>
            {list.busy && !list.items.length ? "—" : list.items.length}
          </strong>
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
          <div
            className="view-tabs compact"
            role="tablist"
            aria-label="Departure views"
          >
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
            <p>
              Try another date range or product, or add availability in Catalog.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                onClick={resetView}
              >
                Reset filters
              </button>
              {session.permissions.includes("catalog.write") && (
                <Link
                  className="button secondary"
                  href="/catalog/availability/new"
                >
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
                          {new Intl.DateTimeFormat(
                            session.tenant.config.locale,
                            {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              timeZone: "UTC",
                            },
                          ).format(new Date(`${day}T12:00:00Z`))}
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
                    <Status
                      state={
                        d.available === 0
                          ? "sold_out"
                          : (d.status ?? "scheduled")
                      }
                    />
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
  const router = useRouter();
  const { data, error, reload } = useResource<Manifest>(
    `ops/v1/departures/${departureId}/manifest`,
  );
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
  const [checkinMessage, setCheckinMessage] = useState("");
  const [guestSearch, setGuestSearch] = useState("");
  const [waiverTarget, setWaiverTarget] = useState<{
    booking: Manifest["bookings"][number];
    passenger: Manifest["bookings"][number]["passengers"][number];
    mode: "sign" | "view";
  } | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<{
    booking: Manifest["bookings"][number];
    passenger?: Manifest["bookings"][number]["passengers"][number];
  } | null>(null);
  const [rosterBookingId, setRosterBookingId] = useState<string | null>(null);
  const [rosterDrafts, setRosterDrafts] = useState<
    Array<{ name: string; category: string; isMinor: boolean }>
  >([]);
  const rosterSave = useMutation();
  const canCheckin = session.permissions.includes("checkin.write");
  const canPay = session.permissions.includes("payment.write");

  function draftRoster(booking: Manifest["bookings"][number]) {
    const drafts: Array<{ name: string; category: string; isMinor: boolean }> =
      [];
    for (const [category, count] of Object.entries(booking.party)) {
      for (let index = 0; index < count; index += 1) {
        drafts.push({
          name:
            drafts.length === 0
              ? booking.lead_name
              : `${booking.lead_name} · ${label(category)} ${index + 1}`,
          category,
          isMinor: category !== "adult",
        });
      }
    }
    setRosterBookingId(booking.booking_id);
    setRosterDrafts(drafts);
  }

  async function saveBoardingRoster(booking: Manifest["bookings"][number]) {
    const result = await rosterSave.run(
      `staff/v1/bookings/${booking.booking_id}/boarding-roster`,
      {
        passengers: rosterDrafts.map((passenger) => ({
          name: passenger.name.trim(),
          category: passenger.category,
          isMinor: passenger.isMinor,
        })),
      },
    );
    if (result) {
      setRosterBookingId(null);
      setRosterDrafts([]);
      setCheckinMessage(`${booking.lead_name}: guest names recorded.`);
      reload();
    }
  }

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
    return null;
  }

  /** Avoid dead “Waiver pending” chips when the next button is Waiver / Board / Arrived. */
  function passengerStatus(state: string) {
    if (
      canCheckin &&
      [
        "not_arrived",
        "arrived",
        "waiver_pending",
        "balance_pending",
        "cleared_to_board",
      ].includes(state)
    )
      return null;
    return <Status state={state} />;
  }

  function openWaiverIfNeeded(
    booking: Manifest["bookings"][number],
    passenger: Manifest["bookings"][number]["passengers"][number],
    state: string,
    waiverSigned?: boolean,
  ) {
    const needsWaiver =
      !waiverSigned && ["arrived", "waiver_pending"].includes(state);
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

  const canPrint = session.permissions.includes("print.jobs.create");
  async function printManifest() {
    if (!data) return;
    await printDocument(
      {
        documentType: "manifest",
        sourceType: "departure",
        sourceId: data.departure.id,
        fallbackName: `manifest-${data.departure.id.slice(0, 8)}.pdf`,
      },
      printJob.run,
      fetchApiFile,
    ).catch(() => {
      /* printJob.error already carries the reason for the banner */
    });
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

  async function handleScanArrived(hit: {
    passengerId: string;
    name: string;
    category: string;
  }) {
    const booking = data?.bookings.find((row) =>
      row.passengers.some((passenger) => passenger.id === hit.passengerId),
    );
    const passenger = booking?.passengers.find(
      (row) => row.id === hit.passengerId,
    );
    if (!booking || !passenger) {
      setCheckinMessage("Passenger found, but not on this departure manifest.");
      return;
    }
    await recordPassengerCheckin(booking, passenger, "arrived");
  }

  const guestQuery = guestSearch.trim().toLowerCase();
  const visibleBookings =
    data?.bookings.filter((booking) => {
      if (!guestQuery) return true;
      const ref = booking.booking_id.toLowerCase();
      const lead = booking.lead_name.toLowerCase();
      if (ref.includes(guestQuery) || lead.includes(guestQuery)) return true;
      return booking.passengers.some((passenger) =>
        passenger.name.toLowerCase().includes(guestQuery),
      );
    }) ?? [];

  const guestTotal =
    data?.bookings.reduce((sum, booking) => sum + booking.party_size, 0) ?? 0;
  const arrivedCount =
    data?.bookings.reduce(
      (sum, booking) =>
        sum +
        booking.passengers.filter((passenger) =>
          [
            "arrived",
            "waiver_pending",
            "balance_pending",
            "cleared_to_board",
            "boarded",
          ].includes(passenger.checkin_state ?? ""),
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
            ["arrived", "waiver_pending"].includes(
              passenger.checkin_state ?? "",
            ),
        ).length,
      0,
    ) ?? 0;
  const balanceDueCount =
    data?.bookings.filter(
      (booking) =>
        (booking.guest_balance_minor ?? 0) > 0 &&
        booking.passengers.some((passenger) =>
          [
            "arrived",
            "balance_pending",
            "waiver_pending",
            "not_arrived",
          ].includes(passenger.checkin_state ?? "not_arrived"),
        ),
    ).length ?? 0;
  const pendingStartGuests =
    data?.bookings.flatMap((booking) =>
      booking.passengers
        .filter(
          (passenger) =>
            !["boarded", "no_show"].includes(passenger.checkin_state ?? ""),
        )
        .map((passenger) => ({ id: passenger.id, name: passenger.name })),
    ) ?? [];
  const tripStarted = ["departed", "completed", "cancelled"].includes(
    data?.departure.trip_run_state ?? "",
  );

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
          onClick={() =>
            void recordPassengerCheckin(booking, passenger, "boarded")
          }
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
        onClick={() =>
          void recordPassengerCheckin(booking, passenger, "arrived")
        }
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
      <div className="boarding-page-header">
        <p className="eyebrow">BOARDING</p>
        <div className="boarding-page-title-row">
          <h1>{data?.departure.product_name ?? "Departure manifest"}</h1>
          <span className="boarding-when-badge">
            {data
              ? dateTime(data.departure.starts_at, session.tenant.timezone)
              : "Loading departure…"}
          </span>
        </div>
        <div className="boarding-page-meta-row">
          <div className="button-row no-print doc-actions boarding-doc-actions">
            {canPrint && (
              <button
                type="button"
                className="button secondary icon-only-action"
                aria-label="Print manifest"
                title="Print"
                onClick={() => void printManifest()}
                disabled={!data || printJob.busy}
              >
                <Printer size={17} aria-hidden="true" />
                <span className="button-label">Print</span>
              </button>
            )}
            {canPrint && (
              <button
                type="button"
                className="button secondary icon-only-action"
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
            )}
            {data && (
              <>
                <DepartureOptionsMenu
                  departure={{
                    id: data.departure.id,
                    operational_status:
                      data.departure.operational_status ?? "open",
                    operational_version:
                      data.departure.operational_version ?? 1,
                    plan_version: data.departure.plan_version,
                  }}
                  session={session}
                  reload={reload}
                  confirmedBookings={data.bookings.length}
                />
                <StartTripButton
                  departureId={data.departure.id}
                  pendingGuests={pendingStartGuests}
                  readiness={{
                    confirmedGuests: guestTotal,
                    boardedGuests: boardedCount,
                    noShowGuests: data.bookings.reduce(
                      (sum, booking) =>
                        sum +
                        booking.passengers.filter(
                          (passenger) => passenger.checkin_state === "no_show",
                        ).length,
                      0,
                    ),
                    boardingPending: pendingStartGuests.length,
                    pickupRequired: 0,
                    pickupPlanned: 0,
                    pickupUnresolved: 0,
                    operationalStatus:
                      data.departure.operational_status ?? "open",
                  }}
                  tripRunState={data.departure.trip_run_state}
                  canStart={canCheckin}
                  variant={
                    tripStarted || pendingStartGuests.length > 0
                      ? "secondary"
                      : "primary"
                  }
                  onStarted={() => router.push("/operations")}
                />
              </>
            )}
          </div>
        </div>
      </div>
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

      <BoardingGateToolbar
        canCheckin={canCheckin}
        assignments={assignments.data}
        search={guestSearch}
        onSearchChange={setGuestSearch}
        onScanArrived={(hit) => void handleScanArrived(hit)}
      />

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
              <p className="muted">Arrive → Pay if needed → Waiver → Board.</p>
            </div>
          </div>
          {!data.bookings.length ? (
            <Empty title="No confirmed bookings yet">
              <p>Held reservations appear here only after confirmation.</p>
            </Empty>
          ) : !visibleBookings.length ? (
            <Empty title="No guests match this search">
              <p>Clear the search to see everyone on this departure.</p>
            </Empty>
          ) : (
            <>
              {(checkin.error || checkinMessage) && (
                <Notice error={Boolean(checkin.error)}>
                  {checkin.error || checkinMessage}
                </Notice>
              )}
              <div className="boarding-guest-list">
                {visibleBookings.map((booking) => (
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
                        {booking.passengers.length
                          ? null
                          : passengerStatus(
                              booking.checkin_state ?? "not_arrived",
                            )}
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
                              {passengerStatus(
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
                        {canCheckin &&
                          rosterBookingId === booking.booking_id && (
                            <div className="boarding-roster-form no-print">
                              {rosterDrafts.map((draft, index) => (
                                <label
                                  className="field"
                                  key={`${draft.category}-${index}`}
                                >
                                  <span>
                                    {label(draft.category)}
                                    {draft.isMinor ? " · minor" : ""}
                                  </span>
                                  <input
                                    value={draft.name}
                                    onChange={(event) =>
                                      setRosterDrafts((rows) =>
                                        rows.map((row, rowIndex) =>
                                          rowIndex === index
                                            ? {
                                                ...row,
                                                name: event.target.value,
                                              }
                                            : row,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                              ))}
                              {(rosterSave.error || checkinMessage) &&
                                rosterBookingId === booking.booking_id && (
                                  <Notice error={Boolean(rosterSave.error)}>
                                    {rosterSave.error || checkinMessage}
                                  </Notice>
                                )}
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="button secondary"
                                  disabled={rosterSave.busy}
                                  onClick={() => {
                                    setRosterBookingId(null);
                                    setRosterDrafts([]);
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="button"
                                  disabled={
                                    rosterSave.busy ||
                                    rosterDrafts.some(
                                      (draft) => !draft.name.trim(),
                                    )
                                  }
                                  onClick={() =>
                                    void saveBoardingRoster(booking)
                                  }
                                >
                                  {rosterSave.busy
                                    ? "Saving…"
                                    : "Save guest names"}
                                </button>
                              </div>
                            </div>
                          )}
                        {canCheckin &&
                          rosterBookingId !== booking.booking_id && (
                            <div className="row-actions no-print">
                              {balanceBadge(
                                booking,
                                booking.checkin_state ?? "not_arrived",
                              )}
                              {passengerStatus(
                                booking.checkin_state ?? "not_arrived",
                              )}
                              <button
                                type="button"
                                className="button"
                                onClick={() => draftRoster(booking)}
                              >
                                Add guest names
                              </button>
                              {booking.checkin_state === "cleared_to_board" ? (
                                <button
                                  className="button secondary"
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
                              ) : booking.checkin_state ===
                                "no_show" ? null : booking.checkin_state ===
                                  "balance_pending" &&
                                canPay &&
                                guestBalanceMinor(booking) > 0 ? (
                                <button
                                  className="button secondary"
                                  type="button"
                                  onClick={() => setPaymentTarget({ booking })}
                                >
                                  Pay
                                </button>
                              ) : booking.checkin_state === "arrived" ||
                                booking.checkin_state === "waiver_pending" ||
                                booking.checkin_state ===
                                  "balance_pending" ? null : (
                                <button
                                  className="button secondary"
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

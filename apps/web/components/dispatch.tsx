"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  MapPin,
  Plus,
  Printer,
  Save,
  Settings2,
} from "lucide-react";
import type {
  DispatchRow,
  PickupLocation,
  PickupPlan,
  PrintablePickupList,
  Session,
} from "@/lib/types";
import { dateTime, label, useMutation, useResource } from "@/lib/client";
import { Back, Empty, Field, Heading, Loading, Notice, Status } from "./common";

const localDay = (zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function OperationsBoard({ session }: { session: Session }) {
  const [date, setDate] = useState(() => localDay(session.tenant.timezone));
  const board = useResource<{ date: string; items: DispatchRow[] }>(
    `ops/v1/board?date=${date}`,
  );
  return (
    <>
      <Heading
        eyebrow="OPERATIONS"
        title="Day board"
        description="Confirmed departures, pickup readiness and unresolved pickup work."
        action={
          <label className="date-control">
            <CalendarDays size={16} />
            <input
              aria-label="Operations date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        }
      />
      <Notice>
        Pickup plans are staff-entered sequences. This workspace does not
        calculate or optimize a route.
      </Notice>
      {board.error ? (
        <Notice error>{board.error}</Notice>
      ) : !board.data ? (
        <Loading />
      ) : !board.data.items.length ? (
        <Empty title="No departures on this day">
          <p>Choose another date or create a schedule.</p>
        </Empty>
      ) : (
        <div className="dispatch-grid">
          {board.data.items.map((d) => {
            const planned =
              d.pickup_required === d.pickup_planned &&
              d.pickup_unresolved === 0;
            return (
              <article className="panel dispatch-card" key={d.id}>
                <div className="dispatch-card-top">
                  <div>
                    <p className="eyebrow">
                      {dateTime(d.starts_at, session.tenant.timezone)}
                    </p>
                    <h2>{d.product_name}</h2>
                  </div>
                  <Status state={planned ? "confirmed" : "held"} />
                </div>
                <div className="dispatch-metrics">
                  <div>
                    <strong>{d.confirmed_guests}</strong>
                    <span>confirmed guests</span>
                  </div>
                  <div>
                    <strong>
                      {d.pickup_planned}/{d.pickup_required}
                    </strong>
                    <span>arranged pickups planned</span>
                  </div>
                  <div>
                    <strong>{d.pickup_unresolved}</strong>
                    <span>pickup follow-ups</span>
                  </div>
                </div>
                <div className="dispatch-card-bottom">
                  <span>
                    {d.plan_version
                      ? `Plan v${d.plan_version}`
                      : "No pickup plan saved"}
                  </span>
                  <div className="dispatch-actions">
                    {d.operational_status !== "open" && (
                      <span className="status held">
                        {label(d.operational_status)}
                      </span>
                    )}
                    {session.permissions.includes("operations.write") && (
                      <OperationalStatusControl
                        departure={d}
                        reload={board.reload}
                      />
                    )}
                    <Link
                      className="text-link"
                      href={`/operations/${d.id}/pickup-list`}
                    >
                      <Printer size={15} /> Pickup list
                    </Link>
                    {session.permissions.includes("operations.write") ? (
                      <Link
                        className="button secondary"
                        href={`/operations/${d.id}/pickups`}
                      >
                        <MapPin size={16} /> Pickup plan
                      </Link>
                    ) : (
                      <Link
                        className="text-link"
                        href={`/departures/${d.id}/manifest`}
                      >
                        View manifest
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
function OperationalStatusControl({
  departure,
  reload,
}: {
  departure: DispatchRow;
  reload: () => void;
}) {
  const change = useMutation();
  async function set(status: "open" | "weather_hold" | "closed") {
    const reason = window.prompt(
      status === "open"
        ? "Why is this departure reopening?"
        : `Reason for ${label(status)}:`,
    );
    if (!reason) return;
    if (
      await change.run(`ops/v1/departures/${departure.id}/operational-status`, {
        version: departure.operational_version,
        status,
        reason,
      })
    )
      reload();
  }
  return departure.operational_status === "open" ? (
    <button
      className="text-link danger"
      disabled={change.busy}
      onClick={() => set("weather_hold")}
    >
      Weather hold
    </button>
  ) : (
    <button
      className="text-link"
      disabled={change.busy}
      onClick={() => set("open")}
    >
      Reopen
    </button>
  );
}
export function PickupPlanPage({
  session,
  departureId,
}: {
  session: Session;
  departureId: string;
}) {
  const plan = useResource<PickupPlan>(
    `ops/v1/departures/${departureId}/pickups`,
  );
  const locations = useResource<PickupLocation[]>("ops/v1/pickup-locations");
  if (plan.error)
    return (
      <>
        <Back href="/operations">Operations</Back>
        <Notice error>{plan.error}</Notice>
      </>
    );
  if (!plan.data || !locations.data)
    return (
      <>
        <Back href="/operations">Operations</Back>
        <Loading />
      </>
    );
  return (
    <PickupEditor
      key={`${departureId}:${plan.data.plan?.version ?? 0}`}
      session={session}
      departureId={departureId}
      initial={plan.data}
      locations={locations.data}
      reload={() => {
        plan.reload();
        locations.reload();
      }}
    />
  );
}
export function PrintablePickupListPage({
  session,
  departureId,
}: {
  session: Session;
  departureId: string;
}) {
  const list = useResource<PrintablePickupList>(
    `ops/v1/departures/${departureId}/pickup-list`,
  );
  if (list.error)
    return (
      <>
        <Back href="/operations">Operations</Back>
        <Notice error>{list.error}</Notice>
      </>
    );
  if (!list.data)
    return (
      <>
        <Back href="/operations">Operations</Back>
        <Loading />
      </>
    );
  const { departure, plan, stops, exceptions } = list.data;
  return (
    <>
      <Back href="/operations">Operations</Back>
      <Heading
        eyebrow="DAY-OF OPERATIONS"
        title="Pickup list"
        description={`${departure.product_name} · ${dateTime(departure.starts_at, session.tenant.timezone)}`}
        action={
          <button className="button no-print" onClick={() => window.print()}>
            <Printer size={16} /> Print or save PDF
          </button>
        }
      />
      <section className="panel pickup-print-summary">
        <div>
          <p className="eyebrow">SAVED PLAN</p>
          <strong>{plan ? `Version ${plan.version}` : "No plan saved"}</strong>
        </div>
        <div>
          <p className="eyebrow">PLANNED STOPS</p>
          <strong>{stops.length}</strong>
        </div>
        <div>
          <p className="eyebrow">EXCEPTIONS</p>
          <strong className={exceptions.length ? "danger" : ""}>
            {exceptions.length}
          </strong>
        </div>
      </section>
      {plan?.notes && (
        <Notice>
          <strong>Dispatcher note:</strong> {plan.notes}
        </Notice>
      )}
      <section className="panel pickup-print-list">
        <div className="panel-heading plain">
          <div>
            <p className="eyebrow">ORDERED STOPS</p>
            <h2>Pickup sequence</h2>
          </div>
        </div>
        {!stops.length ? (
          <Empty title="No pickup stops saved">
            <p>Review the exceptions before this departure is ready.</p>
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Stop</th>
                  <th>Pickup time</th>
                  <th>Location</th>
                  <th>Lead guest</th>
                  <th>Guests</th>
                  <th>Stop note</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((stop) => (
                  <tr key={stop.sequence}>
                    <td>{stop.sequence}</td>
                    <td>{dateTime(stop.pickup_at, session.tenant.timezone)}</td>
                    <td>{stop.location_name}</td>
                    <td>{stop.lead_name}</td>
                    <td>{stop.party_size}</td>
                    <td>{stop.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section
        className={
          "panel pickup-exceptions " + (!exceptions.length ? "clear" : "")
        }
      >
        <div className="panel-heading plain">
          <div>
            <p className="eyebrow">ACTION REQUIRED</p>
            <h2>Pickup exceptions</h2>
          </div>
        </div>
        {!exceptions.length ? (
          <p className="muted">No unresolved or unplanned pickups.</p>
        ) : (
          <ul>
            {exceptions.map((item) => (
              <li key={item.booking_id}>
                <strong>{item.lead_name}</strong> · {item.party_size} guest
                {item.party_size === 1 ? "" : "s"} ·{" "}
                {item.pickup_kind === "unresolved"
                  ? "Pickup details are unresolved"
                  : "Arranged pickup is not in the saved plan"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
function PickupEditor({
  session,
  departureId,
  initial,
  locations,
  reload,
}: {
  session: Session;
  departureId: string;
  initial: PickupPlan;
  locations: PickupLocation[];
  reload: () => void;
}) {
  const save = useMutation(),
    add = useMutation();
  const [stops, setStops] = useState(
    initial.stops.map((s) => ({
      bookingId: s.booking_id,
      locationId: s.location_id,
      pickupAt: s.pickup_at.slice(0, 16),
      notes: s.notes,
    })),
  );
  const [notes, setNotes] = useState(initial.plan?.notes ?? "");
  const [newLocation, setNewLocation] = useState({
    name: "",
    slug: "",
    kind: "hotel",
    notes: "",
  });
  const selected = useMemo(
    () => new Set(stops.map((s) => s.bookingId)),
    [stops],
  );
  const eligible = initial.eligible.filter((b) => !selected.has(b.booking_id));
  const departure = initial.stops[0]?.pickup_at ?? "";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await save.run(`ops/v1/departures/${departureId}/pickups`, {
      version: initial.plan?.version,
      notes,
      stops: stops.map((s) => ({
        ...s,
        pickupAt: new Date(s.pickupAt).toISOString(),
      })),
    });
    if (result) reload();
  }
  async function createLocation(e: React.FormEvent) {
    e.preventDefault();
    const result = await add.run("ops/v1/pickup-locations", newLocation);
    if (result) {
      setNewLocation({ name: "", slug: "", kind: "hotel", notes: "" });
      reload();
    }
  }
  return (
    <>
      <Back href="/operations">Operations</Back>
      <Heading
        eyebrow="DISPATCH"
        title="Pickup plan"
        description="Order confirmed guests with an arranged pickup. Saving replaces the current ordered plan."
        action={
          <Link
            className="button secondary"
            href={`/operations/${departureId}/pickup-list`}
          >
            <Printer size={16} /> Print list
          </Link>
        }
      />
      <div className="pickup-layout">
        <form className="panel form-panel" onSubmit={submit}>
          <div className="panel-heading plain">
            <div>
              <h2>Ordered stops</h2>
              <p className="muted">
                Plan version {initial.plan?.version ?? "new"} ·{" "}
                {initial.eligible.length} eligible booking
                {initial.eligible.length === 1 ? "" : "s"}
              </p>
            </div>
            <button className="button" disabled={save.busy}>
              {save.busy ? "Saving…" : "Save plan"}
              <Save size={16} />
            </button>
          </div>
          {!stops.length && (
            <Empty title="No stops added">
              <p>
                Choose an arranged-pickup booking below. Unresolved pickups
                cannot be routed.
              </p>
            </Empty>
          )}
          {stops.map((stop, i) => {
            const guest =
              initial.eligible.find((b) => b.booking_id === stop.bookingId) ||
              initial.stops.find((s) => s.booking_id === stop.bookingId);
            return (
              <div className="pickup-stop" key={stop.bookingId}>
                <span className="stop-number">{i + 1}</span>
                <div className="stop-main">
                  <strong>{guest?.lead_name}</strong>
                  <small>
                    {guest?.party_size} guest
                    {guest?.party_size === 1 ? "" : "s"}
                  </small>
                </div>
                <Field label="Location">
                  <select
                    value={stop.locationId}
                    onChange={(e) =>
                      setStops((v) =>
                        v.map((x, n) =>
                          n === i ? { ...x, locationId: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} · {label(l.kind)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Pickup time">
                  <input
                    required
                    type="datetime-local"
                    value={stop.pickupAt}
                    onChange={(e) =>
                      setStops((v) =>
                        v.map((x, n) =>
                          n === i ? { ...x, pickupAt: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="text-link danger"
                  onClick={() => setStops((v) => v.filter((_, n) => n !== i))}
                >
                  Remove
                </button>
              </div>
            );
          })}
          {!!eligible.length && (
            <section className="eligible-list">
              <h3>Arranged pickups not yet in this plan</h3>
              {eligible.map((b) => (
                <div key={b.booking_id}>
                  <span>
                    <strong>{b.lead_name}</strong>
                    <small>
                      {b.party_size} guest{b.party_size === 1 ? "" : "s"} ·{" "}
                      {b.pickup.kind === "selected" ? b.pickup.location : ""}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setStops((v) => [
                        ...v,
                        {
                          bookingId: b.booking_id,
                          locationId: locations[0]?.id ?? "",
                          pickupAt: departure ? departure.slice(0, 16) : "",
                          notes: "",
                        },
                      ])
                    }
                    disabled={!locations.length}
                  >
                    Add stop
                  </button>
                </div>
              ))}
            </section>
          )}
          <Field
            label="Dispatcher notes"
            hint="Internal planning notes only; not customer instructions."
          >
            <textarea
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {save.error && <Notice error>{save.error}</Notice>}
        </form>
        <aside className="panel form-panel">
          <div className="panel-heading plain">
            <div>
              <p className="eyebrow">CONTROLLED DATA</p>
              <h2>Pickup locations</h2>
            </div>
            <Settings2 size={18} />
          </div>
          <p className="muted">
            Use a controlled location for every stop. Existing guest
            instructions remain on the reservation.
          </p>
          <form onSubmit={createLocation}>
            <Field label="Location name">
              <input
                required
                maxLength={120}
                value={newLocation.name}
                onChange={(e) =>
                  setNewLocation((v) => ({
                    ...v,
                    name: e.target.value,
                    slug:
                      v.slug ||
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "_")
                        .replace(/^_|_$/g, ""),
                  }))
                }
              />
            </Field>
            <Field label="Location code">
              <input
                required
                pattern="[a-z][a-z0-9_-]{1,49}"
                value={newLocation.slug}
                onChange={(e) =>
                  setNewLocation((v) => ({ ...v, slug: e.target.value }))
                }
              />
            </Field>
            <Field label="Kind">
              <select
                value={newLocation.kind}
                onChange={(e) =>
                  setNewLocation((v) => ({ ...v, kind: e.target.value }))
                }
              >
                <option value="hotel">Hotel</option>
                <option value="port">Port</option>
                <option value="meeting_point">Meeting point</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Operational notes">
              <textarea
                maxLength={500}
                value={newLocation.notes}
                onChange={(e) =>
                  setNewLocation((v) => ({ ...v, notes: e.target.value }))
                }
              />
            </Field>
            {add.error && <Notice error>{add.error}</Notice>}
            <button className="button secondary" disabled={add.busy}>
              {add.busy ? "Adding…" : "Add location"}
              <Plus size={16} />
            </button>
          </form>
          <div className="location-list">
            {locations.map((l) => (
              <div key={l.id}>
                <strong>{l.name}</strong>
                <small>
                  {label(l.kind)} · {l.slug}
                </small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

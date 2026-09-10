"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Download,
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
  RebookingOption,
  RebookingPreview,
  Session,
} from "@/lib/types";
import {
  dateTime,
  downloadApiFile,
  label,
  money,
  useMutation,
  useResource,
} from "@/lib/client";
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
                      <>
                        <span className="status held">
                          {label(d.operational_status)}
                        </span>
                        {session.permissions.includes("operations.write") &&
                          d.confirmed_bookings > 0 && (
                            <Link
                              className="text-link"
                              href={`/operations/${d.id}/rebook`}
                            >
                              Recovery
                            </Link>
                          )}
                      </>
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

export function RebookingPage({
  session,
  departureId,
}: {
  session: Session;
  departureId: string;
}) {
  const options = useResource<{
    source: { id: string; startsAt: string; status: string };
    options: RebookingOption[];
  }>(`ops/v1/departures/${departureId}/rebooking-options`);
  const previewMutation = useMutation();
  const applyMutation = useMutation();
  const [targetDepartureId, setTargetDepartureId] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RebookingPreview | null>(null);
  const [result, setResult] = useState<{
    succeeded: number;
    failed: number;
    results: Array<{ bookingId: string; success: boolean; reason?: string }>;
  } | null>(null);

  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    setResult(null);
    const data = await previewMutation.run<RebookingPreview>(
      `ops/v1/departures/${departureId}/rebooking-preview`,
      { targetDepartureId, reason },
    );
    if (data) setPreview(data);
  }
  async function apply() {
    if (!preview) return;
    const eligible = preview.items.filter(
      (item): item is typeof item & { quoteId: string; version: number } =>
        item.eligible && Boolean(item.quoteId) && Boolean(item.version),
    );
    if (!eligible.length) return;
    if (
      !window.confirm(
        `Move ${eligible.length} eligible booking${eligible.length === 1 ? "" : "s"} to the selected departure? Each booking will retain its payment history and receive a new price snapshot.`,
      )
    )
      return;
    const data = await applyMutation.run<{
      succeeded: number;
      failed: number;
      results: Array<{ bookingId: string; success: boolean; reason?: string }>;
    }>(`ops/v1/departures/${departureId}/rebook`, {
      targetDepartureId: preview.targetDepartureId,
      items: eligible.map((item) => ({
        bookingId: item.bookingId,
        version: item.version,
        quoteId: item.quoteId,
      })),
    });
    if (data) setResult(data);
  }

  return (
    <>
      <Back href="/operations">Operations</Back>
      <Heading
        eyebrow="OPERATIONS"
        title="Departure recovery"
        description="Preview every affected booking before moving eligible guests to an open departure."
      />
      {options.error && <Notice error>{options.error}</Notice>}
      {!options.data ? (
        !options.error && <Loading />
      ) : (
        <div className="rebooking-layout">
          <form className="panel form-card" onSubmit={prepare}>
            <h2>Prepare rebooking</h2>
            <p className="subtitle">
              Source status: {label(options.data.source.status)}. Customer
              messages remain unsent for review.
            </p>
            <Field label="Replacement departure">
              <select
                required
                value={targetDepartureId}
                onChange={(event) => {
                  setTargetDepartureId(event.target.value);
                  setPreview(null);
                }}
              >
                <option value="">Select an open departure</option>
                {options.data.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {dateTime(option.starts_at, session.tenant.timezone)} ·{" "}
                    {option.available} seats available
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Recovery reason"
              hint="This reason is written to each booking's immutable change history."
            >
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setPreview(null);
                }}
              />
            </Field>
            {previewMutation.error && (
              <Notice error>{previewMutation.error}</Notice>
            )}
            <button
              className="button"
              disabled={previewMutation.busy || !options.data.options.length}
            >
              {previewMutation.busy
                ? "Preparing…"
                : "Preview affected bookings"}
            </button>
          </form>
          {preview && (
            <section className="panel form-card">
              <div className="dispatch-card-top">
                <div>
                  <p className="eyebrow">RECOVERY PREVIEW</p>
                  <h2>
                    {preview.eligible} eligible · {preview.excluded} excluded
                  </h2>
                </div>
                <Status state={preview.excluded ? "held" : "confirmed"} />
              </div>
              <Notice>
                No messages are queued or sent by this action. Price differences
                and balances remain visible for finance review.
              </Notice>
              <div className="rebooking-items">
                {preview.items.map((item) => (
                  <div key={item.bookingId}>
                    <div>
                      <strong>{item.leadName}</strong>
                      <small>{item.bookingId}</small>
                    </div>
                    {item.eligible && item.quote ? (
                      <div className="rebooking-amount">
                        <strong>
                          {money(item.quote.totalMinor, item.quote.currency)}
                        </strong>
                        <small>
                          {item.differenceMinor === 0
                            ? "No price change"
                            : `${item.differenceMinor! > 0 ? "+" : ""}${money(item.differenceMinor!, item.quote.currency)} difference`}
                        </small>
                      </div>
                    ) : (
                      <span className="status cancelled">Excluded</span>
                    )}
                    {!item.eligible && (
                      <small className="rebooking-reason">{item.reason}</small>
                    )}
                  </div>
                ))}
              </div>
              {applyMutation.error && (
                <Notice error>{applyMutation.error}</Notice>
              )}
              {result && (
                <Notice>
                  {result.succeeded} moved successfully; {result.failed} require
                  review.
                </Notice>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="button"
                  disabled={
                    applyMutation.busy ||
                    preview.eligible === 0 ||
                    Boolean(result)
                  }
                  onClick={apply}
                >
                  {applyMutation.busy
                    ? "Applying…"
                    : `Move ${preview.eligible} eligible booking${preview.eligible === 1 ? "" : "s"}`}
                </button>
              </div>
            </section>
          )}
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
  const printJob = useMutation();
  async function printPickupList() {
    if (!session.permissions.includes("print.jobs.create")) {
      window.print();
      return;
    }
    const result = await printJob.run("ops/v1/print-jobs", {
      documentType: "pickup_list",
      sourceType: "departure",
      sourceId: departureId,
    });
    if (result) window.print();
  }
  async function downloadPickupList() {
    const result = await printJob.run<{ id: string }>("ops/v1/print-jobs", {
      documentType: "pickup_list",
      sourceType: "departure",
      sourceId: departureId,
    });
    if (result)
      await downloadApiFile(
        `ops/v1/print-jobs/${result.id}/pdf`,
        `pickup-list-${departureId.slice(0, 8)}.pdf`,
      );
  }
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
          <div className="button-row no-print">
            <button
              className="button secondary"
              disabled={printJob.busy}
              onClick={() => void printPickupList()}
            >
              <Printer size={16} /> Print
            </button>
            <button
              className="button"
              disabled={printJob.busy}
              onClick={() => void downloadPickupList()}
            >
              <Download size={16} />{" "}
              {printJob.busy ? "Preparing…" : "Download PDF"}
            </button>
          </div>
        }
      />
      {printJob.error && <Notice error>{printJob.error}</Notice>}
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
    address: "",
    latitude: "",
    longitude: "",
    mapUrl: "",
    visibility: "internal",
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
    const result = await add.run("ops/v1/pickup-locations", {
      ...newLocation,
      latitude: newLocation.latitude ? Number(newLocation.latitude) : undefined,
      longitude: newLocation.longitude
        ? Number(newLocation.longitude)
        : undefined,
    });
    if (result) {
      setNewLocation({
        name: "",
        slug: "",
        kind: "hotel",
        notes: "",
        address: "",
        latitude: "",
        longitude: "",
        mapUrl: "",
        visibility: "internal",
      });
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
            <Field label="Address or directions">
              <input
                maxLength={300}
                value={newLocation.address}
                onChange={(e) =>
                  setNewLocation((v) => ({ ...v, address: e.target.value }))
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="Latitude">
                <input
                  inputMode="decimal"
                  value={newLocation.latitude}
                  onChange={(e) =>
                    setNewLocation((v) => ({ ...v, latitude: e.target.value }))
                  }
                />
              </Field>
              <Field label="Longitude">
                <input
                  inputMode="decimal"
                  value={newLocation.longitude}
                  onChange={(e) =>
                    setNewLocation((v) => ({ ...v, longitude: e.target.value }))
                  }
                />
              </Field>
            </div>
            <Field
              label="Map link"
              hint="Optional tenant-controlled reference."
            >
              <input
                type="url"
                value={newLocation.mapUrl}
                onChange={(e) =>
                  setNewLocation((v) => ({ ...v, mapUrl: e.target.value }))
                }
              />
            </Field>
            <Field label="Visibility">
              <select
                value={newLocation.visibility}
                onChange={(e) =>
                  setNewLocation((v) => ({ ...v, visibility: e.target.value }))
                }
              >
                <option value="internal">Internal operations only</option>
                <option value="guest">May be shown to guests</option>
              </select>
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
                  {l.latitude !== null && l.longitude !== null
                    ? " · mapped"
                    : ""}
                </small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

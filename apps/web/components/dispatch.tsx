"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  MapPin,
  Printer,
  Save,
  Trash2,
} from "lucide-react";
import type {
  DispatchRow,
  Pickup,
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
  fetchApiFile,
  label,
  money,
  useMutation,
  useResource,
} from "@/lib/client";
import { printDocument } from "@/lib/print-agent";
import {
  Back,
  ConfirmDialog,
  Empty,
  Field,
  Heading,
  Loading,
  Notice,
  Status,
  TenantDateInput,
} from "./common";
import { StartTripButton } from "./start-trip";

const localDay = (zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function OperationsBoard({ session }: { session: Session }) {
  const [date, setDate] = useState(() => localDay(session.tenant.timezone));
  const [tripFilter, setTripFilter] = useState<"pending" | "started">(
    "pending",
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const board = useResource<{ date: string; items: DispatchRow[] }>(
    `ops/v1/board?date=${date}`,
  );
  const items = board.data?.items ?? [];
  const pendingCount = items.filter(
    (d) =>
      !["departed", "completed", "cancelled"].includes(d.trip_run_state ?? ""),
  ).length;
  const startedCount = items.length - pendingCount;
  const visible = items.filter((d) => {
    const tripStarted = ["departed", "completed", "cancelled"].includes(
      d.trip_run_state ?? "",
    );
    if (tripFilter === "started") return tripStarted;
    return !tripStarted;
  });
  const filterLabel =
    tripFilter === "started"
      ? `Started (${startedCount})`
      : `Pending (${pendingCount})`;

  useEffect(() => {
    if (!filterOpen) return;
    function onPointer(event: MouseEvent) {
      if (!filterRef.current?.contains(event.target as Node) &&
        !document.getElementById("tdp-popup")?.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  return (
    <>
      <Heading
        title="Day board"
        description="Today’s trips: board guests and start trips. Weather, close, and pickups live on the manifest."
      />
      <div className="board-trip-toolbar">
        <div className="board-trip-toolbar-controls">
          <div className="filter-menu" ref={filterRef}>
            <button
              type="button"
              className={
                "button secondary board-trip-filter-trigger" +
                (filterOpen ? " active-filter" : "")
              }
              aria-label="Trip status filter"
              aria-expanded={filterOpen}
              aria-haspopup="listbox"
              onClick={() => setFilterOpen((value) => !value)}
            >
              {filterLabel}
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {filterOpen && (
              <div
                className="filter-popover board-trip-filter-popover"
                role="listbox"
                aria-label="Trip status"
              >
                {(
                  [
                    ["pending", `Pending (${pendingCount})`],
                    ["started", `Started (${startedCount})`],
                  ] as const
                ).map(([value, caption]) => (
                  <button
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={tripFilter === value}
                    className={
                      tripFilter === value
                        ? "filter-range-option selected"
                        : "filter-range-option"
                    }
                    onClick={() => {
                      setTripFilter(value);
                      setFilterOpen(false);
                    }}
                  >
                    {caption}
                  </button>
                ))}
              </div>
            )}
          </div>
          <TenantDateInput
            label="Day board date"
            compact
            value={date}
            onChange={setDate}
            locale={session.tenant.config.locale}
            dateFormat={session.tenant.config.dateFormat}
          />
        </div>
      </div>
      {board.error ? (
        <Notice error>{board.error}</Notice>
      ) : !board.data ? (
        <Loading />
      ) : !board.data.items.length ? (
        <Empty title="No departures on this day">
          <p>Choose another date or create a schedule.</p>
        </Empty>
      ) : !visible.length ? (
        <Empty
          title={
            tripFilter === "started" ? "No started trips" : "No pending trips"
          }
        >
          <p>
            {tripFilter === "started"
              ? "Started trips appear here after Start trip."
              : "All trips on this day are already started."}
          </p>
        </Empty>
      ) : (
        <div className="dispatch-grid">
          {visible.map((d) => {
            const planned =
              d.pickup_required === d.pickup_planned &&
              d.pickup_unresolved === 0;
            const tripStarted = ["departed", "completed", "cancelled"].includes(
              d.trip_run_state ?? "",
            );
            const boardingPending = d.boarding_pending ?? 0;
            const boardedGuests = d.boarded_guests ?? 0;
            const noShowGuests = d.no_show_guests ?? 0;
            const readyToStart =
              !tripStarted &&
              boardingPending === 0 &&
              d.pickup_unresolved === 0 &&
              d.pickup_required === d.pickup_planned &&
              d.operational_status === "open";
            return (
              <article className="panel dispatch-card" key={d.id}>
                <div className="dispatch-card-top">
                  <div>
                    <p className="eyebrow">
                      {dateTime(d.starts_at, session.tenant.timezone)}
                    </p>
                    <h2>{d.product_name}</h2>
                  </div>
                  <div className="dispatch-card-badges">
                    {tripStarted ? (
                      <span className="status confirmed">Started</span>
                    ) : (
                      <span className="status held">Pending</span>
                    )}
                    {!planned && (
                      <span className="status held">Pickups open</span>
                    )}
                  </div>
                </div>
                <div className="dispatch-metrics">
                  <div>
                    <strong>{d.confirmed_guests}</strong>
                    <span>confirmed guests</span>
                  </div>
                  <div>
                    <strong>
                      {boardedGuests}
                      {boardingPending > 0
                        ? ` / ${boardedGuests + boardingPending + noShowGuests}`
                        : ""}
                    </strong>
                    <span>boarded</span>
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
                  <div className="dispatch-actions">
                    {noShowGuests > 0 && (
                      <span className="status held">
                        {noShowGuests} no-show
                      </span>
                    )}
                    {d.operational_status !== "open" && (
                      <span className="status held">
                        {label(d.operational_status)}
                      </span>
                    )}
                    <Link
                      className={
                        readyToStart || tripStarted
                          ? "button secondary"
                          : "button"
                      }
                      href={`/departures/${d.id}/manifest?from=operations`}
                    >
                      View / Board
                    </Link>
                    <StartTripButton
                      departureId={d.id}
                      pendingCount={boardingPending}
                      readiness={{
                        confirmedGuests: d.confirmed_guests,
                        boardedGuests,
                        noShowGuests,
                        boardingPending,
                        pickupRequired: d.pickup_required,
                        pickupPlanned: d.pickup_planned,
                        pickupUnresolved: d.pickup_unresolved,
                        operationalStatus: d.operational_status,
                      }}
                      tripRunState={d.trip_run_state}
                      canStart={session.permissions.includes("checkin.write")}
                      variant={readyToStart ? "primary" : "secondary"}
                      onStarted={board.reload}
                    />
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
  const [applyOpen, setApplyOpen] = useState(false);
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
    setApplyOpen(true);
  }
  async function confirmApply() {
    if (!preview) return;
    const eligible = preview.items.filter(
      (item): item is typeof item & { quoteId: string; version: number } =>
        item.eligible && Boolean(item.quoteId) && Boolean(item.version),
    );
    if (!eligible.length) return;
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
    if (data) {
      setResult(data);
      setApplyOpen(false);
    }
  }

  return (
    <>
      <Back href="/operations">Day Board</Back>
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
      <ConfirmDialog
        open={applyOpen}
        title="Apply recovery rebooking?"
        description={`Move ${preview?.eligible ?? 0} eligible booking${(preview?.eligible ?? 0) === 1 ? "" : "s"} to the selected departure. Each booking keeps its payment history and gets a new price snapshot. Customer messages stay unsent.`}
        confirmLabel="Move bookings"
        busy={applyMutation.busy}
        error={applyMutation.error}
        onClose={() => {
          if (!applyMutation.busy) setApplyOpen(false);
        }}
        onConfirm={() => void confirmApply()}
      />
    </>
  );
}
export function OperationalStatusControl({
  departure,
  reload,
  variant = "links",
  onAction,
}: {
  departure: {
    id: string;
    operational_status: "open" | "weather_hold" | "closed";
    operational_version: number;
  };
  reload: () => void;
  variant?: "links" | "menu";
  onAction?: () => void;
}) {
  const change = useMutation();
  const [draft, setDraft] = useState<"open" | "weather_hold" | "closed" | null>(
    null,
  );

  async function confirm(reason: string) {
    if (!draft) return;
    const ok = await change.run(
      `ops/v1/departures/${departure.id}/operational-status`,
      {
        version: departure.operational_version,
        status: draft,
        reason,
      },
    );
    if (ok) {
      setDraft(null);
      onAction?.();
      reload();
    }
  }

  const isOpen = departure.operational_status === "open";
  const title =
    draft === "open"
      ? "Reopen this departure?"
      : draft === "closed"
        ? "Close this departure?"
        : "Place weather hold?";
  const description =
    draft === "open"
      ? "Guests can be booked again once the departure is open."
      : draft === "closed"
        ? "Closed departures are not sellable. Use Recovery if confirmed guests need another trip."
        : "Weather hold stops new sales for this departure until you reopen it.";
  const confirmLabel =
    draft === "open"
      ? "Reopen"
      : draft === "closed"
        ? "Close trip"
        : "Hold departure";

  function openDraft(next: "open" | "weather_hold" | "closed") {
    setDraft(next);
  }

  return (
    <>
      {variant === "menu" ? (
        <>
          {isOpen ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="filter-range-option"
                disabled={change.busy}
                onClick={() => openDraft("weather_hold")}
              >
                Weather hold
              </button>
              <button
                type="button"
                role="menuitem"
                className="filter-range-option"
                disabled={change.busy}
                onClick={() => openDraft("closed")}
              >
                Close Trip
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="filter-range-option"
              disabled={change.busy}
              onClick={() => openDraft("open")}
            >
              Reopen
            </button>
          )}
        </>
      ) : isOpen ? (
        <>
          <button
            className="text-link danger"
            disabled={change.busy}
            type="button"
            onClick={() => openDraft("weather_hold")}
          >
            Weather hold
          </button>
          <button
            className="text-link danger"
            disabled={change.busy}
            type="button"
            onClick={() => openDraft("closed")}
          >
            Close Trip
          </button>
        </>
      ) : (
        <button
          className="text-link"
          disabled={change.busy}
          type="button"
          onClick={() => openDraft("open")}
        >
          Reopen
        </button>
      )}
      <ConfirmDialog
        open={draft !== null}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        danger={draft !== "open"}
        reasonRequired
        reasonLabel={
          draft === "open" ? "Reopen reason" : "Internal operational reason"
        }
        reasonHint="Stored on the departure audit trail. Not shown to guests."
        reasonPlaceholder="e.g. Swell at Jolly Harbour"
        busy={change.busy}
        error={change.error}
        onClose={() => {
          if (!change.busy) setDraft(null);
        }}
        onConfirm={confirm}
      />
    </>
  );
}

export function DepartureOptionsMenu({
  departure,
  session,
  reload,
  confirmedBookings = 0,
}: {
  departure: {
    id: string;
    operational_status: "open" | "weather_hold" | "closed";
    operational_version: number;
    plan_version?: number | null;
  };
  session: Session;
  reload: () => void;
  confirmedBookings?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canOps = session.permissions.includes("operations.write");

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".confirm-dialog-root")) {
        return;
      }
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.querySelector(".confirm-dialog-root")) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="filter-menu" ref={ref}>
      <button
        type="button"
        className={"button secondary" + (open ? " active-filter" : "")}
        aria-label="Departure options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        Options
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="filter-popover departure-options-popover"
          role="menu"
          aria-label="Departure options"
        >
          {canOps && (
            <OperationalStatusControl
              departure={departure}
              reload={reload}
              variant="menu"
              onAction={() => setOpen(false)}
            />
          )}
          {departure.plan_version ? (
            <Link
              role="menuitem"
              className="filter-range-option"
              href={`/operations/${departure.id}/pickup-list`}
              onClick={() => setOpen(false)}
            >
              Pickup list
            </Link>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="filter-range-option"
              disabled
              title="Save a pickup plan first"
            >
              Pickup list
            </button>
          )}
          {canOps && (
            <Link
              role="menuitem"
              className="filter-range-option"
              href={`/operations/${departure.id}/pickups`}
              onClick={() => setOpen(false)}
            >
              Plan pickups
            </Link>
          )}
          {canOps &&
            departure.operational_status !== "open" &&
            confirmedBookings > 0 && (
              <Link
                role="menuitem"
                className="filter-range-option"
                href={`/operations/${departure.id}/rebook`}
                onClick={() => setOpen(false)}
              >
                Recovery
              </Link>
            )}
        </div>
      )}
    </div>
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
      <div className="pickup-page">
        <div className="pickup-page-header">
          <p className="eyebrow">PLAN PICKUPS</p>
          <div className="pickup-page-title-row">
            <h1>Plan pickups</h1>
          </div>
        </div>
        <Notice error>{plan.error}</Notice>
      </div>
    );
  if (!plan.data || !locations.data)
    return (
      <div className="pickup-page">
        <div className="pickup-page-header">
          <p className="eyebrow">PLAN PICKUPS</p>
          <div className="pickup-page-title-row">
            <h1>Plan pickups</h1>
          </div>
        </div>
        <Loading />
      </div>
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
  const canPrint = session.permissions.includes("print.jobs.create");
  const printJob = useMutation();
  const [printNotice, setPrintNotice] = useState("");
  async function printPickupList() {
    setPrintNotice("");
    try {
      const outcome = await printDocument(
        {
          documentType: "pickup_list",
          sourceType: "departure",
          sourceId: departureId,
          fallbackName: `pickup-list-${departureId.slice(0, 8)}.pdf`,
        },
        printJob.run,
        fetchApiFile,
      );
      if (outcome.via === "agent")
        setPrintNotice("Sent to the paired printer.");
    } catch (error) {
      setPrintNotice((error as Error).message);
    }
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
      <div className="pickup-page">
        <div className="pickup-page-header">
          <p className="eyebrow">PICKUP LIST</p>
          <div className="pickup-page-title-row">
            <h1>Pickup list</h1>
          </div>
        </div>
        <Notice error>{list.error}</Notice>
      </div>
    );
  if (!list.data)
    return (
      <div className="pickup-page">
        <div className="pickup-page-header">
          <p className="eyebrow">PICKUP LIST</p>
          <div className="pickup-page-title-row">
            <h1>Pickup list</h1>
          </div>
        </div>
        <Loading />
      </div>
    );
  const { departure, plan, stops, exceptions } = list.data;
  const when = dateTime(departure.starts_at, session.tenant.timezone);
  const unresolved = exceptions.filter(
    (item) => item.pickup_kind === "unresolved",
  );
  const notInPlan = exceptions.filter(
    (item) => item.pickup_kind === "selected",
  );
  return (
    <div className="pickup-page pickup-print-page">
      <div className="pickup-page-header">
        <p className="eyebrow">PICKUP LIST</p>
        <div className="pickup-page-title-row">
          <h1>{departure.product_name}</h1>
          <span className="boarding-when-badge">{when}</span>
        </div>
        <div className="pickup-page-meta-row">
          <p className="pickup-page-meta">
            Plan version {plan ? plan.version : "none"} · Driver handoff for
            this departure
          </p>
          <div className="button-row no-print doc-actions pickup-print-actions">
            {session.permissions.includes("operations.write") && (
              <Link
                className="button secondary"
                href={`/operations/${departureId}/pickups`}
                aria-label="Plan pickups"
                title="Plan pickups"
              >
                <MapPin size={16} aria-hidden="true" />
                <span className="button-label">Plan pickups</span>
              </Link>
            )}
            {canPrint && (
              <button
                type="button"
                className="button secondary icon-only-action"
                disabled={printJob.busy}
                onClick={() => void printPickupList()}
                aria-label="Print pickup list"
                title={printJob.busy ? "Preparing print" : "Print"}
              >
                <Printer size={16} aria-hidden="true" />
                <span className="button-label">
                  {printJob.busy ? "Preparing…" : "Print"}
                </span>
              </button>
            )}
            {canPrint && (
              <button
                type="button"
                className="button icon-only-action"
                disabled={printJob.busy}
                onClick={() => void downloadPickupList()}
                aria-label="Download PDF"
                title={printJob.busy ? "Preparing PDF" : "Download PDF"}
              >
                <Download size={16} aria-hidden="true" />
                <span className="button-label">
                  {printJob.busy ? "Preparing…" : "PDF"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
      {printJob.error && <Notice error>{printJob.error}</Notice>}
      {printNotice && !printJob.error && <Notice>{printNotice}</Notice>}

      <div className="boarding-metrics pickup-plan-metrics no-print">
        <div>
          <strong>{stops.length}</strong>
          <span>stops</span>
        </div>
        <div>
          <strong>{plan ? `v${plan.version}` : "—"}</strong>
          <span>plan</span>
        </div>
        <div className={unresolved.length ? "attention" : undefined}>
          <strong>{unresolved.length}</strong>
          <span>unresolved</span>
        </div>
        <div className={notInPlan.length ? "attention" : undefined}>
          <strong>{notInPlan.length}</strong>
          <span>not in plan</span>
        </div>
      </div>

      {(unresolved.length > 0 || notInPlan.length > 0) && (
        <div className="pickup-exceptions panel no-print">
          <h2>Needs attention</h2>
          <ul>
            {unresolved.map((item) => (
              <li key={`u-${item.booking_id}`}>
                <strong>{item.lead_name}</strong>
                {" · "}
                {item.party_size} guest{item.party_size === 1 ? "" : "s"} ·
                pickup unresolved (fix on the reservation)
              </li>
            ))}
            {notInPlan.map((item) => (
              <li key={`e-${item.booking_id}`}>
                <strong>{item.lead_name}</strong>
                {" · "}
                {item.party_size} guest{item.party_size === 1 ? "" : "s"} ·
                arranged but not in the saved plan
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan?.notes ? (
        <div className="panel pickup-print-note">
          <strong>Dispatcher note</strong>
          <p>{plan.notes}</p>
        </div>
      ) : null}

      <section className="panel pickup-print-list">
        <div className="panel-heading plain">
          <div>
            <h2>Pickup sequence</h2>
            <p className="muted no-print">
              Paper-safe stop order for the driver. Edit timing and notes on
              Plan pickups.
            </p>
          </div>
        </div>
        {!stops.length ? (
          <Empty title="No pickup stops saved">
            <p>
              Save an ordered plan on Plan pickups before printing. Review
              exceptions above.
            </p>
          </Empty>
        ) : (
          <ol className="pickup-print-stops">
            {stops.map((stop) => (
              <li key={stop.sequence} className="pickup-print-stop">
                <span className="pickup-print-stop-index" aria-hidden>
                  {stop.sequence}
                </span>
                <div className="pickup-print-stop-main">
                  <div className="pickup-print-stop-head">
                    <strong>{stop.location_name}</strong>
                    <time dateTime={stop.pickup_at}>
                      {dateTime(stop.pickup_at, session.tenant.timezone)}
                    </time>
                  </div>
                  <span>
                    {stop.lead_name} · {stop.party_size} guest
                    {stop.party_size === 1 ? "" : "s"}
                  </span>
                  {stop.notes ? (
                    <small className="muted">{stop.notes}</small>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
type DraftStop = {
  bookingId: string;
  locationId: string;
  pickupAt: string;
  notes: string;
};

function toDatetimeLocalValue(iso: string) {
  if (!iso) return "";
  return iso.length >= 16 ? iso.slice(0, 16) : iso;
}

function matchLocationId(locations: PickupLocation[], pickup: Pickup) {
  if (!locations.length) return "";
  if (pickup.kind !== "selected") return locations[0]?.id ?? "";
  const needle = pickup.location.trim().toLowerCase();
  if (!needle) return locations[0]?.id ?? "";
  const exact = locations.find(
    (location) =>
      location.name.toLowerCase() === needle ||
      location.slug.toLowerCase() === needle,
  );
  if (exact) return exact.id;
  const partial = locations.find(
    (location) =>
      needle.includes(location.name.toLowerCase()) ||
      location.name.toLowerCase().includes(needle),
  );
  return partial?.id ?? locations[0]?.id ?? "";
}

function defaultPickupAt(stops: DraftStop[], departureStartsAt: string) {
  if (stops.length) {
    const last = new Date(stops[stops.length - 1]!.pickupAt);
    if (!Number.isNaN(last.getTime())) {
      return new Date(last.getTime() + 15 * 60_000).toISOString().slice(0, 16);
    }
  }
  const departure = new Date(departureStartsAt);
  if (!Number.isNaN(departure.getTime())) {
    return new Date(departure.getTime() - 60 * 60_000)
      .toISOString()
      .slice(0, 16);
  }
  return "";
}

function draftSnapshot(stops: DraftStop[], notes: string) {
  return JSON.stringify({ notes, stops });
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
  const save = useMutation();
  const [stops, setStops] = useState<DraftStop[]>(() =>
    initial.stops.map((s) => ({
      bookingId: s.booking_id,
      locationId: s.location_id,
      pickupAt: toDatetimeLocalValue(s.pickup_at),
      notes: s.notes,
    })),
  );
  const [notes, setNotes] = useState(initial.plan?.notes ?? "");
  const [baseline] = useState(() =>
    draftSnapshot(
      initial.stops.map((s) => ({
        bookingId: s.booking_id,
        locationId: s.location_id,
        pickupAt: toDatetimeLocalValue(s.pickup_at),
        notes: s.notes,
      })),
      initial.plan?.notes ?? "",
    ),
  );
  const dirty = draftSnapshot(stops, notes) !== baseline;
  const selected = useMemo(
    () => new Set(stops.map((s) => s.bookingId)),
    [stops],
  );
  const eligible = initial.eligible.filter((b) => !selected.has(b.booking_id));
  const unresolved = initial.exceptions.filter(
    (item) => item.pickup_kind === "unresolved",
  );
  const departureStartsAt = initial.departure.starts_at;
  const requiredCount = initial.eligible.length;
  const plannedCount = stops.length;
  const canWrite = session.permissions.includes("operations.write");

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function addStop(booking: PickupPlan["eligible"][number]) {
    setStops((current) => [
      ...current,
      {
        bookingId: booking.booking_id,
        locationId: matchLocationId(locations, booking.pickup),
        pickupAt: defaultPickupAt(current, departureStartsAt),
        notes: "",
      },
    ]);
  }

  function addAllEligible() {
    if (!locations.length || !eligible.length) return;
    setStops((current) => {
      let next = [...current];
      for (const booking of eligible) {
        if (next.some((stop) => stop.bookingId === booking.booking_id))
          continue;
        next = [
          ...next,
          {
            bookingId: booking.booking_id,
            locationId: matchLocationId(locations, booking.pickup),
            pickupAt: defaultPickupAt(next, departureStartsAt),
            notes: "",
          },
        ];
      }
      return next;
    });
  }

  function moveStop(index: number, direction: -1 | 1) {
    setStops((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return next;
    });
  }

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

  function printHref() {
    return `/operations/${departureId}/pickup-list`;
  }

  function onPrintClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!dirty) return;
    const ok = window.confirm(
      "You have unsaved pickup changes. Open the printed list with the last saved plan anyway?",
    );
    if (!ok) event.preventDefault();
  }

  return (
    <div className="pickup-page">
      <div className="pickup-page-header">
        <p className="eyebrow">PLAN PICKUPS</p>
        <div className="pickup-page-title-row">
          <h1>{initial.departure.product_name}</h1>
          <span className="boarding-when-badge">
            {dateTime(departureStartsAt, session.tenant.timezone)}
          </span>
        </div>
        <div className="pickup-page-meta-row">
          <p className="pickup-page-meta">
            Plan version {initial.plan?.version ?? "new"}
            {dirty ? " · Unsaved changes" : ""}
          </p>
          <div className="doc-actions pickup-print-actions no-print">
            {dirty && (
              <span className="status held" title="Save before printing">
                Unsaved
              </span>
            )}
            <Link
              className="button secondary icon-only-action"
              href={printHref()}
              aria-label="Print pickup list"
              title={
                dirty
                  ? "Print last saved plan (unsaved changes on this page)"
                  : "Print pickup list"
              }
              onClick={onPrintClick}
            >
              <Printer size={16} aria-hidden="true" />
              <span className="button-label">Print list</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="boarding-metrics pickup-plan-metrics no-print">
        <div>
          <strong>
            {plannedCount}/{requiredCount}
          </strong>
          <span>stops planned</span>
        </div>
        <div className={unresolved.length ? "attention" : undefined}>
          <strong>{unresolved.length}</strong>
          <span>unresolved</span>
        </div>
        <div className={eligible.length ? "attention" : undefined}>
          <strong>{eligible.length}</strong>
          <span>not in plan</span>
        </div>
        <div>
          <strong>{locations.length}</strong>
          <span>locations</span>
        </div>
      </div>

      {(unresolved.length > 0 || eligible.length > 0) && (
        <div className="pickup-exceptions panel no-print">
          <h2>Needs attention</h2>
          <ul>
            {unresolved.map((item) => (
              <li key={`u-${item.booking_id}`}>
                <strong>{item.lead_name}</strong>
                {" · "}
                {item.party_size} guest{item.party_size === 1 ? "" : "s"} ·
                pickup unresolved (fix on the reservation)
              </li>
            ))}
            {eligible.map((item) => (
              <li key={`e-${item.booking_id}`}>
                <strong>{item.lead_name}</strong>
                {" · "}
                {item.party_size} guest{item.party_size === 1 ? "" : "s"}
                {item.pickup.kind === "selected" && item.pickup.location
                  ? ` · ${item.pickup.location}`
                  : ""}
                {" · "}
                arranged but not in this plan yet
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pickup-layout pickup-layout-sequencing">
        <form className="panel form-panel pickup-plan-main" onSubmit={submit}>
          <div className="panel-heading plain">
            <div>
              <h2>Ordered stops</h2>
              <p className="muted">
                Sequence for the driver. Saving replaces the current plan. Times
                are planning defaults, not a routed ETA. Manage locations in{" "}
                <Link href="/settings?tab=pickups">
                  Settings → Pickup locations
                </Link>
                .
              </p>
            </div>
            <div className="pickup-plan-heading-actions">
              {canWrite && eligible.length > 0 && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!locations.length || save.busy}
                  onClick={addAllEligible}
                >
                  Add all ({eligible.length})
                </button>
              )}
            </div>
          </div>
          {!locations.length && (
            <Notice error>
              No controlled pickup locations. Create them under Tenant settings
              → Pickup locations before sequencing stops.
            </Notice>
          )}
          {!stops.length && (
            <Empty title="No stops added">
              <p>
                Add arranged-pickup bookings below. Unresolved pickups cannot be
                sequenced here until the reservation has a selected location.
              </p>
            </Empty>
          )}
          <div className="pickup-stop-list">
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
                    <div className="pickup-stop-reorder">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Move stop up"
                        disabled={i === 0 || !canWrite}
                        onClick={() => moveStop(i, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Move stop down"
                        disabled={i === stops.length - 1 || !canWrite}
                        onClick={() => moveStop(i, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="pickup-stop-fields">
                    <Field label="Location">
                      <select
                        value={stop.locationId}
                        disabled={!canWrite || !locations.length}
                        onChange={(e) =>
                          setStops((v) =>
                            v.map((x, n) =>
                              n === i
                                ? { ...x, locationId: e.target.value }
                                : x,
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
                    <Field
                      label="Pickup time"
                      hint={`Tenant timezone · ${session.tenant.timezone}`}
                    >
                      <input
                        required
                        type="datetime-local"
                        value={stop.pickupAt}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setStops((v) =>
                            v.map((x, n) =>
                              n === i ? { ...x, pickupAt: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field
                      label="Stop note"
                      hint="Driver-facing; shown on the print list."
                    >
                      <input
                        maxLength={240}
                        value={stop.notes}
                        disabled={!canWrite}
                        placeholder="e.g. Rear lobby"
                        onChange={(e) =>
                          setStops((v) =>
                            v.map((x, n) =>
                              n === i ? { ...x, notes: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      className="text-link danger"
                      onClick={() =>
                        setStops((v) => v.filter((_, n) => n !== i))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!!eligible.length && (
            <section className="eligible-list">
              <div className="eligible-list-head">
                <h3>Arranged pickups not yet in this plan</h3>
                {canWrite && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!locations.length}
                    onClick={addAllEligible}
                  >
                    Add all
                  </button>
                )}
              </div>
              {eligible.map((b) => (
                <div key={b.booking_id}>
                  <span>
                    <strong>{b.lead_name}</strong>
                    <small>
                      {b.party_size} guest{b.party_size === 1 ? "" : "s"}
                      {b.pickup.kind === "selected" && b.pickup.location
                        ? ` · ${b.pickup.location}`
                        : ""}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => addStop(b)}
                    disabled={!locations.length || !canWrite}
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
              disabled={!canWrite}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {save.error && <Notice error>{save.error}</Notice>}
          <div className="pickup-plan-footer">
            <button
              className="button"
              disabled={save.busy || !canWrite || !dirty}
            >
              {save.busy ? "Saving…" : dirty ? "Save plan" : "Saved"}
              <Save size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

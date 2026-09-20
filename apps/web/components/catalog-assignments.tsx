"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Plus,
  Ship,
  UserRound,
  X,
} from "lucide-react";
import type { Departure, Product, Session } from "@/lib/types";
import {
  dateTime,
  formatMediumDate,
  formatMediumDateRange,
  label,
  useMutation,
  useResource,
} from "@/lib/client";
import { coverageSuffix, fleetSeatCoverage } from "@/lib/fleet-coverage";
import {
  ConfirmDialog,
  Empty,
  Field,
  Loading,
  Notice,
  TenantDateInput,
} from "./common";

type RangePreset = "today" | "week" | "month" | "custom";

export type AssignmentListFilters = {
  range: RangePreset;
  customFrom: string;
  customTo: string;
  productId: string;
};

type Crew = {
  actor_id: string;
  operational_name: string;
  notes: string;
  active: boolean;
  name: string;
  email: string;
  role: string;
  role_name: string;
};

type Resource = {
  id: string;
  code: string;
  name: string;
  type: string;
  capacity: number | null;
  notes: string;
  active: boolean;
};

type ComplianceDocument = {
  id: string;
  resource_id: string | null;
  crew_actor_id: string | null;
  document_type: string;
  expires_on: string;
};

type Assignment = {
  id: string;
  departure_id: string;
  assignment_role: string;
  status: string;
  starts_at: string;
  ends_at: string;
  override_reason: string | null;
  resource_id: string | null;
  resource_name: string | null;
  resource_capacity: number | null;
  crew_actor_id: string | null;
  crew_name: string | null;
  departure_starts_at: string;
  local_date: string;
  product_name: string;
  departure_capacity?: number;
  departure_committed?: number;
};

type SubjectKind = "crew" | "resource";
type SubjectRef = { kind: SubjectKind; id: string };

type PendingOverride = {
  departureId: string;
  subject: SubjectRef;
  assignmentRole: string;
  docs: ComplianceDocument[];
};

const SUBJECT_MIME = "application/x-zettaz-subject";

function tenantDay(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const dow = (date.getUTCDay() + 6) % 7;
  return shiftDay(day, -dow);
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

function rangeBounds(
  preset: RangePreset,
  today: string,
  customFrom: string,
  customTo: string,
): [string, string] {
  if (preset === "today") return [today, today];
  // Remaining calendar week / month from today — past days are not assignable
  // work and should not clutter the default Assignments board.
  if (preset === "week") return [today, sundayOf(today)];
  if (preset === "month") {
    const [, end] = monthBounds(today);
    return [today, end];
  }
  return [customFrom || today, customTo || today];
}

export function assignmentFilterCount(filters: AssignmentListFilters) {
  return (filters.range !== "week" ? 1 : 0) + (filters.productId ? 1 : 0);
}

export function AssignmentsFilterButton({
  products,
  filters,
  timezone,
  locale,
  dateFormat,
  onFiltersChange,
}: {
  products: Product[];
  filters: AssignmentListFilters;
  timezone: string;
  locale: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  onFiltersChange: (next: AssignmentListFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = tenantDay(timezone);
  const count = assignmentFilterCount(filters);
  const [from, to] = rangeBounds(
    filters.range,
    today,
    filters.customFrom,
    filters.customTo,
  );
  const scheduledProducts = products.filter(
    (product) =>
      (product.availability_mode ?? "fixed_departure") === "fixed_departure",
  );
  const rangeLabel =
    filters.range === "today"
      ? "Today"
      : filters.range === "week"
        ? "This week"
        : filters.range === "month"
          ? "This month"
          : "Custom range";

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (
        !ref.current?.contains(event.target as Node) &&
        !document.getElementById("tdp-popup")?.contains(event.target as Node)
      )
        setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function selectRange(next: RangePreset) {
    if (next === "custom") {
      onFiltersChange({
        ...filters,
        range: next,
        customFrom: from,
        customTo: to,
      });
      return;
    }
    onFiltersChange({ ...filters, range: next });
  }

  function clearAll() {
    onFiltersChange({
      range: "week",
      customFrom: today,
      customTo: shiftDay(today, 6),
      productId: "",
    });
  }

  return (
    <div className="filter-menu" ref={ref}>
      <button
        type="button"
        className={
          "button secondary catalog-add-btn" +
          (open || count ? " active-filter" : "")
        }
        aria-label="Filter assignments"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <ListFilter size={17} />
        <span className="button-label">Filter</span>
        {count > 0 && <span className="filter-count">{count}</span>}
      </button>
      {open && (
        <div
          className="filter-popover"
          role="dialog"
          aria-label="Assignment filters"
        >
          <div className="filter-popover-head">
            <strong>Filters</strong>
            <span>{count ? `${count} active` : "None"}</span>
          </div>
          <label className="compact-control">
            <span>Tour</span>
            <select
              value={filters.productId}
              onChange={(e) =>
                onFiltersChange({ ...filters, productId: e.target.value })
              }
            >
              <option value="">All products</option>
              {scheduledProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.customer_title ?? product.name}
                </option>
              ))}
            </select>
          </label>
          <div className="compact-control">
            <span>Departure dates</span>
            <div
              className="filter-range-options"
              role="radiogroup"
              aria-label="Departure date range"
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
                  aria-checked={filters.range === value}
                  className={
                    "filter-range-option" +
                    (filters.range === value ? " selected" : "")
                  }
                  onClick={() => selectRange(value)}
                >
                  {caption}
                </button>
              ))}
            </div>
          </div>
          {filters.range === "custom" && (
            <div className="filter-custom-range">
              <TenantDateInput
                label="From"
                compact
                value={filters.customFrom}
                max={filters.customTo || undefined}
                onChange={(customFrom) =>
                  onFiltersChange({ ...filters, customFrom })
                }
                locale={locale}
                dateFormat={dateFormat}
              />
              <TenantDateInput
                label="To"
                compact
                value={filters.customTo}
                min={filters.customFrom || undefined}
                onChange={(customTo) =>
                  onFiltersChange({ ...filters, customTo })
                }
                locale={locale}
                dateFormat={dateFormat}
              />
            </div>
          )}
          {filters.range !== "custom" ? (
            <p className="filter-range-hint muted">
              Showing {rangeLabel.toLowerCase()}
              {filters.range === "week" || filters.range === "month"
                ? ` · ${formatMediumDateRange(from, to, locale)}`
                : filters.range === "today"
                  ? ` · ${formatMediumDate(from, locale)}`
                  : ""}
              .
            </p>
          ) : null}
          <div className="filter-popover-actions">
            <button
              type="button"
              className="text-button"
              onClick={clearAll}
              disabled={!count}
            >
              Reset
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function localDateFromInstant(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function daysInRange(from: string, to: string) {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = shiftDay(cursor, 1);
  }
  return days;
}

function staffAssignmentRole(crew: Crew) {
  return (crew.role_name || label(crew.role || "staff")).slice(0, 80);
}

function fleetAssignmentRole(resource: Resource) {
  return label(resource.type || "asset").slice(0, 80);
}

function subjectKey(subject: SubjectRef) {
  return `${subject.kind}:${subject.id}`;
}

/** Stable pastel index so the same product keeps one tint in the week grid. */
function tourTintIndex(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 6;
}

export function CatalogAssignmentsPanel({
  session,
  products,
  filters,
  onFiltersChange,
  openPlannerRequest = 0,
}: {
  session: Session;
  products: Product[];
  filters: AssignmentListFilters;
  onFiltersChange?: (next: AssignmentListFilters) => void;
  openPlannerRequest?: number;
}) {
  const canAssign = session.permissions.includes("assignments.write");
  const canOverride = session.permissions.includes(
    "safety.assignment.override",
  );
  const canManageResources = session.permissions.includes("resources.write");
  const canManageDocs = session.permissions.includes("documents.expiry.manage");

  const today = tenantDay(session.tenant.timezone);
  const range = filters.range;
  const customFrom = filters.customFrom;
  const customTo = filters.customTo;
  const productId = filters.productId;
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [focusDepartureId, setFocusDepartureId] = useState<string | null>(null);
  const [plannerWeekStart, setPlannerWeekStart] = useState(() =>
    mondayOf(today),
  );
  const [subjectKind, setSubjectKind] = useState<SubjectKind>("crew");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [selectedSubject, setSelectedSubject] = useState<SubjectRef | null>(
    null,
  );
  const [dragOverDepartureId, setDragOverDepartureId] = useState<string | null>(
    null,
  );
  const [pendingOverride, setPendingOverride] =
    useState<PendingOverride | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Assignment | null>(null);

  const [from, to] = rangeBounds(range, today, customFrom, customTo);
  const plannerWeekEnd = sundayOf(plannerWeekStart);
  // Current week: hide Mon–yesterday. Past/future weeks keep the full Mon–Sun grid.
  const plannerRangeFrom =
    plannerWeekStart < today && plannerWeekEnd >= today
      ? today
      : plannerWeekStart;

  const departures = useResource<{ items: Departure[] }>(
    canAssign
      ? `staff/v1/workspace/departures?from=${from}&to=${to}&limit=100${
          productId ? `&productId=${productId}` : ""
        }`
      : null,
  );
  const plannerDepartures = useResource<{ items: Departure[] }>(
    canAssign && plannerOpen
      ? `staff/v1/workspace/departures?from=${plannerRangeFrom}&to=${plannerWeekEnd}&limit=100${
          productId ? `&productId=${productId}` : ""
        }`
      : null,
  );
  const assignments = useResource<Assignment[]>(
    canAssign ? "ops/v1/assignments" : null,
  );
  const resources = useResource<Resource[]>(
    canManageResources ? "ops/v1/resources" : null,
  );
  const crew = useResource<Crew[]>(canManageResources ? "ops/v1/crew" : null);
  const documents = useResource<ComplianceDocument[]>(
    canManageDocs ? "ops/v1/compliance-documents" : null,
  );
  const save = useMutation();
  const remove = useMutation();

  const boardDepartures = useMemo(() => {
    const items = departures.data?.items ?? [];
    return [...items]
      .filter((departure) => {
        const day = localDateFromInstant(
          departure.starts_at,
          session.tenant.timezone,
        );
        // API date bounds are UTC midnight; keep only trips whose tenant-local
        // calendar day falls in the selected range (no leftover past days).
        return day >= from && day <= to;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [departures.data, from, to, session.tenant.timezone]);

  const boardAssignments = useMemo(() => {
    const list = assignments.data ?? [];
    return list.filter(
      (item) => item.local_date >= from && item.local_date <= to,
    );
  }, [assignments.data, from, to]);

  const assignmentsByDeparture = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const item of boardAssignments) {
      const bucket = map.get(item.departure_id) ?? [];
      bucket.push(item);
      map.set(item.departure_id, bucket);
    }
    return map;
  }, [boardAssignments]);

  const departuresByDay = useMemo(() => {
    const map = new Map<string, Departure[]>();
    for (const day of daysInRange(from, to)) map.set(day, []);
    for (const departure of boardDepartures) {
      const day = localDateFromInstant(
        departure.starts_at,
        session.tenant.timezone,
      );
      if (day < from || day > to) continue;
      const bucket = map.get(day);
      if (!bucket) continue;
      bucket.push(departure);
    }
    return map;
  }, [boardDepartures, from, to, session.tenant.timezone]);

  const plannerDayDepartures = useMemo(() => {
    const items = plannerDepartures.data?.items ?? [];
    return [...items]
      .filter((departure) => {
        const day = localDateFromInstant(
          departure.starts_at,
          session.tenant.timezone,
        );
        return day >= plannerRangeFrom && day <= plannerWeekEnd;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [
    plannerDepartures.data,
    plannerRangeFrom,
    plannerWeekEnd,
    session.tenant.timezone,
  ]);

  const plannerAssignmentsByDeparture = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const item of assignments.data ?? []) {
      if (
        item.local_date < plannerRangeFrom ||
        item.local_date > plannerWeekEnd
      ) {
        continue;
      }
      const bucket = map.get(item.departure_id) ?? [];
      bucket.push(item);
      map.set(item.departure_id, bucket);
    }
    return map;
  }, [assignments.data, plannerRangeFrom, plannerWeekEnd]);

  const plannerDays = useMemo(
    () => daysInRange(plannerRangeFrom, plannerWeekEnd),
    [plannerRangeFrom, plannerWeekEnd],
  );

  const scheduledProducts = products.filter(
    (item) =>
      (item.availability_mode ?? "fixed_departure") === "fixed_departure",
  );

  const staffList = useMemo(() => {
    const q = subjectSearch.trim().toLowerCase();
    return (crew.data ?? [])
      .filter((item) => item.active)
      .filter((item) => {
        if (!q) return true;
        return (
          item.operational_name.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          (item.role_name || item.role || "").toLowerCase().includes(q)
        );
      });
  }, [crew.data, subjectSearch]);

  const fleetList = useMemo(() => {
    const q = subjectSearch.trim().toLowerCase();
    return (resources.data ?? [])
      .filter((item) => item.active)
      .filter((item) => {
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          item.type.toLowerCase().includes(q)
        );
      });
  }, [resources.data, subjectSearch]);

  function blockingDocsFor(
    subject: SubjectRef,
    departure: Departure,
  ): ComplianceDocument[] {
    if (!documents.data) return [];
    const localDate = localDateFromInstant(
      departure.starts_at,
      session.tenant.timezone,
    );
    return documents.data.filter(
      (doc) =>
        doc.expires_on.slice(0, 10) < localDate &&
        ((subject.kind === "resource" && doc.resource_id === subject.id) ||
          (subject.kind === "crew" && doc.crew_actor_id === subject.id)),
    );
  }

  function resolveAssignmentRole(subject: SubjectRef): string | null {
    if (subject.kind === "crew") {
      const person = (crew.data ?? []).find((c) => c.actor_id === subject.id);
      return person ? staffAssignmentRole(person) : null;
    }
    const asset = (resources.data ?? []).find((r) => r.id === subject.id);
    return asset ? fleetAssignmentRole(asset) : null;
  }

  function openPlanner(departureId?: string) {
    setPlannerError(null);
    setPendingOverride(null);
    setOverrideReason("");
    setSelectedSubject(null);
    setSubjectSearch("");
    setFocusDepartureId(departureId ?? null);
    if (departureId) {
      const match = boardDepartures.find((d) => d.id === departureId);
      if (match) {
        setPlannerWeekStart(
          mondayOf(
            localDateFromInstant(match.starts_at, session.tenant.timezone),
          ),
        );
      } else {
        setPlannerWeekStart(mondayOf(today));
      }
    } else {
      setPlannerWeekStart(mondayOf(today));
    }
    setPlannerOpen(true);
  }

  useEffect(() => {
    if (!openPlannerRequest) return;
    setPlannerError(null);
    setPendingOverride(null);
    setOverrideReason("");
    setSelectedSubject(null);
    setSubjectSearch("");
    setFocusDepartureId(null);
    setPlannerWeekStart(mondayOf(today));
    setPlannerOpen(true);
  }, [openPlannerRequest, today]);

  function closePlanner() {
    if (save.busy) return;
    setPlannerOpen(false);
    setFocusDepartureId(null);
    setPendingOverride(null);
    setOverrideReason("");
    setPlannerError(null);
    setDragOverDepartureId(null);
  }

  async function createAssignment(
    subject: SubjectRef,
    departureId: string,
    override?: string,
  ) {
    const role = resolveAssignmentRole(subject);
    if (!role) {
      setPlannerError("Could not resolve assignment role for that subject.");
      return;
    }
    const departure = plannerDayDepartures.find((d) => d.id === departureId);
    if (!departure) {
      setPlannerError("Departure is not in the current week view.");
      return;
    }
    const blocked = blockingDocsFor(subject, departure);
    if (blocked.length && !canOverride) {
      setPlannerError(
        `Expired document${blocked.length > 1 ? "s" : ""} (${blocked
          .map((d) => d.document_type)
          .join(
            ", ",
          )}). Update files in Document library or Staff, or ask for a safety override.`,
      );
      setPendingOverride(null);
      return;
    }
    if (blocked.length && !override) {
      setPendingOverride({
        departureId,
        subject,
        assignmentRole: role,
        docs: blocked,
      });
      setOverrideReason("");
      setPlannerError(null);
      return;
    }
    if (blocked.length && (override?.trim().length ?? 0) < 8) {
      setPlannerError("Override reason must be at least 8 characters.");
      return;
    }
    setPlannerError(null);
    const result = await save.run("ops/v1/assignments", {
      departureId,
      assignmentRole: role,
      ...(subject.kind === "resource"
        ? { resourceId: subject.id }
        : { crewActorId: subject.id }),
      ...(blocked.length && override
        ? { overrideReason: override.trim() }
        : {}),
    });
    if (result) {
      setPendingOverride(null);
      setOverrideReason("");
      assignments.reload();
      departures.reload();
      plannerDepartures.reload();
    }
  }

  async function confirmOverride() {
    if (!pendingOverride) return;
    await createAssignment(
      pendingOverride.subject,
      pendingOverride.departureId,
      overrideReason,
    );
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const result = await remove.run(
      `ops/v1/assignments/${pendingDelete.id}`,
      {},
      "DELETE",
    );
    if (result !== undefined) {
      setPendingDelete(null);
      assignments.reload();
    }
  }

  function onSubjectDragStart(event: DragEvent, subject: SubjectRef) {
    const payload = JSON.stringify(subject);
    event.dataTransfer.setData(SUBJECT_MIME, payload);
    event.dataTransfer.setData("text/plain", payload);
    event.dataTransfer.effectAllowed = "copy";
    setSelectedSubject(subject);
  }

  function parseDroppedSubject(event: DragEvent): SubjectRef | null {
    const raw =
      event.dataTransfer.getData(SUBJECT_MIME) ||
      event.dataTransfer.getData("text/plain");
    if (!raw) return selectedSubject;
    try {
      const parsed = JSON.parse(raw) as SubjectRef;
      if (
        (parsed.kind === "crew" || parsed.kind === "resource") &&
        typeof parsed.id === "string"
      ) {
        return parsed;
      }
    } catch {
      /* fall through */
    }
    return selectedSubject;
  }

  if (!canAssign) {
    return (
      <Empty title="Assignments need dispatch permission">
        <p>Ask an owner to grant assignment access for this tenant.</p>
      </Empty>
    );
  }

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
      {(departures.error || assignments.error) && (
        <Notice error>{departures.error || assignments.error}</Notice>
      )}

      {!departures.data || !assignments.data ? (
        <Loading />
      ) : boardDepartures.length === 0 ? (
        <Empty title={`No departures · ${rangeLabel}`}>
          <p>
            {range === "custom"
              ? `${formatMediumDateRange(from, to, session.tenant.config.locale)}. `
              : null}
            Pick another range, or create a schedule under{" "}
            <Link href="/catalog?tab=schedules">Schedules</Link>.
          </p>
        </Empty>
      ) : (
        <div className="catalog-assignment-board">
          {[...departuresByDay.entries()]
            .filter(([, items]) => items.length > 0)
            .map(([day, items]) => (
              <section key={day} className="catalog-assignment-day">
                {(from !== to || range !== "today") && (
                  <h3 className="catalog-assignment-day-heading">
                    {formatMediumDate(day, session.tenant.config.locale)}
                  </h3>
                )}
                {items.map((departure) => {
                  const assigned =
                    assignmentsByDeparture.get(departure.id) ?? [];
                  return (
                    <article
                      key={departure.id}
                      className="catalog-assignment-card"
                    >
                      <header className="catalog-assignment-card-head">
                        <div>
                          <strong>{departure.product_name}</strong>
                          <p>
                            {dateTime(
                              departure.starts_at,
                              session.tenant.timezone,
                            )}
                            {" · "}
                            {departure.committed}/{departure.capacity} occupancy
                            {coverageSuffix(
                              fleetSeatCoverage(assigned, departure.committed),
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => openPlanner(departure.id)}
                        >
                          <Plus size={16} aria-hidden="true" />
                          Assign
                        </button>
                      </header>
                      {assigned.length === 0 ? (
                        <p className="catalog-assignment-empty muted">
                          No crew or assets assigned yet.
                        </p>
                      ) : (
                        <ul className="catalog-assignment-chips">
                          {assigned.map((item) => {
                            const name = item.crew_name
                              ? item.crew_name
                              : item.resource_name;
                            const kind = item.crew_actor_id ? "Staff" : "Fleet";
                            const role = label(item.assignment_role);
                            const title = [
                              name,
                              role,
                              kind,
                              item.override_reason ? "Override" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ");
                            return (
                              <li
                                key={item.id}
                                className={
                                  "catalog-assignment-badge" +
                                  (item.crew_actor_id
                                    ? " is-staff"
                                    : " is-fleet") +
                                  (item.override_reason ? " is-override" : "")
                                }
                                title={title}
                              >
                                <span className="catalog-assignment-badge-name">
                                  {name}
                                </span>
                                <button
                                  type="button"
                                  className="catalog-assignment-badge-remove"
                                  aria-label={`Remove ${name} (${role})`}
                                  onClick={() => setPendingDelete(item)}
                                >
                                  <X size={12} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </article>
                  );
                })}
              </section>
            ))}
        </div>
      )}

      {plannerOpen && (
        <AssignmentPlannerSheet
          session={session}
          busy={save.busy}
          error={plannerError || save.error}
          onClearError={() => {
            setPlannerError(null);
            save.clear();
          }}
          weekStart={plannerRangeFrom}
          weekEnd={plannerWeekEnd}
          days={plannerDays}
          departures={plannerDayDepartures}
          assignmentsByDeparture={plannerAssignmentsByDeparture}
          loading={!plannerDepartures.data}
          loadError={plannerDepartures.error}
          products={scheduledProducts}
          productId={productId}
          onProductIdChange={(next) =>
            onFiltersChange?.({ ...filters, productId: next })
          }
          subjectKind={subjectKind}
          onSubjectKindChange={(next) => {
            setSubjectKind(next);
            setSelectedSubject(null);
            setSubjectSearch("");
          }}
          subjectSearch={subjectSearch}
          onSubjectSearchChange={setSubjectSearch}
          staffList={staffList}
          fleetList={fleetList}
          canManageResources={canManageResources}
          selectedSubject={selectedSubject}
          onSelectSubject={setSelectedSubject}
          focusDepartureId={focusDepartureId}
          dragOverDepartureId={dragOverDepartureId}
          pendingOverride={pendingOverride}
          overrideReason={overrideReason}
          onOverrideReasonChange={setOverrideReason}
          canOverride={canOverride}
          onClose={closePlanner}
          onPrevWeek={() => setPlannerWeekStart(shiftDay(plannerWeekStart, -7))}
          onNextWeek={() => setPlannerWeekStart(shiftDay(plannerWeekStart, 7))}
          onSubjectDragStart={onSubjectDragStart}
          onDragOverDeparture={(id) => setDragOverDepartureId(id)}
          onDragLeaveDeparture={() => setDragOverDepartureId(null)}
          onDropOnDeparture={(event, departureId) => {
            event.preventDefault();
            event.stopPropagation();
            setDragOverDepartureId(null);
            const subject = parseDroppedSubject(event);
            if (!subject) {
              setPlannerError(
                "Drop failed — select someone, then click a tour (touch devices), or drag again.",
              );
              return;
            }
            void createAssignment(subject, departureId);
          }}
          onClickDeparture={(departureId) => {
            if (!selectedSubject) {
              setPlannerError(
                "Select a staff member or fleet asset on the left, then click a departure — or drag them onto a tour.",
              );
              return;
            }
            void createAssignment(selectedSubject, departureId);
          }}
          onConfirmOverride={() => void confirmOverride()}
          onCancelOverride={() => {
            setPendingOverride(null);
            setOverrideReason("");
          }}
          onRemoveAssignment={setPendingDelete}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove assignment?"
        description={
          pendingDelete
            ? `Remove ${
                pendingDelete.crew_name || pendingDelete.resource_name
              } (${label(pendingDelete.assignment_role)}) from this departure?`
            : undefined
        }
        confirmLabel="Remove"
        danger
        busy={remove.busy}
        error={remove.error}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function AssignmentPlannerSheet({
  session,
  busy,
  error,
  onClearError,
  weekStart,
  weekEnd,
  days,
  departures,
  assignmentsByDeparture,
  loading,
  loadError,
  products,
  productId,
  onProductIdChange,
  subjectKind,
  onSubjectKindChange,
  subjectSearch,
  onSubjectSearchChange,
  staffList,
  fleetList,
  canManageResources,
  selectedSubject,
  onSelectSubject,
  focusDepartureId,
  dragOverDepartureId,
  pendingOverride,
  overrideReason,
  onOverrideReasonChange,
  canOverride,
  onClose,
  onPrevWeek,
  onNextWeek,
  onSubjectDragStart,
  onDragOverDeparture,
  onDragLeaveDeparture,
  onDropOnDeparture,
  onClickDeparture,
  onConfirmOverride,
  onCancelOverride,
  onRemoveAssignment,
}: {
  session: Session;
  busy: boolean;
  error: string | null;
  onClearError: () => void;
  weekStart: string;
  weekEnd: string;
  days: string[];
  departures: Departure[];
  assignmentsByDeparture: Map<string, Assignment[]>;
  loading: boolean;
  loadError: string | null;
  products: Product[];
  productId: string;
  onProductIdChange: (value: string) => void;
  subjectKind: SubjectKind;
  onSubjectKindChange: (next: SubjectKind) => void;
  subjectSearch: string;
  onSubjectSearchChange: (value: string) => void;
  staffList: Crew[];
  fleetList: Resource[];
  canManageResources: boolean;
  selectedSubject: SubjectRef | null;
  onSelectSubject: (subject: SubjectRef | null) => void;
  focusDepartureId: string | null;
  dragOverDepartureId: string | null;
  pendingOverride: PendingOverride | null;
  overrideReason: string;
  onOverrideReasonChange: (value: string) => void;
  canOverride: boolean;
  onClose: () => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSubjectDragStart: (event: DragEvent, subject: SubjectRef) => void;
  onDragOverDeparture: (id: string) => void;
  onDragLeaveDeparture: () => void;
  onDropOnDeparture: (event: DragEvent, departureId: string) => void;
  onClickDeparture: (departureId: string) => void;
  onConfirmOverride: () => void;
  onCancelOverride: () => void;
  onRemoveAssignment: (item: Assignment) => void;
}) {
  const titleId = useId();
  const focusRef = useRef<HTMLElement | null>(null);
  const dragActiveRef = useRef(false);
  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [stackDays, setStackDays] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    const emptyMq = window.matchMedia("(max-width: 1200px)");
    const stackMq = window.matchMedia("(max-width: 680px)");
    const apply = () => {
      setHideEmptyDays(emptyMq.matches);
      setStackDays(stackMq.matches);
    };
    apply();
    emptyMq.addEventListener("change", apply);
    stackMq.addEventListener("change", apply);
    return () => {
      emptyMq.removeEventListener("change", apply);
      stackMq.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    if (!focusDepartureId || !focusRef.current) return;
    focusRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusDepartureId, departures]);

  const departuresByDay = useMemo(() => {
    const map = new Map<string, Departure[]>();
    for (const day of days) map.set(day, []);
    for (const departure of departures) {
      const day = localDateFromInstant(
        departure.starts_at,
        session.tenant.timezone,
      );
      const bucket = map.get(day);
      if (!bucket) continue;
      bucket.push(departure);
    }
    return map;
  }, [days, departures, session.tenant.timezone]);

  const visibleDays = useMemo(() => {
    if (!hideEmptyDays) return days;
    return days.filter((day) => (departuresByDay.get(day)?.length ?? 0) > 0);
  }, [days, departuresByDay, hideEmptyDays]);

  function renderSubjectRow(
    subject: SubjectRef,
    title: string,
    subtitle: string,
    icon: "crew" | "resource",
  ) {
    const selected =
      selectedSubject && subjectKey(selectedSubject) === subjectKey(subject);
    return (
      <li key={subjectKey(subject)}>
        <div
          role="option"
          aria-selected={Boolean(selected)}
          tabIndex={0}
          draggable
          className={
            "assignment-planner-subject" + (selected ? " selected" : "")
          }
          onDragStart={(e) => {
            dragActiveRef.current = true;
            onSubjectDragStart(e, subject);
          }}
          onDragEnd={() => {
            window.setTimeout(() => {
              dragActiveRef.current = false;
            }, 0);
          }}
          onClick={() => {
            if (dragActiveRef.current) return;
            onSelectSubject(selected ? null : subject);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectSubject(selected ? null : subject);
            }
          }}
        >
          <span className="catalog-assignment-chip-icon" aria-hidden>
            {icon === "crew" ? <UserRound size={14} /> : <Ship size={14} />}
          </span>
          <span>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
        </div>
      </li>
    );
  }

  return (
    <div
      className="confirm-dialog-root assignment-planner-root"
      role="presentation"
    >
      <div className="confirm-dialog-scrim" aria-hidden="true" />
      <div
        className="panel confirm-dialog-sheet form-dialog-sheet assignment-planner-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="confirm-dialog-head assignment-planner-head">
          <div className="assignment-planner-head-top">
            <h2 id={titleId}>Assign staff &amp; fleet</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              disabled={busy}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <div className="assignment-planner-head-meta">
            <p className="muted assignment-planner-help">
              Drag onto a tour, or select someone and click a departure. Roles
              come from Workspace role (staff) or asset type (fleet).
            </p>
            <label className="compact-control assignment-planner-tour-filter">
              <span className="visually-hidden">Tours</span>
              <select
                value={productId}
                onChange={(e) => onProductIdChange(e.target.value)}
                aria-label="Filter tours"
              >
                <option value="">All tours</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="assignment-planner-body">
          {(error || loadError) && (
            <div className="assignment-planner-banner" role="alert">
              <div className="assignment-planner-banner-copy">
                <Notice error>
                  {error || loadError}
                  {error?.includes("Document library") ||
                  error?.includes("Expired") ? (
                    <>
                      {" "}
                      <Link href="/document-library">Document library</Link>
                      {" · "}
                      <Link href="/team">Staff</Link>
                    </>
                  ) : null}
                </Notice>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss message"
                onClick={onClearError}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {pendingOverride && canOverride && (
            <div className="assignment-planner-override">
              <Notice>
                Expired:{" "}
                {pendingOverride.docs.map((d) => d.document_type).join(", ")}.
                Provide a safety override to continue.
              </Notice>
              <Field
                label="Override reason"
                required
                hint="Audited. Minimum 8 characters."
              >
                <textarea
                  required
                  minLength={8}
                  value={overrideReason}
                  onChange={(e) => onOverrideReasonChange(e.target.value)}
                  placeholder="Manager confirmed temporary replacement inspection."
                />
              </Field>
              <div className="assignment-planner-override-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={onCancelOverride}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || overrideReason.trim().length < 8}
                  onClick={onConfirmOverride}
                >
                  {busy ? "Assigning…" : "Assign with override"}
                </button>
              </div>
            </div>
          )}

          <div className="assignment-planner-grid">
            <aside className="assignment-planner-rail">
              <div className="assignment-planner-rail-toolbar">
                <div
                  className="view-tabs compact"
                  role="tablist"
                  aria-label="Subject type"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={subjectKind === "crew"}
                    onClick={() => onSubjectKindChange("crew")}
                  >
                    Staff
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={subjectKind === "resource"}
                    onClick={() => onSubjectKindChange("resource")}
                  >
                    Fleet
                  </button>
                </div>
                <label className="compact-control assignment-planner-search">
                  <span className="visually-hidden">Search</span>
                  <input
                    value={subjectSearch}
                    onChange={(e) => onSubjectSearchChange(e.target.value)}
                    placeholder={
                      subjectKind === "crew" ? "Name or role" : "Name or type"
                    }
                  />
                </label>
              </div>
              {!canManageResources ? (
                <p className="muted">
                  Listing staff and fleet requires resource management access.
                </p>
              ) : subjectKind === "crew" ? (
                staffList.length === 0 ? (
                  <Empty title="No staff to assign">
                    <p>
                      Add people under <Link href="/team">Staff</Link>.
                    </p>
                  </Empty>
                ) : (
                  <ul className="assignment-planner-subjects" role="listbox">
                    {staffList.map((person) =>
                      renderSubjectRow(
                        { kind: "crew", id: person.actor_id },
                        person.operational_name,
                        `${staffAssignmentRole(person)}${
                          person.email ? ` · ${person.email}` : ""
                        }`,
                        "crew",
                      ),
                    )}
                  </ul>
                )
              ) : fleetList.length === 0 ? (
                <Empty title="No fleet assets">
                  <p>
                    Add assets under <Link href="/resources">Fleet</Link>.
                  </p>
                </Empty>
              ) : (
                <ul className="assignment-planner-subjects" role="listbox">
                  {fleetList.map((asset) =>
                    renderSubjectRow(
                      { kind: "resource", id: asset.id },
                      asset.name,
                      `${fleetAssignmentRole(asset)} · ${asset.code}`,
                      "resource",
                    ),
                  )}
                </ul>
              )}
            </aside>

            <section className="assignment-planner-calendar">
              <div className="assignment-planner-weekbar">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Previous week"
                  onClick={onPrevWeek}
                >
                  <ChevronLeft size={18} />
                </button>
                <strong>
                  {formatMediumDateRange(
                    weekStart,
                    weekEnd,
                    session.tenant.config.locale,
                  )}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Next week"
                  onClick={onNextWeek}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              {loading ? (
                <Loading />
              ) : visibleDays.length === 0 ? (
                <Empty title="No tours this week">
                  <p>Try another week or clear the tours filter.</p>
                </Empty>
              ) : (
                <div
                  className={
                    "assignment-planner-days" + (stackDays ? " is-compact" : "")
                  }
                >
                  {visibleDays.map((day) => {
                    const dayItems = departuresByDay.get(day) ?? [];
                    return (
                      <div
                        key={day}
                        className={
                          "assignment-planner-day" +
                          (dayItems.length === 0 ? " is-empty" : "")
                        }
                      >
                        <h4>
                          {formatMediumDate(day, session.tenant.config.locale)}
                        </h4>
                        {dayItems.length === 0 ? (
                          <p className="muted assignment-planner-day-empty">
                            No tours
                          </p>
                        ) : (
                          dayItems.map((departure) => {
                            const assigned =
                              assignmentsByDeparture.get(departure.id) ?? [];
                            const isFocus = focusDepartureId === departure.id;
                            const isOver = dragOverDepartureId === departure.id;
                            const tint = tourTintIndex(
                              departure.product_id || departure.product_name,
                            );
                            return (
                              <article
                                key={departure.id}
                                ref={
                                  isFocus
                                    ? (node) => {
                                        focusRef.current = node;
                                      }
                                    : undefined
                                }
                                data-tint={tint}
                                className={
                                  "assignment-planner-tour" +
                                  (isFocus ? " is-focus" : "") +
                                  (isOver ? " is-over" : "") +
                                  (selectedSubject ? " is-droppable" : "")
                                }
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.dataTransfer.dropEffect = "copy";
                                  onDragOverDeparture(departure.id);
                                }}
                                onDragLeave={(e) => {
                                  const next = e.relatedTarget as Node | null;
                                  if (next && e.currentTarget.contains(next)) {
                                    return;
                                  }
                                  onDragLeaveDeparture();
                                }}
                                onDrop={(e) =>
                                  onDropOnDeparture(e, departure.id)
                                }
                                onClick={() => onClickDeparture(departure.id)}
                              >
                                <strong>{departure.product_name}</strong>
                                <small>
                                  {dateTime(
                                    departure.starts_at,
                                    session.tenant.timezone,
                                  )}{" "}
                                  · {departure.committed}/{departure.capacity}
                                  {coverageSuffix(
                                    fleetSeatCoverage(
                                      assigned,
                                      departure.committed,
                                    ),
                                  )}
                                </small>
                                {assigned.length > 0 && (
                                  <ul className="assignment-planner-tour-chips">
                                    {assigned.map((item) => {
                                      const name =
                                        item.crew_name || item.resource_name;
                                      const role = label(item.assignment_role);
                                      return (
                                        <li
                                          key={item.id}
                                          className={
                                            "catalog-assignment-badge" +
                                            (item.crew_actor_id
                                              ? " is-staff"
                                              : " is-fleet")
                                          }
                                          title={`${name} · ${role}`}
                                        >
                                          <span className="catalog-assignment-badge-name">
                                            {name}
                                          </span>
                                          <button
                                            type="button"
                                            className="catalog-assignment-badge-remove"
                                            aria-label={`Remove ${name}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onRemoveAssignment(item);
                                            }}
                                          >
                                            <X size={12} />
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </article>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Trash2,
  Check,
  X,
  ArrowRight,
  Pencil,
  Pause,
  Play,
  ListFilter,
  ShieldCheck,
  Building2,
  Globe2,
  Landmark,
  Printer,
  CreditCard,
  Plug,
  FileText,
  Ship,
  Hotel,
  Lock,
  Handshake,
  MoreHorizontal,
  UserRound,
  Phone,
  MapPin,
  MailPlus,
  Ban,
  RotateCcw,
} from "lucide-react";
import type {
  Session,
  Product,
  Member,
  AvailabilityRule,
  Partner,
} from "@/lib/types";
import { availabilityModes, modeLabel, weekdayLabels } from "@/lib/types";
import { COUNTRIES } from "@/lib/countries";
import {
  api,
  dateOnly,
  dateTime,
  digits,
  formatMediumDateRange,
  label,
  minor,
  money,
  priceFromMinor,
  useMutation,
  usePaged,
  useResource,
  downloadApiFile,
} from "@/lib/client";
import {
  Back,
  ConfirmDialog,
  Empty,
  Field,
  FormActions,
  FormDialog,
  Heading,
  Loading,
  More,
  Notice,
  SectionHeading,
  Status,
  TenantDateInput,
  Toggle,
} from "./common";
import { Integrations } from "./integrations";
import { ScheduleFormDialog } from "./schedule-form-dialog";
import { CatalogSchedulesPanel, SchedulesFilterButton } from "./catalog-schedules";
import type { ScheduleListFilters } from "./catalog-schedules";
import { CatalogAssignmentsPanel } from "./catalog-assignments";
import {
  type ComplianceDocument,
  type LibraryUsage,
  StaffDocumentAddFields,
  StaffDocumentArchive,
  uploadComplianceDocument,
} from "./document-library";

function catalogTab(
  router: { replace: (href: string, options?: { scroll?: boolean }) => void },
  next: "products" | "schedules" | "assignments",
  productId?: string,
) {
  const params = new URLSearchParams();
  if (next === "schedules") params.set("tab", "schedules");
  if (next === "assignments") params.set("tab", "assignments");
  if (productId) params.set("product", productId);
  const query = params.toString();
  router.replace(query ? `/catalog?${query}` : "/catalog", { scroll: false });
}
const SETTINGS_TABS = new Set([
  "general",
  "localization",
  "commercial",
  "printers",
  "stays",
  "resellers",
  "payments",
  "waivers",
  "integrations",
  "security",
]);
function settingsTab(next: string) {
  const url = new URL(window.location.href);
  if (next === "general") url.searchParams.delete("tab");
  else url.searchParams.set("tab", next);
  window.history.replaceState(null, "", url.pathname + url.search);
}
function durationHint(minutes: string) {
  const value = Number(minutes);
  if (!value || value < 1)
    return "Used for itinerary length and departure end time.";
  if (value < 60) return `${value} minutes`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!rest) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours}h ${rest}m`;
}
function localWhen(
  value: string,
  locale: string,
  timezone: string,
  withTime = true,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: timezone,
  }).format(new Date(value));
}

export function Catalog({ session }: { session: Session }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = tenantDay(session.tenant.timezone);
  const products = useResource<Product[]>("admin/v1/products"),
    rules = useResource<AvailabilityRule[]>("admin/v1/availability-rules"),
    [scheduleModalOpen, setScheduleModalOpen] = useState(false),
    [scheduleFilters, setScheduleFilters] = useState<ScheduleListFilters>({
      search: "",
      status: "all",
      range: "any",
      customFrom: today,
      customTo: shiftDay(today, 13),
    });
  const tab = searchParams.get("tab");
  const view =
    tab === "schedules" || tab === "availability"
      ? "schedules"
      : tab === "assignments"
        ? "assignments"
        : "products";
  const scheduleProductId = searchParams.get("product") ?? "";
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setScheduleModalOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    const query = params.toString();
    router.replace(query ? `/catalog?${query}` : "/catalog", { scroll: false });
  }, [searchParams, router]);
  const canWrite = session.permissions.includes("catalog.write");
  const canAssign = session.permissions.includes("assignments.write");
  const items = products.data ?? [];
  const active =
    products.data?.filter((p) => (p.status ?? "active") === "active").length ??
    0;
  const scheduleRows = (rules.data ?? []).filter(
    (rule) => !scheduleProductId || rule.product_id === scheduleProductId,
  );
  const scheduled = scheduleRows.reduce(
    (sum, rule) => sum + rule.upcoming_departures,
    0,
  );
  function show(next: "products" | "schedules" | "assignments") {
    catalogTab(
      router,
      next,
      next === "schedules" ? scheduleProductId || undefined : undefined,
    );
  }
  function clearScheduleFilter() {
    catalogTab(router, "schedules");
  }
  function setScheduleProductFilter(nextProductId: string) {
    catalogTab(router, "schedules", nextProductId || undefined);
  }
  return (
    <>
      <Heading
        title="Catalog"
        description="The experiences you sell, when they run, and who or what is assigned to each departure."
      />
      <div className="catalog-metrics" aria-label="Catalog summary">
        <div>
          <strong>{products.data ? products.data.length : "—"}</strong>
          <span>Products</span>
        </div>
        <div>
          <strong>{products.data ? active : "—"}</strong>
          <span>Active</span>
        </div>
        <div>
          <strong>{rules.data ? rules.data.length : "—"}</strong>
          <span>Schedules</span>
        </div>
        <div>
          <strong>{rules.data ? scheduled : "—"}</strong>
          <span>Upcoming departures</span>
        </div>
      </div>
      <div className="catalog-view-bar view-action-bar">
        <div
          className="view-tabs compact"
          role="tablist"
          aria-label="Catalog views"
        >
          <button
            role="tab"
            aria-selected={view === "products"}
            onClick={() => show("products")}
          >
            Products
          </button>
          <button
            role="tab"
            aria-selected={view === "schedules"}
            onClick={() => show("schedules")}
          >
            Schedules
          </button>
          {canAssign && (
            <button
              role="tab"
              aria-selected={view === "assignments"}
              onClick={() => show("assignments")}
            >
              Assignments
            </button>
          )}
        </div>
        {view === "products" ? (
          canWrite ? (
            <Link
              href="/catalog/new"
              className="button catalog-add-btn"
              aria-label="Add product"
            >
              <Plus size={17} />
              <span className="button-label">Add product</span>
            </Link>
          ) : null
        ) : view === "schedules" ? (
          <div className="catalog-view-actions departure-view-actions">
            <SchedulesFilterButton
              products={items}
              productId={scheduleProductId}
              filters={scheduleFilters}
              timezone={session.tenant.timezone}
              locale={session.tenant.config.locale}
              dateFormat={session.tenant.config.dateFormat}
              onFiltersChange={setScheduleFilters}
              onProductFilter={setScheduleProductFilter}
              onClearProductFilter={clearScheduleFilter}
            />
            {canWrite ? (
              <button
                type="button"
                className="button catalog-add-btn"
                aria-label="Add schedule"
                onClick={() => setScheduleModalOpen(true)}
              >
                <Plus size={17} />
                <span className="button-label">Add schedule</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {products.error ? (
        <Notice error>{products.error}</Notice>
      ) : !products.data ? (
        <Loading />
      ) : view === "products" ? (
        <>
          {items.length ? (
            <section className="panel product-list">
              {items.map((p) => {
                const scheduledProduct =
                  (p.availability_mode ?? "fixed_departure") ===
                  "fixed_departure";
                return (
                  <article
                    className={
                      "product-row" +
                      (canWrite && scheduledProduct ? " has-action" : "")
                    }
                    key={p.id}
                  >
                    <Link
                      href={`/catalog/${p.id}`}
                      className="product-row-main"
                    >
                      <div className="product-row-copy">
                        <div className="product-row-meta">
                          <span className="kind-chip">
                            {label(p.product_kind ?? "tour")}
                          </span>
                          <Status state={p.status ?? "active"} />
                        </div>
                        <h2>{p.customer_title ?? p.name}</h2>
                        <p>
                          {p.definition.optionName} ·{" "}
                          {durationHint(String(p.definition.durationMinutes))} ·{" "}
                          {modeLabel(p.availability_mode)}
                        </p>
                      </div>
                      <div className="product-row-when">
                        <span>
                          {scheduledProduct
                            ? "Next departure"
                            : "Selling model"}
                        </span>
                        <strong>
                          {p.next_departure_at
                            ? localWhen(
                                p.next_departure_at,
                                session.tenant.config.locale,
                                session.tenant.timezone,
                              )
                            : scheduledProduct
                              ? "None scheduled"
                              : modeLabel(p.availability_mode)}
                        </strong>
                        <small>
                          {p.availability_rule_count ?? 0}{" "}
                          {(p.availability_rule_count ?? 0) === 1
                            ? "schedule"
                            : "schedules"}
                        </small>
                      </div>
                      <div className="product-row-price">
                        <span>From</span>
                        <strong>
                          {priceFromMinor(p) != null
                            ? money(
                                priceFromMinor(p)!,
                                session.tenant.config.bookingCurrency,
                                session.tenant.config.locale,
                              )
                            : "No rate"}
                        </strong>
                      </div>
                    </Link>
                    {canWrite && scheduledProduct && (
                      <Link
                        className="product-row-action"
                        href={"/catalog?tab=schedules&product=" + p.id}
                      >
                        Schedule
                        <ArrowRight size={16} />
                      </Link>
                    )}
                  </article>
                );
              })}
            </section>
          ) : (
            <Empty title="Your catalog is empty">
              {canWrite && (
                <Link href="/catalog/new">Add your first product</Link>
              )}
            </Empty>
          )}
          {products.data.length === 100 && (
            <Notice>This catalog view shows up to 100 products.</Notice>
          )}
        </>
      ) : view === "assignments" ? (
        <CatalogAssignmentsPanel session={session} products={items} />
      ) : rules.error ? (
        <Notice error>{rules.error}</Notice>
      ) : !rules.data ? (
        <Loading />
      ) : (
        <CatalogSchedulesPanel
          session={session}
          products={items}
          rules={rules.data}
          error={rules.error || undefined}
          productId={scheduleProductId}
          filters={scheduleFilters}
          canWrite={canWrite}
          onClearProductFilter={clearScheduleFilter}
          onAdd={() => setScheduleModalOpen(true)}
          onReload={() => rules.reload()}
        />
      )}
      {canWrite && view !== "assignments" && (
        <ScheduleFormDialog
          session={session}
          open={scheduleModalOpen}
          productId={scheduleProductId || undefined}
          onClose={() => setScheduleModalOpen(false)}
          onCreated={() => {
            setScheduleModalOpen(false);
            rules.reload();
          }}
        />
      )}
    </>
  );
}

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
type CategoryDraft = {
  id: string;
  slug: string;
  label: string;
  countsTowardCapacity: boolean;
};
type PeriodDraft = {
  id: string;
  startDate: string;
  endDate: string;
  amounts: Record<string, string>;
};
function categoryId() {
  return crypto.randomUUID();
}
function periodId() {
  return crypto.randomUUID();
}
const starterCategories: CategoryDraft[] = [
  { id: "adult", slug: "adult", label: "Adult", countsTowardCapacity: true },
  { id: "child", slug: "child", label: "Child", countsTowardCapacity: true },
  {
    id: "infant",
    slug: "infant",
    label: "Infant",
    countsTowardCapacity: false,
  },
];
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
function zeroAmount(currency: string) {
  const places = digits(currency);
  return places === 0 ? "0" : (0).toFixed(places);
}
function amountInput(amountMinor: number, currency: string) {
  return (amountMinor / 10 ** digits(currency)).toFixed(digits(currency));
}
function formatAmountDraft(value: string, currency: string) {
  try {
    return amountInput(minor(value.trim() || "0", currency), currency);
  } catch {
    return zeroAmount(currency);
  }
}
function emptyAmounts(
  categories: CategoryDraft[],
  previous: Record<string, string> = {},
  currency?: string,
) {
  const fallback = currency ? zeroAmount(currency) : "";
  return Object.fromEntries(
    categories.map((category) => [
      category.slug,
      previous[category.slug] ?? fallback,
    ]),
  );
}
function sanitizeCategories(categories: CategoryDraft[]) {
  return categories.map(({ slug, label, countsTowardCapacity }) => ({
    slug,
    label,
    countsTowardCapacity,
  }));
}
function periodsFromRates(
  categories: CategoryDraft[],
  rates: {
    category: string;
    startDate: string;
    endDate: string;
    amountMinor: number;
  }[],
  currency: string,
  fallbackStart: string,
): PeriodDraft[] {
  const groups = new Map<string, PeriodDraft>();
  for (const rate of rates) {
    const key = `${rate.startDate}:${rate.endDate}`;
    const current = groups.get(key) ?? {
      id: periodId(),
      startDate: rate.startDate,
      endDate: rate.endDate,
      amounts: emptyAmounts(categories, {}, currency),
    };
    current.amounts[rate.category] = amountInput(rate.amountMinor, currency);
    groups.set(key, current);
  }
  return groups.size
    ? [...groups.values()]
    : [
        {
          id: periodId(),
          startDate: fallbackStart,
          endDate: shiftDay(fallbackStart, 364),
          amounts: emptyAmounts(categories, {}, currency),
        },
      ];
}
function collectRates(
  categories: CategoryDraft[],
  periods: PeriodDraft[],
  currency: string,
) {
  return periods.flatMap((period) =>
    categories.map((category) => ({
      category: category.slug,
      startDate: period.startDate,
      endDate: period.endDate,
      amountMinor: minor(
        period.amounts[category.slug]?.trim() || "0",
        currency,
      ),
    })),
  );
}
function PricingEditor({
  session,
  productId,
  categories,
  periods,
  onCategories,
  onPeriods,
}: {
  session: Session;
  productId?: string;
  categories: CategoryDraft[];
  periods: PeriodDraft[];
  onCategories: (categories: CategoryDraft[]) => void;
  onPeriods: (periods: PeriodDraft[]) => void;
}) {
  const currency = session.tenant.config.bookingCurrency;
  const today = tenantDay(session.tenant.timezone);
  const [categoryModal, setCategoryModal] = useState<
    null | { mode: "add" } | { mode: "edit"; index: number }
  >(null);
  const [periodModal, setPeriodModal] = useState<
    null | { mode: "add" } | { mode: "edit"; index: number }
  >(null);
  const [deletePeriod, setDeletePeriod] = useState<PeriodDraft | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [catLabel, setCatLabel] = useState("");
  const [catSlug, setCatSlug] = useState("");
  const [catSeats, setCatSeats] = useState(true);
  const [catRate, setCatRate] = useState("");
  const [periodStart, setPeriodStart] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(() => shiftDay(today, 364));
  const [periodAmounts, setPeriodAmounts] = useState<Record<string, string>>(
    {},
  );
  const [modalError, setModalError] = useState("");

  function openAddCategory() {
    setCatLabel("");
    setCatSlug("");
    setCatSeats(true);
    setCatRate(zeroAmount(currency));
    setModalError("");
    setCategoryModal({ mode: "add" });
  }
  function openEditCategory(index: number) {
    const category = categories[index]!;
    setCatLabel(category.label);
    setCatSlug(category.slug);
    setCatSeats(category.countsTowardCapacity);
    const sample = periods[0]?.amounts[category.slug];
    setCatRate(sample ?? zeroAmount(currency));
    setModalError("");
    setCategoryModal({ mode: "edit", index });
  }
  function saveCategory() {
    const labelValue = catLabel.trim();
    const slugValue = catSlug.trim() || slugify(labelValue);
    if (!labelValue || !/^[a-z][a-z0-9_-]{1,49}$/.test(slugValue)) {
      setModalError("Enter a label and a valid identifier code.");
      return;
    }
    if (
      categories.some(
        (category, i) =>
          category.slug === slugValue &&
          !(categoryModal?.mode === "edit" && categoryModal.index === i),
      )
    ) {
      setModalError("That identifier is already used.");
      return;
    }
    const rateValue = formatAmountDraft(catRate, currency);
    if (categoryModal?.mode === "add") {
      const added: CategoryDraft = {
        id: categoryId(),
        label: labelValue,
        slug: slugValue,
        countsTowardCapacity: catSeats,
      };
      const nextCategories = [...categories, added];
      onCategories(nextCategories);
      if (!periods.length) {
        onPeriods([
          {
            id: periodId(),
            startDate: today,
            endDate: shiftDay(today, 364),
            amounts: { [slugValue]: rateValue },
          },
        ]);
      } else {
        onPeriods(
          periods.map((period) => ({
            ...period,
            amounts: {
              ...emptyAmounts(nextCategories, period.amounts, currency),
              [slugValue]: rateValue,
            },
          })),
        );
      }
    } else if (categoryModal?.mode === "edit") {
      const index = categoryModal.index;
      const previous = categories[index]!.slug;
      const nextCategories = categories.map((category, i) =>
        i === index
          ? {
              ...category,
              label: labelValue,
              slug: slugValue,
              countsTowardCapacity: catSeats,
            }
          : category,
      );
      onCategories(nextCategories);
      onPeriods(
        periods.map((period) => {
          const amounts = emptyAmounts(nextCategories, period.amounts, currency);
          amounts[slugValue] =
            rateValue ||
            period.amounts[previous] ||
            amounts[slugValue] ||
            zeroAmount(currency);
          if (previous !== slugValue) delete amounts[previous];
          return { ...period, amounts };
        }),
      );
    }
    setCategoryModal(null);
  }
  function removeCategory(index: number) {
    if (categories.length <= 1) return;
    const category = categories[index]!;
    onCategories(categories.filter((_, i) => i !== index));
    onPeriods(
      periods.map((period) => {
        const amounts = { ...period.amounts };
        delete amounts[category.slug];
        return { ...period, amounts };
      }),
    );
  }
  function openAddPeriod() {
    const last = periods[periods.length - 1];
    setPeriodStart(
      last ? shiftDay(last.endDate, 1) : tenantDay(session.tenant.timezone),
    );
    setPeriodEnd(
      last
        ? shiftDay(last.endDate, 181)
        : shiftDay(tenantDay(session.tenant.timezone), 364),
    );
    setPeriodAmounts(emptyAmounts(categories, last?.amounts, currency));
    setModalError("");
    setPeriodModal({ mode: "add" });
  }
  function openEditPeriod(index: number) {
    const period = periods[index]!;
    setPeriodStart(period.startDate);
    setPeriodEnd(period.endDate);
    setPeriodAmounts(emptyAmounts(categories, period.amounts, currency));
    setModalError("");
    setPeriodModal({ mode: "edit", index });
  }
  function savePeriod() {
    if (!periodStart || !periodEnd || periodEnd < periodStart) {
      setModalError("Enter a valid date range.");
      return;
    }
    const amounts = Object.fromEntries(
      categories.map((category) => [
        category.slug,
        formatAmountDraft(
          periodAmounts[category.slug] ?? zeroAmount(currency),
          currency,
        ),
      ]),
    );
    if (periodModal?.mode === "add") {
      onPeriods([
        ...periods,
        {
          id: periodId(),
          startDate: periodStart,
          endDate: periodEnd,
          amounts,
        },
      ]);
    } else if (periodModal?.mode === "edit") {
      onPeriods(
        periods.map((period, i) =>
          i === periodModal.index
            ? {
                ...period,
                startDate: periodStart,
                endDate: periodEnd,
                amounts,
              }
            : period,
        ),
      );
    }
    setPeriodModal(null);
  }
  async function confirmDeletePeriod() {
    if (!deletePeriod) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      if (productId) {
        const query = new URLSearchParams({
          startDate: deletePeriod.startDate,
          endDate: deletePeriod.endDate,
        });
        const usage = await api<{ holds: number; bookings: number }>(
          `admin/v1/products/${productId}/rate-window-usage?${query}`,
        );
        if (usage.holds > 0 || usage.bookings > 0) {
          setDeleteError(
            `Cannot delete: ${usage.bookings} booking(s) and ${usage.holds} hold(s) use this window.`,
          );
          setDeleteBusy(false);
          return;
        }
      }
      onPeriods(periods.filter((period) => period.id !== deletePeriod.id));
      setDeletePeriod(null);
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <SectionHeading
        title="Passenger categories"
        description="Who can be booked. Removing a category hides it from new reservations; confirmed prices stay frozen."
        action={
          <button
            type="button"
            className="button secondary"
            disabled={categories.length >= 10}
            onClick={openAddCategory}
          >
            <Plus size={16} />
            Add category
          </button>
        }
      />
      <div className="table-scroll">
        <table className="data-table editor-data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Identifier</th>
              <th>Seats</th>
              <th>Default rate</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category, index) => (
              <tr key={category.id}>
                <td>{category.label || "—"}</td>
                <td>
                  <code>{category.slug || "—"}</code>
                </td>
                <td>{category.countsTowardCapacity ? "Yes" : "No"}</td>
                <td>
                  {periods[0]?.amounts[category.slug]
                    ? `${periods[0].amounts[category.slug]} ${currency}`
                    : "—"}
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="icon-link"
                    aria-label={`Edit ${category.label || "category"}`}
                    onClick={() => openEditCategory(index)}
                  >
                    <Pencil size={16} />
                  </button>
                  {categories.length > 1 ? (
                    <button
                      type="button"
                      className="icon-link danger"
                      aria-label={`Remove ${category.label || "category"}`}
                      onClick={() => removeCategory(index)}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionHeading
        title="Seasonal rates"
        description="Special or seasonal prices for a date window. Future bookings use the period that covers the departure date."
        action={
          <button
            type="button"
            className="button secondary"
            disabled={periods.length >= 20 || !categories.length}
            onClick={openAddPeriod}
          >
            <Plus size={16} />
            Add rate period
          </button>
        }
      />
      <div className="table-scroll">
        <table className="data-table editor-data-table">
          <thead>
            <tr>
              <th>Starts</th>
              <th>Ends</th>
              <th>Rates</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period, index) => (
              <tr key={period.id}>
                <td>
                  {dateOnly(
                    period.startDate,
                    session.tenant.config.dateFormat,
                    session.tenant.config.locale,
                  )}
                </td>
                <td>
                  {dateOnly(
                    period.endDate,
                    session.tenant.config.dateFormat,
                    session.tenant.config.locale,
                  )}
                </td>
                <td>
                  {categories
                    .map((category) => {
                      const amount = period.amounts[category.slug];
                      return amount
                        ? `${category.label || category.slug} ${amount}`
                        : null;
                    })
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="icon-link"
                    aria-label={`Edit rate period ${index + 1}`}
                    onClick={() => openEditPeriod(index)}
                  >
                    <Pencil size={16} />
                  </button>
                  {periods.length > 1 ? (
                    <button
                      type="button"
                      className="icon-link danger"
                      aria-label={`Remove rate period ${index + 1}`}
                      onClick={() => {
                        setDeleteError("");
                        setDeletePeriod(period);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormDialog
        open={Boolean(categoryModal)}
        title={
          categoryModal?.mode === "edit" ? "Edit category" : "Add category"
        }
        description="Set who can be booked and a default rate for seasonal periods."
        error={modalError}
        submitLabel="Save category"
        onClose={() => setCategoryModal(null)}
        onSubmit={saveCategory}
      >
        <Field label="Category label">
          <input
            required
            placeholder="e.g. Adult, Child"
            value={catLabel}
            onChange={(e) => {
              setCatLabel(e.target.value);
              if (categoryModal?.mode === "add")
                setCatSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Identifier code">
          <input
            required
            className="mono-input"
            placeholder="e.g. adult"
            pattern="[a-z][a-z0-9_\-]{1,49}"
            value={catSlug}
            onChange={(e) => setCatSlug(e.target.value)}
          />
        </Field>
        <Toggle
          className="toggle-inline"
          label="Counts toward seats"
          checked={catSeats}
          onChange={setCatSeats}
        />
        <Field label={`Default rate (${currency})`}>
          <input
            required
            className="amount-input"
            inputMode="decimal"
            value={catRate}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCatRate(e.target.value)}
            onBlur={(e) =>
              setCatRate(formatAmountDraft(e.target.value, currency))
            }
          />
        </Field>
      </FormDialog>
      <FormDialog
        open={Boolean(periodModal)}
        title={
          periodModal?.mode === "edit" ? "Edit rate period" : "Add rate period"
        }
        description="Prices apply to departures whose local date falls in this window."
        error={modalError}
        submitLabel="Save period"
        onClose={() => setPeriodModal(null)}
        onSubmit={savePeriod}
      >
        <div className="form-grid">
          <TenantDateInput
            label="Period starts"
            value={periodStart}
            max={periodEnd || undefined}
            onChange={setPeriodStart}
            locale={session.tenant.config.locale}
            dateFormat={session.tenant.config.dateFormat}
          />
          <TenantDateInput
            label="Period ends"
            value={periodEnd}
            min={periodStart || undefined}
            onChange={setPeriodEnd}
            locale={session.tenant.config.locale}
            dateFormat={session.tenant.config.dateFormat}
          />
        </div>
        {categories.map((category) => (
          <Field
            key={category.id}
            label={`${category.label || category.slug} (${currency})`}
          >
            <input
              required
              className="amount-input"
              inputMode="decimal"
              value={
                periodAmounts[category.slug] ?? zeroAmount(currency)
              }
              onFocus={(e) => e.target.select()}
              onChange={(e) =>
                setPeriodAmounts((current) => ({
                  ...current,
                  [category.slug]: e.target.value,
                }))
              }
              onBlur={(e) =>
                setPeriodAmounts((current) => ({
                  ...current,
                  [category.slug]: formatAmountDraft(
                    e.target.value,
                    currency,
                  ),
                }))
              }
            />
          </Field>
        ))}
      </FormDialog>
      <ConfirmDialog
        open={Boolean(deletePeriod)}
        title="Delete rate period?"
        description="This removes the seasonal window from the product draft. Confirmed booking prices stay frozen. Delete is blocked if holds or bookings exist in this date range."
        confirmLabel="Delete period"
        danger
        busy={deleteBusy}
        error={deleteError}
        onClose={() => setDeletePeriod(null)}
        onConfirm={() => void confirmDeletePeriod()}
      />
    </>
  );
}

export function NewProduct({ session }: { session: Session }) {
  const today = tenantDay(session.tenant.timezone);
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [productKind, setProductKind] = useState("tour"),
    [availabilityMode, setAvailabilityMode] = useState("fixed_departure"),
    [option, setOption] = useState("Standard"),
    [duration, setDuration] = useState("180"),
    [pricingModel, setPricingModel] = useState("per_person"),
    [privateBooking, setPrivateBooking] = useState(false),
    [confirmationMode, setConfirmationMode] = useState("instant"),
    [error, setError] = useState(""),
    [categories, setCategories] = useState(starterCategories),
    [periods, setPeriods] = useState<PeriodDraft[]>([
      {
        id: periodId(),
        startDate: today,
        endDate: shiftDay(today, 364),
        amounts: emptyAmounts(
          starterCategories,
          {},
          session.tenant.config.bookingCurrency,
        ),
      },
    ]);
  const mutation = useMutation(),
    router = useRouter();
  const mode =
    availabilityModes[availabilityMode as keyof typeof availabilityModes];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await mutation.run("admin/v1/products", {
        name,
        description,
        productKind,
        availabilityMode,
        optionName: option,
        durationMinutes: Number(duration),
        pricingModel,
        privateBooking,
        confirmationMode,
        categories: sanitizeCategories(categories),
        rates: collectRates(
          categories,
          periods,
          session.tenant.config.bookingCurrency,
        ),
      });
      if (result)
        router.push(`/catalog/${(result as { productId: string }).productId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  let fromAmount: number | null = null;
  try {
    const amounts = collectRates(
      categories,
      periods,
      session.tenant.config.bookingCurrency,
    )
      .map((rate) => rate.amountMinor)
      .filter((amount) => amount > 0);
    fromAmount = amounts.length ? Math.min(...amounts) : null;
  } catch {
    fromAmount = null;
  }
  return (
    <>
      <Back href="/catalog">Catalog</Back>
      <div className="product-header-bar">
        <div>
          <div className="product-header-badges">
            <span className="kind-chip">{label(productKind)}</span>
            <span className="badge">{mode?.label ?? "Fixed departure"}</span>
            {fromAmount != null && (
              <span className="price-pill-badge">
                From{" "}
                {money(
                  fromAmount,
                  session.tenant.config.bookingCurrency,
                  session.tenant.config.locale,
                )}
              </span>
            )}
          </div>
          <div className="product-header-title-row">
            <h1>{name.trim() || "Add a product"}</h1>
          </div>
          <p className="product-header-subtitle">
            Configure sellable options, passenger categories, and seasonal
            rates.
          </p>
        </div>
        <div className="product-header-actions">
          <Link
            href="/catalog"
            className="button secondary"
            aria-label="Cancel"
          >
            <X size={16} />
            <span className="button-label">Cancel</span>
          </Link>
          <button
            type="submit"
            form="new-product-form"
            className="button"
            disabled={mutation.busy}
            aria-label={mutation.busy ? "Creating" : "Create product"}
          >
            <span className="button-label">
              {mutation.busy ? "Creating…" : "Create product"}
            </span>
            <Check size={16} />
          </button>
        </div>
      </div>
      <form
        id="new-product-form"
        className="product-editor-layout"
        onSubmit={submit}
      >
        <div className="editor-stack">
          <section className="editor-section">
            <SectionHeading
              title="Offer & settings"
              description="Customer-facing title, operational duration, and booking rules."
            />
            <div className="offer-grid">
              <div className="col-span-2">
                <Field label="Customer-facing name">
                  <input
                    required
                    maxLength={120}
                    placeholder="e.g. Island Discovery Cruise"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Product type">
                <select
                  value={productKind}
                  onChange={(e) => setProductKind(e.target.value)}
                >
                  <option value="tour">Tour</option>
                  <option value="activity">Activity</option>
                  <option value="experience">Experience</option>
                  <option value="charter">Private charter</option>
                  <option value="transport">Transport</option>
                  <option value="rental">Rental</option>
                  <option value="ticket">Ticket</option>
                </select>
              </Field>
              <Field
                label="Option name"
                hint="The first sellable variant, such as Standard or Morning."
              >
                <input
                  required
                  maxLength={120}
                  value={option}
                  onChange={(e) => setOption(e.target.value)}
                />
              </Field>
              <Field label="Duration · minutes" hint={durationHint(duration)}>
                <input
                  type="number"
                  min="1"
                  max="10080"
                  required
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
              <Field label="Availability model" hint={mode?.summary}>
                <select
                  value={availabilityMode}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAvailabilityMode(next);
                    if (next === "resource_window" || next === "on_request") {
                      setPrivateBooking(true);
                      setConfirmationMode("request");
                    }
                  }}
                >
                  {(
                    Object.keys(availabilityModes) as Array<
                      keyof typeof availabilityModes
                    >
                  ).map((item) => (
                    <option key={item} value={item}>
                      {availabilityModes[item].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pricing model">
                <select
                  value={pricingModel}
                  onChange={(e) => setPricingModel(e.target.value)}
                >
                  <option value="per_person">Per person</option>
                  <option value="per_group">Per group</option>
                  <option value="per_unit">Per unit / resource</option>
                </select>
              </Field>
              <Field label="Confirmation">
                <select
                  value={confirmationMode}
                  onChange={(e) => setConfirmationMode(e.target.value)}
                >
                  <option value="instant">Instant confirmation</option>
                  <option value="request">Operator approval required</option>
                </select>
              </Field>
              <div className="col-span-full">
                <Toggle
                  className="toggle-card"
                  label="Reserve for one private party"
                  description="Whole-boat, exclusive charter, or private group booking. Blocks the departure for a single group."
                  checked={privateBooking}
                  onChange={setPrivateBooking}
                />
              </div>
              <div className="col-span-full">
                <Field label="Short description">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="Brief highlights or requirements shown to guests and reservation staff…"
                  />
                </Field>
              </div>
            </div>
            {availabilityMode !== "fixed_departure" && (
              <Notice>
                {mode?.label} will not generate dated seat holds. Add the
                product first; a dedicated availability editor comes with that
                booking flow.
              </Notice>
            )}
          </section>
          <section className="editor-section">
            <PricingEditor
              session={session}
              categories={categories}
              periods={periods}
              onCategories={setCategories}
              onPeriods={setPeriods}
            />
          </section>
          {(error || mutation.error) && (
            <Notice error>{error || mutation.error}</Notice>
          )}
          <div className="editor-actions-bar">
            <Link
              href="/catalog"
              className="button secondary"
              aria-label="Cancel"
            >
              <X size={16} />
              <span className="button-label">Cancel</span>
            </Link>
            <button
              type="submit"
              className="button"
              disabled={mutation.busy}
              aria-label={mutation.busy ? "Creating" : "Create product"}
            >
              <span className="button-label">
                {mutation.busy ? "Creating…" : "Create product"}
              </span>
              <Check size={16} />
            </button>
          </div>
        </div>
        <aside className="product-preview" aria-live="polite">
          <div className="product-preview-card">
            <span className="kind-chip">{label(productKind)}</span>
            <h2>{name || "Untitled product"}</h2>
            <p>
              {option || "First option"} · {durationHint(duration)}
            </p>
            <div className="product-preview-price">
              <span>From</span>
              <strong>
                {fromAmount != null
                  ? money(
                      fromAmount,
                      session.tenant.config.bookingCurrency,
                      session.tenant.config.locale,
                    )
                  : "Enter rates"}
              </strong>
            </div>
            <ul className="product-preview-facts">
              <li>
                <span>Sold as</span>
                <strong>{mode?.label ?? "Choose a model"}</strong>
              </li>
              <li>
                <span>Categories</span>
                <strong>
                  {categories
                    .map((category) => category.label)
                    .filter(Boolean)
                    .join(" · ") || "Add categories"}
                </strong>
              </li>
              <li>
                <span>Rate periods</span>
                <strong>
                  {periods.length} {periods.length === 1 ? "window" : "windows"}
                </strong>
              </li>
            </ul>
            <p className="muted">
              {availabilityMode === "fixed_departure"
                ? "After saving, add the recurring local-time rule that creates departures."
                : mode?.summary}
            </p>
          </div>
        </aside>
      </form>
    </>
  );
}
export function NewSchedule({ session }: { session: Session }) {
  void session;
  const router = useRouter();
  useEffect(() => {
    const product = new URLSearchParams(window.location.search).get("product");
    const params = new URLSearchParams({ tab: "schedules", new: "1" });
    if (product) params.set("product", product);
    router.replace(`/catalog?${params}`);
  }, [router]);
  return (
    <>
      <Heading
        title="Add schedule"
        description="Opening the schedule editor…"
      />
      <Loading />
    </>
  );
}

export function ProductDetail({
  session,
  productId,
}: {
  session: Session;
  productId: string;
}) {
  const product = useResource<Product>(`admin/v1/products/${productId}`);
  const rules = useResource<AvailabilityRule[]>("admin/v1/availability-rules");
  const mutation = useMutation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("active");
  const [productKind, setProductKind] = useState("tour");
  const [option, setOption] = useState("");
  const [duration, setDuration] = useState("120");
  const [pricingModel, setPricingModel] = useState("per_person");
  const [privateBooking, setPrivateBooking] = useState(false);
  const [confirmationMode, setConfirmationMode] = useState("instant");
  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [periods, setPeriods] = useState<PeriodDraft[]>([]);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  useEffect(() => {
    if (!product.data) return;
    const definition = product.data.definition;
    const nextCategories = (definition.categories ?? []).map((category) => ({
      id: categoryId(),
      slug: category.slug,
      label: category.label,
      countsTowardCapacity: category.countsTowardCapacity,
    }));
    setName(product.data.customer_title ?? product.data.name);
    setDescription(product.data.description ?? definition.description ?? "");
    setStatus(product.data.status ?? "active");
    setProductKind(
      product.data.product_kind ?? definition.productKind ?? "tour",
    );
    setOption(definition.optionName ?? "");
    setDuration(String(definition.durationMinutes ?? 120));
    setPricingModel(definition.pricingModel ?? "per_person");
    setPrivateBooking(Boolean(definition.privateBooking));
    setConfirmationMode(definition.confirmationMode ?? "instant");
    setCategories(nextCategories);
    setPeriods(
      periodsFromRates(
        nextCategories,
        definition.rates ?? [],
        session.tenant.config.bookingCurrency,
        tenantDay(session.tenant.timezone),
      ),
    );
  }, [
    product.data,
    session.tenant.config.bookingCurrency,
    session.tenant.timezone,
  ]);
  const canWrite = session.permissions.includes("catalog.write");
  const scheduled =
    (product.data?.availability_mode ?? "fixed_departure") ===
    "fixed_departure";
  const linked =
    rules.data?.filter((rule) => rule.product_id === productId) ?? [];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!product.data) return;
    setSaved("");
    setError("");
    try {
      const result = await mutation.run(
        `admin/v1/products/${productId}`,
        {
          version: product.data.version,
          name,
          description,
          status,
          productKind,
          optionName: option,
          durationMinutes: Number(duration),
          pricingModel,
          privateBooking,
          confirmationMode,
          categories: sanitizeCategories(categories),
          rates: collectRates(
            categories,
            periods,
            session.tenant.config.bookingCurrency,
          ),
        },
        "PATCH",
      );
      if (result) {
        setSaved(
          "Product saved. New bookings use these rates; confirmed prices stay frozen.",
        );
        product.reload();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }
  let fromAmount: number | null = null;
  try {
    const amounts = collectRates(
      categories,
      periods,
      session.tenant.config.bookingCurrency,
    )
      .map((rate) => rate.amountMinor)
      .filter((amount) => amount > 0);
    fromAmount = amounts.length ? Math.min(...amounts) : null;
  } catch {
    fromAmount = null;
  }
  const item = product.data;
  const effectiveFromMinor =
    fromAmount != null ? fromAmount : item ? priceFromMinor(item) : null;
  return (
    <>
      <Back href="/catalog">Catalog</Back>
      {product.error ? (
        <Notice error>{product.error}</Notice>
      ) : !item ? (
        <Loading />
      ) : (
        <>
          <div className="product-header-bar">
            <div>
              <div className="product-header-badges">
                <span className="kind-chip">
                  {label(item.product_kind ?? "tour")}
                </span>
                <Status state={status ?? "active"} />
                <span className="badge">
                  {modeLabel(item.availability_mode)}
                </span>
                {effectiveFromMinor != null && (
                  <span className="price-pill-badge">
                    From{" "}
                    {money(
                      effectiveFromMinor,
                      session.tenant.config.bookingCurrency,
                      session.tenant.config.locale,
                    )}
                  </span>
                )}
              </div>
              <div className="product-header-title-row">
                <h1>{name.trim() || item.customer_title || item.name}</h1>
              </div>
              <p className="product-header-subtitle">
                {option || item.definition.optionName} ·{" "}
                {durationHint(
                  duration || String(item.definition.durationMinutes),
                )}{" "}
                ·{" "}
                {pricingModel === "per_person"
                  ? "Per person"
                  : pricingModel === "per_group"
                    ? "Per group"
                    : "Per unit"}
              </p>
            </div>
            <div className="product-header-actions">
              {canWrite && scheduled && (
                <button
                  type="button"
                  className="button secondary"
                  aria-label="Add schedule"
                  onClick={() => setScheduleModalOpen(true)}
                >
                  <Plus size={16} />
                  <span className="button-label">Add schedule</span>
                </button>
              )}
              {canWrite && (
                <>
                  <Link
                    href="/catalog"
                    className="button secondary"
                    aria-label="Cancel"
                  >
                    <X size={16} />
                    <span className="button-label">Cancel</span>
                  </Link>
                  <button
                    type="submit"
                    form="edit-product-form"
                    className="button"
                    disabled={mutation.busy}
                    aria-label={mutation.busy ? "Saving" : "Save product"}
                  >
                    <span className="button-label button-label-full">
                      {mutation.busy ? "Saving…" : "Save product"}
                    </span>
                    <span className="button-label button-label-short" aria-hidden="true">
                      {mutation.busy ? "Saving…" : "Save"}
                    </span>
                    <Check size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
          {!scheduled && (
            <Notice>
              {modeLabel(item.availability_mode)} products are not sold from
              dated seat holds. The selling model cannot be changed after
              create.
            </Notice>
          )}
          {canWrite ? (
            <form
              id="edit-product-form"
              className="product-editor-layout"
              onSubmit={save}
            >
              <div className="editor-stack">
                <section className="editor-section">
                  <SectionHeading
                    title="Offer & settings"
                    description="Customer-facing title, operational duration, and booking rules."
                  />
                  <div className="offer-grid">
                    <div className="col-span-2">
                      <Field label="Customer-facing name">
                        <input
                          required
                          maxLength={120}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Product type">
                      <select
                        value={productKind}
                        onChange={(e) => setProductKind(e.target.value)}
                      >
                        <option value="tour">Tour</option>
                        <option value="activity">Activity</option>
                        <option value="experience">Experience</option>
                        <option value="charter">Private charter</option>
                        <option value="transport">Transport</option>
                        <option value="rental">Rental</option>
                        <option value="ticket">Ticket</option>
                      </select>
                    </Field>
                    <Field
                      label="Status"
                      hint="Archived products stay in history but leave New reservation."
                    >
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                      </select>
                    </Field>
                    <Field label="Option name">
                      <input
                        required
                        maxLength={120}
                        value={option}
                        onChange={(e) => setOption(e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Duration · minutes"
                      hint={durationHint(duration)}
                    >
                      <input
                        type="number"
                        min="1"
                        max="10080"
                        required
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                      />
                    </Field>
                    <Field label="Pricing model">
                      <select
                        value={pricingModel}
                        onChange={(e) => setPricingModel(e.target.value)}
                      >
                        <option value="per_person">Per person</option>
                        <option value="per_group">Per group</option>
                        <option value="per_unit">Per unit / resource</option>
                      </select>
                    </Field>
                    <Field label="Confirmation">
                      <select
                        value={confirmationMode}
                        onChange={(e) => setConfirmationMode(e.target.value)}
                      >
                        <option value="instant">Instant confirmation</option>
                        <option value="request">
                          Operator approval required
                        </option>
                      </select>
                    </Field>
                    <Field
                      label="Availability model"
                      hint="Locked after create so existing departures keep the same inventory primitive."
                    >
                      <div className="locked-field-badge">
                        <span className="lock-label">
                          <Lock size={14} />
                          {modeLabel(item.availability_mode)}
                        </span>
                        <span className="lock-tag">Locked</span>
                      </div>
                    </Field>
                    <div className="col-span-full">
                      <Toggle
                        className="toggle-card"
                        label="Reserve for one private party"
                        description="Whole-boat, exclusive charter, or private group booking. Blocks the departure for a single group."
                        checked={privateBooking}
                        onChange={setPrivateBooking}
                      />
                    </div>
                    <div className="col-span-full">
                      <Field label="Short description">
                        <textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          maxLength={2000}
                          rows={3}
                          placeholder="Brief highlights or requirements shown to guests and reservation staff…"
                        />
                      </Field>
                    </div>
                  </div>
                </section>
                <section className="editor-section">
                  <PricingEditor
                    session={session}
                    productId={productId}
                    categories={categories}
                    periods={periods}
                    onCategories={setCategories}
                    onPeriods={setPeriods}
                  />
                </section>
                <section className="editor-section">
                  <SectionHeading
                    title="Schedules"
                    description="When this product runs. Each schedule creates bookable departures."
                    action={
                      canWrite && scheduled ? (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setScheduleModalOpen(true)}
                        >
                          <Plus size={16} />
                          Add schedule
                        </button>
                      ) : undefined
                    }
                  />
                  {rules.error ? (
                    <Notice error>{rules.error}</Notice>
                  ) : !rules.data ? (
                    <Loading />
                  ) : linked.length ? (
                    <div className="table-scroll">
                      <table className="data-table editor-data-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Period</th>
                            <th>Times</th>
                            <th>Status</th>
                            <th>Upcoming</th>
                            <th>
                              <span className="visually-hidden">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {linked.map((rule) => (
                            <tr key={rule.id}>
                              <td>{rule.name || rule.product_name}</td>
                              <td>
                                {rule.start_date} — {rule.end_date}
                                <div className="muted">
                                  {rule.weekdays
                                    .map((day) => weekdayLabels[day - 1])
                                    .join(" · ")}
                                </div>
                              </td>
                              <td>{rule.times.join(", ") || "—"}</td>
                              <td>
                                <Status state={rule.status} />
                              </td>
                              <td>{rule.upcoming_departures}</td>
                              <td className="row-actions">
                                <Link
                                  className="icon-link"
                                  href={`/catalog/availability/${rule.id}`}
                                  aria-label={`Open ${rule.name || "schedule"}`}
                                >
                                  <ArrowRight size={16} />
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty title="No schedules yet">
                      {canWrite && scheduled && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setScheduleModalOpen(true)}
                        >
                          Create the first schedule
                        </button>
                      )}
                    </Empty>
                  )}
                </section>
                {(error || mutation.error || saved) && (
                  <Notice error={Boolean(error || mutation.error)}>
                    {error || mutation.error || saved}
                  </Notice>
                )}
                <div className="editor-actions-bar">
                  <Link
                    href="/catalog"
                    className="button secondary"
                    aria-label="Cancel"
                  >
                    <X size={16} />
                    <span className="button-label">Cancel</span>
                  </Link>
                  <button
                    type="submit"
                    className="button"
                    disabled={mutation.busy}
                    aria-label={mutation.busy ? "Saving" : "Save product"}
                  >
                    <span className="button-label button-label-full">
                      {mutation.busy ? "Saving…" : "Save product"}
                    </span>
                    <span className="button-label button-label-short" aria-hidden="true">
                      {mutation.busy ? "Saving…" : "Save"}
                    </span>
                    <Check size={16} />
                  </button>
                </div>
              </div>
              <aside className="product-preview" aria-live="polite">
                <div className="product-preview-card">
                  <span className="kind-chip">{label(productKind)}</span>
                  <h2>{name || item.customer_title || item.name}</h2>
                  <p>
                    {option || item.definition.optionName} ·{" "}
                    {durationHint(
                      duration || String(item.definition.durationMinutes),
                    )}
                  </p>
                  <div className="product-preview-price">
                    <span>From</span>
                    <strong>
                      {fromAmount != null
                        ? money(
                            fromAmount,
                            session.tenant.config.bookingCurrency,
                            session.tenant.config.locale,
                          )
                        : priceFromMinor(item) != null
                          ? money(
                              priceFromMinor(item)!,
                              session.tenant.config.bookingCurrency,
                              session.tenant.config.locale,
                            )
                          : "No rate"}
                    </strong>
                    <small>
                      {item.next_departure_at
                        ? `Next ${localWhen(
                            item.next_departure_at,
                            session.tenant.config.locale,
                            session.tenant.timezone,
                            false,
                          )}`
                        : scheduled
                          ? "No upcoming departure"
                          : "Not sold from dated departures"}
                    </small>
                  </div>
                  <ul className="product-preview-facts">
                    <li>
                      <span>Sold as</span>
                      <strong>{modeLabel(item.availability_mode)}</strong>
                    </li>
                    <li>
                      <span>Status</span>
                      <strong style={{ textTransform: "capitalize" }}>
                        {status}
                      </strong>
                    </li>
                    <li>
                      <span>Categories</span>
                      <strong>
                        {categories
                          .map((category) => category.label)
                          .filter(Boolean)
                          .join(" · ") || "None"}
                      </strong>
                    </li>
                    <li>
                      <span>Rate periods</span>
                      <strong>
                        {periods.length}{" "}
                        {periods.length === 1 ? "window" : "windows"}
                      </strong>
                    </li>
                    <li>
                      <span>Schedules</span>
                      <strong>
                        {linked.length}{" "}
                        {linked.length === 1 ? "schedule" : "schedules"}
                      </strong>
                    </li>
                  </ul>
                  {scheduled && canWrite && (
                    <div style={{ marginTop: 18 }}>
                      <button
                        type="button"
                        className="button secondary"
                        style={{ width: "100%", justifyContent: "center" }}
                        onClick={() => setScheduleModalOpen(true)}
                      >
                        <Plus size={15} />
                        Add schedule
                      </button>
                    </div>
                  )}
                </div>
              </aside>
            </form>
          ) : (
            <div className="product-editor-layout">
              <div className="editor-stack">
                <section className="editor-section">
                  <SectionHeading title="Published offer" />
                  <p className="product-readout">
                    {item.description || "No description yet."}
                  </p>
                  <div className="rate-list">
                    {item.definition.rates.map((rate, index) => (
                      <div key={index}>
                        <span>
                          <strong>
                            {item.definition.categories.find(
                              (category) => category.slug === rate.category,
                            )?.label ?? label(rate.category)}
                          </strong>
                          <small>
                            {rate.startDate} — {rate.endDate}
                          </small>
                        </span>
                        <strong>
                          {money(
                            rate.amountMinor,
                            session.tenant.config.bookingCurrency,
                            session.tenant.config.locale,
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="editor-section">
                  <SectionHeading
                    title="Schedules"
                    description="When this product runs. Each schedule creates bookable departures."
                  />
                  {rules.error ? (
                    <Notice error>{rules.error}</Notice>
                  ) : !rules.data ? (
                    <Loading />
                  ) : linked.length ? (
                    <div className="table-scroll">
                      <table className="data-table editor-data-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Period</th>
                            <th>Times</th>
                            <th>Status</th>
                            <th>Upcoming</th>
                          </tr>
                        </thead>
                        <tbody>
                          {linked.map((rule) => (
                            <tr key={rule.id}>
                              <td>{rule.name || rule.product_name}</td>
                              <td>
                                {rule.start_date} — {rule.end_date}
                              </td>
                              <td>{rule.times.join(", ") || "—"}</td>
                              <td>
                                <Status state={rule.status} />
                              </td>
                              <td>{rule.upcoming_departures}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty title="No schedules yet" />
                  )}
                </section>
              </div>
              <aside className="product-preview" aria-live="polite">
                <div className="product-preview-card">
                  <span className="kind-chip">
                    {label(item.product_kind ?? "tour")}
                  </span>
                  <h2>{item.customer_title ?? item.name}</h2>
                  <p>
                    {item.definition.optionName} ·{" "}
                    {durationHint(String(item.definition.durationMinutes))}
                  </p>
                  <div className="product-preview-price">
                    <span>From</span>
                    <strong>
                      {priceFromMinor(item) != null
                        ? money(
                            priceFromMinor(item)!,
                            session.tenant.config.bookingCurrency,
                            session.tenant.config.locale,
                          )
                        : "No rate"}
                    </strong>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </>
      )}
      {canWrite && (
        <ScheduleFormDialog
          session={session}
          open={scheduleModalOpen}
          productId={productId}
          onClose={() => setScheduleModalOpen(false)}
          onCreated={() => {
            setScheduleModalOpen(false);
            rules.reload();
          }}
        />
      )}
    </>
  );
}
export function AvailabilityDetail({
  session,
  ruleId,
}: {
  session: Session;
  ruleId: string;
}) {
  const rule = useResource<AvailabilityRule>(
    `admin/v1/availability-rules/${ruleId}`,
  );
  const mutation = useMutation();
  const canWrite = session.permissions.includes("catalog.write");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthCursor, setMonthCursor] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);
  const locale = session.tenant.config.locale;
  const timezone = session.tenant.timezone;

  useEffect(() => {
    if (!filtersOpen) return;
    function onPointer(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node))
        setFiltersOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const departures = rule.data?.departures ?? [];
  const filteredDepartures = departures.filter(
    (item) => statusFilter === "all" || item.status === statusFilter,
  );
  const byDate = useMemo(() => {
    const map = new Map<string, typeof filteredDepartures>();
    for (const departure of filteredDepartures) {
      const day = localDayFromInstant(departure.starts_at, timezone);
      const list = map.get(day) ?? [];
      list.push(departure);
      map.set(day, list);
    }
    return map;
  }, [filteredDepartures, timezone]);

  useEffect(() => {
    if (!rule.data || monthCursor) return;
    const first = filteredDepartures[0]?.starts_at;
    const seed = first
      ? localDayFromInstant(first, timezone).slice(0, 7)
      : rule.data.start_date.slice(0, 7);
    setMonthCursor(seed);
  }, [rule.data, filteredDepartures, monthCursor, timezone]);

  const months = useMemo(() => {
    if (!rule.data) return [] as string[];
    const keys: string[] = [];
    for (
      let day = rule.data.start_date;
      day <= rule.data.end_date;
      day = shiftDay(day, 1)
    ) {
      const key = day.slice(0, 7);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  }, [rule.data]);

  async function setStatus(status: "active" | "paused") {
    if (!rule.data?.version) return;
    const result = await mutation.run(
      `admin/v1/availability-rules/${ruleId}`,
      { version: rule.data.version, status },
      "PATCH",
    );
    if (result) rule.reload();
  }

  const activeFilters = statusFilter !== "all" ? 1 : 0;
  const visibleMonth = monthCursor || months[0] || "";
  const gridDays = monthGrid(visibleMonth);

  return (
    <>
      <Back href="/catalog?tab=schedules">Schedules</Back>
      {rule.error ? (
        <Notice error>{rule.error}</Notice>
      ) : !rule.data ? (
        <Loading />
      ) : (
        <>
          <div className="schedule-detail-header">
            <div className="schedule-detail-copy">
              <div className="schedule-detail-meta">
                <Status state={rule.data.status} />
                {rule.data.product_id ? (
                  <Link
                    className="text-button"
                    href={`/catalog/${rule.data.product_id}`}
                  >
                    {rule.data.product_name}
                  </Link>
                ) : (
                  <span className="muted">{rule.data.product_name}</span>
                )}
              </div>
              <Heading title={rule.data.name || rule.data.product_name} />
            </div>
            <div className="catalog-view-actions departure-view-actions schedule-detail-actions">
              <div className="filter-menu" ref={filterRef}>
                <button
                  type="button"
                  className={
                    "button secondary catalog-add-btn" +
                    (filtersOpen || activeFilters ? " active-filter" : "")
                  }
                  aria-label="Filter upcoming departures"
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
                    aria-label="Upcoming departure filters"
                  >
                    <div className="filter-popover-head">
                      <strong>Filters</strong>
                      <span>
                        {activeFilters ? `${activeFilters} active` : "None"}
                      </span>
                    </div>
                    <label className="compact-control">
                      <span>Departure status</span>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                      >
                        <option value="all">All statuses</option>
                        {[
                          ...new Set(departures.map((item) => item.status)),
                        ].map((status) => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="filter-popover-actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={!activeFilters}
                        onClick={() => setStatusFilter("all")}
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
              {canWrite && rule.data.status === "active" ? (
                <button
                  type="button"
                  className="button secondary catalog-add-btn"
                  aria-label="Pause schedule"
                  disabled={mutation.busy}
                  onClick={() => void setStatus("paused")}
                >
                  <Pause size={17} />
                  <span className="button-label">Pause</span>
                </button>
              ) : null}
              {canWrite && rule.data.status === "paused" ? (
                <button
                  type="button"
                  className="button secondary catalog-add-btn"
                  aria-label="Resume schedule"
                  disabled={mutation.busy}
                  onClick={() => void setStatus("active")}
                >
                  <Play size={17} />
                  <span className="button-label">Resume</span>
                </button>
              ) : null}
              {canWrite &&
              rule.data.product_availability_mode === "fixed_departure" ? (
                <button
                  type="button"
                  className="button catalog-add-btn"
                  aria-label="Add schedule"
                  onClick={() => setScheduleModalOpen(true)}
                >
                  <Plus size={17} />
                  <span className="button-label">Add schedule</span>
                </button>
              ) : null}
            </div>
          </div>
          {mutation.error && <Notice error>{mutation.error}</Notice>}
          <div className="catalog-metrics" aria-label="Schedule summary">
            <div>
              <strong>
                {formatMediumDateRange(
                  rule.data.start_date,
                  rule.data.end_date,
                  locale,
                )}
              </strong>
              <span>Operating period</span>
            </div>
            <div>
              <strong>{rule.data.times.join(", ") || "Flexible"}</strong>
              <span>Start times</span>
            </div>
            <div>
              <strong>{rule.data.capacity ?? "—"}</strong>
              <span>Seat capacity</span>
            </div>
            <div>
              <strong>{rule.data.upcoming_departures}</strong>
              <span>Upcoming departures</span>
            </div>
          </div>
          <section className="panel schedule-detail-calendar-panel">
            <div className="panel-heading">
              <h2>Upcoming departures</h2>
              <Link className="text-link" href="/departures">
                Open departures <ArrowRight size={16} />
              </Link>
            </div>
            {filteredDepartures.length ? (
              <div className="rule-departure-calendar">
                <div className="schedule-calendar-nav">
                  <button
                    type="button"
                    className="text-button"
                    disabled={months.indexOf(visibleMonth) <= 0}
                    onClick={() => {
                      const i = months.indexOf(visibleMonth);
                      if (i > 0) setMonthCursor(months[i - 1]!);
                    }}
                  >
                    Previous
                  </button>
                  <strong>
                    {visibleMonth
                      ? new Date(`${visibleMonth}-01T12:00:00Z`).toLocaleString(
                          locale,
                          { month: "long", year: "numeric", timeZone: "UTC" },
                        )
                      : "—"}
                  </strong>
                  <button
                    type="button"
                    className="text-button"
                    disabled={
                      months.indexOf(visibleMonth) >= months.length - 1
                    }
                    onClick={() => {
                      const i = months.indexOf(visibleMonth);
                      if (i >= 0 && i < months.length - 1)
                        setMonthCursor(months[i + 1]!);
                    }}
                  >
                    Next
                  </button>
                </div>
                <div className="rule-departure-grid">
                  {gridDays.map((day, index) => {
                    if (!day)
                      return <div key={`pad-${index}`} className="rule-day empty" />;
                    const items = byDate.get(day) ?? [];
                    const inPeriod =
                      day >= rule.data!.start_date &&
                      day <= rule.data!.end_date;
                    return (
                      <div
                        key={day}
                        className={
                          "rule-day" +
                          (items.length ? " has-departures" : "") +
                          (inPeriod ? "" : " outside")
                        }
                      >
                        <header>
                          <span className="rule-day-num">
                            {Number(day.slice(8))}
                          </span>
                          <span className="rule-day-dow">
                            {weekdayLabels[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]}
                          </span>
                        </header>
                        <div className="rule-day-slots">
                          {items.map((departure) => (
                            <Link
                              key={departure.id}
                              href={`/departures/${departure.id}/manifest`}
                              className="rule-day-slot"
                              title={`${clockFromInstant(departure.starts_at, timezone, locale)} · ${departure.committed}/${departure.capacity}`}
                            >
                              <strong>
                                {clockFromInstant(
                                  departure.starts_at,
                                  timezone,
                                  locale,
                                )}
                              </strong>
                              <span>
                                {departure.committed}/{departure.capacity}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Empty title="No upcoming departures from this schedule" />
            )}
          </section>
          {canWrite &&
            rule.data.product_availability_mode === "fixed_departure" && (
              <ScheduleFormDialog
                session={session}
                open={scheduleModalOpen}
                productId={rule.data.product_id}
                onClose={() => setScheduleModalOpen(false)}
                onCreated={(result) => {
                  setScheduleModalOpen(false);
                  if (result.ruleId)
                    window.location.assign(
                      `/catalog/availability/${result.ruleId}`,
                    );
                  else rule.reload();
                }}
              />
            )}
        </>
      )}
    </>
  );
}

function localDayFromInstant(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function clockFromInstant(value: string, timezone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function monthGrid(monthKey: string) {
  if (!monthKey) return [] as (string | null)[];
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year!, month! - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7;
  const days: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= 31; d++) {
    const day = `${monthKey}-${String(d).padStart(2, "0")}`;
    if (Number.isNaN(Date.parse(`${day}T12:00:00Z`))) break;
    if (day.slice(0, 7) !== monthKey) break;
    days.push(day);
  }
  return days;
}
export function Settings({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => Promise<void>;
}) {
  const [config, setConfig] = useState({
      ...session.tenant.config,
      documentStorage: session.tenant.config.documentStorage ?? {
        hotProvider: "filesystem" as const,
        archiveProvider: "none" as const,
        hotRetentionDays: 7,
      },
    }),
    [methods, setMethods] = useState(config.manualPaymentMethods.join(", ")),
    [sources, setSources] = useState(config.bookingSources.join(", ")),
    [logoError, setLogoError] = useState(""),
    [logoBusy, setLogoBusy] = useState(false),
    [logoUnavailable, setLogoUnavailable] = useState(false),
    [tab, setTab] = useState(() => {
      if (typeof window === "undefined") return "general";
      const value = new URLSearchParams(window.location.search).get("tab");
      return value && SETTINGS_TABS.has(value) ? value : "general";
    }),
    [profile, setProfile] = useState(
      session.tenant.business_profile ?? {
        displayName: session.tenant.name,
        streetAddress: "",
        suite: "",
        city: "",
        stateParish: "",
        postalCode: "",
        country: "US",
        email: "",
        phone: "",
      },
    ),
    [authorizedContact, setAuthorizedContact] = useState(
      session.tenant.authorized_contact ?? { name: "", email: "", phone: "" },
    ),
    [waiverTitle, setWaiverTitle] = useState(""),
    [waiverBody, setWaiverBody] = useState(""),
    [vesselName, setVesselName] = useState(""),
    [callDate, setCallDate] = useState(""),
    [portName, setPortName] = useState(""),
    [allAboardAt, setAllAboardAt] = useState(""),
    [accommodationName, setAccommodationName] = useState(""),
    [accommodationAddress, setAccommodationAddress] = useState(""),
    [printName, setPrintName] = useState(""),
    [printDocumentType, setPrintDocumentType] = useState<
      "manifest" | "pickup_list"
    >("manifest");
  const mutation = useMutation(),
    profileMutation = useMutation(),
    waiverMutation = useMutation(),
    waiverTemplates = useResource<
      {
        id: string;
        version: number;
        title: string;
        body: string;
        active: boolean;
        created_at: string;
      }[]
    >("ops/v1/waiver-templates"),
    stayMutation = useMutation(),
    stayOptions = useResource<{
      cruiseCalls: {
        id: string;
        vessel_name: string;
        call_date: string;
        port_name: string;
        all_aboard_at: string | null;
      }[];
      accommodations: { id: string; name: string; address: string }[];
    }>("ops/v1/stays/options"),
    printMutation = useMutation(),
    printTemplates = useResource<
      {
        id: string;
        template_key: string;
        version: number;
        document_type: string;
        name: string;
        is_default: boolean;
        created_at: string;
      }[]
    >("ops/v1/print-templates"),
    printJobs = useResource<
      {
        id: string;
        document_type: string;
        status: string;
        destination_type: string;
        requested_at: string;
      }[]
    >("ops/v1/print-jobs");
  useEffect(() => {
    setLogoUnavailable(false);
  }, [session.tenant.logo_path]);
  useEffect(() => {
    const active = document.querySelector<HTMLElement>(
      ".settings-nav button.active",
    );
    active?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [tab]);
  function selectTab(next: string) {
    if (!SETTINGS_TABS.has(next)) return;
    if (
      next === "resellers" &&
      !session.permissions.includes("partner.manage")
    )
      return;
    if (
      next === "integrations" &&
      !session.permissions.includes("integration.manage")
    )
      return;
    setTab(next);
    settingsTab(next);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await mutation.run(
      "admin/v1/tenant/config",
      {
        version: session.tenant.version,
        config: {
          ...config,
          manualPaymentMethods: methods
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          bookingSources: sources
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      },
      "PATCH",
    );
    if (result) await refresh();
  }
  async function uploadLogo(file?: File) {
    if (!file) return;
    setLogoBusy(true);
    setLogoError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/gateway/admin/v1/tenant/logo", {
        method: "POST",
        headers: {
          "X-Tenant-Id": session.tenant.id,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: form,
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).message ?? "Logo upload failed",
        );
      await refresh();
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }
  async function saveProfile() {
    const result = await profileMutation.run(
      "admin/v1/tenant/profile",
      { businessProfile: profile, authorizedContact },
      "PATCH",
    );
    if (result) await refresh();
  }
  async function publishWaiverTemplate() {
    const result = await waiverMutation.run("ops/v1/waiver-templates", {
      title: waiverTitle,
      body: waiverBody,
    });
    if (result) {
      setWaiverTitle("");
      setWaiverBody("");
      waiverTemplates.reload();
    }
  }
  async function publishPrintTemplate() {
    const result = await printMutation.run("ops/v1/print-templates", {
      documentType: printDocumentType,
      name: printName,
      outputProfile: { paper: "A4", orientation: "portrait" },
      payload: { includeTenantLogo: true },
      isDefault: true,
    });
    if (result) {
      setPrintName("");
      printTemplates.reload();
    }
  }
  async function createCruiseCall() {
    const result = await stayMutation.run("ops/v1/stays/cruise-calls", {
      vesselName,
      callDate,
      portName,
      ...(allAboardAt ? { allAboardAt } : {}),
      tenderRequired: false,
    });
    if (result) {
      setVesselName("");
      setCallDate("");
      setPortName("");
      setAllAboardAt("");
      stayOptions.reload();
    }
  }
  async function createAccommodation() {
    const result = await stayMutation.run("ops/v1/stays/accommodations", {
      name: accommodationName,
      address: accommodationAddress,
    });
    if (result) {
      setAccommodationName("");
      setAccommodationAddress("");
      stayOptions.reload();
    }
  }
  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Tenant settings"
        description="Configure identity, commercial policy, and operational controls. Policy changes apply to new holds — existing quotes stay fixed."
      />
      <div className="settings-layout">
        <aside className="panel settings-summary">
          <div className="settings-tenant-header">
            {session.tenant.logo_path && !logoUnavailable ? (
              <img
                className="tenant-logo-preview"
                src={session.tenant.logo_path}
                alt={`${session.tenant.name} logo`}
                onError={() => setLogoUnavailable(true)}
              />
            ) : (
              <span className="tenant-monogram">
                {session.tenant.name.replace("Mock ", "").slice(0, 1)}
              </span>
            )}
            <div>
              <h2>{session.tenant.name}</h2>
              <p className="muted settings-tenant-meta">
                {session.tenant.timezone} · {config.reportingCurrency} ·{" "}
                {config.locale}
              </p>
            </div>
          </div>
          <dl className="settings-facts">
            <div>
              <dt>Booking currency</dt>
              <dd>{config.bookingCurrency}</dd>
            </div>
            <div>
              <dt>Date format</dt>
              <dd>{config.dateFormat}</dd>
            </div>
            <div>
              <dt>Hold window</dt>
              <dd>{Math.round(config.holdSeconds / 60)} min</dd>
            </div>
          </dl>
          <nav className="settings-nav" aria-label="Tenant settings sections">
            <p>PROFILE</p>
            <button
              className={tab === "general" ? "active" : ""}
              type="button"
              onClick={() => selectTab("general")}
            >
              <Building2 size={16} />
              <span className="settings-nav-label">General & branding</span>
              <span className="settings-nav-label-short">General</span>
            </button>
            <button
              className={tab === "localization" ? "active" : ""}
              type="button"
              onClick={() => selectTab("localization")}
            >
              <Globe2 size={16} />
              <span className="settings-nav-label">Localization</span>
              <span className="settings-nav-label-short">Locale</span>
            </button>
            <p>OPERATIONS</p>
            <button
              className={tab === "commercial" ? "active" : ""}
              type="button"
              onClick={() => selectTab("commercial")}
            >
              <Landmark size={16} />
              <span className="settings-nav-label">Taxes & commercial</span>
              <span className="settings-nav-label-short">Commercial</span>
            </button>
            <button
              className={tab === "printers" ? "active" : ""}
              type="button"
              onClick={() => selectTab("printers")}
            >
              <Printer size={16} />
              <span className="settings-nav-label">Printers & documents</span>
              <span className="settings-nav-label-short">Documents</span>
            </button>
            <button
              className={tab === "stays" ? "active" : ""}
              type="button"
              onClick={() => selectTab("stays")}
            >
              <Ship size={16} />
              <span className="settings-nav-label">Guest stays & cruise calls</span>
              <span className="settings-nav-label-short">Stays</span>
            </button>
            {session.permissions.includes("partner.manage") && (
              <button
                className={tab === "resellers" ? "active" : ""}
                type="button"
                onClick={() => selectTab("resellers")}
              >
                <Handshake size={16} />
                <span className="settings-nav-label">Partners / Resellers</span>
                <span className="settings-nav-label-short">Partners</span>
              </button>
            )}
            <p>PLATFORM</p>
            <button
              className={tab === "payments" ? "active" : ""}
              type="button"
              onClick={() => selectTab("payments")}
            >
              <CreditCard size={16} />
              <span className="settings-nav-label">Payments</span>
              <span className="settings-nav-label-short">Payments</span>
            </button>
            <button
              className={tab === "waivers" ? "active" : ""}
              type="button"
              onClick={() => selectTab("waivers")}
            >
              <FileText size={16} />
              <span className="settings-nav-label">Waivers</span>
              <span className="settings-nav-label-short">Waivers</span>
            </button>
            {session.permissions.includes("integration.manage") && (
              <button
                className={tab === "integrations" ? "active" : ""}
                type="button"
                onClick={() => selectTab("integrations")}
              >
                <Plug size={16} />
                <span className="settings-nav-label">Integrations</span>
                <span className="settings-nav-label-short">Integrations</span>
              </button>
            )}
            <button
              className={tab === "security" ? "active" : ""}
              type="button"
              onClick={() => selectTab("security")}
            >
              <ShieldCheck size={16} />
              <span className="settings-nav-label">Security</span>
              <span className="settings-nav-label-short">Security</span>
            </button>
          </nav>
        </aside>
        {tab === "integrations" ? (
          <div className="settings-tab-content">
            <Integrations embedded />
          </div>
        ) : (
          <form className="panel form-panel" onSubmit={submit}>
            {tab === "general" && (
              <section>
                <div className="settings-card-head" id="branding">
                  <Building2 size={20} />
                  <div>
                    <h2>Company identity</h2>
                    <p>
                      Logo and core business details used across the workspace
                      and operational documents.
                    </p>
                  </div>
                </div>
                <div className="identity-layout">
                  <div className="logo-control">
                    <label className="logo-dropzone" htmlFor="tenant-logo">
                      {session.tenant.logo_path && !logoUnavailable ? (
                        <img
                          className="uploaded-tenant-logo"
                          src={session.tenant.logo_path}
                          alt="Tenant logo"
                          onError={() => setLogoUnavailable(true)}
                        />
                      ) : (
                        <span className="logo-monogram">
                          {profile.displayName.slice(0, 1).toUpperCase() || "T"}
                        </span>
                      )}
                      {(!session.tenant.logo_path || logoUnavailable) && (
                        <span>Click to upload logo</span>
                      )}
                    </label>
                    <input
                      id="tenant-logo"
                      className="visually-hidden"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      disabled={logoBusy}
                      onChange={(e) => void uploadLogo(e.target.files?.[0])}
                    />
                    <small>JPG, PNG, WebP or SVG · maximum 2 MB</small>
                  </div>
                  <div className="identity-fields">
                    <Field label="Business name">
                      <input
                        required
                        value={profile.displayName}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            displayName: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="Business email">
                        <input
                          required
                          type="email"
                          value={profile.email}
                          onChange={(e) =>
                            setProfile({ ...profile, email: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Business phone">
                        <input
                          value={profile.phone}
                          onChange={(e) =>
                            setProfile({ ...profile, phone: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </div>
                </div>
                {logoError && <Notice error>{logoError}</Notice>}
                <div className="form-divider" />
                <div className="settings-card-head compact-card-head">
                  <Globe2 size={20} />
                  <div>
                    <h2>Business address</h2>
                    <p>Used for operational and statutory correspondence.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <Field label="Street address">
                    <input
                      value={profile.streetAddress}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          streetAddress: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Apt / suite">
                    <input
                      value={profile.suite}
                      onChange={(e) =>
                        setProfile({ ...profile, suite: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="City">
                    <input
                      value={profile.city}
                      onChange={(e) =>
                        setProfile({ ...profile, city: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="State / parish">
                    <input
                      value={profile.stateParish}
                      onChange={(e) =>
                        setProfile({ ...profile, stateParish: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Postal code">
                    <input
                      value={profile.postalCode}
                      onChange={(e) =>
                        setProfile({ ...profile, postalCode: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Country">
                    <select
                      required
                      value={profile.country}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          country: e.target.value,
                        })
                      }
                    >
                      {!COUNTRIES.some((c) => c.code === profile.country) &&
                        profile.country && (
                          <option value={profile.country}>
                            {profile.country} (current)
                          </option>
                        )}
                      {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <h2>Authorized contact</h2>
                <p className="policy-copy">
                  This contact will receive future verification requests for
                  critical account changes.
                </p>
                <div className="form-grid">
                  <Field label="Name">
                    <input
                      required
                      value={authorizedContact.name}
                      onChange={(e) =>
                        setAuthorizedContact({
                          ...authorizedContact,
                          name: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      required
                      type="email"
                      value={authorizedContact.email}
                      onChange={(e) =>
                        setAuthorizedContact({
                          ...authorizedContact,
                          email: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      value={authorizedContact.phone}
                      onChange={(e) =>
                        setAuthorizedContact({
                          ...authorizedContact,
                          phone: e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                {profileMutation.error && (
                  <Notice error>{profileMutation.error}</Notice>
                )}
                <FormActions stickyOnMobile>
                  <button
                    type="button"
                    className="button"
                    disabled={profileMutation.busy}
                    onClick={() => void saveProfile()}
                  >
                    {profileMutation.busy ? "Saving…" : "Save general profile"}
                    <Check size={17} />
                  </button>
                </FormActions>
                <div className="form-divider" />
              </section>
            )}
            {tab === "commercial" && (
              <section>
                <div className="settings-card-head" id="commercial">
                  <Landmark size={20} />
                  <div>
                    <h2>Booking, taxes & commercial policy</h2>
                    <p>
                      Controls for new holds and bookings. Existing snapshots
                      remain fixed.
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <Field
                    label="Hold duration · seconds"
                    hint="Between 30 and 1,800 seconds."
                  >
                    <input
                      type="number"
                      min="30"
                      max="1800"
                      required
                      value={config.holdSeconds}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          holdSeconds: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Minimum payment to confirm · %">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      required
                      value={config.minimumPaidPercent}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          minimumPaidPercent: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Tax / fee rate · %"
                    hint="Added once on the party subtotal when a hold is priced (exclusive). Not a tax engine."
                  >
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      required
                      value={config.taxBasisPoints / 100}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          taxBasisPoints: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
                <p className="policy-copy">
                  Yes — this rate is used today. New holds compute tax as rate ×
                  party subtotal and freeze it on the quote (total = subtotal +
                  tax). Inclusive pricing, exemptions, multi-jurisdiction tax,
                  and remittance are not modeled; treat catalogue amounts as
                  tax-exclusive until a finance-approved tax engine ships.
                </p>
                <Toggle
                  label="Allow confirmation before pickup is arranged"
                  description="Unresolved pickup still appears on the booking."
                  checked={config.allowUnresolvedPickup}
                  onChange={(checked) =>
                    setConfig({ ...config, allowUnresolvedPickup: checked })
                  }
                />
                <div className="form-divider" />
              </section>
            )}
            {tab === "localization" && (
              <section>
                <div className="settings-card-head" id="localization">
                  <Globe2 size={20} />
                  <div>
                    <h2>Localization</h2>
                    <p>
                      Regional display and data-entry defaults for this tenant.
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <Field label="Display language">
                    <select
                      value={config.locale}
                      onChange={(e) =>
                        setConfig({ ...config, locale: e.target.value })
                      }
                    >
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                    </select>
                  </Field>
                  <Field label="Date format">
                    <select
                      value={config.dateFormat}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          dateFormat: e.target
                            .value as typeof config.dateFormat,
                        })
                      }
                    >
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                  </Field>
                  <Field label="Time format">
                    <select
                      value={config.timeFormat}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          timeFormat: e.target
                            .value as typeof config.timeFormat,
                        })
                      }
                    >
                      <option value="12h">12-hour</option>
                      <option value="24h">24-hour</option>
                    </select>
                  </Field>
                  <Field label="Week starts on">
                    <select
                      value={config.weekStartsOn}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          weekStartsOn: Number(e.target.value),
                        })
                      }
                    >
                      <option value={0}>Sunday</option>
                      <option value={1}>Monday</option>
                    </select>
                  </Field>
                  <Field label="Measurement system">
                    <select
                      value={config.measurementSystem}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          measurementSystem: e.target
                            .value as typeof config.measurementSystem,
                        })
                      }
                    >
                      <option value="metric">Metric</option>
                      <option value="imperial">Imperial</option>
                    </select>
                  </Field>
                </div>
                <div className="form-divider" />
                <h2>Currency & tax context</h2>
                <p className="policy-copy">
                  Track A requires booking, collection, and reporting currencies
                  to be the same. FX conversion is out of scope, so these fields
                  are read-only after tenant create. Change them only through an
                  approved finance migration — not from this screen. Tax rate
                  editing lives under Taxes & commercial.
                </p>
                <div className="form-grid">
                  <Field label="Booking currency">
                    <input value={config.bookingCurrency} disabled />
                  </Field>
                  <Field label="Collection currency">
                    <input value={config.collectionCurrency} disabled />
                  </Field>
                  <Field label="Reporting currency">
                    <input value={config.reportingCurrency} disabled />
                  </Field>
                </div>
                <div className="form-divider" />
              </section>
            )}
            {tab === "printers" && (
              <section>
                <div className="settings-card-head">
                  <Printer size={20} />
                  <div>
                    <h2>Printers & documents</h2>
                    <p>
                      Produce paper-safe operational documents from the current
                      departure data.
                    </p>
                  </div>
                </div>
                <div className="document-access-grid">
                  <article>
                    <FileText size={19} />
                    <div>
                      <h3>Departure manifest</h3>
                      <p>
                        Open a departure, then print its confirmed passenger
                        manifest or save it as a PDF.
                      </p>
                      <Link className="text-link" href="/departures">
                        Open departures <ArrowRight size={16} />
                      </Link>
                    </div>
                  </article>
                  <article>
                    <Printer size={19} />
                    <div>
                      <h3>Pickup list</h3>
                      <p>
                        Open the operations board, save the pickup plan, then
                        print its ordered stops and exceptions.
                      </p>
                      <Link className="text-link" href="/operations">
                        Open operations <ArrowRight size={16} />
                      </Link>
                    </div>
                  </article>
                </div>
                <p className="policy-copy">
                  Browser print and Save as PDF are the current delivery method.
                  Browser jobs are recorded for audit; a printer agent and
                  physical destinations are not enabled yet.
                </p>
                <div className="form-divider" />
                <h2>Document storage</h2>
                <p className="policy-copy">
                  Signed waiver PDFs are written to a short-lived hot store,
                  then synced out to the tenant archive target so production
                  disk can be cleared. Hot copies auto-purge within 7 days.
                  Longer retention requires a purchased storage plan (not
                  enabled yet). Drive adapters stay feature-flagged until OAuth
                  credentials are approved.
                </p>
                <div className="form-grid">
                  <Field label="Hot store">
                    <select
                      value={config.documentStorage.hotProvider}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          documentStorage: {
                            ...config.documentStorage,
                            hotProvider: event.target.value as
                              | "filesystem"
                              | "s3",
                          },
                        })
                      }
                    >
                      <option value="filesystem">
                        Production filesystem / volume
                      </option>
                      <option value="s3">S3-compatible object storage</option>
                    </select>
                  </Field>
                  <Field label="Archive sync target">
                    <select
                      value={config.documentStorage.archiveProvider}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          documentStorage: {
                            ...config.documentStorage,
                            archiveProvider: event.target.value as
                              | "none"
                              | "google_drive"
                              | "onedrive"
                              | "dropbox",
                          },
                        })
                      }
                    >
                      <option value="none">None (purge after retention)</option>
                      <option value="google_drive">Google Drive</option>
                      <option value="onedrive">OneDrive</option>
                      <option value="dropbox">Dropbox</option>
                    </select>
                  </Field>
                  <Field label="Hot retention (days, max 7)">
                    <input
                      type="number"
                      min={1}
                      max={7}
                      value={config.documentStorage.hotRetentionDays}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          documentStorage: {
                            ...config.documentStorage,
                            hotRetentionDays: Math.min(
                              7,
                              Math.max(1, Number(event.target.value) || 7),
                            ),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                {config.documentStorage.archiveProvider !== "none" && (
                  <p className="policy-copy">
                    Archive sync runs from `npm run outbox:drain`. Adapters
                    remain blocked until `DOCUMENT_ARCHIVE_ADAPTERS=1` and
                    provider credentials are configured. Hot files still expire
                    within the retention window.
                  </p>
                )}
                {session.permissions.includes("config.write") && (
                  <FormActions stickyOnMobile>
                    <button className="button" disabled={mutation.busy}>
                      {mutation.busy ? "Saving…" : "Save document storage"}
                      <Check size={17} />
                    </button>
                  </FormActions>
                )}
                {session.permissions.includes("print.templates.manage") && (
                  <>
                    <div className="form-divider" />
                    <h2>Document templates</h2>
                    <p className="policy-copy">
                      Publishing creates a new tenant-owned template version.
                      The selected layout becomes the default for its document
                      type.
                    </p>
                    <div className="form-grid compact">
                      <Field label="Document type">
                        <select
                          value={printDocumentType}
                          onChange={(event) =>
                            setPrintDocumentType(
                              event.target.value as "manifest" | "pickup_list",
                            )
                          }
                        >
                          <option value="manifest">Departure manifest</option>
                          <option value="pickup_list">Pickup list</option>
                        </select>
                      </Field>
                      <Field label="Template name">
                        <input
                          value={printName}
                          maxLength={120}
                          placeholder="Standard departure manifest"
                          onChange={(event) => setPrintName(event.target.value)}
                        />
                      </Field>
                    </div>
                    {printMutation.error && (
                      <Notice error>{printMutation.error}</Notice>
                    )}
                    <div className="form-actions">
                      <button
                        className="button"
                        type="button"
                        disabled={printMutation.busy || !printName.trim()}
                        onClick={() => void publishPrintTemplate()}
                      >
                        {printMutation.busy
                          ? "Publishing…"
                          : "Publish template"}
                      </button>
                    </div>
                  </>
                )}
                {printTemplates.error ? (
                  <Notice error>{printTemplates.error}</Notice>
                ) : printTemplates.data?.length ? (
                  <div className="settings-list">
                    {printTemplates.data.map((template) => (
                      <article key={template.id}>
                        <div>
                          <strong>{template.name}</strong>
                          <p>
                            {label(template.document_type)} · version{" "}
                            {template.version}
                          </p>
                        </div>
                        {template.is_default && <Status state="confirmed" />}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No published document templates yet.</p>
                )}
                {printJobs.data?.length ? (
                  <>
                    <div className="form-divider" />
                    <h2>Recent document requests</h2>
                    <div className="settings-list">
                      {printJobs.data.slice(0, 5).map((job) => (
                        <article key={job.id}>
                          <div>
                            <strong>{label(job.document_type)}</strong>
                            <p>{new Date(job.requested_at).toLocaleString()}</p>
                          </div>
                          <Status state={job.status} />
                        </article>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            )}
            {tab === "stays" && (
              <section>
                <div className="settings-card-head">
                  <Ship size={20} />
                  <div>
                    <h2>Guest stays & cruise calls</h2>
                    <p>
                      Maintain controlled vessel calls and accommodations used
                      by reservations and pickup operations.
                    </p>
                  </div>
                </div>
                <h2>Cruise calls</h2>
                <div className="form-grid">
                  <Field label="Vessel name">
                    <input
                      required
                      value={vesselName}
                      onChange={(e) => setVesselName(e.target.value)}
                    />
                  </Field>
                  <TenantDateInput
                    label="Call date"
                    value={callDate}
                    onChange={setCallDate}
                    locale={session.tenant.config.locale}
                    dateFormat={session.tenant.config.dateFormat}
                  />
                  <Field label="Port or marina">
                    <input
                      required
                      value={portName}
                      onChange={(e) => setPortName(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="All aboard · optional ISO time"
                    hint="Include the UTC offset, for example 2026-09-10T16:30:00-04:00"
                  >
                    <input
                      value={allAboardAt}
                      onChange={(e) => setAllAboardAt(e.target.value)}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={
                    stayMutation.busy || !vesselName || !callDate || !portName
                  }
                  onClick={() => void createCruiseCall()}
                >
                  Add cruise call
                </button>
                {stayOptions.data?.cruiseCalls.map((item) => (
                  <div className="detail-row" key={item.id}>
                    <span>
                      <strong>{item.vessel_name}</strong>
                      <small>
                        {item.call_date} · {item.port_name}
                        {item.all_aboard_at
                          ? ` · all aboard ${new Date(item.all_aboard_at).toLocaleString()}`
                          : ""}
                      </small>
                    </span>
                  </div>
                ))}
                <div className="form-divider" />
                <h2>Accommodation properties</h2>
                <div className="form-grid">
                  <Field label="Hotel or property name">
                    <input
                      required
                      value={accommodationName}
                      onChange={(e) => setAccommodationName(e.target.value)}
                    />
                  </Field>
                  <Field label="Address">
                    <input
                      value={accommodationAddress}
                      onChange={(e) => setAccommodationAddress(e.target.value)}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={stayMutation.busy || !accommodationName}
                  onClick={() => void createAccommodation()}
                >
                  Add accommodation
                </button>
                {stayOptions.data?.accommodations.map((item) => (
                  <div className="detail-row" key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.address || "No address recorded"}</small>
                    </span>
                  </div>
                ))}
                {(stayMutation.error || stayOptions.error) && (
                  <Notice error>
                    {stayMutation.error || stayOptions.error}
                  </Notice>
                )}
              </section>
            )}
            {tab === "resellers" && session.permissions.includes("partner.manage") && (
              <PartnersResellersSettings />
            )}
            {tab === "payments" && (
              <section className="settings-future">
                <CreditCard size={20} />
                <div>
                  <h2>Payments</h2>
                  <p>
                    Tenant collection providers, Stripe Connect, gateway
                    selection and settlement rules will appear here after
                    finance policy decisions are recorded.
                  </p>
                </div>
              </section>
            )}
            {tab === "waivers" && (
              <section>
                <div className="settings-card-head">
                  <FileText size={20} />
                  <div>
                    <h2>Waiver templates</h2>
                    <p>
                      Publish an approved version for staff capture. Signed
                      evidence always stays bound to its original version.
                    </p>
                  </div>
                </div>
                {waiverTemplates.error ? (
                  <Notice error>{waiverTemplates.error}</Notice>
                ) : !waiverTemplates.data ? (
                  <Loading />
                ) : waiverTemplates.data.length ? (
                  <div className="waiver-current">
                    <span>ACTIVE VERSION</span>
                    <strong>
                      v{waiverTemplates.data[0].version} ·{" "}
                      {waiverTemplates.data[0].title}
                    </strong>
                    <p>
                      Published{" "}
                      {new Date(
                        waiverTemplates.data[0].created_at,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                ) : (
                  <Notice>No active waiver template has been published.</Notice>
                )}
                {session.permissions.includes("waiver.template.publish") ? (
                  <div className="waiver-editor">
                    <h2>
                      {waiverTemplates.data?.length
                        ? "Publish replacement version"
                        : "Publish first version"}
                    </h2>
                    <p className="policy-copy">
                      Confirm wording with the tenant's legal and insurance
                      advisers before publishing. Publishing supersedes the
                      current version for future signatures; it never changes
                      existing evidence.
                    </p>
                    <Field label="Template title">
                      <input
                        required
                        maxLength={160}
                        value={waiverTitle}
                        onChange={(e) => setWaiverTitle(e.target.value)}
                        placeholder="For example, Tour participant waiver"
                      />
                    </Field>
                    <Field label="Approved waiver wording">
                      <textarea
                        required
                        maxLength={20000}
                        value={waiverBody}
                        onChange={(e) => setWaiverBody(e.target.value)}
                        placeholder="Enter tenant-approved wording"
                        rows={12}
                      />
                    </Field>
                    {waiverMutation.error && (
                      <Notice error>{waiverMutation.error}</Notice>
                    )}
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={
                          waiverMutation.busy ||
                          !waiverTitle.trim() ||
                          !waiverBody.trim()
                        }
                        onClick={() => void publishWaiverTemplate()}
                      >
                        {waiverMutation.busy
                          ? "Publishing…"
                          : "Publish immutable version"}
                        <Check size={17} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <Notice>
                    Only the tenant owner can publish or replace waiver wording.
                  </Notice>
                )}
              </section>
            )}
            {tab === "security" ? (
              session.role === "owner" ? (
                <SupportAccessSettings />
              ) : (
                <section>
                  <div className="settings-card-head">
                    <ShieldCheck size={20} />
                    <div>
                      <h2>Security & support access</h2>
                      <p>
                        Only a tenant owner can review or authorize Zettaz
                        support access.
                      </p>
                    </div>
                  </div>
                </section>
              )
            ) : null}
            {tab === "commercial" && (
              <section>
                <h2>Collection methods & booking sources</h2>
                <Field
                  label="Allowed manual collection methods"
                  hint="Comma-separated codes. Suggested: cash, card, online, bank_transfer, reseller_payment. Guest payment via reseller is a guest-to-operator ledger entry when the guest paid through a reseller channel — not a substitute for Partner collects / Partner invoice claims."
                >
                  <input
                    required
                    value={methods}
                    onChange={(e) => setMethods(e.target.value)}
                  />
                </Field>
                <Field
                  label="Booking sources"
                  hint="Comma-separated codes such as phone, walk_in, website, partner_reseller. Channel brands (Viator, GetYourGuide) belong under Partners / Resellers organizations, not as separate booking sources."
                >
                  <input
                    required
                    value={sources}
                    onChange={(e) => setSources(e.target.value)}
                  />
                </Field>
                <Toggle
                  label="Allow confirmed amendments to create an additional balance due"
                  description="When disabled, an accepted amendment must satisfy its minimum-paid rule. This is separate from the initial confirmation policy."
                  checked={config.allowAmendmentBalance ?? false}
                  onChange={(checked) =>
                    setConfig({
                      ...config,
                      allowAmendmentBalance: checked,
                    })
                  }
                />
              </section>
            )}
            {mutation.error && (
              <Notice error>
                {mutation.error}{" "}
                <button type="button" className="text-button" onClick={refresh}>
                  Reload current settings
                </button>
              </Notice>
            )}
            {(tab === "commercial" || tab === "localization") && (
              <FormActions stickyOnMobile>
                <button className="button" disabled={mutation.busy}>
                  {mutation.busy ? "Saving…" : "Save settings"}
                  <Check size={17} />
                </button>
              </FormActions>
            )}
          </form>
        )}
      </div>
    </>
  );
}

type SupportGrant = {
  id: string;
  platform_actor_id: string;
  platform_user: string;
  purpose: string;
  permissions: string[];
  status: "pending" | "approved" | "rejected" | "revoked";
  requested_at: string;
  expires_at: string | null;
  decision_reason: string | null;
};
function PartnersResellersSettings() {
  const partners = useResource<Partner[]>("finance/v1/partners");
  const create = useMutation();
  const statusMutation = useMutation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  async function addPartner() {
    const result = await create.run("finance/v1/partners", {
      name,
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      notes,
    });
    if (result) {
      setName("");
      setEmail("");
      setPhone("");
      setNotes("");
      partners.reload();
    }
  }
  async function setStatus(partner: Partner, status: "active" | "inactive") {
    const result = await statusMutation.run(
      `finance/v1/partners/${partner.id}/status`,
      { status },
    );
    if (result) partners.reload();
  }
  return (
    <section>
      <div className="settings-card-head" id="resellers">
        <Handshake size={20} />
        <div>
          <h2>Partners / Resellers</h2>
          <p>
            External hotels and resellers used across reservations and finance.
            Staff attribute bookings here; settlement agreements stay in Finance.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Organization name">
          <input
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Email · optional">
          <input
            type="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Phone · optional">
          <input
            type="tel"
            maxLength={40}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field label="Notes · optional">
          <input
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button"
          disabled={create.busy || !name.trim()}
          onClick={() => void addPartner()}
        >
          {create.busy ? "Saving…" : "Add partner"}
        </button>
      </div>
      {(create.error || statusMutation.error || partners.error) && (
        <Notice error>
          {create.error || statusMutation.error || partners.error}
        </Notice>
      )}
      <div className="stack-list">
        {(partners.data ?? []).map((partner) => (
          <div className="detail-row" key={partner.id}>
            <span>
              <strong>{partner.name}</strong>
              <small>
                {label(partner.status ?? "active")}
                {partner.email ? ` · ${partner.email}` : ""}
                {partner.phone ? ` · ${partner.phone}` : ""}
              </small>
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={statusMutation.busy}
              onClick={() =>
                void setStatus(
                  partner,
                  partner.status === "inactive" ? "active" : "inactive",
                )
              }
            >
              {partner.status === "inactive" ? "Reactivate" : "Deactivate"}
            </button>
          </div>
        ))}
        {!partners.data?.length && (
          <Empty title="No partners yet" />
        )}
      </div>
    </section>
  );
}
function SupportAccessSettings() {
  const grants = useResource<{ items: SupportGrant[] }>(
    "admin/v1/support-access",
  );
  const mutation = useMutation();
  const [pending, setPending] = useState<{
    grant: SupportGrant;
    action: "approved" | "rejected" | "revoked";
  } | null>(null);

  async function confirmPending(reason: string) {
    if (!pending) return;
    const { grant, action } = pending;
    const result =
      action === "revoked"
        ? await mutation.run(`admin/v1/support-access/${grant.id}/revoke`, {
            reason,
          })
        : await mutation.run(`admin/v1/support-access/${grant.id}/decision`, {
            decision: action,
            ...(action === "approved" ? { expiresInHours: 8 } : {}),
            reason,
          });
    if (result) {
      setPending(null);
      grants.reload();
    }
  }

  return (
    <section>
      <div className="settings-card-head">
        <ShieldCheck size={20} />
        <div>
          <h2>Security & support access</h2>
          <p>
            Review time-limited, read-only access requested by an identified
            Zettaz support user.
          </p>
        </div>
      </div>
      <Notice>
        Support has no standing tenant access. Approval lasts at most eight
        hours, remains visibly marked in the workspace, and can be revoked
        immediately.
      </Notice>
      {(grants.error || mutation.error) && (
        <Notice error>{grants.error || mutation.error}</Notice>
      )}
      {!grants.data ? (
        <Loading />
      ) : !grants.data.items.length ? (
        <Empty title="No support requests">
          <p>No Zettaz support user has requested access to this tenant.</p>
        </Empty>
      ) : (
        <>
          <div className="stack-list support-grants resource-table">
            {grants.data.items.map((grant) => (
              <div className="detail-row" key={grant.id}>
                <span>
                  <strong>{grant.platform_user}</strong>
                  <small>{grant.purpose}</small>
                  <small>{grant.permissions.map(label).join(" · ")}</small>
                  {grant.expires_at && (
                    <small>
                      Expires {new Date(grant.expires_at).toLocaleString()}
                    </small>
                  )}
                </span>
                <span className="support-grant-actions">
                  <Status state={grant.status} />
                  {grant.status === "pending" && (
                    <>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={mutation.busy}
                        onClick={() =>
                          setPending({ grant, action: "rejected" })
                        }
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={mutation.busy}
                        onClick={() =>
                          setPending({ grant, action: "approved" })
                        }
                      >
                        Approve 8 hours
                      </button>
                    </>
                  )}
                  {grant.status === "approved" && (
                    <button
                      type="button"
                      className="text-link danger-text"
                      disabled={mutation.busy}
                      onClick={() => setPending({ grant, action: "revoked" })}
                    >
                      Revoke
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="resource-cards support-grant-cards">
            {grants.data.items.map((grant) => (
              <article key={grant.id} className="resource-card">
                <div className="resource-card-head">
                  <strong>{grant.platform_user}</strong>
                  <Status state={grant.status} />
                </div>
                <small>{grant.purpose}</small>
                <small>{grant.permissions.map(label).join(" · ")}</small>
                {grant.expires_at && (
                  <small>
                    Expires {new Date(grant.expires_at).toLocaleString()}
                  </small>
                )}
                <div className="row-actions support-grant-actions">
                  {grant.status === "pending" && (
                    <>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={mutation.busy}
                        onClick={() =>
                          setPending({ grant, action: "rejected" })
                        }
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={mutation.busy}
                        onClick={() =>
                          setPending({ grant, action: "approved" })
                        }
                      >
                        Approve 8 hours
                      </button>
                    </>
                  )}
                  {grant.status === "approved" && (
                    <button
                      type="button"
                      className="text-link danger-text"
                      disabled={mutation.busy}
                      onClick={() => setPending({ grant, action: "revoked" })}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        title={
          pending?.action === "approved"
            ? "Approve support access?"
            : pending?.action === "rejected"
              ? "Reject support request?"
              : "Revoke support access?"
        }
        description={
          pending
            ? `${pending.grant.platform_user} · ${pending.grant.purpose}`
            : undefined
        }
        confirmLabel={
          pending?.action === "approved"
            ? "Approve 8 hours"
            : pending?.action === "rejected"
              ? "Reject request"
              : "Revoke access"
        }
        danger={pending?.action !== "approved"}
        reasonRequired
        reasonLabel="Reason"
        reasonPlaceholder="Record why this decision is being made."
        busy={mutation.busy}
        error={mutation.error}
        onClose={() => setPending(null)}
        onConfirm={confirmPending}
      />
    </section>
  );
}
export function Team({ session }: { session: Session }) {
  const members = usePaged<Member>("staff/v1/workspace/members", "", {}, 25),
    mutation = useMutation(),
    add = useMutation(),
    grant = useMutation(),
    docMutation = useMutation(),
    roleData = useResource<{ roles: RoleData[] }>("staff/v1/workspace/roles");
  const canManageDocs = session.permissions.includes("documents.expiry.manage");
  const documents = useResource<ComplianceDocument[]>(
    canManageDocs ? "ops/v1/compliance-documents" : null,
  );
  const defaultCountry = session.tenant.business_profile?.country || "";
  const emptyForm = {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    suite: "",
    city: "",
    stateParish: "",
    postalCode: "",
    country: defaultCountry,
    role: "reservations",
  };
  const [form, setForm] = useState(emptyForm),
    [editor, setEditor] = useState<null | { mode: "create" } | { mode: "edit"; member: Member }>(
      null,
    ),
    [menuFor, setMenuFor] = useState<string | null>(null),
    [invitationToken, setInvitationToken] = useState(""),
    [grantNotice, setGrantNotice] = useState(""),
    [pendingRevoke, setPendingRevoke] = useState<Member | null>(null),
    [docsFor, setDocsFor] = useState<Member | null>(null),
    [docBusy, setDocBusy] = useState(false),
    [docError, setDocError] = useState(""),
    [docForm, setDocForm] = useState({
      documentType: "",
      expiresOn: "",
      notes: "",
      file: null as File | null,
    });
  const libraryUsage = useResource<LibraryUsage>(
    canManageDocs && docsFor ? "ops/v1/document-library/usage" : null,
  );
  const roles = (roleData.data?.roles ?? []).filter(
    (item) => item.code !== "owner",
  );
  const activeCount = members.items.filter((item) => item.active).length;
  const invitedCount = members.items.filter(
    (item) => item.access_status === "invited" || item.access_status === "pending",
  ).length;
  const revokedCount = members.items.filter(
    (item) => item.access_status === "revoked",
  ).length;
  const roleName = (code: string) =>
    roleData.data?.roles.find((r) => r.code === code)?.name ?? label(code);

  useEffect(() => {
    if (!menuFor) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest?.(".staff-row-menu")) return;
      setMenuFor(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuFor(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuFor]);

  function openCreate() {
    setForm({ ...emptyForm, role: roles[0]?.code ?? "reservations" });
    setEditor({ mode: "create" });
  }
  function openEdit(m: Member) {
    setForm({
      firstName: m.first_name || m.name.split(" ")[0] || "",
      lastName: m.last_name || m.name.split(" ").slice(1).join(" "),
      email: m.email,
      phone: m.phone || "",
      street: m.address?.street || "",
      suite: m.address?.suite || "",
      city: m.address?.city || "",
      stateParish: m.address?.stateParish || "",
      postalCode: m.address?.postalCode || "",
      country: m.address?.country || defaultCountry,
      role: m.role === "owner" ? m.role : m.role,
    });
    setEditor({ mode: "edit", member: m });
    setMenuFor(null);
  }

  async function saveStaff() {
    const address = {
      street: form.street,
      suite: form.suite,
      city: form.city,
      stateParish: form.stateParish,
      postalCode: form.postalCode,
      country: form.country,
    };
    if (editor?.mode === "create") {
      const result = await add.run("admin/v1/staff", {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        address,
        role: form.role,
      });
      if (result) {
        setEditor(null);
        members.reload();
      }
      return;
    }
    if (editor?.mode === "edit") {
      const body: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        address,
      };
      if (editor.member.role !== "owner") body.role = form.role;
      const result = await mutation.run(
        "admin/v1/staff/" + editor.member.id,
        body,
        "PATCH",
      );
      if (result) {
        setEditor(null);
        members.reload();
      }
    }
  }

  async function grantAccess(m: Member) {
    setMenuFor(null);
    const result = await grant.run<{
      token: string;
      emailed: boolean;
    }>("admin/v1/staff/" + m.id + "/grant-access", {});
    if (result) {
      setInvitationToken(result.token);
      setGrantNotice(
        result.emailed
          ? `Activation email sent to ${m.email}.`
          : `Invitation created. Copy the token below — SMTP email was not sent.`,
      );
      members.reload();
    }
  }

  async function revoke(m: Member) {
    const result = await mutation.run(
      "admin/v1/members/" + m.id,
      { role: m.role, active: false },
      "PATCH",
    );
    if (result) {
      setPendingRevoke(null);
      members.reload();
    }
  }

  async function restore(m: Member) {
    setMenuFor(null);
    const result = await mutation.run(
      "admin/v1/members/" + m.id,
      { role: m.role, active: true },
      "PATCH",
    );
    if (result) members.reload();
  }

  const memberDocs =
    docsFor && documents.data
      ? documents.data.filter((d) => d.crew_actor_id === docsFor.id)
      : [];

  async function saveDocument() {
    if (!docsFor) return;
    setDocBusy(true);
    setDocError("");
    try {
      await uploadComplianceDocument(
        session.tenant.id,
        {
          crewActorId: docsFor.id,
          documentType: docForm.documentType,
          expiresOn: docForm.expiresOn,
          notes: docForm.notes,
        },
        docForm.file,
      );
      setDocForm({
        documentType: "",
        expiresOn: "",
        notes: "",
        file: null,
      });
      setDocsFor(null);
      documents.reload();
      libraryUsage.reload();
      members.reload();
    } catch (e) {
      setDocError((e as Error).message);
    } finally {
      setDocBusy(false);
    }
  }

  async function deleteDocument(id: string) {
    const result = await docMutation.run(
      "ops/v1/compliance-documents/" + id,
      {},
      "DELETE",
    );
    if (result !== undefined) {
      documents.reload();
      libraryUsage.reload();
      members.reload();
    }
  }

  function accessLabel(m: Member) {
    if (m.role === "owner") return "active";
    return m.access_status ?? (m.active ? "active" : "revoked");
  }

  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Staff & access"
        description="People, workspace access, and personal compliance documents. External partners use a separate access model."
      />

      <div className="resource-metrics staff-metrics">
        <div>
          <strong>
            {members.busy && !members.items.length ? "—" : activeCount}
          </strong>
          <span>Active</span>
        </div>
        <div>
          <strong>
            {members.busy && !members.items.length ? "—" : invitedCount}
          </strong>
          <span>Pending access</span>
        </div>
        <div className={revokedCount ? "attention" : ""}>
          <strong>
            {members.busy && !members.items.length ? "—" : revokedCount}
          </strong>
          <span>Revoked</span>
        </div>
      </div>

      <div className="view-action-bar resource-view-bar">
        <div
          className="view-tabs compact"
          role="tablist"
          aria-label="Staff and roles"
        >
          <Link
            href="/team"
            className="view-tab-link"
            role="tab"
            aria-selected="true"
          >
            Staff
          </Link>
          <Link
            href="/roles"
            className="view-tab-link"
            role="tab"
            aria-selected="false"
          >
            Roles & permissions
          </Link>
        </div>
        <button
          type="button"
          className="button catalog-add-btn"
          aria-label="Add staff"
          onClick={openCreate}
        >
          <Plus size={17} />
          <span className="button-label">Add staff</span>
        </button>
      </div>

      {(invitationToken || grantNotice) && (
        <section className="panel form-panel staff-invite-token">
          <h2>Grant access</h2>
          {grantNotice && <p className="muted">{grantNotice}</p>}
          {invitationToken && (
            <>
              <p className="muted">
                Recipient activates at <strong>/activate</strong> with this
                one-time token (expires in 7 days).
              </p>
              <Field label="One-time token">
                <input
                  readOnly
                  value={invitationToken}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </Field>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invitationToken);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Copy token
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setInvitationToken("");
                    setGrantNotice("");
                  }}
                >
                  Done
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {(members.error ||
        mutation.error ||
        add.error ||
        grant.error ||
        docMutation.error) && (
        <Notice error>
          {members.error ||
            mutation.error ||
            add.error ||
            grant.error ||
            docMutation.error}
        </Notice>
      )}

      <section className="panel" aria-label="Staff members">
        <div className="panel-heading plain resource-tab-intro">
          <div>
            <h2>Staff members</h2>
            <p className="muted">
              Add people once. Grant access sends an activation email; revoke
              blocks sign-in without deleting the person.
            </p>
          </div>
        </div>
        {members.busy && !members.items.length ? (
          <Loading />
        ) : members.items.length ? (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Staff member</th>
                    <th>Role</th>
                    <th>Access</th>
                    <th>Last login</th>
                    <th>Docs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {members.items.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>
                          {m.name}
                          {m.id === session.actorId ? " (you)" : ""}
                        </strong>
                        <small>
                          {m.email}
                          {m.phone ? ` · ${m.phone}` : ""}
                        </small>
                      </td>
                      <td>
                        {m.role === "owner" ? (
                          <span className="owner-role">
                            <ShieldCheck size={15} />
                            Owner
                          </span>
                        ) : (
                          roleName(m.role)
                        )}
                      </td>
                      <td>
                        <Status state={accessLabel(m)} />
                      </td>
                      <td>
                        <small>
                          {m.last_login_at
                            ? dateTime(
                                m.last_login_at,
                                session.tenant.timezone,
                              )
                            : "—"}
                        </small>
                      </td>
                      <td>
                        <small>{m.document_count ?? 0}</small>
                      </td>
                      <td className="staff-actions-cell">
                        <div className="staff-row-menu">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Actions for ${m.name}`}
                            aria-expanded={menuFor === m.id}
                            onClick={() =>
                              setMenuFor((id) => (id === m.id ? null : m.id))
                            }
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          {menuFor === m.id && (
                            <div className="staff-action-menu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => openEdit(m)}
                              >
                                <Pencil size={15} aria-hidden="true" />
                                Edit
                              </button>
                              {m.role !== "owner" && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={grant.busy}
                                  onClick={() => void grantAccess(m)}
                                >
                                  <MailPlus size={15} aria-hidden="true" />
                                  {m.access_status === "active"
                                    ? "Resend access"
                                    : "Grant access"}
                                </button>
                              )}
                              {canManageDocs && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setDocsFor(m);
                                    setMenuFor(null);
                                  }}
                                >
                                  <FileText size={15} aria-hidden="true" />
                                  Manage documents
                                </button>
                              )}
                              {m.role !== "owner" &&
                                m.id !== session.actorId &&
                                (m.active ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="danger-text"
                                    onClick={() => {
                                      setPendingRevoke(m);
                                      setMenuFor(null);
                                    }}
                                  >
                                    <Ban size={15} aria-hidden="true" />
                                    Revoke access
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => void restore(m)}
                                  >
                                    <RotateCcw size={15} aria-hidden="true" />
                                    Restore access
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {members.items.map((m) => (
                <article key={m.id} className="resource-card">
                  <div className="resource-card-head">
                    <strong>
                      {m.name}
                      {m.id === session.actorId ? " (you)" : ""}
                    </strong>
                    <Status state={accessLabel(m)} />
                  </div>
                  <small>
                    {m.email}
                    {m.phone ? ` · ${m.phone}` : ""}
                  </small>
                  <p>{roleName(m.role)}</p>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => openEdit(m)}
                    >
                      Edit
                    </button>
                    {m.role !== "owner" && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => void grantAccess(m)}
                      >
                        Grant access
                      </button>
                    )}
                    {canManageDocs && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setDocsFor(m)}
                      >
                        Documents
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <Empty title="No staff members yet">
            Add the first team member, then grant workspace access.
          </Empty>
        )}
        <More {...members} count={members.items.length} />
      </section>

      <FormDialog
        open={Boolean(editor)}
        className="staff-form-dialog"
        title={editor?.mode === "edit" ? "Edit staff" : "Add staff"}
        description={
          editor?.mode === "edit"
            ? "Update contact details and role. Login access is managed separately."
            : "Add someone to the roster. They stay inactive until you grant access."
        }
        busy={add.busy || mutation.busy}
        error={add.error || mutation.error}
        submitLabel={editor?.mode === "edit" ? "Save changes" : "Add staff"}
        onClose={() => setEditor(null)}
        onSubmit={() => void saveStaff()}
      >
        <section className="staff-form-section">
          <div className="staff-form-section-head">
            <UserRound size={16} aria-hidden="true" />
            <div>
              <h3>Person</h3>
              <p>Name used on manifests and assignments.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="First name" required>
              <input
                required
                autoComplete="given-name"
                value={form.firstName}
                onChange={(e) =>
                  setForm((v) => ({ ...v, firstName: e.target.value }))
                }
              />
            </Field>
            <Field label="Last name">
              <input
                autoComplete="family-name"
                value={form.lastName}
                onChange={(e) =>
                  setForm((v) => ({ ...v, lastName: e.target.value }))
                }
              />
            </Field>
          </div>
        </section>

        <section className="staff-form-section">
          <div className="staff-form-section-head">
            <Phone size={16} aria-hidden="true" />
            <div>
              <h3>Contact</h3>
              <p>Email is required for invitations and account recovery.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Email" required>
              <input
                type="email"
                required
                autoComplete="email"
                disabled={editor?.mode === "edit"}
                value={form.email}
                onChange={(e) =>
                  setForm((v) => ({ ...v, email: e.target.value }))
                }
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) =>
                  setForm((v) => ({ ...v, phone: e.target.value }))
                }
              />
            </Field>
          </div>
        </section>

        <section className="staff-form-section">
          <div className="staff-form-section-head">
            <MapPin size={16} aria-hidden="true" />
            <div>
              <h3>Address</h3>
              <p>Optional. Useful for payroll and emergency contact records.</p>
            </div>
          </div>
          <div className="staff-address-grid">
            <div className="staff-field-span-2">
              <Field label="Street address">
                <input
                  autoComplete="street-address"
                  value={form.street}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, street: e.target.value }))
                  }
                />
              </Field>
            </div>
            <Field label="Apt / suite">
              <input
                autoComplete="address-line2"
                value={form.suite}
                onChange={(e) =>
                  setForm((v) => ({ ...v, suite: e.target.value }))
                }
              />
            </Field>
            <Field label="City">
              <input
                autoComplete="address-level2"
                value={form.city}
                onChange={(e) =>
                  setForm((v) => ({ ...v, city: e.target.value }))
                }
              />
            </Field>
            <Field label="State / Parish">
              <input
                autoComplete="address-level1"
                value={form.stateParish}
                onChange={(e) =>
                  setForm((v) => ({ ...v, stateParish: e.target.value }))
                }
              />
            </Field>
            <Field label="Postal code">
              <input
                autoComplete="postal-code"
                value={form.postalCode}
                onChange={(e) =>
                  setForm((v) => ({ ...v, postalCode: e.target.value }))
                }
              />
            </Field>
            <div className="staff-field-span-3">
              <Field label="Country">
                <select
                  autoComplete="country"
                  value={form.country}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, country: e.target.value }))
                  }
                >
                  <option value="">Select country</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </section>

        <section className="staff-form-section staff-form-section-role">
          <div className="staff-form-section-head">
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <h3>Role</h3>
              <p>Controls what they can do once access is granted.</p>
            </div>
          </div>
          {editor?.mode === "edit" && editor.member.role === "owner" ? (
            <p className="staff-form-note">
              Owner role cannot be changed here.
            </p>
          ) : (
            <Field label="Workspace role" required>
              <select
                required
                value={form.role}
                onChange={(e) =>
                  setForm((v) => ({ ...v, role: e.target.value }))
                }
                disabled={!roles.length}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </section>
      </FormDialog>

      <FormDialog
        open={Boolean(docsFor)}
        className="staff-docs-dialog"
        title={docsFor ? `Documents · ${docsFor.name}` : "Documents"}
        description="Expiry documents for this person, stored in this tenant’s document library."
        busy={docBusy || docMutation.busy}
        error={docError || docMutation.error}
        submitLabel="Add document"
        submitDisabled={
          !docForm.documentType ||
          !docForm.expiresOn ||
          (libraryUsage.data != null &&
            libraryUsage.data.usedBytes >= libraryUsage.data.quotaBytes &&
            Boolean(docForm.file))
        }
        onClose={() => {
          setDocsFor(null);
          setDocError("");
          setDocForm({
            documentType: "",
            expiresOn: "",
            notes: "",
            file: null,
          });
        }}
        onSubmit={() => void saveDocument()}
        afterActions={
          <StaffDocumentArchive
            docs={memberDocs}
            usage={libraryUsage.data}
            busy={docBusy || docMutation.busy}
            onDownload={(doc) =>
              void downloadApiFile(
                `ops/v1/compliance-documents/${doc.id}/file`,
                doc.file_name || "document",
              )
            }
            onRemove={(id) => void deleteDocument(id)}
          />
        }
      >
        <StaffDocumentAddFields
          form={docForm}
          setForm={setDocForm}
          locale={session.tenant.config.locale}
          dateFormat={session.tenant.config.dateFormat}
        />
      </FormDialog>

      <ConfirmDialog
        open={Boolean(pendingRevoke)}
        title="Revoke access?"
        description={
          pendingRevoke
            ? `${pendingRevoke.name} will no longer be able to sign in to this tenant. You can restore access later.`
            : undefined
        }
        confirmLabel="Revoke access"
        danger
        busy={mutation.busy}
        error={mutation.error}
        onClose={() => setPendingRevoke(null)}
        onConfirm={() => {
          if (pendingRevoke) return revoke(pendingRevoke);
        }}
      />
    </>
  );
}
type RoleData = {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  permissions: string[];
};
type PermissionData = {
  code: string;
  name: string;
  description: string;
  module_code: string;
  module_name: string;
};
export function RolesPermissions() {
  const data = useResource<{
      roles: RoleData[];
      permissions: PermissionData[];
    }>("staff/v1/workspace/roles"),
    create = useMutation();
  const [name, setName] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [createOpen, setCreateOpen] = useState(false);
  if (data.error) return <Notice error>{data.error}</Notice>;
  if (!data.data) return <Loading />;
  const grouped = Object.entries(
    Object.groupBy(
      data.data.permissions,
      (permission) => permission.module_name,
    ),
  );
  const systemCount = data.data.roles.filter((role) => role.is_system).length;
  const customCount = data.data.roles.filter((role) => !role.is_system).length;

  async function submit() {
    const result = await create.run("admin/v1/roles", {
      name,
      permissions: selected,
    });
    if (result) {
      setName("");
      setSelected([]);
      setCreateOpen(false);
      data.reload();
    }
  }

  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Roles & permissions"
        description="System roles are protected. Create tenant roles by selecting the capabilities staff require."
      />

      <div className="resource-metrics staff-metrics">
        <div>
          <strong>{systemCount}</strong>
          <span>System roles</span>
        </div>
        <div>
          <strong>{customCount}</strong>
          <span>Custom roles</span>
        </div>
        <div>
          <strong>{data.data.permissions.length}</strong>
          <span>Permissions</span>
        </div>
      </div>

      <div className="view-action-bar resource-view-bar">
        <div
          className="view-tabs compact"
          role="tablist"
          aria-label="Staff and roles"
        >
          <Link
            href="/team"
            className="view-tab-link"
            role="tab"
            aria-selected="false"
          >
            Staff
          </Link>
          <Link
            href="/roles"
            className="view-tab-link"
            role="tab"
            aria-selected="true"
          >
            Roles & permissions
          </Link>
        </div>
        <button
          type="button"
          className="button catalog-add-btn"
          aria-label="Create role"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={17} />
          <span className="button-label">Create role</span>
        </button>
      </div>

      <section className="panel roles-table" aria-label="Roles">
        <div className="panel-heading plain resource-tab-intro">
          <div>
            <h2>Roles</h2>
            <p className="muted">
              Assignable capabilities for staff invitations and member updates.
            </p>
          </div>
        </div>
        {data.data.roles.length ? (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Permissions</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.roles.map((role) => (
                    <tr key={role.id}>
                      <td>
                        <strong>{role.name}</strong>
                        <small>{role.code}</small>
                      </td>
                      <td>
                        <span className="role-permission-summary">
                          {role.permissions.length
                            ? `${role.permissions.length} permissions`
                            : "No permissions"}
                        </span>
                        <small>
                          {role.permissions.map(label).join(", ") || "—"}
                        </small>
                      </td>
                      <td>
                        <Status
                          state={role.is_system ? "system" : "custom"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {data.data.roles.map((role) => (
                <article key={role.id} className="resource-card">
                  <div className="resource-card-head">
                    <strong>{role.name}</strong>
                    <Status state={role.is_system ? "system" : "custom"} />
                  </div>
                  <small>{role.code}</small>
                  <small>
                    {role.permissions.map(label).join(", ") ||
                      "No permissions"}
                  </small>
                </article>
              ))}
            </div>
          </>
        ) : (
          <Empty title="No roles configured">
            Create a tenant role with the permissions your staff need.
          </Empty>
        )}
      </section>

      <FormDialog
        open={createOpen}
        title="Create tenant role"
        description="Choose only the capabilities this role should grant."
        busy={create.busy}
        error={
          create.error ||
          (createOpen && !selected.length
            ? "Select at least one permission to continue."
            : null)
        }
        submitLabel="Create role"
        onClose={() => setCreateOpen(false)}
        onSubmit={async () => {
          if (!selected.length) return;
          await submit();
        }}
      >
        <Field label="Role name" required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <div className="permission-grid permission-grid-modal">
          {grouped.map(([module, permissions]) => (
            <fieldset key={module}>
              <legend>{module}</legend>
              {permissions!.map((permission) => (
                <label key={permission.code}>
                  <input
                    type="checkbox"
                    checked={selected.includes(permission.code)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(permission.code)
                          ? current.filter((code) => code !== permission.code)
                          : [...current, permission.code],
                      )
                    }
                  />{" "}
                  <span>
                    <strong>{permission.name}</strong>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </FormDialog>
    </>
  );
}

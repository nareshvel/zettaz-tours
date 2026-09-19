"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AvailabilityRule, Product, Session } from "@/lib/types";
import { occupancyCaption, modeLabel, weekdayLabels } from "@/lib/types";
import { money, priceFromMinor, useMutation, useResource } from "@/lib/client";
import { Field, FormDialog, Notice, TenantDateInput } from "./common";

function clockLabel(time: string, locale: string, timeFormat: "12h" | "24h") {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat !== "24h",
  }).format(date);
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

function weekdayMon1(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function daysInRange(start: string, end: string) {
  if (!start || !end || end < start) return [] as string[];
  const out: string[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) out.push(day);
  return out;
}

function monthKeys(start: string, end: string) {
  const days = daysInRange(start, end);
  const keys: string[] = [];
  for (const day of days) {
    const key = day.slice(0, 7);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function paintWeekdays(
  start: string,
  end: string,
  weekdays: number[],
): string[] {
  return daysInRange(start, end).filter((day) =>
    weekdays.includes(weekdayMon1(day)),
  );
}

function deriveWeekdaysAndBlackouts(
  start: string,
  end: string,
  selected: Set<string>,
) {
  const weekdays = new Set<number>();
  for (const day of selected) {
    if (day >= start && day <= end) weekdays.add(weekdayMon1(day));
  }
  const weekdayList = [...weekdays].sort((a, b) => a - b);
  const blackoutDates = daysInRange(start, end).filter(
    (day) => weekdayList.includes(weekdayMon1(day)) && !selected.has(day),
  );
  return { weekdays: weekdayList, blackoutDates };
}

function selectedDaysFromRule(rule: AvailabilityRule) {
  const painted = new Set(
    paintWeekdays(rule.start_date, rule.end_date, rule.weekdays),
  );
  for (const day of rule.blackouts ?? []) painted.delete(day);
  return painted;
}

export type ScheduleEditImpact = {
  added: number;
  cancelled: number;
  capacityUpdated: number;
  revived: number;
};

export function ScheduleFormDialog({
  session,
  open,
  productId,
  rule = null,
  onClose,
  onCreated,
  onSaved,
}: {
  session: Session;
  open: boolean;
  productId?: string;
  /** When set, dialog opens in edit mode and can regenerate upcoming departures. */
  rule?: AvailabilityRule | null;
  onClose: () => void;
  onCreated?: (result: { ruleId?: string }) => void;
  onSaved?: (result?: { impact?: ScheduleEditImpact }) => void;
}) {
  const today = tenantDay(session.tenant.timezone);
  const isEdit = Boolean(rule);
  const products = useResource<Product[]>(open ? "admin/v1/products" : null);
  const mutation = useMutation();
  const [name, setName] = useState(""),
    [product, setProduct] = useState(productId ?? ""),
    [start, setStart] = useState(today),
    [end, setEnd] = useState(() => shiftDay(today, 89)),
    [times, setTimes] = useState<string[]>(["09:00"]),
    [capacity, setCapacity] = useState(""),
    [adultCapacity, setAdultCapacity] = useState(""),
    [childCapacity, setChildCapacity] = useState(""),
    [fleetUnits, setFleetUnits] = useState("1"),
    [adultPerUnit, setAdultPerUnit] = useState(""),
    [occupancyPerUnit, setOccupancyPerUnit] = useState(""),
    [childPerUnit, setChildPerUnit] = useState(""),
    [selectedDays, setSelectedDays] = useState<Set<string>>(
      () =>
        new Set(
          paintWeekdays(today, shiftDay(today, 89), [1, 2, 3, 4, 5, 6, 7]),
        ),
    ),
    [monthCursor, setMonthCursor] = useState(today.slice(0, 7));

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name || "");
      setProduct(rule.product_id ?? productId ?? "");
      setStart(rule.start_date);
      setEnd(rule.end_date);
      setTimes(rule.times.length ? rule.times : ["09:00"]);
      setCapacity(rule.capacity != null ? String(rule.capacity) : "");
      setAdultCapacity(
        rule.capacity_adult != null
          ? String(rule.capacity_adult)
          : rule.capacity != null
            ? String(rule.capacity)
            : "",
      );
      setChildCapacity(
        rule.capacity_child != null ? String(rule.capacity_child) : "",
      );
      setFleetUnits("1");
      setOccupancyPerUnit(
        rule.capacity != null ? String(rule.capacity) : "",
      );
      setAdultPerUnit(
        rule.capacity_adult != null
          ? String(rule.capacity_adult)
          : rule.capacity != null
            ? String(rule.capacity)
            : "",
      );
      setChildPerUnit(
        rule.capacity_child != null ? String(rule.capacity_child) : "",
      );
      setSelectedDays(selectedDaysFromRule(rule));
      setMonthCursor(rule.start_date.slice(0, 7));
      return;
    }
    setName("");
    setProduct(productId ?? "");
    setStart(today);
    setEnd(shiftDay(today, 89));
    setTimes(["09:00"]);
    setCapacity("");
    setAdultCapacity("");
    setChildCapacity("");
    setFleetUnits("1");
    setAdultPerUnit("");
    setOccupancyPerUnit("");
    setChildPerUnit("");
    setSelectedDays(
      new Set(paintWeekdays(today, shiftDay(today, 89), [1, 2, 3, 4, 5, 6, 7])),
    );
    setMonthCursor(today.slice(0, 7));
  }, [open, productId, rule]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduledProducts =
    products.data?.filter(
      (item) =>
        (item.availability_mode ?? "fixed_departure") === "fixed_departure" &&
        (item.status ?? "active") === "active",
    ) ?? [];
  const selected = scheduledProducts.find((item) => item.id === product);
  const productLocked = Boolean(productId) || isEdit;
  const uniqueTimes = [...new Set(times.filter(Boolean))];
  const operatingDays = [...selectedDays]
    .filter((day) => day >= start && day <= end)
    .sort();
  const departureCount = operatingDays.length * uniqueTimes.length;
  const spanDays =
    start && end && end >= start
      ? Math.round(
          (new Date(`${end}T12:00:00Z`).getTime() -
            new Date(`${start}T12:00:00Z`).getTime()) /
            86400000,
        )
      : 0;
  const months = useMemo(() => monthKeys(start, end), [start, end]);
  useEffect(() => {
    if (!months.length) return;
    if (!months.includes(monthCursor)) setMonthCursor(months[0]!);
  }, [months, monthCursor]);

  function applyPreset(weekdays: number[]) {
    setSelectedDays(new Set(paintWeekdays(start, end, weekdays)));
  }

  function toggleDay(day: string) {
    setSelectedDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function onRangeChange(nextStart: string, nextEnd: string) {
    setStart(nextStart);
    setEnd(nextEnd);
    const weekdays = deriveWeekdaysAndBlackouts(
      start,
      end,
      selectedDays,
    ).weekdays;
    const paint = weekdays.length ? weekdays : [1, 2, 3, 4, 5, 6, 7];
    setSelectedDays(new Set(paintWeekdays(nextStart, nextEnd, paint)));
  }

  function sameList(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((value, index) => value === right[index]);
  }

  function occupancyPayload() {
    return {
      capacity: Number(capacity),
      capacityAdult: Number(adultCapacity),
      capacityChild: childCapacity === "" ? null : Number(childCapacity),
    };
  }

  function applyFleetHelper(next?: {
    fleetUnits?: string;
    adultPerUnit?: string;
    occupancyPerUnit?: string;
    childPerUnit?: string;
  }) {
    const units = Math.max(1, Number(next?.fleetUnits ?? fleetUnits) || 1);
    const adultEach = next?.adultPerUnit ?? adultPerUnit;
    const occupancyEach = next?.occupancyPerUnit ?? occupancyPerUnit;
    const childEach = next?.childPerUnit ?? childPerUnit;
    if (!adultEach && !occupancyEach && !childEach) return;
    const adult =
      adultEach !== "" ? Number(adultEach) * units : Number.NaN;
    const child =
      childEach === "" ? null : Number(childEach) * units;
    const occupancy =
      occupancyEach !== ""
        ? Number(occupancyEach) * units
        : Number.isFinite(adult) && child != null
          ? adult + child
          : Number.isFinite(adult)
            ? adult
            : child != null
              ? child
              : Number.NaN;
    if (Number.isFinite(occupancy) && occupancy > 0)
      setCapacity(String(occupancy));
    if (Number.isFinite(adult) && adult > 0) setAdultCapacity(String(adult));
    if (childEach !== "")
      setChildCapacity(
        child == null || !Number.isFinite(child) ? "" : String(child),
      );
  }

  async function submit() {
    const occupancy = occupancyPayload();
    if (isEdit) {
      if (!rule?.version || !name.trim() || editDisabled) return;
      const { weekdays, blackoutDates } = deriveWeekdaysAndBlackouts(
        start,
        end,
        selectedDays,
      );
      const status = rule.status === "paused" ? "paused" : "active";
      const result = await mutation.run(
        `admin/v1/availability-rules/${rule.id}`,
        {
          version: rule.version,
          status,
          name: name.trim(),
          startDate: start,
          endDate: end,
          localTimes: uniqueTimes,
          capacity: occupancy.capacity,
          capacityAdult: occupancy.capacityAdult,
          capacityChild: occupancy.capacityChild,
          weekdays,
          blackoutDates,
        },
        "PATCH",
      );
      if (result) onSaved?.(result as { impact?: ScheduleEditImpact });
      return;
    }
    if (createDisabled) return;
    const { weekdays, blackoutDates } = deriveWeekdaysAndBlackouts(
      start,
      end,
      selectedDays,
    );
    const result = await mutation.run("admin/v1/schedules", {
      name: name.trim(),
      productId: product,
      startDate: start,
      endDate: end,
      localTimes: uniqueTimes,
      capacity: occupancy.capacity,
      capacityAdult: occupancy.capacityAdult,
      capacityChild: occupancy.capacityChild,
      weekdays,
      blackoutDates,
    });
    if (result) onCreated?.(result as { ruleId?: string });
  }

  const originalDays = rule ? selectedDaysFromRule(rule) : new Set<string>();
  const editUnchanged =
    isEdit &&
    rule &&
    (rule.name || "") === name.trim() &&
    rule.start_date === start &&
    rule.end_date === end &&
    String(rule.capacity ?? "") === capacity &&
    String(rule.capacity_adult ?? rule.capacity ?? "") === adultCapacity &&
    String(rule.capacity_child ?? "") === childCapacity &&
    sameList(rule.times, uniqueTimes) &&
    sameList([...originalDays].sort(), [...selectedDays].sort());
  const createDisabled =
    mutation.busy ||
    !name.trim() ||
    !product ||
    !capacity ||
    !adultCapacity ||
    !uniqueTimes.length ||
    !operatingDays.length ||
    spanDays > 365;
  const editDisabled =
    mutation.busy ||
    !name.trim() ||
    !capacity ||
    !adultCapacity ||
    !uniqueTimes.length ||
    !operatingDays.length ||
    spanDays > 365 ||
    !rule?.version ||
    Boolean(editUnchanged);
  const submitDisabled = isEdit ? editDisabled : createDisabled;

  const visibleMonth = monthCursor || start.slice(0, 7);
  const [year, month] = visibleMonth.split("-").map(Number);
  const first = new Date(Date.UTC(year!, month! - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // Monday-first
  const gridDays: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) gridDays.push(null);
  for (let d = 1; d <= 31; d++) {
    const day = `${visibleMonth}-${String(d).padStart(2, "0")}`;
    if (Number.isNaN(Date.parse(`${day}T12:00:00Z`))) break;
    if (day.slice(0, 7) !== visibleMonth) break;
    gridDays.push(day);
  }

  const tourLabel =
    selected?.customer_title ?? selected?.name ?? rule?.product_name ?? "";

  return (
    <FormDialog
      open={open}
      title={isEdit ? "Edit schedule" : "Add schedule"}
      tip={
        isEdit
          ? "Changes update this rule and regenerate upcoming empty departures. Departures with active bookings or holds are protected."
          : "Name the rule, pick the tour and occupancy, then paint the days it runs."
      }
      className="schedule-form-dialog"
      busy={mutation.busy}
      error={mutation.error}
      onErrorDismiss={mutation.clear}
      submitLabel={
        mutation.busy
          ? isEdit
            ? "Saving…"
            : "Creating…"
          : isEdit
            ? "Save schedule"
            : `Create ${departureCount} ${departureCount === 1 ? "departure" : "departures"}`
      }
      submitDisabled={submitDisabled}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="schedule-name-tour">
        <Field label="Schedule name">
          <input
            required
            maxLength={120}
            placeholder="e.g. Morning shared"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Tour">
          {isEdit ? (
            <input readOnly disabled value={tourLabel} />
          ) : (
            <select
              required
              disabled={productLocked}
              value={selected ? product : ""}
              onChange={(e) => {
                setProduct(e.target.value);
                setCapacity("");
                setAdultCapacity("");
                setChildCapacity("");
              }}
            >
              <option value="">Choose a tour</option>
              {scheduledProducts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customer_title ?? item.name} ·{" "}
                  {item.definition.optionName}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {!isEdit && selected && (
        <p className="muted schedule-tour-meta">
          {selected.definition.durationMinutes} minutes ·{" "}
          {modeLabel(selected.availability_mode)}
          {priceFromMinor(selected) != null
            ? ` · from ${money(
                priceFromMinor(selected)!,
                session.tenant.config.bookingCurrency,
                session.tenant.config.locale,
              )}`
            : ""}
        </p>
      )}
      {isEdit && rule?.option_name ? (
        <p className="muted schedule-tour-meta">{rule.option_name}</p>
      ) : null}
      <div className="schedule-fleet-grid">
        <Field
          label="Units on this run"
          tip="Tuk-tuks, boats, buses, jetskis, kayaks, or any other unit you run together. Fills occupancy totals below (units × per unit). Example: 18 tuk-tuks × 4 adults + 2 children → 72 / 108 / 36. You can still edit those totals. Fleet assignments stay separate."
        >
          <input
            type="number"
            min={1}
            max={500}
            value={fleetUnits}
            onChange={(e) => {
              const value = e.target.value;
              setFleetUnits(value);
              applyFleetHelper({ fleetUnits: value });
            }}
          />
        </Field>
        <Field
          label="Occupancy / unit"
          tip="All counting guests on one unit. Multiplied into Maximum occupancy. If left blank, occupancy is adults + children per unit."
        >
          <input
            type="number"
            min={1}
            max={1000}
            value={occupancyPerUnit}
            onChange={(e) => {
              const value = e.target.value;
              setOccupancyPerUnit(value);
              applyFleetHelper({ occupancyPerUnit: value });
            }}
          />
        </Field>
        <Field
          label="Adults / unit"
          tip="Adult places on one unit. Multiplied into Adult capacity below."
        >
          <input
            type="number"
            min={1}
            max={1000}
            value={adultPerUnit}
            onChange={(e) => {
              const value = e.target.value;
              setAdultPerUnit(value);
              applyFleetHelper({ adultPerUnit: value });
            }}
          />
        </Field>
        <Field
          label="Child seats / unit"
          tip="Leave blank for glass-bottom leftover occupancy. Set when child seats cannot replace adult seats; fills Child capacity below."
        >
          <input
            type="number"
            min={0}
            max={1000}
            value={childPerUnit}
            onChange={(e) => {
              const value = e.target.value;
              setChildPerUnit(value);
              applyFleetHelper({ childPerUnit: value });
            }}
          />
        </Field>
      </div>
      <div className="schedule-occupancy-grid">
        <Field
          label="Maximum occupancy"
          tip={
            isEdit
              ? "All counting guests. Cannot go below places already sold. Filled from the units row; change if needed."
              : "Adults plus children who count toward capacity. Filled from the units row; change if this run is different."
          }
        >
          <input
            type="number"
            required
            min={1}
            max={10000}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </Field>
        <Field
          label="Adult capacity"
          tip="Hard ceiling on adult-class guests. Extra occupancy may still be children. Filled from the units row; change if this run is different."
        >
          <input
            type="number"
            required
            min={1}
            max={10000}
            value={adultCapacity}
            onChange={(e) => setAdultCapacity(e.target.value)}
          />
        </Field>
        <Field
          label="Child capacity (optional)"
          tip="Leave blank if children may fill leftover occupancy (glass-bottom style). Set a number when child seats cannot replace adult seats."
        >
          <input
            type="number"
            min={0}
            max={10000}
            value={childCapacity}
            onChange={(e) => setChildCapacity(e.target.value)}
          />
        </Field>
      </div>
      <p className="muted">
        {occupancyCaption({
          capacity: Number(capacity) || null,
          capacityAdult: Number(adultCapacity) || null,
          capacityChild: childCapacity === "" ? null : Number(childCapacity),
        })}
      </p>
      <SectionLabel>Dates & times</SectionLabel>
      <div className="schedule-modal-dates">
        <TenantDateInput
          label="First date"
          value={start}
          max={end || undefined}
          onChange={(value) => onRangeChange(value, end)}
          locale={session.tenant.config.locale}
          dateFormat={session.tenant.config.dateFormat}
        />
        <TenantDateInput
          label="Last date"
          value={end}
          min={start || undefined}
          onChange={(value) => onRangeChange(start, value)}
          locale={session.tenant.config.locale}
          dateFormat={session.tenant.config.dateFormat}
        />
        <div className="schedule-time-primary">
          <Field
            label="Start time"
            hint={clockLabel(
              times[0] || "09:00",
              session.tenant.config.locale,
              session.tenant.config.timeFormat,
            )}
          >
            <input
              type="time"
              required
              value={times[0] || ""}
              onChange={(e) =>
                setTimes((current) => [e.target.value, ...current.slice(1)])
              }
            />
          </Field>
          {times.length < 12 ? (
            <button
              type="button"
              className="icon-button schedule-time-add"
              aria-label="Add start time"
              onClick={() => setTimes((current) => [...current, "14:00"])}
            >
              <Plus size={18} />
            </button>
          ) : (
            <span className="schedule-time-add-spacer" aria-hidden="true" />
          )}
        </div>
        {times.slice(1).map((time, index) => (
          <div className="schedule-extra-time-row" key={`time-${index + 1}`}>
            <Field label={`Start time ${index + 2}`}>
              <input
                type="time"
                required
                value={time}
                onChange={(e) =>
                  setTimes((current) =>
                    current.map((item, i) =>
                      i === index + 1 ? e.target.value : item,
                    ),
                  )
                }
              />
            </Field>
            <button
              type="button"
              className="icon-link danger"
              aria-label={`Remove start time ${index + 2}`}
              onClick={() =>
                setTimes((current) => current.filter((_, i) => i !== index + 1))
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <SectionLabel>Operating days</SectionLabel>
      <div className="weekday-presets" role="group" aria-label="Day presets">
        <button
          type="button"
          className="weekday-preset"
          onClick={() => applyPreset([1, 2, 3, 4, 5, 6, 7])}
        >
          Every day
        </button>
        <button
          type="button"
          className="weekday-preset"
          onClick={() => applyPreset([1, 2, 3, 4, 5])}
        >
          Weekdays
        </button>
        <button
          type="button"
          className="weekday-preset"
          onClick={() => applyPreset([6, 7])}
        >
          Weekend
        </button>
      </div>
      <div className="schedule-calendar">
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
            {new Date(`${visibleMonth}-01T12:00:00Z`).toLocaleString(
              session.tenant.config.locale,
              { month: "long", year: "numeric", timeZone: "UTC" },
            )}
          </strong>
          <button
            type="button"
            className="text-button"
            disabled={months.indexOf(visibleMonth) >= months.length - 1}
            onClick={() => {
              const i = months.indexOf(visibleMonth);
              if (i >= 0 && i < months.length - 1)
                setMonthCursor(months[i + 1]!);
            }}
          >
            Next
          </button>
        </div>
        <div className="schedule-calendar-weekdays">
          {weekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="schedule-calendar-grid">
          {gridDays.map((day, index) => {
            if (!day) return <span key={`pad-${index}`} />;
            const inRange = day >= start && day <= end;
            const on = selectedDays.has(day);
            return (
              <button
                key={day}
                type="button"
                disabled={!inRange}
                className={
                  "schedule-calendar-day" +
                  (on ? " selected" : "") +
                  (inRange ? "" : " muted")
                }
                onClick={() => toggleDay(day)}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
        <p className="muted">
          {operatingDays.length} {operatingDays.length === 1 ? "day" : "days"}{" "}
          selected · Times in {session.tenant.timezone}
        </p>
      </div>
      {isEdit ? (
        <Notice>
          Extending dates or times adds departures. Shortening or clearing days
          cancels only empty upcoming departures. Past trips are left as
          history.
        </Notice>
      ) : null}
      {spanDays > 365 && (
        <Notice error>
          A schedule can cover at most 365 days. Shorten the date range.
        </Notice>
      )}
      {!operatingDays.length && start && end && (
        <Notice>Select at least one operating day on the calendar.</Notice>
      )}
    </FormDialog>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="schedule-modal-section">{children}</h3>;
}

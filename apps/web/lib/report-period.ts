/** Date-range helpers shared by every report in the Reports hub. */
export type ReportRange =
  "today" | "last_7" | "week" | "month" | "last_month" | "year" | "custom";

export type ReportBasis = "departure" | "booked";

export const REPORT_PRESETS: { value: ReportRange; caption: string }[] = [
  { value: "today", caption: "Today" },
  { value: "last_7", caption: "Last 7 days" },
  { value: "week", caption: "This week" },
  { value: "month", caption: "This month" },
  { value: "last_month", caption: "Last month" },
  { value: "year", caption: "This year" },
  { value: "custom", caption: "Custom" },
];

export const BASIS_LABELS: Record<ReportBasis, string> = {
  departure: "Departure date",
  booked: "Booking date",
};

export function tenantDay(timezone: string, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = date.getUTCDay();
  return shiftDay(day, weekday === 0 ? -6 : 1 - weekday);
}

export function sundayOf(day: string) {
  return shiftDay(mondayOf(day), 6);
}

function monthBounds(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return [from, to];
}

export function rangeBounds(
  range: ReportRange,
  today: string,
  customFrom: string,
  customTo: string,
): [string, string] {
  if (range === "today") return [today, today];
  if (range === "last_7") return [shiftDay(today, -6), today];
  if (range === "week") return [mondayOf(today), sundayOf(today)];
  if (range === "month") return monthBounds(today);
  if (range === "last_month") {
    const [year, month] = today.split("-").map(Number);
    const prev = month === 1 ? [year - 1, 12] : [year, month - 1];
    return monthBounds(`${prev[0]}-${String(prev[1]).padStart(2, "0")}-01`);
  }
  if (range === "year") {
    const year = today.slice(0, 4);
    return [`${year}-01-01`, `${year}-12-31`];
  }
  return [customFrom, customTo];
}

/** Percent change, or null when there is no prior baseline. */
export function percentChange(current: number, previous: number) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

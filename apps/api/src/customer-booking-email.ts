import { DateTime } from "luxon";
import QRCode from "qrcode";

export type CustomerNotificationKind =
  | "booking_confirmation"
  | "payment_request"
  | "waiver_request"
  | "cancellation";

export type BookingEmailContext = {
  kind: CustomerNotificationKind;
  tenantName: string;
  timezone: string;
  locale: string;
  bookingId: string;
  state: string;
  leadName: string;
  productName: string;
  startsAt: string | Date;
  party: Record<string, number>;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  pickup: { kind: string; location?: string; note?: string; instructions?: string };
  stay: {
    kind: string;
    vesselName?: string;
    cabinNumber?: string;
    hotelName?: string;
    roomNumber?: string;
    propertyName?: string;
    address?: string;
  };
};

export type RenderedCustomerEmail = {
  subject: string;
  /** Durable snapshot stored on notification_messages.body */
  body: string;
  text: string;
  html: string;
};

const KIND_META: Record<
  CustomerNotificationKind,
  { subjectPrefix: string; headline: string; intro: (ctx: BookingEmailContext) => string }
> = {
  booking_confirmation: {
    subjectPrefix: "Booking confirmation",
    headline: "Your booking is confirmed",
    intro: (ctx) =>
      `Hello ${ctx.leadName}, your reservation with ${ctx.tenantName} is confirmed. Keep this email for check-in.`,
  },
  payment_request: {
    subjectPrefix: "Payment request",
    headline: "Payment is requested",
    intro: (ctx) =>
      `Hello ${ctx.leadName}, ${ctx.tenantName} is requesting payment for the booking below. Please follow the operator’s approved payment instructions.`,
  },
  waiver_request: {
    subjectPrefix: "Waiver request",
    headline: "Please complete your waiver",
    intro: (ctx) =>
      `Hello ${ctx.leadName}, please complete the required waiver with ${ctx.tenantName} before departure. Contact them if you need a link or assistance.`,
  },
  cancellation: {
    subjectPrefix: "Booking cancellation",
    headline: "Your booking has been cancelled",
    intro: (ctx) =>
      `Hello ${ctx.leadName}, the booking below with ${ctx.tenantName} has been cancelled. Contact them if you have questions about this change.`,
  },
};

export function shortBookingRef(bookingId: string): string {
  return bookingId.slice(0, 8).toUpperCase();
}

export function parseCommunicationBody(body: string): {
  text: string;
  html?: string;
} {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        v?: number;
        text?: string;
        html?: string;
      };
      if (
        parsed?.v === 1 &&
        typeof parsed.text === "string" &&
        typeof parsed.html === "string"
      ) {
        return { text: parsed.text, html: parsed.html };
      }
    } catch {
      /* fall through */
    }
  }
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    return { text: stripTags(trimmed), html: trimmed };
  }
  return { text: body };
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(minor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || "en", {
      style: "currency",
      currency: currency || "USD",
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function formatDeparture(
  startsAt: string | Date,
  timezone: string,
  locale: string,
): string {
  const dt =
    typeof startsAt === "string"
      ? DateTime.fromISO(startsAt, { setZone: true })
      : DateTime.fromJSDate(startsAt);
  const zoned = dt.setZone(timezone || "UTC");
  if (!zoned.isValid) return String(startsAt);
  return zoned.setLocale(locale || "en").toFormat("ccc, d LLL yyyy · h:mm a ZZZZ");
}

function formatParty(party: Record<string, number>): string {
  const parts = Object.entries(party ?? {})
    .filter(([, n]) => Number(n) > 0)
    .map(([label, n]) => `${n} ${label}`);
  return parts.length ? parts.join(", ") : "—";
}

function formatPickup(pickup: BookingEmailContext["pickup"]): string | null {
  if (!pickup || pickup.kind === "none") return null;
  if (pickup.kind === "selected") {
    const bits = [pickup.location, pickup.instructions].filter(Boolean);
    return bits.join(" — ") || "Selected pickup";
  }
  if (pickup.kind === "unresolved") {
    return pickup.note ? `Pickup TBD — ${pickup.note}` : "Pickup to be confirmed";
  }
  return null;
}

function formatStay(stay: BookingEmailContext["stay"]): string | null {
  if (!stay || stay.kind === "none") return null;
  if (stay.kind === "cruise") {
    const cabin = stay.cabinNumber ? ` · Cabin ${stay.cabinNumber}` : "";
    return stay.vesselName ? `Cruise · ${stay.vesselName}${cabin}` : `Cruise${cabin}`;
  }
  if (stay.kind === "hotel") {
    const room = stay.roomNumber ? ` · Room ${stay.roomNumber}` : "";
    return stay.hotelName ? `Hotel · ${stay.hotelName}${room}` : `Hotel${room}`;
  }
  if (stay.kind === "private_accommodation") {
    const bits = [stay.propertyName, stay.address].filter(Boolean);
    return bits.length ? `Private stay · ${bits.join(" — ")}` : "Private stay";
  }
  if (stay.kind === "local") {
    return stay.address ? `Local · ${stay.address}` : "Local stay";
  }
  return null;
}

function labelState(state: string): string {
  return state.replace(/_/g, " ");
}

function detailRows(ctx: BookingEmailContext): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Tour", value: ctx.productName },
    {
      label: "Departure",
      value: formatDeparture(ctx.startsAt, ctx.timezone, ctx.locale),
    },
    { label: "Guests", value: formatParty(ctx.party) },
    { label: "Status", value: labelState(ctx.state) },
  ];
  const pickup = formatPickup(ctx.pickup);
  if (pickup) rows.push({ label: "Pickup", value: pickup });
  const stay = formatStay(ctx.stay);
  if (stay) rows.push({ label: "Stay", value: stay });

  const balance = ctx.totalMinor - ctx.paidMinor;
  rows.push({
    label: "Total",
    value: formatMoney(ctx.totalMinor, ctx.currency, ctx.locale),
  });
  if (ctx.kind === "payment_request" || ctx.paidMinor > 0 || balance > 0) {
    rows.push({
      label: "Paid",
      value: formatMoney(ctx.paidMinor, ctx.currency, ctx.locale),
    });
    rows.push({
      label: "Balance due",
      value: formatMoney(Math.max(0, balance), ctx.currency, ctx.locale),
    });
  }
  return rows;
}

function buildPlainText(ctx: BookingEmailContext, meta: (typeof KIND_META)[CustomerNotificationKind]): string {
  const ref = shortBookingRef(ctx.bookingId);
  const lines = [
    meta.headline,
    "",
    meta.intro(ctx),
    "",
    ...detailRows(ctx).map((row) => `${row.label}: ${row.value}`),
    "",
    `Booking reference: ${ref}`,
    `Full reference: ${ctx.bookingId}`,
    "",
    `Please contact ${ctx.tenantName} with any questions.`,
  ];
  return lines.join("\n");
}

function buildHtml(
  ctx: BookingEmailContext,
  meta: (typeof KIND_META)[CustomerNotificationKind],
  qrDataUrl: string,
): string {
  const ref = shortBookingRef(ctx.bookingId);
  const rows = detailRows(ctx)
    .map(
      (row) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #e8eef0;color:#65777b;font-size:13px;width:34%;vertical-align:top;">${escapeHtml(row.label)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e8eef0;color:#172f35;font-size:14px;font-weight:600;vertical-align:top;">${escapeHtml(row.value)}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${escapeHtml(ctx.locale || "en")}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(meta.headline)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);">
    <div style="background:#142f36;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px;">${escapeHtml(ctx.tenantName)}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.55);font-size:13px;">Booking communication</p>
    </div>
    <div style="padding:32px;color:#172f35;font-size:14px;line-height:1.6;">
      <h2 style="margin:0 0 12px;font-size:22px;letter-spacing:-0.3px;">${escapeHtml(meta.headline)}</h2>
      <p style="margin:0 0 24px;">${escapeHtml(meta.intro(ctx))}</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 28px;">${rows}</table>
      <div style="text-align:center;padding:20px 16px;background:#f5f7f7;border-radius:10px;">
        <p style="margin:0 0 12px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#65777b;font-weight:700;">Booking reference</p>
        <img src="${qrDataUrl}" width="160" height="160" alt="QR code for booking ${escapeHtml(ref)}" style="display:block;margin:0 auto 12px;border:0;" />
        <p style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.08em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(ref)}</p>
        <p style="margin:8px 0 0;font-size:11px;color:#65777b;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(ctx.bookingId)}</p>
        <p style="margin:12px 0 0;font-size:12px;color:#65777b;">Show this code at check-in if asked.</p>
      </div>
      <p style="margin:24px 0 0;font-size:13px;color:#65777b;">Questions? Contact ${escapeHtml(ctx.tenantName)}.</p>
    </div>
    <div style="padding:20px 32px;background:#f5f7f7;font-size:11px;color:#65777b;text-align:center;">
      Sent on behalf of ${escapeHtml(ctx.tenantName)} via Zettaz Tours &amp; Charters.
    </div>
  </div>
</body>
</html>`;
}

export async function renderCustomerBookingEmail(
  ctx: BookingEmailContext,
): Promise<RenderedCustomerEmail> {
  const meta = KIND_META[ctx.kind];
  const ref = shortBookingRef(ctx.bookingId);
  const qrDataUrl = await QRCode.toDataURL(ctx.bookingId, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 160,
    color: { dark: "#142f36", light: "#ffffff" },
  });
  const text = buildPlainText(ctx, meta);
  const html = buildHtml(ctx, meta, qrDataUrl);
  return {
    subject: `${meta.subjectPrefix} · ${ref} · ${ctx.tenantName}`,
    text,
    html,
    body: JSON.stringify({ v: 1, text, html }),
  };
}

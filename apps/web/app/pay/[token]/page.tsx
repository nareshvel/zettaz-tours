import type { Metadata } from "next";
import { upstream } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pay for your booking",
  robots: { index: false, follow: false },
};

type PayLink = {
  businessName: string;
  productName: string;
  startsAt: string;
  timezone: string;
  guestFirstName: string;
  bookingRef: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  amountDueMinor: number;
  status: "open" | "paid" | "unavailable";
  message: string | null;
};

function money(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(
      minor / 100,
    );
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function when(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const shell: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f5f7f7",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "40px 16px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: "#172f35",
};
const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  background: "#fff",
  borderRadius: 14,
  overflow: "hidden",
  boxShadow: "0 2px 16px rgba(0,0,0,.07)",
};
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  padding: "10px 0",
  borderBottom: "1px solid #e8eef0",
  fontSize: 14,
};

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  let link: PayLink | null = null;
  let failure = "";
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    failure = "This payment link is not valid.";
  } else {
    try {
      const res = await upstream(`/pay/v1/${token}`, { method: "GET" }, "");
      if (res.ok) link = (await res.json()) as PayLink;
      else
        failure =
          res.status === 404
            ? "This payment link is not valid."
            : "We could not load this payment right now. Please try again shortly.";
    } catch {
      failure =
        "We could not load this payment right now. Please try again shortly.";
    }
  }
  const justPaid = query.status === "success";

  return (
    <main style={shell}>
      <div style={card}>
        <div style={{ background: "#142f36", padding: "24px 28px" }}>
          <p
            style={{
              margin: 0,
              color: "rgba(255,255,255,.6)",
              fontSize: 12,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Secure payment
          </p>
          <h1 style={{ margin: "6px 0 0", color: "#fff", fontSize: 21 }}>
            {link?.businessName ?? "Booking payment"}
          </h1>
        </div>
        <div style={{ padding: "24px 28px 28px" }}>
          {!link ? (
            <p style={{ margin: 0, fontSize: 15 }}>{failure}</p>
          ) : (
            <>
              {justPaid || link.status === "paid" ? (
                <div
                  style={{
                    background: "#e8f4f1",
                    borderRadius: 10,
                    padding: "14px 16px",
                    margin: "0 0 20px",
                    fontSize: 15,
                  }}
                >
                  <strong>
                    Thank you
                    {link.guestFirstName ? `, ${link.guestFirstName}` : ""}.
                  </strong>{" "}
                  {link.status === "paid"
                    ? "This booking is paid."
                    : "Your payment was received and your booking updates within a minute. Keep the Stripe confirmation page or email for your records."}
                </div>
              ) : null}
              <div style={{ margin: "0 0 22px" }}>
                <div style={row}>
                  <span style={{ color: "#65777b" }}>Experience</span>
                  <strong style={{ textAlign: "right" }}>
                    {link.productName}
                  </strong>
                </div>
                <div style={row}>
                  <span style={{ color: "#65777b" }}>Date</span>
                  <strong style={{ textAlign: "right" }}>
                    {when(link.startsAt, link.timezone)}
                  </strong>
                </div>
                <div style={row}>
                  <span style={{ color: "#65777b" }}>Booking</span>
                  <strong
                    style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
                  >
                    {link.bookingRef}
                  </strong>
                </div>
                <div style={row}>
                  <span style={{ color: "#65777b" }}>Total</span>
                  <strong>{money(link.totalMinor, link.currency)}</strong>
                </div>
                {link.paidMinor > 0 ? (
                  <div style={row}>
                    <span style={{ color: "#65777b" }}>Already paid</span>
                    <strong>{money(link.paidMinor, link.currency)}</strong>
                  </div>
                ) : null}
              </div>
              {link.status === "open" && !justPaid ? (
                <form method="post" action={`/pay/${token}/checkout`}>
                  {query.error ? (
                    <p
                      style={{
                        background: "#fdecea",
                        color: "#8a1c12",
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: 14,
                        margin: "0 0 14px",
                      }}
                    >
                      {query.error.slice(0, 300)}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    style={{
                      width: "100%",
                      border: 0,
                      borderRadius: 10,
                      background: "#176c63",
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: 700,
                      padding: "15px 18px",
                      cursor: "pointer",
                    }}
                  >
                    Pay {money(link.amountDueMinor, link.currency)} by card
                  </button>
                  <p
                    style={{
                      margin: "12px 0 0",
                      fontSize: 12,
                      color: "#65777b",
                      textAlign: "center",
                    }}
                  >
                    You will be taken to a secure Stripe checkout page. Card
                    details never reach {link.businessName}.
                  </p>
                </form>
              ) : link.status === "unavailable" && link.message ? (
                <p style={{ margin: 0, fontSize: 15 }}>{link.message}</p>
              ) : null}
            </>
          )}
        </div>
        <div
          style={{
            background: "#f5f7f7",
            padding: "14px 28px",
            fontSize: 11,
            color: "#65777b",
            textAlign: "center",
          }}
        >
          Payments by Zettaz Pay
        </div>
      </div>
    </main>
  );
}

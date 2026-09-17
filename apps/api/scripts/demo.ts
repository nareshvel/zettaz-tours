import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { localDatabase } from "./local-database";
import { bootstrapPlatform, issueSession } from "./sessions";
import { createApp } from "../src/app";
import { mockConfig, mockProduct } from "../test/fixtures";
import { OutboxService } from "../src/operations";
import {
  grants,
  type ProductInput,
} from "../../../packages/shared/src/contracts";

// Public product names and durations observed on 9 September 2026 at
// rockadventuresantigua.com. This is demo-only presentation data; all rates,
// schedules, capacity, pickup rules and policies remain synthetic.
const mockRockAdventuresCatalog: ProductInput[] = [
  {
    name: "Tuk-Tuk Adventure – Historical Harbour, Beach & Beers",
    optionName: "Mock 09:30 departure · adults",
    durationMinutes: 300,
    categories: [{ slug: "adult", label: "Adult", countsTowardCapacity: true }],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 13900,
      },
    ],
  },
  {
    name: "Tuk-Tuk Rainforest & Beach Hopping",
    optionName: "Mock morning departure",
    durationMinutes: 270,
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
      { slug: "child", label: "Child", countsTowardCapacity: true },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 10900,
      },
      {
        category: "child",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 8900,
      },
    ],
  },
  {
    name: "Kayak & Snorkel Eco Adventures",
    optionName: "Mock 09:00 departure",
    durationMinutes: 180,
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
      { slug: "child", label: "Child", countsTowardCapacity: true },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 9900,
      },
      {
        category: "child",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 6900,
      },
    ],
  },
  {
    name: "Clear Boat & Offshore Islands Experience",
    optionName: "Mock coastal departure",
    durationMinutes: 180,
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
      { slug: "child", label: "Child", countsTowardCapacity: true },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 8900,
      },
      {
        category: "child",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 5900,
      },
    ],
  },
];

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Mock demo cannot run in production");
  // New isolated cluster on each run; no existing tenant data is reset or overwritten.
  if (process.env.TEST_ADMIN_DATABASE_URL)
    throw new Error(
      "Demo requires its own isolated local database, not TEST_ADMIN_DATABASE_URL",
    );
  process.env.APP_MODE = "demo";
  const webPort = Number(process.env.WEB_PORT ?? 3191);
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535)
    throw new Error("Invalid WEB_PORT");
  const local = await localDatabase();
  process.env.DATABASE_URL = local.runtimeUrl;
  const admin = new Pool({ connectionString: local.adminUrl });
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let web: ChildProcess | undefined;
  try {
    app = await createApp();
    await app.listen(Number(process.env.PORT ?? 3190), "127.0.0.1");
    const base = await app.getUrl();
    const platform = await bootstrapPlatform(admin);
    async function post(path: string, token: string, body: unknown) {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, any>;
      if (!res.ok)
        throw new Error(`Demo request ${path} failed: ${res.status}`);
      return data;
    }
    const tenants = [];
    const manifests = [];
    for (const [slug, name, currency] of [
      ["mock-harbor", "Mock Harbor Tours", "USD"],
      ["mock-river", "Mock River Excursions", "XCD"],
    ]) {
      const config = {
        ...mockConfig,
        bookingCurrency: currency,
        collectionCurrency: currency,
        reportingCurrency: currency,
      };
      const t = await post("/platform/v1/tenants", platform, {
        slug,
        name,
        timezone: "America/Antigua",
        ownerName: "Mock Owner",
        ownerEmail: `${slug}@example.invalid`,
        ownerPhone: "+12685550100",
        country: "AG",
        config,
      });
      const token = await issueSession(admin, t.ownerId, t.tenantId);
      const date = DateTime.utc().plus({ days: 1 }).toISODate();
      const catalog =
        slug === "mock-harbor" ? mockRockAdventuresCatalog : [mockProduct];
      const seeded = [];
      for (const [index, input] of catalog.entries()) {
        const product = await post("/admin/v1/products", token, input);
        const schedule = await post("/admin/v1/schedules", token, {
          productId: product.productId,
          name: "Schedule",
          startDate: date,
          endDate: date,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          localTimes: [`${String(9 + index).padStart(2, "0")}:00`],
          capacity: 18,
          blackoutDates: [],
        });
        const scheduledDepartureId = schedule.departures[0]?.departureId;
        if (!scheduledDepartureId)
          throw new Error("Demo schedule created no departure");
        seeded.push({ departureId: scheduledDepartureId });
      }
      const departureId = seeded[0]?.departureId;
      if (!departureId) throw new Error("Demo catalog created no departures");
      const hold = await post("/staff/v1/holds", token, {
        departureId,
        party: { adult: 2 },
      });
      const booking = await post("/staff/v1/bookings", token, {
        holdId: hold.holdId,
        leadName: "Mock Traveler",
        leadEmail: "traveler@example.invalid",
        source: "phone",
        pickup: {
          kind: "selected",
          location: "Mock meeting point",
          instructions: "Arrive 15 minutes before departure",
        },
      });
      await post(`/staff/v1/bookings/${booking.bookingId}/payments`, token, {
        amountMinor: hold.quote.totalMinor,
        currency,
        method: "cash",
        status: "settled",
        reference: "MOCK-RECEIPT-001",
        reason: "Synthetic demo payment; no real money collected",
        occurredAt: new Date().toISOString(),
      });
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, token, {
        version: 1,
      });
      const manifestResponse = await fetch(
        `${base}/ops/v1/departures/${departureId}/manifest`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!manifestResponse.ok) throw new Error("Demo manifest query failed");
      manifests.push({
        name,
        currency,
        manifest: await manifestResponse.json(),
      });
      await app.get(OutboxService).drain({
        actorId: t.ownerId,
        tenantId: t.tenantId,
        platform: false,
        permissions: [...grants.owner],
        role: "owner",
      });
      tenants.push({
        ...t,
        name,
        token,
        departureId,
        bookingId: booking.bookingId,
      });
    }
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/demo-access.json",
      JSON.stringify({ base, platformToken: platform, tenants }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      ".local/demo-manifests.json",
      JSON.stringify(manifests, null, 2),
      { mode: 0o600 },
    );
    console.log(
      `Mock API running at ${base}. Two isolated mock tenants each have a paid, confirmed reservation.`,
    );
    console.log(
      "Session tokens and record IDs: .local/demo-access.json (local only, expires in 8 hours).",
    );
    console.log(
      "API contract: /openapi.json. No real payment providers or customer messages are enabled.",
    );
    if (process.env.DEMO_EXIT_AFTER_SEED === "1") return;
    if (process.env.START_WEB === "1") {
      web = spawn(
        process.execPath,
        [
          require.resolve("next/dist/bin/next"),
          "dev",
          "--webpack",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(webPort),
        ],
        {
          cwd: resolve("apps/web"),
          stdio: "inherit",
          env: {
            ...process.env,
            ZETTAZ_DEMO_WEB: "1",
            DEMO_ACCESS_FILE: resolve(".local/demo-access.json"),
            WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
          },
        },
      );
      console.log(`Mock tenant workspace: http://127.0.0.1:${webPort}`);
    }
    await new Promise<void>((resolve, reject) => {
      web?.once("error", reject);
      web?.once("exit", () => resolve());
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
  } finally {
    if (web && web.exitCode === null && web.signalCode === null) {
      const stopped = new Promise<void>((done) =>
        web!.once("exit", () => done()),
      );
      web.kill("SIGTERM");
      await stopped;
    }
    await app?.close();
    await admin.end();
    await local.stop();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Demo failed");
  process.exitCode = 1;
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { DateTime } from "luxon";
import { INestApplication } from "@nestjs/common";
import { localDatabase } from "../scripts/local-database";
import { bootstrapPlatform, issueSession } from "../scripts/sessions";
import { createApp } from "../src/app";
import { Database, digest } from "../src/database";
import { OutboxService } from "../src/operations";
import { IntegrationService } from "../src/integrations";
import { Actor, grants } from "../../../packages/shared/src/contracts";
import { mockConfig, mockProduct } from "./fixtures";
import { migrate } from "../scripts/migrate";

let local: Awaited<ReturnType<typeof localDatabase>>,
  admin: Pool,
  app: INestApplication,
  platform: string;
let a: { tenantId: string; ownerId: string; token: string }, b: typeof a;
const key = () => randomUUID();
function post(path: string, token: string, body: unknown, k = key()) {
  return request(app.getHttpServer())
    .post(path)
    .timeout({ response: 10000, deadline: 15000 })
    .auth(token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send(body as object);
}
function get(path: string, token: string) {
  return request(app.getHttpServer()).get(path).auth(token, { type: "bearer" });
}
function patch(path: string, token: string, body: unknown, k = key()) {
  return request(app.getHttpServer())
    .patch(path)
    .timeout({ response: 10000, deadline: 15000 })
    .auth(token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send(body as object);
}
function del(path: string, token: string, k = key()) {
  return request(app.getHttpServer())
    .delete(path)
    .timeout({ response: 10000, deadline: 15000 })
    .auth(token, { type: "bearer" })
    .set("Idempotency-Key", k);
}
async function setupTenant(slug: string, config = mockConfig) {
  const res = await post("/platform/v1/tenants", platform, {
    slug,
    name: `Mock ${slug}`,
    timezone: "America/Antigua",
    ownerName: "Mock Owner",
    ownerEmail: `${slug}@example.invalid`,
    ownerPhone: "+12685550100",
    country: "AG",
    config,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { tenantId, ownerId } = res.body;
  return {
    tenantId,
    ownerId,
    token: await issueSession(admin, ownerId, tenantId),
  };
}
async function departure(
  token = a.token,
  capacity = 10,
  overrides: Record<string, unknown> = {},
) {
  const p = await post("/admin/v1/products", token, mockProduct);
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const date = DateTime.utc().plus({ days: 10 }).toISODate();
  const s = await post("/admin/v1/schedules", token, {
    productId: p.body.productId,
    name: "Schedule",
    startDate: date,
    endDate: date,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    localTimes: ["09:00"],
    capacity,
    blackoutDates: [],
    ...overrides,
  });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  return {
    departureId: s.body.departures[0].departureId,
    productId: p.body.productId,
  };
}
async function heldBooking(
  dep: string,
  token = a.token,
  party: Record<string, number> = { adult: 1 },
  pickup: unknown = { kind: "none" },
) {
  const h = await post("/staff/v1/holds", token, { departureId: dep, party });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const booking = await post("/staff/v1/bookings", token, {
    holdId: h.body.holdId,
    leadName: "Mock Traveler",
    leadEmail: "traveler@example.invalid",
    source: "phone",
    pickup,
  });
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  return { ...booking.body, holdId: h.body.holdId };
}
async function pay(
  bookingId: string,
  amountMinor: number,
  token = a.token,
  status = "settled",
  k = key(),
) {
  return post(
    `/staff/v1/bookings/${bookingId}/payments`,
    token,
    {
      amountMinor,
      currency: "USD",
      method: "cash",
      status,
      reference: "mock-receipt",
      reason: "Mock cash collection",
      occurredAt: new Date().toISOString(),
    },
    k,
  );
}
const actor = (): Actor => ({
  actorId: a.ownerId,
  tenantId: a.tenantId,
  platform: false,
  permissions: [...grants.owner],
  role: "owner",
});

test("resources are tenant-scoped, expired compliance blocks assignment, and check-in gates boarding", async () => {
  const t = await setupTenant(`resources-${randomUUID().slice(0, 8)}`);
  const dep = await departure(t.token, 8);
  const blockedResource = await post("/ops/v1/resources", t.token, {
    code: `van-${randomUUID().slice(0, 8)}`,
    name: "Mock compliance van",
    type: "vehicle",
    capacity: 8,
    notes: "Synthetic test resource",
  });
  assert.equal(
    blockedResource.status,
    201,
    JSON.stringify(blockedResource.body),
  );
  const expired = await post("/ops/v1/compliance-documents", t.token, {
    resourceId: blockedResource.body.id,
    documentType: "vehicle inspection",
    expiresOn: "2000-01-01",
    notes: "Expired synthetic evidence",
  });
  assert.equal(expired.status, 201, JSON.stringify(expired.body));
  assert.equal(
    (
      await post("/ops/v1/assignments", t.token, {
        departureId: dep.departureId,
        resourceId: blockedResource.body.id,
        assignmentRole: "vehicle",
      })
    ).status,
    409,
  );
  const override = await post("/ops/v1/assignments", t.token, {
    departureId: dep.departureId,
    resourceId: blockedResource.body.id,
    assignmentRole: "vehicle",
    overrideReason: "Manager confirmed a temporary replacement inspection.",
  });
  assert.equal(override.status, 201, JSON.stringify(override.body));
  const resource = await post("/ops/v1/resources", t.token, {
    code: `boat-${randomUUID().slice(0, 8)}`,
    name: "Mock ready boat",
    type: "vessel",
    capacity: 12,
    notes: "Synthetic test resource",
  });
  assert.equal(resource.status, 201, JSON.stringify(resource.body));
  const updatedResource = await patch(
    `/ops/v1/resources/${resource.body.id}`,
    t.token,
    {
      code: resource.body.code,
      name: "Mock ready boat updated",
      type: "vessel",
      capacity: 14,
      notes: "Synthetic test resource",
      active: true,
    },
  );
  assert.equal(
    updatedResource.status,
    200,
    JSON.stringify(updatedResource.body),
  );
  assert.equal(updatedResource.body.name, "Mock ready boat updated");
  assert.equal(updatedResource.body.capacity, 14);
  const doc = await post("/ops/v1/compliance-documents", t.token, {
    resourceId: resource.body.id,
    documentType: "vessel insurance",
    expiresOn: "2099-01-01",
    notes: "Synthetic valid evidence",
  });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
  const updatedDoc = await patch(
    `/ops/v1/compliance-documents/${doc.body.id}`,
    t.token,
    {
      documentType: "vessel insurance",
      expiresOn: "2099-06-01",
      notes: "Extended synthetic evidence",
    },
  );
  assert.equal(updatedDoc.status, 200, JSON.stringify(updatedDoc.body));
  assert.equal(updatedDoc.body.expiresOn, "2099-06-01");
  assert.equal(
    (await del(`/ops/v1/compliance-documents/${doc.body.id}`, t.token)).status,
    200,
  );
  const assignment = await post("/ops/v1/assignments", t.token, {
    departureId: dep.departureId,
    resourceId: resource.body.id,
    assignmentRole: "vessel",
  });
  assert.equal(assignment.status, 201, JSON.stringify(assignment.body));
  assert.equal(
    (await del(`/ops/v1/resources/${resource.body.id}`, t.token)).status,
    200,
  );
  assert.equal(
    (
      await post("/ops/v1/assignments", t.token, {
        departureId: dep.departureId,
        resourceId: resource.body.id,
        assignmentRole: "vessel-again",
      })
    ).status,
    400,
  );
  const reactivated = await patch(
    `/ops/v1/resources/${resource.body.id}`,
    t.token,
    {
      code: resource.body.code,
      name: "Mock ready boat updated",
      type: "vessel",
      capacity: 14,
      notes: "Synthetic test resource",
      active: true,
    },
  );
  assert.equal(reactivated.status, 200, JSON.stringify(reactivated.body));
  assert.equal(reactivated.body.active, true);
  const listed = await get("/ops/v1/resources", t.token);
  assert.equal(listed.status, 200);
  assert.equal(
    listed.body.find((item: { id: string }) => item.id === resource.body.id)
      ?.active,
    true,
  );
  const assignments = await get(
    `/ops/v1/departures/${dep.departureId}/assignments`,
    t.token,
  );
  assert.equal(assignments.status, 200, JSON.stringify(assignments.body));
  assert.equal(assignments.body.readiness, "ready");
  assert.equal(assignments.body.items.length, 2);
  assert.equal((await get("/ops/v1/resources", b.token)).body.length, 0);

  const booking = await heldBooking(dep.departureId, t.token);
  const confirmed = await post(
    `/staff/v1/bookings/${booking.bookingId}/confirm`,
    t.token,
    {
      version: 1,
    },
  );
  assert.equal(confirmed.status, 409, "unpaid booking cannot be confirmed");
  const { rows: quoteRows } = await admin.query(
    "SELECT (quote->>'totalMinor')::int AS total_minor FROM holds WHERE tenant_id=$1 AND id=$2",
    [t.tenantId, booking.holdId],
  );
  assert.equal(
    (await pay(booking.bookingId, quoteRows[0].total_minor, t.token)).status,
    201,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, t.token, {
        version: 1,
      })
    ).status,
    201,
  );
  const arrived = await post(
    `/ops/v1/bookings/${booking.bookingId}/checkin`,
    t.token,
    {
      state: "arrived",
    },
  );
  assert.equal(arrived.status, 201, JSON.stringify(arrived.body));
  assert.equal(arrived.body.state, "waiver_pending");
  assert.equal(
    (
      await post(`/ops/v1/bookings/${booking.bookingId}/checkin`, t.token, {
        state: "boarded",
        version: arrived.body.version,
      })
    ).status,
    400,
  );
  const waiver = await post("/ops/v1/waiver-templates", t.token, {
    title: `Mock check-in waiver ${randomUUID()}`,
    body: "Synthetic test waiver. Not legal text.",
  });
  assert.equal(waiver.status, 201, JSON.stringify(waiver.body));
  assert.equal(
    (
      await post(`/ops/v1/bookings/${booking.bookingId}/waivers`, t.token, {
        templateId: waiver.body.id,
        signerName: "Mock Traveler",
        signerCapacity: "self",
      })
    ).status,
    201,
  );
  const boarded = await post(
    `/ops/v1/bookings/${booking.bookingId}/checkin`,
    t.token,
    {
      state: "boarded",
      version: arrived.body.version,
    },
  );
  assert.equal(boarded.status, 201, JSON.stringify(boarded.body));
  assert.equal(boarded.body.state, "boarded");
  assert.equal(
    (
      await post(`/ops/v1/bookings/${booking.bookingId}/checkin`, t.token, {
        state: "no_show",
        version: arrived.body.version,
      })
    ).status,
    400,
  );
});

test("compliance document library uploads, quotas, downloads and tenant isolation", async () => {
  const t = await setupTenant(`library-${randomUUID().slice(0, 8)}`, {
    ...mockConfig,
    documentLibrary: { quotaBytes: 2048 },
  });
  const other = await setupTenant(`library-b-${randomUUID().slice(0, 8)}`);
  const resource = await post("/ops/v1/resources", t.token, {
    code: `lib-${randomUUID().slice(0, 8)}`,
    name: "Library test vessel",
    type: "vessel",
    capacity: 6,
    notes: "",
  });
  assert.equal(resource.status, 201, JSON.stringify(resource.body));

  const usageBefore = await get("/ops/v1/document-library/usage", t.token);
  assert.equal(usageBefore.status, 200, JSON.stringify(usageBefore.body));
  assert.equal(usageBefore.body.quotaBytes, 2048);
  assert.equal(usageBefore.body.usedBytes, 0);

  const pdfBytes = Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  );
  const uploaded = await request(app.getHttpServer())
    .post("/ops/v1/compliance-documents")
    .auth(t.token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .field("resourceId", resource.body.id)
    .field("documentType", "vessel insurance")
    .field("expiresOn", "2099-01-01")
    .field("notes", "Synthetic library upload")
    .attach("file", pdfBytes, {
      filename: "insurance.pdf",
      contentType: "application/pdf",
    });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.hasFile, true);
  assert.ok(uploaded.body.byteSize > 0);

  const usageAfter = await get("/ops/v1/document-library/usage", t.token);
  assert.equal(usageAfter.status, 200);
  assert.equal(usageAfter.body.usedBytes, uploaded.body.byteSize);
  assert.equal(usageAfter.body.fileCount, 1);

  const listed = await get("/ops/v1/compliance-documents", t.token);
  assert.equal(listed.status, 200);
  const row = listed.body.find(
    (item: { id: string }) => item.id === uploaded.body.id,
  );
  assert.ok(row);
  assert.equal(row.has_file, true);
  assert.equal(row.subject_kind, "resource");
  assert.match(String(row.subject_name), /Library test vessel/);

  const download = await get(
    `/ops/v1/compliance-documents/${uploaded.body.id}/file`,
    t.token,
  );
  assert.equal(download.status, 200);
  assert.match(
    String(download.headers["content-type"] ?? ""),
    /application\/pdf/,
  );

  assert.equal(
    (
      await get(
        `/ops/v1/compliance-documents/${uploaded.body.id}/file`,
        other.token,
      )
    ).status,
    404,
  );

  const overQuota = await request(app.getHttpServer())
    .post("/ops/v1/compliance-documents")
    .auth(t.token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .field("resourceId", resource.body.id)
    .field("documentType", "inspection")
    .field("expiresOn", "2099-06-01")
    .attach("file", Buffer.alloc(2048, 1), {
      filename: "too-big.pdf",
      contentType: "application/pdf",
    });
  assert.equal(overQuota.status, 413, JSON.stringify(overQuota.body));

  assert.equal(
    (await del(`/ops/v1/compliance-documents/${uploaded.body.id}`, t.token))
      .status,
    200,
  );
  const usageCleared = await get("/ops/v1/document-library/usage", t.token);
  assert.equal(usageCleared.body.usedBytes, 0);
  assert.equal(usageCleared.body.fileCount, 0);
});

test("operations board and pickup plans stay scoped, versioned and aligned with reservation changes", async () => {
  const dep = await departure(a.token, 8);
  const booking = await heldBooking(
    dep.departureId,
    a.token,
    { adult: 2 },
    { kind: "selected", location: "Mock hotel", instructions: "Lobby" },
  );
  assert.equal((await pay(booking.bookingId, 20000)).status, 201);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    201,
  );
  const location = await post("/ops/v1/pickup-locations", a.token, {
    slug: "mock_hotel",
    name: "Mock Hotel",
    kind: "hotel",
    notes: "Front lobby",
  });
  assert.equal(location.status, 201);
  const {
    rows: [dayRow],
  } = await admin.query(
    "SELECT local_date::text AS day,starts_at FROM departures WHERE id=$1",
    [dep.departureId],
  );
  const board = await get(`/ops/v1/board?date=${dayRow.day}`, a.token);
  assert.equal(board.status, 200, JSON.stringify(board.body));
  assert.equal(board.body.items.length, 1);
  assert.equal(board.body.items[0].pickup_required, 1);
  assert.equal(board.body.items[0].pickup_planned, 0);
  assert.equal(board.body.items[0].boarding_pending >= 1, true);
  assert.equal(board.body.items[0].trip_run_state, null);
  const planPath = `/ops/v1/departures/${dep.departureId}/pickups`;
  const planInput = {
    notes: "Mock route order",
    stops: [
      {
        bookingId: booking.bookingId,
        locationId: location.body.id,
        pickupAt: new Date(
          new Date(dayRow.starts_at).getTime() - 30 * 60_000,
        ).toISOString(),
        notes: "Lobby",
      },
    ],
  };
  const saved = await post(planPath, a.token, planInput);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.version, 1);
  assert.equal(
    (await post(planPath, a.token, { ...planInput, version: 2 })).status,
    409,
  );
  const plan = await get(planPath, a.token);
  assert.equal(plan.body.stops.length, 1);
  assert.equal(plan.body.stops[0].lead_name, "Mock Traveler");
  assert.equal(typeof plan.body.departure.product_name, "string");
  assert.ok(Array.isArray(plan.body.exceptions));
  const printablePath = `/ops/v1/departures/${dep.departureId}/pickup-list`;
  const printable = await get(printablePath, a.token);
  assert.equal(printable.status, 200, JSON.stringify(printable.body));
  assert.equal(typeof printable.body.departure.product_name, "string");
  assert.ok(printable.body.departure.product_name.length > 0);
  assert.equal(printable.body.plan.version, 1);
  assert.equal(printable.body.stops[0].location_name, "Mock Hotel");
  assert.equal(printable.body.exceptions.length, 0);
  const waiver = await post("/ops/v1/waiver-templates", a.token, {
    title: "Mock waiver",
    body: "Synthetic only; not legal text.",
  });
  assert.equal(waiver.status, 201, JSON.stringify(waiver.body));
  const signed = await post(
    `/ops/v1/bookings/${booking.bookingId}/waivers`,
    a.token,
    {
      templateId: waiver.body.id,
      signerName: "Mock Traveler",
      signerCapacity: "self",
    },
  );
  assert.equal(signed.status, 201, JSON.stringify(signed.body));
  const replacement = await post("/ops/v1/waiver-templates", a.token, {
    title: "Mock waiver revised",
    body: "Synthetic only; revised and not legal text.",
  });
  assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
  assert.equal(replacement.body.version, 2);
  const activeTemplates = await get("/ops/v1/waiver-templates", a.token);
  assert.equal(activeTemplates.status, 200);
  assert.equal(activeTemplates.body.length, 1);
  assert.equal(activeTemplates.body[0].id, replacement.body.id);
  assert.equal(
    (
      await post(`/ops/v1/bookings/${booking.bookingId}/waivers`, a.token, {
        templateId: waiver.body.id,
        signerName: "Mock Traveler",
        signerCapacity: "self",
      })
    ).status,
    400,
  );
  assert.equal((await get("/ops/v1/waiver-templates", b.token)).body.length, 0);
  const after = await get(`/ops/v1/board?date=${dayRow.day}`, a.token);
  assert.equal(after.body.items[0].pickup_planned, 1);
  const quote = await changeQuote(booking.bookingId, {
    pickup: { kind: "none" },
  });
  assert.equal(quote.status, 201);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: quote.body.quoteId,
      })
    ).status,
    201,
  );
  assert.equal((await get(planPath, a.token)).body.stops.length, 0);
  const dispatcherMember = await post("/admin/v1/members", a.token, {
    name: "Mock Dispatcher",
    email: "dispatch-plan@example.invalid",
    role: "dispatcher",
  });
  const dispatcher = await issueSession(
    admin,
    dispatcherMember.body.actorId,
    a.tenantId,
  );
  assert.equal(
    (await get(`/ops/v1/board?date=${dayRow.day}`, dispatcher)).status,
    200,
  );
  assert.equal(
    (
      await post("/ops/v1/pickup-locations", dispatcher, {
        slug: "mock_port",
        name: "Mock Port",
        kind: "port",
        notes: "",
      })
    ).status,
    201,
  );
  const reservationsMember = await post("/admin/v1/members", a.token, {
    name: "Mock Reservations",
    email: "reservations-plan@example.invalid",
    role: "reservations",
  });
  const reservations = await issueSession(
    admin,
    reservationsMember.body.actorId,
    a.tenantId,
  );
  assert.equal(
    (
      await post("/ops/v1/pickup-locations", reservations, {
        slug: "denied_stop",
        name: "Denied",
        kind: "other",
        notes: "",
      })
    ).status,
    403,
  );
  assert.equal((await get(planPath, b.token)).status, 404);
  assert.equal((await get(printablePath, b.token)).status, 404);
});

test("ops start trip marks remaining guests no-show and records departed", async () => {
  const dep = await departure(a.token, 8);
  const booking = await heldBooking(dep.departureId, a.token, { adult: 2 });
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${booking.bookingId}/passengers`,
        a.token,
        {
          passengers: [
            { name: "Mock Traveler", category: "adult", isMinor: false },
            { name: "Mock Companion", category: "adult", isMinor: false },
          ],
        },
      )
    ).status,
    201,
  );
  const { rows: quoteRows } = await admin.query(
    "SELECT (quote->>'totalMinor')::int AS total_minor FROM holds WHERE tenant_id=$1 AND id=$2",
    [a.tenantId, booking.holdId],
  );
  assert.equal(
    (await pay(booking.bookingId, quoteRows[0].total_minor)).status,
    201,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    201,
  );
  const {
    rows: [dayRow],
  } = await admin.query(
    "SELECT local_date::text AS day FROM departures WHERE id=$1",
    [dep.departureId],
  );
  const boardBefore = await get(`/ops/v1/board?date=${dayRow.day}`, a.token);
  assert.equal(boardBefore.status, 200, JSON.stringify(boardBefore.body));
  const row = boardBefore.body.items.find(
    (item: { id: string }) => item.id === dep.departureId,
  );
  assert.ok(row, JSON.stringify(boardBefore.body));
  assert.equal(row.boarding_pending, 2);
  assert.equal(row.trip_run_state, null);
  assert.equal(
    (
      await post(`/ops/v1/departures/${dep.departureId}/start`, a.token, {
        markRemainingNoShow: false,
      })
    ).status,
    400,
  );
  const started = await post(
    `/ops/v1/departures/${dep.departureId}/start`,
    a.token,
    {
      markRemainingNoShow: true,
      reason: "Guests did not arrive before departure",
    },
  );
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal(started.body.state, "departed");
  assert.equal(started.body.markedNoShow.length, 2);
  const boardAfter = await get(`/ops/v1/board?date=${dayRow.day}`, a.token);
  const after = boardAfter.body.items.find(
    (item: { id: string }) => item.id === dep.departureId,
  );
  assert.equal(after.boarding_pending, 0);
  assert.equal(after.no_show_guests, 2);
  assert.equal(after.trip_run_state, "departed");
  const manifest = await get(
    `/ops/v1/departures/${dep.departureId}/manifest`,
    a.token,
  );
  assert.equal(manifest.status, 200);
  assert.equal(manifest.body.departure.trip_run_state, "departed");
  assert.equal(
    (
      await post(`/ops/v1/departures/${dep.departureId}/start`, a.token, {
        markRemainingNoShow: true,
        reason: "Second start must fail",
      })
    ).status,
    400,
  );
});

before(async () => {
  local = await localDatabase();
  admin = new Pool({ connectionString: local.adminUrl });
  process.env.APP_MODE = "test";
  process.env.SUBSCRIPTION_JOBS_DISABLED = "true";
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
    "test-webhook-secret-encryption-key";
  process.env.DATABASE_URL = local.runtimeUrl;
  app = await createApp();
  // Keep one listener open across concurrent Supertest requests.
  await app.listen(0, "127.0.0.1");
  platform = await bootstrapPlatform(admin);
  a = await setupTenant("mock-harbor");
  b = await setupTenant("mock-river");
});
after(async () => {
  await app?.close();
  await admin?.end();
  await local?.stop();
});

test("full manual journey freezes price, requires payment then explicit confirmation, and writes manifest/audit", async () => {
  const dep = await departure();
  const booking = await heldBooking(dep.departureId, a.token, {
    adult: 2,
    child: 1,
    infant: 1,
  } as { adult: number });
  const before = await get(
    `/ops/v1/departures/${dep.departureId}/manifest`,
    a.token,
  );
  assert.equal(before.body.bookings.length, 0);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    409,
  );
  assert.equal((await pay(booking.bookingId, 26000)).status, 201);
  assert.equal(
    (await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body.state,
    "held",
  );
  const k = key(),
    url = `/staff/v1/bookings/${booking.bookingId}/confirm`;
  const confirmed = await post(url, a.token, { version: 1 }, k);
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  const repeated = await post(url, a.token, { version: 1 }, k);
  assert.deepEqual(repeated.body, confirmed.body);
  assert.equal((await post(url, a.token, { version: 2 }, k)).status, 409);
  const {
    rows: [snapshot],
  } = await admin.query(
    "SELECT quote FROM price_snapshots WHERE booking_id=$1",
    [booking.bookingId],
  );
  assert.equal(snapshot.quote.totalMinor, 26000);
  assert.equal(snapshot.quote.exchangeRate.source, "same_currency");
  // Simulate a later catalog edit, not a change to the accepted snapshot.
  await admin.query(
    `UPDATE products SET definition=jsonb_set(definition,'{rates,0,amountMinor}','20000'),version=version+1 WHERE tenant_id=$1 AND id=$2`,
    [a.tenantId, dep.productId],
  );
  assert.equal(
    (await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body.quote
      .totalMinor,
    26000,
  );
  const manifest = await get(
    `/ops/v1/departures/${dep.departureId}/manifest`,
    a.token,
  );
  assert.equal(manifest.body.bookings[0].party_size, 4);
  assert.equal(manifest.body.bookings[0].pickup.kind, "none");
  const available = await get(
    `/staff/v1/departures/${dep.departureId}/availability`,
    a.token,
  );
  assert.equal(available.body.available, 7);
  const { rows: events } = await admin.query(
    "SELECT * FROM audit_events WHERE tenant_id=$1 AND aggregate_id=$2",
    [a.tenantId, booking.bookingId],
  );
  assert.ok(events.some((e) => e.action === "booking.confirmed"));
  assert.ok(events.every((e) => e.actor_id && e.occurred_at && e.after_data));
});

test("tenant isolation includes direct unscoped SQL under runtime role and composite foreign keys", async () => {
  const dep = await departure();
  const booking = await heldBooking(dep.departureId);
  assert.equal(
    (await get(`/staff/v1/bookings/${booking.bookingId}`, b.token)).status,
    404,
  );
  assert.equal(
    (await get(`/ops/v1/departures/${dep.departureId}/manifest`, b.token))
      .status,
    404,
  );
  assert.equal(
    (
      await post("/staff/v1/holds", b.token, {
        departureId: dep.departureId,
        party: { adult: 1 },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post("/staff/v1/bookings", b.token, {
        holdId: booking.holdId,
        leadName: "Mock",
        leadEmail: "a@example.invalid",
        source: "phone",
        pickup: { kind: "none" },
      })
    ).status,
    404,
  );
  const db = app.get(Database);
  assert.equal((await db.pool.query("SELECT * FROM bookings")).rowCount, 0);
  await db.transaction(actor(), async (tx) => {
    const rows = await tx.query("SELECT DISTINCT tenant_id FROM bookings");
    assert.ok(rows.rows.every((r) => r.tenant_id === a.tenantId));
  });
  const foreign = await departure(b.token);
  await assert.rejects(
    db.transaction(actor(), (tx) =>
      tx.query(`INSERT INTO schedules VALUES($1,$2,$3,'{}')`, [
        a.tenantId,
        randomUUID(),
        foreign.productId,
      ]),
    ),
    /foreign key/i,
  );
  await assert.rejects(
    db.pool.query("SELECT * FROM staff_sessions"),
    /permission denied/i,
  );
});

test("hold expiry returns availability without a cleanup worker and cannot confirm", async () => {
  const dep = await departure(a.token, 1),
    booking = await heldBooking(dep.departureId);
  assert.equal(
    (await get(`/staff/v1/departures/${dep.departureId}/availability`, a.token))
      .body.available,
    0,
  );
  await admin.query(
    `UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [booking.holdId],
  );
  assert.equal(
    (await get(`/staff/v1/departures/${dep.departureId}/availability`, a.token))
      .body.available,
    1,
  );
  assert.equal(
    (await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body.state,
    "expired",
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    409,
  );
});

test("concurrent last-seat requests and concurrent confirms never overcommit", async () => {
  const dep = await departure(a.token, 1);
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 1 },
      }),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 1);
  assert.equal(attempts.filter((r) => r.status === 409).length, 7);
  const hold = attempts.find((r) => r.status === 201)!.body;
  const booking = await post("/staff/v1/bookings", a.token, {
    holdId: hold.holdId,
    leadName: "Mock",
    leadEmail: "a@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
  });
  assert.equal((await pay(booking.body.bookingId, 10000)).status, 201);
  const confirms = await Promise.all(
    Array.from({ length: 8 }, () =>
      post(`/staff/v1/bookings/${booking.body.bookingId}/confirm`, a.token, {
        version: 1,
      }),
    ),
  );
  assert.ok(
    confirms.every((r) => r.status === 201),
    JSON.stringify(confirms.map((r) => r.body)),
  );
  const {
    rows: [row],
  } = await admin.query("SELECT committed FROM departures WHERE id=$1", [
    dep.departureId,
  ]);
  assert.equal(row.committed, 1);
  assert.equal(
    (
      await admin.query("SELECT * FROM price_snapshots WHERE booking_id=$1", [
        booking.body.bookingId,
      ])
    ).rowCount,
    1,
  );
});

test("authorized overbooking requires its permission and an audited reason", async () => {
  const dep = await departure(a.token, 1);
  const first = await heldBooking(dep.departureId);
  await pay(first.bookingId, 10000);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${first.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 1 },
      })
    ).status,
    409,
  );
  const adminMember = await post("/admin/v1/members", a.token, {
    name: "Mock Admin Without Overbook",
    email: `admin-no-overbook-${randomUUID()}@example.invalid`,
    role: "admin",
  });
  const adminToken = await issueSession(
    admin,
    adminMember.body.actorId,
    a.tenantId,
  );
  assert.equal(
    (
      await post("/staff/v1/overbook-holds", adminToken, {
        departureId: dep.departureId,
        party: { adult: 1 },
        reason: "Mock group exception",
      })
    ).status,
    403,
  );
  const reservationsMember = await post("/admin/v1/members", a.token, {
    name: "Mock Reservations Without Overbook",
    email: `reservations-no-overbook-${randomUUID()}@example.invalid`,
    role: "reservations",
  });
  const reservationsToken = await issueSession(
    admin,
    reservationsMember.body.actorId,
    a.tenantId,
  );
  assert.equal(
    (
      await post("/staff/v1/overbook-holds", reservationsToken, {
        departureId: dep.departureId,
        party: { adult: 1 },
        reason: "Must be escalated to an authorized approver",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/staff/v1/overbook-holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 1 },
        reason: "short",
      })
    ).status,
    400,
  );
  const overbook = await post("/staff/v1/overbook-holds", a.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
    reason: "Mock owner approved operational exception",
  });
  assert.equal(overbook.status, 201, JSON.stringify(overbook.body));
  assert.equal(overbook.body.overbookAuthorized, true);
  const second = await post("/staff/v1/bookings", a.token, {
    holdId: overbook.body.holdId,
    leadName: "Mock Overbook Guest",
    leadEmail: "overbook@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  await pay(second.body.bookingId, 10000);
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${second.body.bookingId}/confirm`,
        a.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const {
    rows: [row],
  } = await admin.query(
    "SELECT committed,overbooked,capacity FROM departures WHERE id=$1",
    [dep.departureId],
  );
  assert.equal(row.capacity, 1);
  assert.equal(row.committed, 1);
  assert.equal(row.overbooked, 1);
  const { rows: audit } = await admin.query(
    "SELECT reason FROM audit_events WHERE tenant_id=$1 AND aggregate_id=$2 AND action='inventory.overbook_authorized'",
    [a.tenantId, overbook.body.holdId],
  );
  assert.equal(audit[0].reason, "Mock owner approved operational exception");
});

test("duplicate concurrent hold key returns a single hold and changed payload conflicts", async () => {
  const dep = await departure(),
    k = key();
  const replies = await Promise.all(
    Array.from({ length: 5 }, () =>
      post(
        "/staff/v1/holds",
        a.token,
        { departureId: dep.departureId, party: { adult: 1 } },
        k,
      ),
    ),
  );
  assert.ok(replies.every((r) => r.status === 201));
  assert.equal(new Set(replies.map((r) => r.body.holdId)).size, 1);
  assert.equal(
    (
      await post(
        "/staff/v1/holds",
        a.token,
        { departureId: dep.departureId, party: { adult: 2 } },
        k,
      )
    ).status,
    409,
  );
});

test("pending/manual payments, wrong currency and unconfigured methods do not fabricate settlement", async () => {
  const dep = await departure(),
    booking = await heldBooking(dep.departureId);
  assert.equal(
    (await pay(booking.bookingId, 10000, a.token, "pending")).status,
    201,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    409,
  );
  const payload = {
    amountMinor: 10000,
    currency: "XCD",
    method: "cash",
    status: "settled",
    reference: "mock",
    reason: "Mock",
    occurredAt: new Date().toISOString(),
  };
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${booking.bookingId}/payments`,
        a.token,
        payload,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/payments`, a.token, {
        ...payload,
        currency: "USD",
        method: "stripe",
      })
    ).status,
    400,
  );
  const k = key();
  const body = { ...payload, currency: "USD" };
  const p = await post(
    `/staff/v1/bookings/${booking.bookingId}/payments`,
    a.token,
    body,
    k,
  );
  assert.equal(p.status, 201);
  assert.deepEqual(
    (
      await post(
        `/staff/v1/bookings/${booking.bookingId}/payments`,
        a.token,
        body,
        k,
      )
    ).body,
    p.body,
  );
  assert.equal(
    (await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body
      .paidMinor,
    10000,
  );
  assert.equal((await pay(booking.bookingId, 1)).status, 409);
});

test("manual payment corrections append one audited void or reversal and recalculate balances", async () => {
  const dep = await departure();
  const booking = await heldBooking(dep.departureId);
  const pending = await pay(booking.bookingId, 2500, a.token, "pending");
  assert.equal(pending.status, 201, JSON.stringify(pending.body));
  const voided = await post(
    `/staff/v1/bookings/${booking.bookingId}/payments/${pending.body.paymentId}/adjustments`,
    a.token,
    {
      kind: "void",
      reference: "VOID-TEST-1",
      reason: "Pending entry was recorded against the wrong booking",
      occurredAt: new Date().toISOString(),
    },
  );
  assert.equal(voided.status, 201, JSON.stringify(voided.body));
  const settled = await pay(booking.bookingId, 10000, a.token, "settled");
  assert.equal(settled.status, 201, JSON.stringify(settled.body));
  const reversalKey = key();
  const reversalBody = {
    kind: "reversal",
    reference: "REV-TEST-1",
    reason: "External bank reversal confirmed by finance",
    occurredAt: new Date().toISOString(),
  };
  const reversed = await post(
    `/staff/v1/bookings/${booking.bookingId}/payments/${settled.body.paymentId}/adjustments`,
    a.token,
    reversalBody,
    reversalKey,
  );
  assert.equal(reversed.status, 201, JSON.stringify(reversed.body));
  assert.deepEqual(
    (
      await post(
        `/staff/v1/bookings/${booking.bookingId}/payments/${settled.body.paymentId}/adjustments`,
        a.token,
        reversalBody,
        reversalKey,
      )
    ).body,
    reversed.body,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${booking.bookingId}/payments/${settled.body.paymentId}/adjustments`,
        a.token,
        { ...reversalBody, reference: "REV-TEST-2" },
      )
    ).status,
    409,
  );
  const detail = await get(`/staff/v1/bookings/${booking.bookingId}`, a.token);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.paidMinor, 0);
  assert.equal(detail.body.payments.length, 2);
  assert.ok(
    detail.body.payments.every((payment: any) => payment.adjustment_id),
  );
  const { rows: audit } = await admin.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND aggregate_id=ANY($2::uuid[]) ORDER BY occurred_at",
    [a.tenantId, [pending.body.paymentId, settled.body.paymentId]],
  );
  assert.deepEqual(
    audit
      .map((row) => row.action)
      .filter((action) => action.startsWith("payment.")),
    [
      "payment.manual_recorded",
      "payment.void",
      "payment.manual_recorded",
      "payment.reversal",
    ],
  );
});

test("permissions, revoked membership and expired session are enforced on every request", async () => {
  const member = await post("/admin/v1/members", a.token, {
    name: "Mock Reader",
    email: "reader@example.invalid",
    role: "auditor",
  });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  const token = await issueSession(admin, member.body.actorId, a.tenantId);
  assert.equal(
    (await post("/admin/v1/products", token, mockProduct)).status,
    403,
  );
  assert.equal((await post("/platform/v1/tenants", token, {})).status, 403);
  const elevated = await post("/admin/v1/members", a.token, {
    name: "Bad Owner",
    email: "x@example.invalid",
    role: "owner",
  });
  assert.equal(elevated.status, 400);
  const revoke = await request(app.getHttpServer())
    .patch(`/admin/v1/members/${member.body.actorId}`)
    .auth(a.token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .send({ role: "auditor", active: false });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
  assert.equal((await get("/admin/v1/products", token)).status, 401);
  const expires = await issueSession(admin, a.ownerId, a.tenantId);
  await admin.query(
    `UPDATE staff_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1`,
    [digest(expires)],
  );
  assert.equal((await get("/admin/v1/products", expires)).status, 401);
  assert.equal(
    (
      await request(app.getHttpServer())
        .get("/admin/v1/products")
        .set("x-tenant-id", a.tenantId)
    ).status,
    401,
  );
});

test("tenant owners approve, observe and revoke time-limited read-only platform support access", async () => {
  const requestId = randomUUID();
  const requested = await post(
    "/platform/v1/support-access/requests",
    platform,
    {
      requestId,
      tenantId: a.tenantId,
      purpose: "Investigate a tenant-reported reservation display issue",
      permissions: ["bookings.read", "manifest.read"],
    },
  );
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.ok(requested.body.permissions.includes("catalog.read"));
  const listed = await get("/admin/v1/support-access", a.token);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(
    listed.body.items.find((item: any) => item.id === requestId).status,
    "pending",
  );
  const approved = await post(
    `/admin/v1/support-access/${requestId}/decision`,
    a.token,
    {
      decision: "approved",
      expiresInHours: 1,
      reason: "Approved to diagnose the reported display issue",
    },
  );
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  const used = await post(
    `/platform/v1/support-access/${requestId}/use`,
    platform,
    {},
  );
  assert.equal(used.status, 201, JSON.stringify(used.body));
  const supportToken = used.body.token;
  const supportSession = await get("/staff/v1/workspace/session", supportToken);
  assert.equal(supportSession.status, 200, JSON.stringify(supportSession.body));
  assert.equal(supportSession.body.role, "support");
  assert.equal(supportSession.body.tenant.id, a.tenantId);
  assert.equal(supportSession.body.supportAccess.id, requestId);
  assert.equal(
    (await get("/staff/v1/workspace/reservations", supportToken)).status,
    200,
  );
  assert.equal(
    (await get("/admin/v1/support-access", supportToken)).status,
    403,
  );
  const revoked = await post(
    `/admin/v1/support-access/${requestId}/revoke`,
    a.token,
    { reason: "Support investigation has been completed" },
  );
  assert.equal(revoked.status, 201, JSON.stringify(revoked.body));
  assert.equal(
    (await get("/staff/v1/workspace/session", supportToken)).status,
    401,
  );
  const { rows: audit } = await admin.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY occurred_at",
    [a.tenantId, requestId],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    [
      "support_access.requested",
      "support_access.approved",
      "support_access.used",
      "support_access.revoked",
    ],
  );
});

test("tenant invitations create access only after the recipient activates with a password", async () => {
  const email = `invite-${randomUUID().slice(0, 8)}@example.invalid`;
  const invitation = await post("/admin/v1/invitations", a.token, {
    name: "Invited Dispatcher",
    email,
    role: "dispatcher",
  });
  assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
  assert.equal((await get("/admin/v1/invitations", a.token)).status, 200);
  const rejected = await request(app.getHttpServer())
    .post("/auth/v1/invitations/accept")
    .send({ token: invitation.body.token, password: "short" });
  assert.equal(rejected.status, 400);
  const activated = await request(app.getHttpServer())
    .post("/auth/v1/invitations/accept")
    .send({ token: invitation.body.token, password: "InvitationPass123!" });
  assert.equal(activated.status, 201, JSON.stringify(activated.body));
  assert.equal(
    (await get("/staff/v1/workspace/session", activated.body.token)).status,
    200,
  );
  assert.equal(
    (
      await request(app.getHttpServer())
        .post("/auth/v1/invitations/accept")
        .send({ token: invitation.body.token, password: "InvitationPass123!" })
    ).status,
    401,
  );
});

test("a staff user can revoke every active session across their tenant memberships", async () => {
  const member = await post("/admin/v1/members", a.token, {
    name: "Session Test User",
    email: `sessions-${randomUUID()}@example.invalid`,
    role: "auditor",
  });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  const first = await issueSession(admin, member.body.actorId, a.tenantId);
  const second = await issueSession(admin, member.body.actorId, a.tenantId);
  const revoked = await request(app.getHttpServer())
    .post("/auth/v1/sign-out-all")
    .auth(first, { type: "bearer" });
  assert.equal(revoked.status, 201, JSON.stringify(revoked.body));
  assert.ok(revoked.body.revoked >= 2);
  assert.equal((await get("/staff/v1/workspace/session", first)).status, 401);
  assert.equal((await get("/staff/v1/workspace/session", second)).status, 401);
});

test("tenant policies are configurable, versioned and snapshotted per hold", async () => {
  const demo = await setupTenant("mock-flexible", {
    ...mockConfig,
    taxBasisPoints: 750,
    minimumPaidPercent: 25,
    allowUnresolvedPickup: true,
  });
  const dep = await departure(demo.token),
    booking = await heldBooking(
      dep.departureId,
      demo.token,
      { adult: 1 },
      { kind: "unresolved", note: "Mock pickup pending" },
    );
  const profile = await request(app.getHttpServer())
    .patch("/admin/v1/tenant/profile")
    .auth(demo.token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .send({
      businessProfile: {
        displayName: "Mock Flexible Tours",
        streetAddress: "1 Harbour Road",
        suite: "Suite 2",
        city: "St. John's",
        stateParish: "Saint John",
        postalCode: "00000",
        country: "AG",
        email: "contact@example.test",
        phone: "+1 268 555 0100",
      },
      authorizedContact: {
        name: "Mock Owner",
        email: "owner@example.test",
        phone: "+1 268 555 0101",
      },
    });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  assert.equal(profile.body.businessProfile.country, "AG");
  assert.equal(booking.quote.totalMinor, 10750);
  const patch = await request(app.getHttpServer())
    .patch("/admin/v1/tenant/config")
    .auth(demo.token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .send({ version: 2, config: { ...mockConfig, minimumPaidPercent: 100 } });
  assert.equal(patch.status, 200);
  assert.equal((await pay(booking.bookingId, 2688, demo.token)).status, 201);
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${booking.bookingId}/confirm`,
        demo.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const stale = await request(app.getHttpServer())
    .patch("/admin/v1/tenant/config")
    .auth(demo.token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .send({ version: 2, config: mockConfig });
  assert.equal(stale.status, 409);
});

test("strict validation rejects unknown fields, bad rates, empty parties and duplicate recurring departures", async () => {
  assert.equal(
    (
      await post("/admin/v1/products", a.token, {
        ...mockProduct,
        tenantId: b.tenantId,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/admin/v1/products", a.token, {
        ...mockProduct,
        rates: [...mockProduct.rates, mockProduct.rates[0]],
      })
    ).status,
    400,
  );
  const dep = await departure();
  assert.equal(
    (
      await post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 0 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { alien: 1 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 1.5 },
      })
    ).status,
    400,
  );
  const d = DateTime.utc().plus({ days: 20 }).toISODate(),
    body = {
      productId: dep.productId,
      name: "Schedule",
      startDate: d,
      endDate: d,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTimes: ["10:00"],
      capacity: 5,
      blackoutDates: [],
    },
    k = key();
  const first = await post("/admin/v1/schedules", a.token, body, k);
  assert.equal(first.status, 201);
  assert.deepEqual(
    (await post("/admin/v1/schedules", a.token, body, k)).body,
    first.body,
  );
  assert.equal((await post("/admin/v1/schedules", a.token, body)).status, 409);
});

test("catalog creation normalizes options, passenger units, rates and availability rules", async () => {
  const created = await departure(a.token, 12);
  const product = await admin.query(
    `SELECT p.status,p.availability_mode,count(DISTINCT o.id)::int options,
            count(DISTINCT u.id)::int units,count(DISTINCT r.id)::int rates
     FROM products p
     JOIN product_options o ON o.tenant_id=p.tenant_id AND o.product_id=p.id
     JOIN passenger_units u ON u.tenant_id=o.tenant_id AND u.option_id=o.id
     JOIN rate_plans r ON r.tenant_id=o.tenant_id AND r.option_id=o.id
     WHERE p.tenant_id=$1 AND p.id=$2
     GROUP BY p.tenant_id,p.id`,
    [a.tenantId, created.productId],
  );
  assert.deepEqual(product.rows[0], {
    status: "active",
    availability_mode: "fixed_departure",
    options: 1,
    units: mockProduct.categories.length,
    rates: mockProduct.rates.length,
  });
  const rules = await get("/admin/v1/availability-rules", a.token);
  assert.equal(rules.status, 200, JSON.stringify(rules.body));
  assert.ok(
    rules.body.some(
      (rule: { capacity: number; times: string[] }) =>
        rule.capacity === 12 && rule.times.includes("09:00"),
    ),
  );
  const otherTenantRules = await get("/admin/v1/availability-rules", b.token);
  assert.equal(otherTenantRules.status, 200);
  assert.equal(
    otherTenantRules.body.some((rule: { id: string }) =>
      rules.body.some((own: { id: string }) => own.id === rule.id),
    ),
    false,
  );

  const requested = await post("/admin/v1/products", a.token, {
    ...mockProduct,
    name: "Mock request-only charter",
    availabilityMode: "on_request",
    productKind: "charter",
    pricingModel: "per_group",
    privateBooking: true,
    confirmationMode: "request",
  });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const fixedEditor = await post("/admin/v1/schedules", a.token, {
    productId: requested.body.productId,
    name: "Schedule",
    startDate: DateTime.utc().plus({ days: 20 }).toISODate(),
    endDate: DateTime.utc().plus({ days: 21 }).toISODate(),
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    localTimes: ["10:00"],
    capacity: 1,
    blackoutDates: [],
  });
  assert.equal(fixedEditor.status, 400);
  const catalog = await get("/admin/v1/products", a.token);
  assert.equal(catalog.status, 200);
  assert.ok(
    catalog.body.some(
      (product: { id: string; availability_mode: string }) =>
        product.id === requested.body.productId &&
        product.availability_mode === "on_request",
    ),
  );
  const priced = catalog.body.find(
    (product: { id: string }) => product.id === created.productId,
  );
  assert.equal(Number(priced.price_from_minor), 6000);
  const date = DateTime.utc().plus({ days: 10 }).toISODate();
  const bookable = await get(
    `/staff/v1/workspace/departures?view=upcoming&from=${date}&to=${date}&availabilityMode=fixed_departure`,
    a.token,
  );
  assert.equal(bookable.status, 200, JSON.stringify(bookable.body));
  assert.ok(
    bookable.body.items.some(
      (item: { id: string; availability_mode: string }) =>
        item.id === created.departureId &&
        item.availability_mode === "fixed_departure",
    ),
  );
  await admin.query(
    "UPDATE products SET availability_mode='on_request' WHERE tenant_id=$1 AND id=$2",
    [a.tenantId, created.productId],
  );
  const hidden = await get(
    `/staff/v1/workspace/departures?view=upcoming&from=${date}&to=${date}&availabilityMode=fixed_departure&productId=${created.productId}`,
    a.token,
  );
  assert.equal(hidden.body.items.length, 0);
  assert.equal(
    (
      await post("/staff/v1/holds", a.token, {
        departureId: created.departureId,
        party: { adult: 1 },
      })
    ).status,
    400,
  );
});

test("catalog product and availability rule can be opened and updated", async () => {
  const created = await departure(a.token, 8);
  const product = await get(`/admin/v1/products/${created.productId}`, a.token);
  assert.equal(product.status, 200, JSON.stringify(product.body));
  assert.equal(product.body.id, created.productId);
  const definition = product.body.definition;
  const updated = await patch(
    `/admin/v1/products/${created.productId}`,
    a.token,
    {
      version: product.body.version,
      name: "Harbor sunset",
      description: "Evening shared departure",
      status: "active",
      productKind: product.body.product_kind ?? "tour",
      optionName: definition.optionName,
      durationMinutes: definition.durationMinutes,
      pricingModel: definition.pricingModel ?? "per_person",
      privateBooking: Boolean(definition.privateBooking),
      confirmationMode: definition.confirmationMode ?? "instant",
      categories: definition.categories,
      rates: definition.rates.map(
        (rate: { amountMinor: number }, index: number) =>
          index === 0 ? { ...rate, amountMinor: 12000 } : rate,
      ),
    },
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.name, "Harbor sunset");
  assert.equal(updated.body.definition.rates[0].amountMinor, 12000);
  assert.equal(
    (
      await patch(`/admin/v1/products/${created.productId}`, a.token, {
        version: product.body.version,
        name: "Stale name",
        description: "",
        status: "active",
        productKind: "tour",
        optionName: definition.optionName,
        durationMinutes: definition.durationMinutes,
        pricingModel: definition.pricingModel ?? "per_person",
        privateBooking: false,
        confirmationMode: "instant",
        categories: definition.categories,
        rates: definition.rates,
      })
    ).status,
    409,
  );
  assert.equal(
    (await get(`/admin/v1/products/${created.productId}`, b.token)).status,
    404,
  );
  const rules = await get("/admin/v1/availability-rules", a.token);
  const rule = rules.body.find(
    (item: { product_id: string }) => item.product_id === created.productId,
  );
  assert.ok(rule);
  const detail = await get(`/admin/v1/availability-rules/${rule.id}`, a.token);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.ok(
    detail.body.departures.some(
      (item: { id: string }) => item.id === created.departureId,
    ),
  );
  const paused = await patch(
    `/admin/v1/availability-rules/${rule.id}`,
    a.token,
    {
      version: detail.body.version,
      status: "paused",
    },
  );
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  assert.equal(paused.body.status, "paused");
  const resumed = await patch(
    `/admin/v1/availability-rules/${rule.id}`,
    a.token,
    {
      version: paused.body.version,
      status: "active",
    },
  );
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  await heldBooking(created.departureId);
  const blocked = await patch(
    `/admin/v1/availability-rules/${rule.id}`,
    a.token,
    {
      version: resumed.body.version,
      status: "paused",
    },
  );
  assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
  assert.match(
    String(
      blocked.body.message ??
        blocked.body.error ??
        JSON.stringify(blocked.body),
    ),
    /active bookings/i,
  );
  assert.equal(
    (await get(`/admin/v1/availability-rules/${rule.id}`, b.token)).status,
    404,
  );
});

test("availability rule edit regenerates capacity and end date safely", async () => {
  const created = await departure(a.token, 8);
  const rules = await get("/admin/v1/availability-rules", a.token);
  const rule = rules.body.find(
    (item: { product_id: string }) => item.product_id === created.productId,
  );
  assert.ok(rule);
  const detail = await get(`/admin/v1/availability-rules/${rule.id}`, a.token);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const longerEnd = DateTime.fromISO(detail.body.end_date, { zone: "UTC" })
    .plus({ days: 3 })
    .toISODate()!;
  const extended = await patch(
    `/admin/v1/availability-rules/${rule.id}`,
    a.token,
    {
      version: detail.body.version,
      status: "active",
      name: detail.body.name,
      startDate: detail.body.start_date,
      endDate: longerEnd,
      weekdays: detail.body.weekdays,
      localTimes: detail.body.times,
      capacity: 12,
      blackoutDates: detail.body.blackouts ?? [],
    },
  );
  assert.equal(extended.status, 200, JSON.stringify(extended.body));
  assert.equal(extended.body.capacity, 12);
  assert.equal(extended.body.end_date, longerEnd);
  assert.ok(extended.body.impact.added >= 1);
  assert.ok(extended.body.impact.capacityUpdated >= 1);

  await heldBooking(created.departureId);
  const onlyNewDay = longerEnd;
  const blocked = await patch(
    `/admin/v1/availability-rules/${rule.id}`,
    a.token,
    {
      version: extended.body.version,
      status: "active",
      name: extended.body.name,
      startDate: onlyNewDay,
      endDate: onlyNewDay,
      weekdays: extended.body.weekdays,
      localTimes: extended.body.times,
      capacity: 12,
      blackoutDates: extended.body.blackouts ?? [],
    },
  );
  assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
  assert.match(
    String(blocked.body.message ?? JSON.stringify(blocked.body)),
    /active bookings|holds/i,
  );
});

test("confirmation failure rolls back capacity, consumption, snapshot, audit and outbox together", async () => {
  const dep = await departure(),
    booking = await heldBooking(dep.departureId);
  await pay(booking.bookingId, 10000);
  await admin.query(`CREATE FUNCTION test_fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;
    CREATE TRIGGER test_failure BEFORE INSERT ON price_snapshots FOR EACH ROW EXECUTE FUNCTION test_fail_snapshot();`);
  try {
    assert.equal(
      (
        await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
          version: 1,
        })
      ).status,
      500,
    );
    const {
      rows: [state],
    } = await admin.query(
      "SELECT committed,consumed FROM departures JOIN holds ON holds.departure_id=departures.id WHERE holds.id=$1",
      [booking.holdId],
    );
    assert.equal(state.committed, 0);
    assert.equal(state.consumed, false);
    assert.equal(
      (
        await admin.query(
          `SELECT * FROM audit_events WHERE aggregate_id=$1 AND action='booking.confirmed'`,
          [booking.bookingId],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await admin.query(
          `SELECT * FROM outbox_events WHERE aggregate_id=$1 AND type='booking.confirmed'`,
          [booking.bookingId],
        )
      ).rowCount,
      0,
    );
  } finally {
    await admin.query(
      "DROP TRIGGER test_failure ON price_snapshots; DROP FUNCTION test_fail_snapshot()",
    );
  }
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    201,
  );
});

test("recurring schedules reject DST gaps/ambiguities and honor blackout dates", async () => {
  const ny = await post("/platform/v1/tenants", platform, {
    slug: "mock-new-york",
    name: "Mock DST Tours",
    timezone: "America/New_York",
    ownerName: "Mock Owner",
    ownerEmail: "dst@example.invalid",
    ownerPhone: "+12125550100",
    country: "US",
    config: mockConfig,
  });
  assert.equal(ny.status, 201);
  const token = await issueSession(admin, ny.body.ownerId, ny.body.tenantId);
  const p = await post("/admin/v1/products", token, mockProduct);
  const base = {
    productId: p.body.productId,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    capacity: 10,
    blackoutDates: [],
  };
  assert.equal(
    (
      await post("/admin/v1/schedules", token, {
        ...base,
        name: "Schedule",
        startDate: "2030-03-10",
        endDate: "2030-03-10",
        localTimes: ["02:30"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/admin/v1/schedules", token, {
        ...base,
        name: "Schedule",
        startDate: "2030-11-03",
        endDate: "2030-11-03",
        localTimes: ["01:30"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/admin/v1/schedules", token, {
        ...base,
        name: "Schedule",
        startDate: "2030-02-30",
        endDate: "2030-02-30",
        localTimes: ["09:00"],
      })
    ).status,
    400,
  );
  const valid = await post("/admin/v1/schedules", token, {
    ...base,
    name: "Schedule",
    startDate: "2030-03-10",
    endDate: "2030-03-12",
    localTimes: ["09:00"],
    blackoutDates: ["2030-03-11"],
  });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.departures.length, 2);
});

test("unresolved pickup policy and stale booking version block confirmation without consuming capacity", async () => {
  const dep = await departure(),
    booking = await heldBooking(
      dep.departureId,
      a.token,
      { adult: 1 },
      { kind: "unresolved", note: "Mock pending pickup" },
    );
  await pay(booking.bookingId, 10000);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 2,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    409,
  );
  const {
    rows: [row],
  } = await admin.query("SELECT committed FROM departures WHERE id=$1", [
    dep.departureId,
  ]);
  assert.equal(row.committed, 0);
});

test("financial/audit snapshots are append-only and outbox delivery has one durable receipt per event", async () => {
  await assert.rejects(
    admin.query(`UPDATE audit_events SET action='changed' WHERE tenant_id=$1`, [
      a.tenantId,
    ]),
    /append-only/,
  );
  await assert.rejects(
    admin.query(`UPDATE payments SET amount_minor=1 WHERE tenant_id=$1`, [
      a.tenantId,
    ]),
    /append-only/,
  );
  await assert.rejects(
    admin.query(`UPDATE price_snapshots SET quote='{}' WHERE tenant_id=$1`, [
      a.tenantId,
    ]),
    /append-only/,
  );
  const worker = app.get(OutboxService);
  await Promise.all([worker.drain(actor()), worker.drain(actor())]);
  while ((await worker.drain(actor())).delivered) {
    /* drain bounded batches */
  }
  assert.equal((await worker.drain(actor())).delivered, 0);
  const {
    rows: [counts],
  } = await admin.query(
    `SELECT (SELECT COUNT(*) FROM outbox_events WHERE tenant_id=$1) AS events,(SELECT COUNT(*) FROM event_receipts WHERE tenant_id=$1) AS receipts`,
    [a.tenantId],
  );
  assert.equal(counts.events, counts.receipts);
});

test("migrations rerun cleanly, OpenAPI is available, and unsafe startup is blocked", async () => {
  await migrate(local.adminUrl, local.role);
  const api = await request(app.getHttpServer()).get("/openapi.json");
  assert.equal(api.status, 200, JSON.stringify(api.body));
  assert.ok(api.body.paths["/staff/v1/bookings/{id}/confirm"]);
  const old = process.env.APP_MODE;
  process.env.APP_MODE = "production";
  await assert.rejects(createApp(), /Production/);
  process.env.APP_MODE = old;
  const db = app.get(Database);
  const {
    rows: [role],
  } = await db.pool.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  process.env.DATABASE_URL = local.adminUrl;
  await assert.rejects(createApp(), /non-owner/);
  process.env.DATABASE_URL = local.runtimeUrl;
});

test("workspace reads paginate, honor tenant scope and restrict staff directory", async () => {
  const one = await setupTenant("workspace-one");
  const two = await setupTenant("workspace-two");
  const d1 = await departure(one.token);
  await departure(one.token);
  const other = await departure(two.token);
  const session = await get("/staff/v1/workspace/session", one.token);
  assert.equal(session.status, 200);
  assert.equal(session.body.tenant.id, one.tenantId);
  assert.ok(session.body.permissions.includes("members.write"));
  const first = await get("/staff/v1/workspace/departures?limit=1", one.token);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.ok(first.body.nextCursor);
  const second = await get(
    `/staff/v1/workspace/departures?limit=1&cursor=${first.body.nextCursor}`,
    one.token,
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.items.length, 1);
  assert.notEqual(second.body.items[0].id, first.body.items[0].id);
  assert.equal(second.body.nextCursor, null);
  assert.ok(
    [first.body.items[0], second.body.items[0]].every(
      (d) => d.id !== other.departureId,
    ),
  );
  assert.equal(
    (await get("/staff/v1/workspace/departures?limit=101", one.token)).status,
    400,
  );
  const booked = await heldBooking(d1.departureId, one.token);
  const reservations = await get(
    "/staff/v1/workspace/reservations?search=Mock",
    one.token,
  );
  assert.equal(reservations.status, 200);
  assert.equal(reservations.body.items[0].id, booked.bookingId);
  assert.ok(reservations.body.items[0].created_at);
  const sortedByGuest = await get(
    "/staff/v1/workspace/reservations?sort=lead_name&dir=asc",
    one.token,
  );
  assert.equal(sortedByGuest.status, 200, JSON.stringify(sortedByGuest.body));
  assert.equal(
    (
      await get(
        "/staff/v1/workspace/reservations?state=held&source=phone",
        one.token,
      )
    ).body.items[0].id,
    booked.bookingId,
  );
  assert.equal(
    (await get("/staff/v1/workspace/reservations?state=cancelled", one.token))
      .body.items.length,
    0,
  );
  assert.equal(
    (await get("/staff/v1/workspace/reservations?from=not-a-date", one.token))
      .status,
    400,
  );
  assert.equal(
    (await get("/staff/v1/workspace/reservations", two.token)).body.items
      .length,
    0,
  );
  assert.ok(
    (await get(`/staff/v1/bookings/${booked.bookingId}`, one.token)).body
      .expiresAt,
  );
  const summary = await get("/staff/v1/workspace/summary", one.token);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.upcoming_departures, 2);
  assert.equal(summary.body.held_bookings, 1);
  const member = await post("/admin/v1/members", one.token, {
    name: "Mock Dispatcher",
    email: "workspace-dispatcher@example.invalid",
    role: "dispatcher",
  });
  assert.equal(member.status, 201);
  const directory = await get("/staff/v1/workspace/members", one.token);
  assert.equal(directory.status, 200);
  assert.equal(directory.body.items.length, 2);
  assert.ok(
    directory.body.items.every((m: { id: string }) => m.id !== two.ownerId),
  );
  const token = await issueSession(admin, member.body.actorId, one.tenantId);
  assert.equal((await get("/staff/v1/workspace/members", token)).status, 403);
  assert.equal(
    (await get("/staff/v1/workspace/departures", token)).status,
    200,
  );
});

test("customer records deduplicate within a tenant and expose protected booking timelines", async () => {
  const firstDeparture = await departure(a.token, 3);
  const firstHold = await post("/staff/v1/holds", a.token, {
    departureId: firstDeparture.departureId,
    party: { adult: 1 },
  });
  const first = await post("/staff/v1/bookings", a.token, {
    holdId: firstHold.body.holdId,
    leadName: "Mock Repeat Guest",
    leadEmail: "Repeat.Guest@example.invalid",
    leadPhone: "+1 268 555 0100",
    purchaser: {
      name: "Mock Purchaser",
      email: "buyer@example.invalid",
      phone: "+1 268 555 0199",
    },
    emergencyContact: {
      name: "Mock Emergency",
      phone: "+1 268 555 0188",
      relationship: "Sibling",
    },
    source: "phone",
    pickup: { kind: "none" },
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const secondDeparture = await departure(a.token, 3);
  const secondHold = await post("/staff/v1/holds", a.token, {
    departureId: secondDeparture.departureId,
    party: { adult: 1 },
  });
  const second = await post("/staff/v1/bookings", a.token, {
    holdId: secondHold.body.holdId,
    leadName: "Mock Repeat Guest Updated",
    leadEmail: "repeat.guest@example.invalid",
    leadPhone: "+1 268 555 0101",
    source: "phone",
    pickup: { kind: "none" },
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const customers = await get(
    "/staff/v1/customers?search=repeat.guest%40example.invalid",
    a.token,
  );
  assert.equal(customers.status, 200, JSON.stringify(customers.body));
  assert.equal(customers.body.items.length, 1);
  assert.equal(customers.body.items[0].booking_count, 2);
  assert.equal(customers.body.items[0].phone, "+1 268 555 0101");
  const detail = await get(
    `/staff/v1/customers/${customers.body.items[0].id}`,
    a.token,
  );
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.bookings.length, 2);
  assert.equal(
    detail.body.bookings.find(
      (booking: any) => booking.id === first.body.bookingId,
    ).purchaser.name,
    "Mock Purchaser",
  );
  assert.equal(
    detail.body.bookings.find(
      (booking: any) => booking.id === first.body.bookingId,
    ).emergency_contact.relationship,
    "Sibling",
  );
  assert.equal(
    detail.body.timeline.filter((event: any) => event.kind === "booking")
      .length,
    2,
  );
  assert.equal(
    (await get(`/staff/v1/customers/${customers.body.items[0].id}`, b.token))
      .status,
    404,
  );
});

async function confirmedForChange(capacity = 10) {
  const d = await departure(a.token, capacity);
  const booking = await heldBooking(d.departureId);
  await pay(booking.bookingId, 10000);
  await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
    version: 1,
  });
  return { ...d, ...booking };
}
async function changeQuote(
  bookingId: string,
  overrides: Record<string, unknown> = {},
) {
  const current = (await get(`/staff/v1/bookings/${bookingId}`, a.token)).body;
  return post(`/staff/v1/bookings/${bookingId}/change-quotes`, a.token, {
    version: current.version,
    departureId: current.departure_id,
    party: current.party,
    leadName: current.lead_name,
    leadEmail: current.lead_email,
    pickup: current.pickup,
    reason: "Mock requested change",
    ...overrides,
  });
}
test("amendment moves capacity, preserves old prices/payment facts, and cancellation releases seats exactly once", async () => {
  const original = await confirmedForChange(1),
    target = await departure(a.token, 4);
  const q = await changeQuote(original.bookingId, {
    departureId: target.departureId,
    party: { adult: 2 },
    leadName: "Mock Changed Traveler",
  });
  assert.equal(q.status, 201, JSON.stringify(q.body));
  assert.equal(q.body.differenceMinor, 10000);
  assert.equal(q.body.seatsReserved, false);
  const accepted = await post(
    `/staff/v1/bookings/${original.bookingId}/changes`,
    a.token,
    { version: 2, quoteId: q.body.quoteId },
  );
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  const read = (await get(`/staff/v1/bookings/${original.bookingId}`, a.token))
    .body;
  assert.equal(read.version, 3);
  assert.equal(read.balanceMinor, 10000);
  assert.equal(read.paidMinor, 10000);
  assert.equal(read.departure_id, target.departureId);
  assert.deepEqual(read.party, { adult: 2 });
  assert.equal(
    (
      await get(
        `/staff/v1/departures/${original.departureId}/availability`,
        a.token,
      )
    ).body.available,
    1,
  );
  assert.equal(
    (await get(`/ops/v1/departures/${target.departureId}/manifest`, a.token))
      .body.bookings[0].party_size,
    2,
  );
  assert.equal(
    (
      await admin.query("SELECT * FROM price_snapshots WHERE booking_id=$1", [
        original.bookingId,
      ])
    ).rowCount,
    2,
  );
  const cancelKey = key(),
    cancelPath = `/staff/v1/bookings/${original.bookingId}/cancel`;
  const cancelled = await post(
    cancelPath,
    a.token,
    { version: 3, reason: "Mock cancellation" },
    cancelKey,
  );
  assert.equal(cancelled.status, 201);
  assert.equal(cancelled.body.financeReviewRequired, true);
  assert.deepEqual(
    (
      await post(
        cancelPath,
        a.token,
        { version: 3, reason: "Mock cancellation" },
        cancelKey,
      )
    ).body,
    cancelled.body,
  );
  assert.equal(
    (await post(cancelPath, a.token, { version: 3, reason: "Again" })).status,
    409,
  );
  assert.equal(
    (
      await get(
        `/staff/v1/departures/${target.departureId}/availability`,
        a.token,
      )
    ).body.available,
    4,
  );
  assert.equal(
    (await get(`/ops/v1/departures/${target.departureId}/manifest`, a.token))
      .body.bookings.length,
    0,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${original.bookingId}/confirm`, a.token, {
        version: 4,
      })
    ).status,
    409,
  );
  assert.equal((await pay(original.bookingId, 1)).status, 409);
  const final = (await get(`/staff/v1/bookings/${original.bookingId}`, a.token))
    .body;
  assert.equal(final.state, "cancelled");
  assert.equal(final.balanceMinor, 0);
  assert.equal(final.paidMinor, 10000);
  const history = await get(
    `/staff/v1/bookings/${original.bookingId}/changes`,
    a.token,
  );
  assert.equal(history.body.length, 2);
  assert.equal(history.body[1].before_data.quote.totalMinor, 10000);
  assert.equal(
    (await get(`/staff/v1/bookings/${original.bookingId}/changes`, b.token))
      .status,
    404,
  );
  await assert.rejects(
    admin.query("UPDATE booking_changes SET reason=$1 WHERE booking_id=$2", [
      "tamper",
      original.bookingId,
    ]),
    /append-only/,
  );
});
test("amendment acceptance races for last seat and stale or expired quotes preserve original bookings", async () => {
  const first = await confirmedForChange(),
    second = await confirmedForChange(),
    target = await departure(a.token, 1);
  const q1 = await changeQuote(first.bookingId, {
    departureId: target.departureId,
  });
  const q2 = await changeQuote(second.bookingId, {
    departureId: target.departureId,
  });
  const results = await Promise.all(
    [
      [first, q1],
      [second, q2],
    ].map(([booking, q]: any) =>
      post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: q.body.quoteId,
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const failed = results[0]!.status === 409 ? first : second;
  assert.equal(
    (await get(`/staff/v1/bookings/${failed.bookingId}`, a.token)).body
      .departure_id,
    failed.departureId,
  );
  const stale = await changeQuote(failed.bookingId),
    fresh = await changeQuote(failed.bookingId, { leadName: "Mock corrected" });
  assert.equal(
    (
      await post(`/staff/v1/bookings/${failed.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: fresh.body.quoteId,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${failed.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: stale.body.quoteId,
      })
    ).status,
    409,
  );
  // Issue with a short expiry using a past target quote timestamp via insert-only admin fixture.
  const expiredId = key();
  await admin.query(
    `INSERT INTO booking_change_quotes SELECT tenant_id,$2,booking_id,actor_id,3,input,quote,seats,allow_balance,clock_timestamp()-interval '1 second' FROM booking_change_quotes WHERE id=$1`,
    [fresh.body.quoteId, expiredId],
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${failed.bookingId}/changes`, a.token, {
        version: 3,
        quoteId: expiredId,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${failed.bookingId}/cancel`, b.token, {
        version: 3,
        reason: "Wrong tenant",
      })
    ).status,
    404,
  );
});
test("closure recovery previews affected bookings and reports each capacity-safe rebooking result", async () => {
  const source = await departure(a.token, 2);
  const travelDate = DateTime.utc().plus({ days: 11 }).toISODate();
  const targetSchedule = await post("/admin/v1/schedules", a.token, {
    productId: source.productId,
    name: "Schedule",
    startDate: travelDate,
    endDate: travelDate,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    localTimes: ["09:00"],
    capacity: 1,
    blackoutDates: [],
  });
  assert.equal(targetSchedule.status, 201, JSON.stringify(targetSchedule.body));
  const targetId = targetSchedule.body.departures[0].departureId;
  const bookings = [];
  for (let i = 0; i < 2; i++) {
    const booking = await heldBooking(source.departureId);
    await pay(booking.bookingId, 10000);
    const confirmed = await post(
      `/staff/v1/bookings/${booking.bookingId}/confirm`,
      a.token,
      { version: 1 },
    );
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
    bookings.push(booking);
  }
  const previewPath = `/ops/v1/departures/${source.departureId}/rebooking-preview`;
  assert.equal(
    (
      await post(previewPath, a.token, {
        targetDepartureId: targetId,
        reason: "Mock weather closure",
      })
    ).status,
    409,
  );
  const closed = await post(
    `/ops/v1/departures/${source.departureId}/operational-status`,
    a.token,
    {
      version: 1,
      status: "closed",
      reason: "Mock unsafe sea conditions",
    },
  );
  assert.equal(closed.status, 201, JSON.stringify(closed.body));
  const options = await get(
    `/ops/v1/departures/${source.departureId}/rebooking-options`,
    a.token,
  );
  assert.equal(options.status, 200, JSON.stringify(options.body));
  assert.ok(options.body.options.some((option: any) => option.id === targetId));
  assert.equal(
    (
      await get(
        `/ops/v1/departures/${source.departureId}/rebooking-options`,
        b.token,
      )
    ).status,
    404,
  );
  const preview = await post(previewPath, a.token, {
    targetDepartureId: targetId,
    reason: "Mock weather closure",
  });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  assert.equal(preview.body.affected, 2);
  assert.equal(preview.body.eligible, 2);
  assert.equal(preview.body.messagesQueued, 0);
  const applied = await post(
    `/ops/v1/departures/${source.departureId}/rebook`,
    a.token,
    {
      targetDepartureId: targetId,
      items: preview.body.items.map((item: any) => ({
        bookingId: item.bookingId,
        version: item.version,
        quoteId: item.quoteId,
      })),
    },
  );
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal(applied.body.succeeded, 1);
  assert.equal(applied.body.failed, 1);
  assert.equal(
    (await get(`/staff/v1/departures/${targetId}/availability`, a.token)).body
      .available,
    0,
  );
  const reads = await Promise.all(
    bookings.map((booking) =>
      get(`/staff/v1/bookings/${booking.bookingId}`, a.token),
    ),
  );
  assert.deepEqual(
    reads.map((response) => response.body.departure_id).sort(),
    [source.departureId, targetId].sort(),
  );
});
test("held pickup correction retains expiry and cancelled hold immediately returns availability", async () => {
  const d = await departure(a.token, 1),
    booking = await heldBooking(
      d.departureId,
      a.token,
      { adult: 1 },
      { kind: "unresolved", note: "Mock needs pickup" },
    );
  const original = (
    await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)
  ).body;
  const q = await changeQuote(booking.bookingId, {
    pickup: { kind: "selected", location: "Mock dock", instructions: "" },
  });
  assert.equal(q.status, 201);
  assert.equal(q.body.differenceMinor, 0);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 1,
        quoteId: q.body.quoteId,
      })
    ).status,
    201,
  );
  assert.equal(
    (await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body
      .expiresAt,
    original.expiresAt,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/cancel`, a.token, {
        version: 2,
        reason: "Mock cancelled hold",
      })
    ).status,
    201,
  );
  assert.equal(
    (await get(`/staff/v1/departures/${d.departureId}/availability`, a.token))
      .body.available,
    1,
  );
});

test("amendment persists stay, purchaser and emergency contacts; held rejects departure or party change", async () => {
  const hotel = await post("/ops/v1/stays/accommodations", a.token, {
    name: "Mock Amend Hotel",
    address: "9 Mock Wharf",
  });
  assert.equal(hotel.status, 201, JSON.stringify(hotel.body));
  const d = await departure(a.token, 4);
  const booking = await heldBooking(d.departureId);
  const heldPartyReject = await changeQuote(booking.bookingId, {
    party: { adult: 2 },
  });
  assert.equal(
    heldPartyReject.status,
    409,
    JSON.stringify(heldPartyReject.body),
  );
  const other = await departure(a.token, 4);
  const heldDepartureReject = await changeQuote(booking.bookingId, {
    departureId: other.departureId,
  });
  assert.equal(
    heldDepartureReject.status,
    409,
    JSON.stringify(heldDepartureReject.body),
  );
  const heldContacts = await changeQuote(booking.bookingId, {
    leadName: "Mock Held Lead",
    leadPhone: "+1 268 555 0200",
    purchaser: {
      name: "Mock Amend Buyer",
      email: "amend-buyer@example.invalid",
      phone: "+1 268 555 0201",
    },
    emergencyContact: {
      name: "Mock Amend Emergency",
      phone: "+1 268 555 0202",
      relationship: "Parent",
    },
    stay: {
      kind: "hotel",
      accommodationId: hotel.body.id,
      hotelName: "Untrusted hotel name",
      roomNumber: "12",
    },
  });
  assert.equal(heldContacts.status, 201, JSON.stringify(heldContacts.body));
  assert.equal(heldContacts.body.differenceMinor, 0);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 1,
        quoteId: heldContacts.body.quoteId,
      })
    ).status,
    201,
  );
  const heldRead = (
    await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)
  ).body;
  assert.equal(heldRead.lead_name, "Mock Held Lead");
  assert.equal(heldRead.purchaser.name, "Mock Amend Buyer");
  assert.equal(heldRead.purchaser.phone, "+1 268 555 0201");
  assert.equal(heldRead.emergency_contact.relationship, "Parent");
  assert.equal(heldRead.stay.kind, "hotel");
  assert.equal(heldRead.stay.hotelName, "Mock Amend Hotel");
  assert.equal(heldRead.accommodation_property_id, hotel.body.id);
  assert.equal((await pay(booking.bookingId, 10000)).status, 201);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 2,
      })
    ).status,
    201,
  );
  const cruise = await post("/ops/v1/stays/vessels", a.token, {
    name: "Mock Amend Voyager",
  });
  assert.equal(cruise.status, 201, JSON.stringify(cruise.body));
  const confirmedQuote = await changeQuote(booking.bookingId, {
    party: { adult: 2 },
    leadPhone: "+1 268 555 0300",
    purchaser: {
      name: "Mock Confirmed Buyer",
      email: "confirmed-buyer@example.invalid",
      phone: "+1 268 555 0301",
    },
    emergencyContact: {
      name: "Mock Confirmed Emergency",
      phone: "+1 268 555 0302",
      relationship: "Spouse",
    },
    stay: {
      kind: "cruise",
      vesselId: cruise.body.id,
      vesselName: "Untrusted vessel",
      cabinNumber: "B4",
    },
    reason: "Mock party and stay amendment",
  });
  assert.equal(confirmedQuote.status, 201, JSON.stringify(confirmedQuote.body));
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 3,
        quoteId: confirmedQuote.body.quoteId,
      })
    ).status,
    201,
  );
  const confirmedRead = (
    await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)
  ).body;
  assert.deepEqual(confirmedRead.party, { adult: 2 });
  assert.equal(confirmedRead.purchaser.name, "Mock Confirmed Buyer");
  assert.equal(
    confirmedRead.emergency_contact.name,
    "Mock Confirmed Emergency",
  );
  assert.equal(confirmedRead.stay.kind, "cruise");
  assert.equal(confirmedRead.stay.vesselName, "Mock Amend Voyager");
  assert.equal(confirmedRead.vessel_id, cruise.body.id);
  const history = await get(
    `/staff/v1/bookings/${booking.bookingId}/changes`,
    a.token,
  );
  assert.equal(history.status, 200);
  const latest = history.body[0];
  assert.equal(latest.kind, "amendment");
  assert.equal(latest.after_data.stay.kind, "cruise");
  assert.equal(latest.after_data.purchaser.name, "Mock Confirmed Buyer");
  assert.equal(latest.after_data.emergency_contact.relationship, "Spouse");
});

test("amendment policy, role denial and rollback on history failure protect commercial changes", async () => {
  const t = await setupTenant("mock-strict-amendments", {
    ...mockConfig,
    allowAmendmentBalance: false,
  });
  const d = await departure(t.token),
    h = await heldBooking(d.departureId, t.token);
  assert.equal((await pay(h.bookingId, 10000, t.token)).status, 201);
  await post(`/staff/v1/bookings/${h.bookingId}/confirm`, t.token, {
    version: 1,
  });
  const input = {
    version: 2,
    departureId: d.departureId,
    party: { adult: 2 },
    leadName: "Mock Guest",
    leadEmail: "guest@example.invalid",
    pickup: { kind: "none" },
    reason: "Mock extra guest",
  };
  const q = await post(
    `/staff/v1/bookings/${h.bookingId}/change-quotes`,
    t.token,
    input,
  );
  assert.equal(q.status, 201);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${h.bookingId}/changes`, t.token, {
        version: 2,
        quoteId: q.body.quoteId,
      })
    ).status,
    409,
  );
  const member = await post("/admin/v1/members", t.token, {
    name: "Mock Finance",
    email: "review@example.invalid",
    role: "finance",
  });
  const finance = await issueSession(admin, member.body.actorId, t.tenantId);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${h.bookingId}/cancel`, finance, {
        version: 2,
        reason: "Denied",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${h.bookingId}/change-quotes`,
        finance,
        input,
      )
    ).status,
    403,
  );
  const unchanged = await post(
    `/staff/v1/bookings/${h.bookingId}/change-quotes`,
    t.token,
    { ...input, party: { adult: 1 } },
  );
  assert.equal(unchanged.status, 201);
  await admin.query(
    `CREATE FUNCTION fail_change_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test history failure'; END $$; CREATE TRIGGER fail_change_test BEFORE INSERT ON booking_changes FOR EACH ROW EXECUTE FUNCTION fail_change_test();`,
  );
  try {
    assert.equal(
      (
        await post(`/staff/v1/bookings/${h.bookingId}/changes`, t.token, {
          version: 2,
          quoteId: unchanged.body.quoteId,
        })
      ).status,
      500,
    );
    assert.equal(
      (await get(`/staff/v1/bookings/${h.bookingId}`, t.token)).body.version,
      2,
    );
    assert.equal(
      (
        await admin.query("SELECT * FROM price_snapshots WHERE booking_id=$1", [
          h.bookingId,
        ])
      ).rowCount,
      1,
    );
    assert.equal(
      (await get(`/staff/v1/departures/${d.departureId}/availability`, t.token))
        .body.committed,
      1,
    );
  } finally {
    await admin.query(
      "DROP TRIGGER fail_change_test ON booking_changes; DROP FUNCTION fail_change_test();",
    );
  }
});

test("published print templates and browser jobs are versioned, idempotent and tenant-scoped", async () => {
  const t = await setupTenant(`print-${randomUUID().slice(0, 8)}`);
  const first = await post("/ops/v1/print-templates", t.token, {
    documentType: "manifest",
    name: "Standard manifest",
    outputProfile: { paper: "A4", orientation: "portrait" },
    payload: { showPickup: true },
    isDefault: true,
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await post("/ops/v1/print-templates", t.token, {
    templateKey: first.body.templateKey,
    documentType: "manifest",
    name: "Standard manifest revised",
    outputProfile: { paper: "A4", orientation: "landscape" },
    payload: { showPickup: true, showCheckin: true },
    isDefault: true,
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.version, 2);
  const templates = await get("/ops/v1/print-templates", t.token);
  assert.equal(templates.status, 200, JSON.stringify(templates.body));
  assert.equal(templates.body.length, 2);
  assert.equal((await get("/ops/v1/print-templates", b.token)).body.length, 0);
  const dep = await departure(t.token);
  const requestKey = randomUUID();
  const jobInput = {
    documentType: "manifest",
    sourceType: "departure",
    sourceId: dep.departureId,
  };
  const job = await post("/ops/v1/print-jobs", t.token, jobInput, requestKey);
  assert.equal(job.status, 201, JSON.stringify(job.body));
  assert.equal(job.body.destinationType, "browser");
  assert.equal(job.body.downloadUrl, `/ops/v1/print-jobs/${job.body.id}/pdf`);
  const repeated = await post(
    "/ops/v1/print-jobs",
    t.token,
    jobInput,
    requestKey,
  );
  assert.equal(repeated.status, 201, JSON.stringify(repeated.body));
  assert.equal(repeated.body.id, job.body.id);
  const jobs = await get("/ops/v1/print-jobs", t.token);
  assert.equal(jobs.status, 200, JSON.stringify(jobs.body));
  assert.equal(jobs.body.length, 1);
  assert.equal((await get("/ops/v1/print-jobs", b.token)).body.length, 0);
  const pdf = await get(`/ops/v1/print-jobs/${job.body.id}/pdf`, t.token)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(pdf.status, 200);
  assert.match(String(pdf.headers["content-type"]), /^application\/pdf/);
  assert.equal((pdf.body as Buffer).subarray(0, 8).toString(), "%PDF-1.4");
  assert.equal(
    (await get(`/ops/v1/print-jobs/${job.body.id}/pdf`, b.token)).status,
    404,
  );
});

test("boarding payments may attribute a passenger and receipt PDF prints a booking", async () => {
  const t = await setupTenant(`split-pay-${randomUUID().slice(0, 8)}`);
  const dep = await departure(t.token, 8);
  const booking = await heldBooking(dep.departureId, t.token, { adult: 2 });
  const roster = await post(
    `/staff/v1/bookings/${booking.bookingId}/passengers`,
    t.token,
    {
      passengers: [
        { name: "Traveler One", category: "adult", isMinor: false },
        { name: "Traveler Two", category: "adult", isMinor: false },
      ],
    },
  );
  assert.equal(roster.status, 201, JSON.stringify(roster.body));
  const detail = await get(`/staff/v1/bookings/${booking.bookingId}`, t.token);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const total = detail.body.balanceMinor as number;
  const share = Math.floor(total / 2);
  const firstPassenger = roster.body[0].id as string;
  const secondPassenger = roster.body[1].id as string;
  const first = await post(
    `/staff/v1/bookings/${booking.bookingId}/payments`,
    t.token,
    {
      amountMinor: share,
      currency: "USD",
      method: "cash",
      status: "settled",
      reference: "share-1",
      reason: "Boarding share",
      occurredAt: new Date().toISOString(),
      passengerId: firstPassenger,
    },
  );
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.passengerId, firstPassenger);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/payments`, t.token, {
        amountMinor: share,
        currency: "USD",
        method: "cash",
        status: "settled",
        reference: "bad-passenger",
        reason: "Wrong booking passenger",
        occurredAt: new Date().toISOString(),
        passengerId: randomUUID(),
      })
    ).status,
    400,
  );
  const afterPartial = await get(
    `/staff/v1/bookings/${booking.bookingId}`,
    t.token,
  );
  assert.equal(afterPartial.status, 200);
  assert.equal(afterPartial.body.balanceMinor, total - share);
  assert.equal(afterPartial.body.payments[0].passenger_id, firstPassenger);
  assert.equal(afterPartial.body.payments[0].passenger_name, "Traveler One");
  const second = await post(
    `/staff/v1/bookings/${booking.bookingId}/payments`,
    t.token,
    {
      amountMinor: total - share,
      currency: "USD",
      method: "cash",
      status: "settled",
      reference: "share-2",
      reason: "Boarding share",
      occurredAt: new Date().toISOString(),
      passengerId: secondPassenger,
    },
  );
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, t.token, {
        version: 1,
      })
    ).status,
    201,
  );
  const receipt = await post("/ops/v1/print-jobs", t.token, {
    documentType: "receipt",
    sourceType: "booking",
    sourceId: booking.bookingId,
  });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
  const pdf = await get(`/ops/v1/print-jobs/${receipt.body.id}/pdf`, t.token)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(pdf.status, 200);
  assert.match(String(pdf.headers["content-type"]), /^application\/pdf/);
  const pdfBytes = pdf.body as Buffer;
  assert.equal(pdfBytes.subarray(0, 8).toString(), "%PDF-1.4");
  const pdfText = pdfBytes.toString("latin1");
  assert.match(pdfText, /Reservation receipt/);
  assert.match(pdfText, /Guest details/);
  assert.match(pdfText, /Charges/);
  assert.match(pdfText, /Payments/);
  assert.match(pdfText, /Traveler One/);
  assert.match(pdfText, /USD/);
});

test("report totals use tenant-scoped published commercial and operational facts", async () => {
  const t = await setupTenant(`report-${randomUUID().slice(0, 8)}`);
  const dep = await departure(t.token, 6);
  const booking = await heldBooking(dep.departureId, t.token);
  const { rows: quoteRows } = await admin.query(
    "SELECT (quote->>'totalMinor')::int AS total_minor FROM holds WHERE tenant_id=$1 AND id=$2",
    [t.tenantId, booking.holdId],
  );
  await pay(booking.bookingId, quoteRows[0].total_minor, t.token);
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, t.token, {
        version: 1,
      })
    ).status,
    201,
  );
  const { rows: dateRows } = await admin.query(
    "SELECT local_date::text AS date FROM departures WHERE tenant_id=$1 AND id=$2",
    [t.tenantId, dep.departureId],
  );
  const path = `/reports/v1/overview?from=${dateRows[0].date}&to=${dateRows[0].date}`;
  const report = await get(path, t.token);
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(report.body.commercial.confirmed, 1);
  assert.equal(report.body.commercial.bookedMinor, quoteRows[0].total_minor);
  assert.equal(report.body.commercial.receivedMinor, quoteRows[0].total_minor);
  assert.equal(report.body.commercial.guestBalanceMinor, 0);
  assert.equal(report.body.operations.departures, 1);
  assert.equal(report.body.operations.unassigned, 1);
  assert.equal((await get(path, b.token)).body.commercial.confirmed, 0);
});

test("crew mobile façade exposes only assigned trips and restricts crew check-in to that assignment", async () => {
  const t = await setupTenant(`crew-${randomUUID().slice(0, 8)}`);
  const member = await post("/admin/v1/members", t.token, {
    name: "Mock Guide",
    email: `guide-${randomUUID()}@example.invalid`,
    role: "guide",
  });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  const guide = await issueSession(admin, member.body.actorId, t.tenantId);
  const dep = await departure(t.token);
  assert.equal(
    (
      await post("/ops/v1/assignments", t.token, {
        departureId: dep.departureId,
        crewActorId: member.body.actorId,
        assignmentRole: "guide",
      })
    ).status,
    201,
  );
  const booking = await heldBooking(dep.departureId, t.token);
  const { rows: quoteRows } = await admin.query(
    "SELECT (quote->>'totalMinor')::int AS total_minor FROM holds WHERE tenant_id=$1 AND id=$2",
    [t.tenantId, booking.holdId],
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${booking.bookingId}/passengers`,
        t.token,
        {
          passengers: [
            {
              name: "Guest 1 · name required",
              category: "adult",
              isMinor: false,
              identityPending: true,
            },
          ],
        },
      )
    ).status,
    201,
  );
  await pay(booking.bookingId, quoteRows[0].total_minor, t.token);
  await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, t.token, {
    version: 1,
  });
  const crewWaiverTemplate = await post("/ops/v1/waiver-templates", t.token, {
    title: "Crew mobile waiver",
    body: "Synthetic crew waiver used only by the integration test.",
  });
  assert.equal(
    crewWaiverTemplate.status,
    201,
    JSON.stringify(crewWaiverTemplate.body),
  );
  const today = await get(
    `/crew/v1/today?date=${DateTime.utc().plus({ days: 10 }).toISODate()}`,
    guide,
  );
  assert.equal(today.status, 200, JSON.stringify(today.body));
  assert.equal(today.body.trips.length, 1);
  assert.equal(today.body.trips[0].guests.length, 1);
  assert.equal(today.body.trips[0].guests[0].lead_email, undefined);
  assert.equal(today.body.trips[0].guests[0].paid_minor, undefined);
  assert.equal(today.body.trips[0].guests[0].collection_mode, undefined);
  assert.equal(today.body.trips[0].guests[0].boarding_clearance, "settled");
  assert.equal(today.body.trips[0].guests[0].guest_balance_minor, 0);
  assert.equal(today.body.trips[0].trip_run_state, null);
  assert.deepEqual(today.body.trips[0].pickup_stops, []);
  assert.deepEqual(today.body.trips[0].pickup_exceptions, []);
  assert.equal(today.body.trips[0].guests[0].passengers.length, 1);
  assert.equal(today.body.waiverTemplate.id, crewWaiverTemplate.body.id);
  const crewPassenger = today.body.trips[0].guests[0].passengers[0];
  assert.equal(crewPassenger.waiver_signed, false);
  assert.equal(crewPassenger.identity_pending, true);
  const waiverCommand = `crew-waiver-${randomUUID()}`;
  assert.equal(
    (
      await post(`/ops/v1/passengers/${crewPassenger.id}/waiver`, guide, {
        signerName: "Crew manifest traveller",
        consentAccepted: true,
        signatureStrokes: Array.from({ length: 8 }, (_, index) => ({
          x: index / 10,
          y: index / 12,
        })),
        capturedAt: new Date().toISOString(),
        deviceCommandId: `missing-name-${randomUUID()}`,
        stay: { kind: "none" },
      })
    ).status,
    400,
  );
  const crewWaiver = await post(
    `/ops/v1/passengers/${crewPassenger.id}/waiver`,
    guide,
    {
      passengerName: "Crew manifest traveller",
      signerName: "Crew manifest traveller",
      consentAccepted: true,
      signatureStrokes: Array.from({ length: 8 }, (_, index) => ({
        x: index / 10,
        y: index / 12,
      })),
      capturedAt: new Date().toISOString(),
      deviceCommandId: waiverCommand,
      stay: {
        kind: "private_accommodation",
        propertyName: "Mock private villa",
        address: "Synthetic test address",
      },
    },
  );
  assert.equal(crewWaiver.status, 201, JSON.stringify(crewWaiver.body));
  assert.equal(
    crewWaiver.body.templateVersion,
    crewWaiverTemplate.body.version,
  );
  assert.equal(crewWaiver.body.stay.kind, "private_accommodation");
  const afterWaiver = await get(
    `/crew/v1/today?date=${DateTime.utc().plus({ days: 10 }).toISODate()}`,
    guide,
  );
  assert.equal(
    afterWaiver.body.trips[0].guests[0].passengers[0].waiver_signed,
    true,
  );
  assert.equal(
    afterWaiver.body.trips[0].guests[0].passengers[0].identity_pending,
    false,
  );
  assert.equal(
    afterWaiver.body.trips[0].guests[0].passengers[0].name,
    "Crew manifest traveller",
  );
  const token = await post(
    `/staff/v1/passengers/${crewPassenger.id}/checkin-token`,
    t.token,
    {},
  );
  assert.equal(token.status, 201, JSON.stringify(token.body));
  const resolved = await post("/staff/v1/crew/checkin-token/resolve", guide, {
    token: token.body.token,
  });
  assert.equal(resolved.status, 201, JSON.stringify(resolved.body));
  assert.equal(resolved.body.passengerId, crewPassenger.id);
  const replacementToken = await post(
    `/staff/v1/passengers/${crewPassenger.id}/checkin-token`,
    t.token,
    {},
  );
  assert.equal(replacementToken.status, 201);
  assert.equal(
    (
      await post("/staff/v1/crew/checkin-token/resolve", guide, {
        token: token.body.token,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post("/staff/v1/crew/checkin-token/resolve", b.token, {
        token: replacementToken.body.token,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post(`/staff/v1/passengers/${crewPassenger.id}/checkin`, guide, {
        state: "arrived",
      })
    ).status,
    201,
  );
  const run = await post(
    `/crew/v1/departures/${dep.departureId}/events`,
    guide,
    { state: "boarding", reason: "Guests are arriving at the meeting point" },
  );
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.state, "boarding");
  assert.equal(
    (
      await post(`/crew/v1/departures/${dep.departureId}/events`, guide, {
        state: "completed",
        reason: "Synthetic trip completed",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(`/crew/v1/departures/${dep.departureId}/events`, guide, {
        state: "departed",
        reason: "Must reject after completion",
      })
    ).status,
    400,
  );
  const arrived = await post(
    `/ops/v1/bookings/${booking.bookingId}/checkin`,
    guide,
    {
      state: "arrived",
    },
  );
  assert.equal(arrived.status, 201, JSON.stringify(arrived.body));
  const other = await departure(t.token);
  const otherBooking = await heldBooking(other.departureId, t.token);
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${otherBooking.bookingId}/passengers`,
        t.token,
        {
          passengers: [
            { name: "Unassigned traveller", category: "adult", isMinor: false },
          ],
        },
      )
    ).status,
    201,
  );
  const { rows: otherQuote } = await admin.query(
    "SELECT (quote->>'totalMinor')::int AS total_minor FROM holds WHERE tenant_id=$1 AND id=$2",
    [t.tenantId, otherBooking.holdId],
  );
  await pay(otherBooking.bookingId, otherQuote[0].total_minor, t.token);
  await post(`/staff/v1/bookings/${otherBooking.bookingId}/confirm`, t.token, {
    version: 1,
  });
  const { rows: otherPassengers } = await admin.query(
    "SELECT id FROM booking_passengers WHERE tenant_id=$1 AND booking_id=$2 AND superseded_at IS NULL",
    [t.tenantId, otherBooking.bookingId],
  );
  assert.equal(
    (
      await post(`/ops/v1/passengers/${otherPassengers[0].id}/waiver`, guide, {
        signerName: "Unassigned traveller",
        consentAccepted: true,
        signatureStrokes: Array.from({ length: 8 }, (_, index) => ({
          x: index / 10,
          y: index / 12,
        })),
        capturedAt: new Date().toISOString(),
        deviceCommandId: `crew-waiver-${randomUUID()}`,
        stay: { kind: "none" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(`/ops/v1/bookings/${otherBooking.bookingId}/checkin`, guide, {
        state: "arrived",
      })
    ).status,
    400,
  );
  const financeMember = await post("/admin/v1/members", t.token, {
    name: "Mock Finance",
    email: `finance-${randomUUID()}@example.invalid`,
    role: "finance",
  });
  const finance = await issueSession(
    admin,
    financeMember.body.actorId,
    t.tenantId,
  );
  assert.equal(
    (await get(`/crew/v1/today?date=${today.body.date}`, finance)).status,
    403,
  );
  const otherTenant = await get(
    `/crew/v1/today?date=${today.body.date}`,
    b.token,
  );
  assert.equal(otherTenant.status, 200);
  assert.equal(otherTenant.body.trips.length, 0);
});

test("crew today includes pickup sequence, balance-due facts, and assigned start", async () => {
  const t = await setupTenant(`crew-field-${randomUUID().slice(0, 8)}`, {
    ...mockConfig,
    minimumPaidPercent: 0,
  });
  const member = await post("/admin/v1/members", t.token, {
    name: "Mock Field Guide",
    email: `guide-${randomUUID()}@example.invalid`,
    role: "guide",
  });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  const guide = await issueSession(admin, member.body.actorId, t.tenantId);
  const dep = await departure(t.token);
  assert.equal(
    (
      await post("/ops/v1/assignments", t.token, {
        departureId: dep.departureId,
        crewActorId: member.body.actorId,
        assignmentRole: "guide",
      })
    ).status,
    201,
  );
  const dueBooking = await heldBooking(
    dep.departureId,
    t.token,
    { adult: 1 },
    {
      kind: "selected",
      location: "Mock hotel",
      instructions: "Lobby",
    },
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${dueBooking.bookingId}/passengers`,
        t.token,
        {
          passengers: [
            { name: "Due Traveler", category: "adult", isMinor: false },
          ],
        },
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${dueBooking.bookingId}/confirm`,
        t.token,
        {
          version: 1,
        },
      )
    ).status,
    201,
  );
  const other = await departure(t.token);
  const otherBooking = await heldBooking(other.departureId, t.token);
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${otherBooking.bookingId}/passengers`,
        t.token,
        {
          passengers: [
            { name: "Other traveller", category: "adult", isMinor: false },
          ],
        },
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${otherBooking.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const location = await post("/ops/v1/pickup-locations", t.token, {
    slug: `lobby_${randomUUID().slice(0, 8)}`,
    name: "Mock Lobby",
    kind: "hotel",
    notes: "Front desk",
  });
  assert.equal(location.status, 201, JSON.stringify(location.body));
  const {
    rows: [dayRow],
  } = await admin.query(
    "SELECT local_date::text AS day,starts_at FROM departures WHERE id=$1",
    [dep.departureId],
  );
  const saved = await post(
    `/ops/v1/departures/${dep.departureId}/pickups`,
    t.token,
    {
      notes: "Mock field order",
      stops: [
        {
          bookingId: dueBooking.bookingId,
          locationId: location.body.id,
          pickupAt: new Date(
            new Date(dayRow.starts_at).getTime() - 30 * 60_000,
          ).toISOString(),
          notes: "Lobby",
        },
      ],
    },
  );
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const today = await get(`/crew/v1/today?date=${dayRow.day}`, guide);
  assert.equal(today.status, 200, JSON.stringify(today.body));
  assert.equal(today.body.trips.length, 1);
  const trip = today.body.trips[0];
  assert.equal(trip.guests[0].boarding_clearance, "due");
  assert.ok(trip.guests[0].guest_balance_minor > 0);
  assert.equal(trip.pickup_stops.length, 1);
  assert.equal(trip.pickup_stops[0].location_name, "Mock Lobby");
  assert.equal(trip.pickup_stops[0].lead_name, "Mock Traveler");
  assert.equal(trip.boarding_pending, 1);
  assert.equal(
    (await get(`/ops/v1/departures/${dep.departureId}/pickups`, guide)).status,
    403,
  );
  assert.equal(
    (
      await post(`/ops/v1/departures/${other.departureId}/start`, guide, {
        markRemainingNoShow: true,
        reason: "Must reject unassigned start",
      })
    ).status,
    400,
  );
  const started = await post(
    `/ops/v1/departures/${dep.departureId}/start`,
    guide,
    {
      markRemainingNoShow: true,
      reason: "Guests did not arrive before departure",
    },
  );
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal(started.body.state, "departed");
  const afterStart = await get(`/crew/v1/today?date=${dayRow.day}`, guide);
  assert.equal(afterStart.body.trips[0].trip_run_state, "departed");
  assert.equal(afterStart.body.trips[0].no_show_guests, 1);
  assert.equal(afterStart.body.trips[0].boarding_pending, 0);
});

test("crew can collect remaining guest balance only on an assigned booking", async () => {
  const t = await setupTenant(`crew-pay-${randomUUID().slice(0, 8)}`, {
    ...mockConfig,
    minimumPaidPercent: 0,
  });
  const member = await post("/admin/v1/members", t.token, {
    name: "Mock Pay Guide",
    email: `guide-${randomUUID()}@example.invalid`,
    role: "guide",
  });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  const guide = await issueSession(admin, member.body.actorId, t.tenantId);
  const dep = await departure(t.token);
  assert.equal(
    (
      await post("/ops/v1/assignments", t.token, {
        departureId: dep.departureId,
        crewActorId: member.body.actorId,
        assignmentRole: "guide",
      })
    ).status,
    201,
  );
  const dueBooking = await heldBooking(dep.departureId, t.token);
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${dueBooking.bookingId}/passengers`,
        t.token,
        {
          passengers: [
            { name: "Due Traveler", category: "adult", isMinor: false },
          ],
        },
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${dueBooking.bookingId}/confirm`,
        t.token,
        {
          version: 1,
        },
      )
    ).status,
    201,
  );
  const other = await departure(t.token);
  const otherBooking = await heldBooking(other.departureId, t.token);
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${otherBooking.bookingId}/passengers`,
        t.token,
        {
          passengers: [
            { name: "Other traveller", category: "adult", isMinor: false },
          ],
        },
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${otherBooking.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const partner = await post("/finance/v1/partners", t.token, {
    name: "Mock Crew Partner",
    email: `crew-partner-${randomUUID()}@example.invalid`,
    notes: "Synthetic crew pay partner",
  });
  assert.equal(partner.status, 201, JSON.stringify(partner.body));
  const partnerHold = await post("/staff/v1/holds", t.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
  });
  assert.equal(partnerHold.status, 201, JSON.stringify(partnerHold.body));
  const partnerBooking = await post("/staff/v1/bookings", t.token, {
    holdId: partnerHold.body.holdId,
    leadName: "Partner Guest",
    leadEmail: "partner-crew@example.invalid",
    source: "partner_reseller",
    pickup: { kind: "none" },
    partner: {
      partnerId: partner.body.id,
      externalReference: "CREW-1",
      collectionMode: "partner_invoice",
      invoiceRequired: true,
    },
  });
  assert.equal(partnerBooking.status, 201, JSON.stringify(partnerBooking.body));
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${partnerBooking.body.bookingId}/passengers`,
        t.token,
        {
          passengers: [
            { name: "Partner Traveler", category: "adult", isMinor: false },
          ],
        },
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${partnerBooking.body.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const {
    rows: [dayRow],
  } = await admin.query(
    "SELECT local_date::text AS day FROM departures WHERE id=$1",
    [dep.departureId],
  );
  const today = await get(`/crew/v1/today?date=${dayRow.day}`, guide);
  assert.equal(today.status, 200, JSON.stringify(today.body));
  const dueGuest = today.body.trips[0].guests.find(
    (guest: { booking_id: string }) =>
      guest.booking_id === dueBooking.bookingId,
  );
  const partnerGuest = today.body.trips[0].guests.find(
    (guest: { booking_id: string }) =>
      guest.booking_id === partnerBooking.body.bookingId,
  );
  assert.equal(dueGuest.boarding_clearance, "due");
  assert.equal(partnerGuest.boarding_clearance, "partner");
  assert.ok(today.body.paymentMethods.includes("cash"));
  assert.equal(
    (
      await post(`/staff/v1/bookings/${dueBooking.bookingId}/payments`, guide, {
        amountMinor: dueGuest.guest_balance_minor,
        currency: dueGuest.currency,
        method: "cash",
        status: "settled",
        occurredAt: new Date().toISOString(),
        reason: "Must reject broad payment.write",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        `/crew/v1/bookings/${otherBooking.bookingId}/payments`,
        guide,
        {
          amountMinor: 1000,
          currency: "USD",
          method: "cash",
          status: "settled",
          occurredAt: new Date().toISOString(),
          reason: "Collected at boarding",
        },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        `/crew/v1/bookings/${partnerBooking.body.bookingId}/payments`,
        guide,
        {
          amountMinor: 1000,
          currency: "USD",
          method: "cash",
          status: "settled",
          occurredAt: new Date().toISOString(),
          reason: "Collected at boarding",
        },
      )
    ).status,
    400,
  );
  const paid = await post(
    `/crew/v1/bookings/${dueBooking.bookingId}/payments`,
    guide,
    {
      amountMinor: dueGuest.guest_balance_minor,
      currency: dueGuest.currency,
      method: "cash",
      status: "settled",
      occurredAt: new Date().toISOString(),
      reason: "Collected at boarding",
      passengerId: dueGuest.passengers[0].id,
    },
  );
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  const afterPay = await get(`/crew/v1/today?date=${dayRow.day}`, guide);
  const settled = afterPay.body.trips[0].guests.find(
    (guest: { booking_id: string }) =>
      guest.booking_id === dueBooking.bookingId,
  );
  assert.equal(settled.boarding_clearance, "settled");
  assert.equal(settled.guest_balance_minor, 0);
});

test("crew tablet board, walk-up, and weather stay hidden from guides", async () => {
  const t = await setupTenant(`crew-tablet-${randomUUID().slice(0, 8)}`, {
    ...mockConfig,
    minimumPaidPercent: 0,
  });
  const member = await post("/admin/v1/members", t.token, {
    name: "Mock Tablet Guide",
    email: `guide-${randomUUID()}@example.invalid`,
    role: "guide",
  });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  const guide = await issueSession(admin, member.body.actorId, t.tenantId);
  const desk = await post("/admin/v1/members", t.token, {
    name: "Mock Reservations",
    email: `res-${randomUUID()}@example.invalid`,
    role: "reservations",
  });
  assert.equal(desk.status, 201, JSON.stringify(desk.body));
  const reservations = await issueSession(
    admin,
    desk.body.actorId,
    t.tenantId,
  );
  const dep = await departure(t.token);
  assert.equal(
    (
      await post("/ops/v1/assignments", t.token, {
        departureId: dep.departureId,
        crewActorId: member.body.actorId,
        assignmentRole: "guide",
      })
    ).status,
    201,
  );
  const {
    rows: [dayRow],
  } = await admin.query(
    "SELECT local_date::text AS day FROM departures WHERE id=$1",
    [dep.departureId],
  );
  assert.equal(
    (await get(`/crew/v1/board?date=${dayRow.day}`, guide)).status,
    403,
  );
  const board = await get(`/crew/v1/board?date=${dayRow.day}`, t.token);
  assert.equal(board.status, 200, JSON.stringify(board.body));
  assert.equal(board.body.capabilities.walkUp, true);
  assert.equal(board.body.capabilities.weather, true);
  const row = board.body.items.find(
    (item: { id: string }) => item.id === dep.departureId,
  );
  assert.ok(row, JSON.stringify(board.body));
  assert.equal(row.crew[0].name, "Mock Tablet Guide");
  const deskBoard = await get(
    `/crew/v1/board?date=${dayRow.day}`,
    reservations,
  );
  assert.equal(deskBoard.status, 200, JSON.stringify(deskBoard.body));
  assert.equal(deskBoard.body.capabilities.walkUp, true);
  assert.equal(deskBoard.body.capabilities.weather, false);
  assert.equal(
    (
      await post(`/crew/v1/walk-ups`, guide, {
        departureId: dep.departureId,
        party: { adult: 1 },
        leadName: "Walk Up Guest",
        leadEmail: "walkup@example.invalid",
      })
    ).status,
    403,
  );
  const walkUp = await post(`/crew/v1/walk-ups`, reservations, {
    departureId: dep.departureId,
    party: { adult: 1 },
    leadName: "Walk Up Guest",
    leadEmail: "walkup@example.invalid",
  });
  assert.equal(walkUp.status, 201, JSON.stringify(walkUp.body));
  assert.equal(walkUp.body.state, "confirmed");
  assert.equal(walkUp.body.needsPayment, false);
  const roster = await get(`/crew/v1/board/${dep.departureId}`, t.token);
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  assert.equal(
    roster.body.guests.some(
      (guest: { lead_name: string }) => guest.lead_name === "Walk Up Guest",
    ),
    true,
  );
  const dueWalkUp = roster.body.guests.find(
    (guest: { lead_name: string }) => guest.lead_name === "Walk Up Guest",
  );
  assert.equal(dueWalkUp.boarding_clearance, "due");
  const deskPay = await post(
    `/crew/v1/bookings/${dueWalkUp.booking_id}/payments`,
    reservations,
    {
      amountMinor: dueWalkUp.guest_balance_minor,
      currency: dueWalkUp.currency,
      method: "cash",
      status: "settled",
      occurredAt: new Date().toISOString(),
      reason: "Booth collection",
    },
  );
  assert.equal(deskPay.status, 201, JSON.stringify(deskPay.body));
  const weather = await post(
    `/crew/v1/departures/${dep.departureId}/operational-status`,
    t.token,
    {
      version: row.operational_version,
      status: "weather_hold",
      reason: "Thunderstorm on the route",
    },
  );
  assert.equal(weather.status, 201, JSON.stringify(weather.body));
  assert.equal(
    (
      await post(
        `/crew/v1/departures/${dep.departureId}/operational-status`,
        guide,
        {
          version: weather.body.operational_version,
          status: "open",
          reason: "Guides cannot reopen",
        },
      )
    ).status,
    403,
  );
  const printed = await post("/crew/v1/print-jobs", t.token, {
    documentType: "pickup_list",
    sourceId: dep.departureId,
  });
  assert.equal(printed.status, 201, JSON.stringify(printed.body));
  const pdf = await get(`/crew/v1/print-jobs/${printed.body.id}/pdf`, t.token);
  assert.equal(pdf.status, 200);
  assert.match(String(pdf.headers["content-type"]), /pdf/);
  assert.equal(
    (await get(`/crew/v1/print-jobs/${printed.body.id}/pdf`, guide)).status,
    403,
  );
});

test("crew tablet walk-up collects then confirms when a deposit is required", async () => {
  const t = await setupTenant(`crew-walkpay-${randomUUID().slice(0, 8)}`, {
    ...mockConfig,
    minimumPaidPercent: 100,
  });
  const dep = await departure(t.token);
  const held = await post("/crew/v1/walk-ups", t.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
    leadName: "Booth Guest",
    leadEmail: "booth@example.invalid",
  });
  assert.equal(held.status, 201, JSON.stringify(held.body));
  assert.equal(held.body.needsPayment, true);
  assert.equal(held.body.state, "held");
  const paid = await post("/crew/v1/walk-ups", t.token, {
    bookingId: held.body.bookingId,
    payment: {
      amountMinor: held.body.quote.totalMinor,
      currency: held.body.quote.currency,
      method: "cash",
      status: "settled",
      occurredAt: new Date().toISOString(),
      reason: "Walk-up cash",
    },
  });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.state, "confirmed");
});

test("partner organizations are tenant-scoped and require partner management permission", async () => {
  const t = await setupTenant(`partner-${randomUUID().slice(0, 8)}`);
  const partner = await post("/finance/v1/partners", t.token, {
    name: "Mock Hotel Partner",
    email: "partner@example.invalid",
    notes: "Synthetic partner",
  });
  assert.equal(partner.status, 201, JSON.stringify(partner.body));
  const own = await get("/finance/v1/partners", t.token);
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.length, 1);
  assert.equal((await get("/finance/v1/partners", b.token)).body.length, 0);
  const dispatcherMember = await post("/admin/v1/members", t.token, {
    name: "Mock Dispatcher",
    email: `dispatcher-${randomUUID()}@example.invalid`,
    role: "dispatcher",
  });
  const dispatcher = await issueSession(
    admin,
    dispatcherMember.body.actorId,
    t.tenantId,
  );
  assert.equal((await get("/finance/v1/partners", dispatcher)).status, 403);
});

test("partner collection claims remain separate from guest payments until finance accepts them", async () => {
  const t = await setupTenant(`partner-claims-${randomUUID().slice(0, 8)}`, {
    ...mockConfig,
    minimumPaidPercent: 0,
  });
  const partner = await post("/finance/v1/partners", t.token, {
    name: "Mock Resort Collections",
    email: `collections-${randomUUID()}@example.invalid`,
    notes: "Synthetic finance evidence",
  });
  assert.equal(partner.status, 201, JSON.stringify(partner.body));
  const dep = await departure(t.token);
  const hold = await post("/staff/v1/holds", t.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
  });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  const booking = await post("/staff/v1/bookings", t.token, {
    holdId: hold.body.holdId,
    leadName: "Mock Partner Guest",
    leadEmail: "partner-guest@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
    partner: {
      partnerId: partner.body.id,
      externalReference: "RES-101",
      collectionMode: "partner_collects_for_tenant",
      invoiceRequired: false,
    },
  });
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${booking.body.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const claimInput = {
    bookingId: booking.body.bookingId,
    partnerId: partner.body.id,
    amountMinor: 4000,
    currency: "USD",
    reference: "RES-101-paid",
    notes: "Resort reported collection",
  };
  const claim = await post("/finance/v1/partner-claims", t.token, claimInput);
  assert.equal(claim.status, 201, JSON.stringify(claim.body));
  const pending = await get(
    `/finance/v1/bookings/${booking.body.bookingId}/finance-summary`,
    t.token,
  );
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  assert.equal(pending.body.partnerCreditMinor, 0);
  assert.equal(pending.body.guestBalanceMinor, 10000);

  const reservationsMember = await post("/admin/v1/members", t.token, {
    name: "Mock Reservations Claim Clerk",
    email: `claim-clerk-${randomUUID()}@example.invalid`,
    role: "reservations",
  });
  const reservations = await issueSession(
    admin,
    reservationsMember.body.actorId,
    t.tenantId,
  );
  assert.equal(
    (
      await post(
        `/finance/v1/partner-claims/${claim.body.id}/decision`,
        reservations,
        {
          decision: "accepted",
          reason: "Must be reviewed by finance",
        },
      )
    ).status,
    403,
  );
  const financeMember = await post("/admin/v1/members", t.token, {
    name: "Mock Finance Reviewer",
    email: `claim-finance-${randomUUID()}@example.invalid`,
    role: "finance",
  });
  const finance = await issueSession(
    admin,
    financeMember.body.actorId,
    t.tenantId,
  );
  const decisionKey = key();
  const decision = await post(
    `/finance/v1/partner-claims/${claim.body.id}/decision`,
    finance,
    {
      decision: "accepted",
      reason: "Banked partner collection verified",
    },
    decisionKey,
  );
  assert.equal(decision.status, 201, JSON.stringify(decision.body));
  assert.ok(decision.body.obligationId);
  assert.deepEqual(
    (
      await post(
        `/finance/v1/partner-claims/${claim.body.id}/decision`,
        finance,
        {
          decision: "accepted",
          reason: "Banked partner collection verified",
        },
        decisionKey,
      )
    ).body,
    decision.body,
  );
  assert.equal(
    (
      await post(
        `/finance/v1/partner-claims/${claim.body.id}/decision`,
        finance,
        {
          decision: "rejected",
          reason: "Changed duplicate must fail",
        },
        decisionKey,
      )
    ).status,
    409,
  );
  const accepted = await get(
    `/finance/v1/bookings/${booking.body.bookingId}/finance-summary`,
    t.token,
  );
  assert.equal(accepted.body.guestPaidMinor, 0);
  assert.equal(accepted.body.partnerCreditMinor, 4000);
  assert.equal(accepted.body.guestBalanceMinor, 6000);
  assert.equal(accepted.body.partnerObligationMinor, 4000);
  assert.equal(
    (await pay(booking.body.bookingId, 6001, t.token)).status,
    409,
    "Guest payment cannot exceed the balance after an accepted partner credit",
  );
  const statements = await get(
    `/finance/v1/partner-statements?partnerId=${partner.body.id}`,
    finance,
  );
  assert.equal(statements.status, 200, JSON.stringify(statements.body));
  assert.equal(statements.body.length, 1);
  assert.equal(statements.body[0].kind, "partner_collection");
  const facts = await admin.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND aggregate_id=ANY($2::uuid[])",
    [t.tenantId, [claim.body.id, decision.body.obligationId]],
  );
  assert.ok(facts.rows.some((row) => row.action === "partner.claim.recorded"));
  assert.ok(
    facts.rows.some((row) => row.action === "partner.obligation.created"),
  );
  const outbox = await admin.query(
    "SELECT type FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=ANY($2::uuid[])",
    [t.tenantId, [claim.body.id, decision.body.obligationId]],
  );
  assert.ok(outbox.rows.some((row) => row.type === "partner.claim.recorded"));
  assert.ok(
    outbox.rows.some((row) => row.type === "partner.obligation.created"),
  );
  const payments = await admin.query(
    "SELECT COUNT(*)::int AS count FROM payments WHERE tenant_id=$1 AND booking_id=$2",
    [t.tenantId, booking.body.bookingId],
  );
  assert.equal(payments.rows[0].count, 0);

  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${booking.body.bookingId}/cancel`,
        t.token,
        {
          version: 2,
          reason: "Synthetic partner finance review",
        },
      )
    ).body.financeReviewRequired,
    true,
  );
  assert.equal(
    (await get(`/staff/v1/bookings/${booking.body.bookingId}`, t.token)).body
      .financeReviewRequired,
    true,
  );

  const rejectedHold = await post("/staff/v1/holds", t.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
  });
  const rejectedBooking = await post("/staff/v1/bookings", t.token, {
    holdId: rejectedHold.body.holdId,
    leadName: "Mock Rejected Claim",
    leadEmail: "reject@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
    partner: {
      partnerId: partner.body.id,
      externalReference: "RES-102",
      collectionMode: "partner_collects_for_tenant",
      invoiceRequired: false,
    },
  });
  assert.equal(
    rejectedBooking.status,
    201,
    JSON.stringify(rejectedBooking.body),
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${rejectedBooking.body.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const rejectedClaim = await post("/finance/v1/partner-claims", t.token, {
    ...claimInput,
    bookingId: rejectedBooking.body.bookingId,
    reference: "RES-102-paid",
  });
  assert.equal(rejectedClaim.status, 201, JSON.stringify(rejectedClaim.body));
  const rejected = await post(
    `/finance/v1/partner-claims/${rejectedClaim.body.id}/decision`,
    finance,
    {
      decision: "rejected",
      reason: "Partner receipt did not match the booking",
    },
  );
  assert.equal(rejected.status, 201, JSON.stringify(rejected.body));
  assert.equal(
    (
      await get(
        `/finance/v1/bookings/${rejectedBooking.body.bookingId}/finance-summary`,
        t.token,
      )
    ).body.partnerCreditMinor,
    0,
  );

  const referralHold = await post("/staff/v1/holds", t.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
  });
  const referral = await post("/staff/v1/bookings", t.token, {
    holdId: referralHold.body.holdId,
    leadName: "Mock Referral",
    leadEmail: "referral@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
  });
  assert.equal(referral.status, 201, JSON.stringify(referral.body));
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${referral.body.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await get(
        `/finance/v1/bookings/${referral.body.bookingId}/finance-summary`,
        t.token,
      )
    ).status,
    404,
  );
  const crossTenantDeparture = await departure(b.token);
  const crossTenantHold = await post("/staff/v1/holds", b.token, {
    departureId: crossTenantDeparture.departureId,
    party: { adult: 1 },
  });
  assert.equal(
    (
      await post("/staff/v1/bookings", b.token, {
        holdId: crossTenantHold.body.holdId,
        leadName: "Mock Foreign Partner",
        leadEmail: "foreign@example.invalid",
        source: "phone",
        pickup: { kind: "none" },
        partner: {
          partnerId: partner.body.id,
          externalReference: "FOREIGN",
          collectionMode: "guest_pays_tenant",
          invoiceRequired: false,
        },
      })
    ).status,
    404,
  );
});

test("partner invoice and partner collects confirm without guest payment", async () => {
  const t = await setupTenant(`partner-confirm-${randomUUID().slice(0, 8)}`, {
    ...mockConfig,
    minimumPaidPercent: 100,
  });
  const invoicePartner = await post("/finance/v1/partners", t.token, {
    name: "Mock Invoice Channel",
    email: `invoice-${randomUUID()}@example.invalid`,
  });
  assert.equal(invoicePartner.status, 201, JSON.stringify(invoicePartner.body));
  const collectPartner = await post("/finance/v1/partners", t.token, {
    name: "Mock Collection Channel",
    email: `collect-${randomUUID()}@example.invalid`,
  });
  assert.equal(collectPartner.status, 201, JSON.stringify(collectPartner.body));
  const dep = await departure(t.token);

  const invoiceHold = await post("/staff/v1/holds", t.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
  });
  const invoiceBooking = await post("/staff/v1/bookings", t.token, {
    holdId: invoiceHold.body.holdId,
    leadName: "Mock Invoice Guest",
    leadEmail: "invoice-guest@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
    partner: {
      partnerId: invoicePartner.body.id,
      externalReference: "INV-100",
      collectionMode: "partner_invoice",
      invoiceRequired: true,
    },
  });
  assert.equal(invoiceBooking.status, 201, JSON.stringify(invoiceBooking.body));
  const invoiceRead = await get(
    `/staff/v1/bookings/${invoiceBooking.body.bookingId}`,
    t.token,
  );
  assert.equal(invoiceRead.status, 200, JSON.stringify(invoiceRead.body));
  assert.equal(invoiceRead.body.partner?.collectionMode, "partner_invoice");
  assert.equal(invoiceRead.body.partner?.partnerName, "Mock Invoice Channel");
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${invoiceBooking.body.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
  const invoiceSummary = await get(
    `/finance/v1/bookings/${invoiceBooking.body.bookingId}/finance-summary`,
    t.token,
  );
  assert.equal(invoiceSummary.status, 200, JSON.stringify(invoiceSummary.body));
  assert.equal(invoiceSummary.body.collectionMode, "partner_invoice");
  assert.equal(
    invoiceSummary.body.partnerObligationMinor,
    invoiceSummary.body.totalMinor,
  );

  const collectHold = await post("/staff/v1/holds", t.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
  });
  const collectBooking = await post("/staff/v1/bookings", t.token, {
    holdId: collectHold.body.holdId,
    leadName: "Mock Collect Guest",
    leadEmail: "collect-guest@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
    partner: {
      partnerId: collectPartner.body.id,
      externalReference: "COL-100",
      collectionMode: "partner_collects_for_tenant",
      invoiceRequired: false,
    },
  });
  assert.equal(collectBooking.status, 201, JSON.stringify(collectBooking.body));
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${collectBooking.body.bookingId}/confirm`,
        t.token,
        { version: 1 },
      )
    ).status,
    201,
  );
});

test("signed webhook inbox verifies, deduplicates and never bypasses booking workflows", async () => {
  const connectorCatalog = await get("/integrations/v1/catalog", a.token);
  assert.equal(
    connectorCatalog.status,
    200,
    JSON.stringify(connectorCatalog.body),
  );
  assert.equal(
    connectorCatalog.body.find(
      (item: { code: string }) => item.code === "viator",
    ).lifecycle_status,
    "approval_required",
  );
  assert.equal(
    (
      await post("/integrations/v1/accounts", a.token, {
        connectorCode: "viator",
      })
    ).status,
    409,
  );
  const account = await post("/integrations/v1/accounts", a.token, {
    connectorCode: "wp_travel_engine",
  });
  assert.equal(account.status, 201, JSON.stringify(account.body));
  assert.equal(
    (
      await request(app.getHttpServer())
        .patch(`/integrations/v1/accounts/${account.body.id}`)
        .auth(a.token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ status: "enabled" })
    ).status,
    200,
  );
  const payload = JSON.stringify({
    event_id: "wp-order-1001",
    type: "booking.created",
  });
  const signature =
    "sha256=" +
    createHmac("sha256", account.body.secret).update(payload).digest("hex");
  const path = `/integrations/v1/inbound/${account.body.publicInboundId}`;
  const first = await request(app.getHttpServer())
    .post(path)
    .set("Content-Type", "application/json")
    .set("x-zettaz-signature", signature)
    .send(payload);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const duplicate = await request(app.getHttpServer())
    .post(path)
    .set("Content-Type", "application/json")
    .set("x-zettaz-signature", signature)
    .send(payload);
  assert.equal(duplicate.status, 201, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(
    (
      await request(app.getHttpServer())
        .post(path)
        .set("Content-Type", "application/json")
        .set("x-zettaz-signature", "sha256=bad")
        .send(payload)
    ).status,
    401,
  );
  const reviewed = await get("/integrations/v1/inbox", a.token);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body[0].external_event_id, "wp-order-1001");
  const malformed = JSON.stringify({ type: "booking.created" });
  const malformedSignature =
    "sha256=" +
    createHmac("sha256", account.body.secret).update(malformed).digest("hex");
  const quarantined = await request(app.getHttpServer())
    .post(path)
    .set("Content-Type", "application/json")
    .set("x-zettaz-signature", malformedSignature)
    .send(malformed);
  assert.equal(quarantined.status, 201, JSON.stringify(quarantined.body));
  assert.equal(quarantined.body.status, "quarantined");
  const queued = await post(
    `/integrations/v1/inbox/${quarantined.body.receiptId}/review`,
    a.token,
    {
      action: "retry",
      reason: "Product mapping was corrected by the tenant administrator",
    },
  );
  assert.equal(queued.status, 201, JSON.stringify(queued.body));
  assert.equal(queued.body.status, "retry_pending");
  const retryResult = await app.get(IntegrationService).drainRetries({
    actorId: a.ownerId,
    tenantId: a.tenantId,
    platform: false,
    permissions: [...grants.owner],
    role: "owner",
  });
  assert.deepEqual(retryResult, {
    claimed: 1,
    released: 0,
    quarantined: 1,
    deadLettered: 0,
  });
  assert.equal(
    (await get("/integrations/v1/inbox", a.token)).body.find(
      (item: { id: string }) => item.id === quarantined.body.receiptId,
    ).status,
    "quarantined",
  );
  assert.equal(
    (
      await post(
        `/integrations/v1/inbox/${quarantined.body.receiptId}/review`,
        b.token,
        {
          action: "dead_letter",
          reason: "Cross tenant attempt must not find this event",
        },
      )
    ).status,
    409,
  );
  const retained = await post(
    `/integrations/v1/inbox/${quarantined.body.receiptId}/review`,
    a.token,
    {
      action: "dead_letter",
      reason: "Source payload contract is unavailable for this event",
    },
  );
  assert.equal(retained.status, 201, JSON.stringify(retained.body));
  assert.equal(retained.body.status, "dead_letter");
  const inbox = await admin.query(
    "SELECT COUNT(*)::int AS count FROM webhook_inbox WHERE tenant_id=$1",
    [a.tenantId],
  );
  assert.equal(inbox.rows[0].count, 2);
});

test("assisted import dry-run quarantines exceptions and produces tenant-scoped acceptance evidence", async () => {
  const accounts = await get("/integrations/v1/accounts", a.token);
  assert.equal(accounts.status, 200);
  const product = await post("/admin/v1/products", a.token, {
    ...mockProduct,
    name: `Import tour ${randomUUID().slice(0, 8)}`,
  });
  assert.equal(product.status, 201, JSON.stringify(product.body));
  const externalProductId = `legacy-${randomUUID()}`;
  const mapping = await post("/integrations/v1/mappings", a.token, {
    connectorAccountId: accounts.body[0].id,
    entityType: "product",
    externalId: externalProductId,
    internalProductId: product.body.productId,
  });
  assert.equal(mapping.status, 201, JSON.stringify(mapping.body));
  const base = {
    externalReference: "LEGACY-100",
    externalProductId,
    departureAt: "2026-10-15T09:00:00-04:00",
    partySize: 2,
    leadName: "Import Guest",
    leadEmail: "import@example.invalid",
    source: "spreadsheet",
    sourceStatus: "confirmed",
    pickupDisposition: "resolved",
    currency: "USD",
    totalMinor: 15000,
    paidMinor: 5000,
    partnerReference: "",
    invoiceOwner: "guest",
  };
  const imported = await post("/integrations/v1/assisted-imports", a.token, {
    source: "tenant_cutover",
    fileName: "future-bookings.csv",
    connectorAccountId: accounts.body[0].id,
    rows: [base, { ...base, paidMinor: 16000 }],
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.dryRun, true);
  assert.equal(imported.body.valid, 1);
  assert.equal(imported.body.quarantined, 1);
  assert.equal(imported.body.duplicates, 1);
  const report = await get(
    `/integrations/v1/assisted-imports/${imported.body.importId}/report`,
    a.token,
  );
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(report.body.summary.total_rows, 2);
  assert.equal(report.body.rows[1].status, "quarantined");
  assert.match(
    report.body.rows[1].failure_reason,
    /Duplicate external reference/,
  );
  assert.equal(
    (
      await get(
        `/integrations/v1/assisted-imports/${imported.body.importId}/report`,
        b.token,
      )
    ).status,
    409,
  );
});

test("passenger rosters match the held party, remain tenant-scoped and freeze at confirmation", async () => {
  const dep = await departure(a.token, 8);
  const booking = await heldBooking(dep.departureId, a.token, {
    adult: 1,
    child: 1,
  });
  const path = `/staff/v1/bookings/${booking.bookingId}/passengers`;
  assert.equal(
    (
      await post(path, a.token, {
        passengers: [{ name: "Only one traveller", category: "adult" }],
      })
    ).status,
    409,
  );
  const roster = {
    passengers: [
      { name: "Mock Adult", category: "adult", isMinor: false },
      { name: "Mock Child", category: "child", isMinor: true },
    ],
  };
  const recorded = await post(path, a.token, roster);
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  assert.equal(recorded.body.length, 2);
  const correction = await post(`${path}/corrections`, a.token, {
    passengers: [
      { name: "Mock Adult Corrected", category: "adult", isMinor: false },
      { name: "Mock Child", category: "child", isMinor: true },
    ],
    reason: "Corrected the lead traveller spelling",
  });
  assert.equal(correction.status, 201, JSON.stringify(correction.body));
  assert.equal(correction.body[0].rosterVersion, 2);
  const listed = await get(path, a.token);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.length, 2);
  assert.equal(listed.body[0].roster_version, 2);
  const bookingBeforeConfirmation = await get(
    `/staff/v1/bookings/${booking.bookingId}`,
    a.token,
  );
  assert.equal(bookingBeforeConfirmation.status, 200);
  assert.equal(
    (
      await pay(
        booking.bookingId,
        bookingBeforeConfirmation.body.balanceMinor,
        a.token,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
      })
    ).status,
    201,
  );
  assert.equal((await post(path, a.token, roster)).status, 409);
  const waiver = await post("/ops/v1/waiver-templates", a.token, {
    title: "Passenger evidence waiver",
    body: "Synthetic passenger waiver only.",
  });
  assert.equal(waiver.status, 201, JSON.stringify(waiver.body));
  const adult = listed.body.find(
    (passenger: { category: string }) => passenger.category === "adult",
  );
  const child = listed.body.find(
    (passenger: { category: string }) => passenger.category === "child",
  );
  assert.equal(
    (
      await post(`/ops/v1/bookings/${booking.bookingId}/waivers`, a.token, {
        templateId: waiver.body.id,
        signerName: "Mock Adult Corrected",
        signerCapacity: "self",
        passengerId: adult.id,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(`/ops/v1/bookings/${booking.bookingId}/waivers`, a.token, {
        templateId: waiver.body.id,
        signerName: "Mock Child",
        signerCapacity: "self",
        passengerId: child.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(`/ops/v1/bookings/${booking.bookingId}/waivers`, a.token, {
        templateId: waiver.body.id,
        signerName: "Mock Adult Corrected",
        signerCapacity: "guardian",
        passengerId: child.id,
        guardianPassengerId: adult.id,
      })
    ).status,
    201,
  );
  const waivers = await get(
    `/ops/v1/bookings/${booking.bookingId}/waivers`,
    a.token,
  );
  assert.equal(waivers.status, 200);
  assert.equal(waivers.body.length, 2);
  assert.equal(waivers.body[0].passenger_id, child.id);
  const adultArrival = await post(
    `/staff/v1/passengers/${adult.id}/checkin`,
    a.token,
    { state: "arrived" },
  );
  assert.equal(adultArrival.status, 201, JSON.stringify(adultArrival.body));
  assert.equal(adultArrival.body.state, "arrived");
  assert.equal(
    (
      await post(`/staff/v1/passengers/${adult.id}/checkin`, a.token, {
        state: "cleared_to_board",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(`/staff/v1/passengers/${adult.id}/checkin`, a.token, {
        state: "boarded",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(`/staff/v1/passengers/${adult.id}/checkin`, a.token, {
        state: "no_show",
      })
    ).status,
    409,
  );
  const childArrival = await post(
    `/staff/v1/passengers/${child.id}/checkin`,
    a.token,
    { state: "arrived" },
  );
  assert.equal(childArrival.status, 201, JSON.stringify(childArrival.body));
  assert.equal(childArrival.body.state, "arrived");
  assert.equal(
    (
      await post(`/staff/v1/passengers/${child.id}/checkin`, a.token, {
        state: "cleared_to_board",
      })
    ).status,
    201,
  );
  const manifest = await get(
    `/ops/v1/departures/${dep.departureId}/manifest`,
    a.token,
  );
  assert.equal(manifest.status, 200);
  assert.equal(manifest.body.bookings[0].passengers.length, 2);
  assert.equal(
    manifest.body.bookings[0].passengers.find(
      (passenger: { id: string }) => passenger.id === adult.id,
    ).checkin_state,
    "boarded",
  );
  assert.equal(
    manifest.body.bookings[0].passengers.find(
      (passenger: { id: string }) => passenger.id === child.id,
    ).checkin_state,
    "cleared_to_board",
  );
  assert.equal((await get(path, b.token)).status, 404);
});

test("customer communication requests are durable, auditable, held without SMTP and tenant-scoped", async () => {
  const dep = await departure(a.token, 6);
  const booking = await heldBooking(dep.departureId, a.token);
  const path = `/staff/v1/bookings/${booking.bookingId}/notifications`;
  const prepared = await post(path, a.token, { kind: "payment_request" });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
  // Test env has no SMTP_* — request stays held until configured, then retryable.
  assert.equal(prepared.body.status, "held_provider");
  assert.equal(prepared.body.recipient, "traveler@example.invalid");
  const listed = await get(path, a.token);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].kind, "payment_request");
  assert.equal((await get(path, b.token)).status, 404);
  const audit = await admin.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND aggregate_id=$2",
    [a.tenantId, prepared.body.id],
  );
  assert.equal(audit.rows[0].action, "notification.requested");
  const retried = await post(`${path}/${prepared.body.id}/retry`, a.token, {});
  assert.equal(retried.status, 201, JSON.stringify(retried.body));
  assert.equal(retried.body.status, "held_provider");
});

test("payment request is blocked when balance is paid in full and confirm auto-queues confirmation email", async () => {
  const dep = await departure(a.token, 6);
  const booking = await heldBooking(dep.departureId, a.token);
  const { rows: quoteRows } = await admin.query(
    "SELECT (quote->>'totalMinor')::int AS total_minor FROM holds WHERE tenant_id=$1 AND id=$2",
    [a.tenantId, booking.holdId],
  );
  const total = quoteRows[0].total_minor as number;
  assert.ok(total > 0);
  const paid = await pay(booking.bookingId, total, a.token);
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  const blocked = await post(
    `/staff/v1/bookings/${booking.bookingId}/notifications`,
    a.token,
    { kind: "payment_request" },
  );
  assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
  assert.match(
    JSON.stringify(blocked.body.detail ?? blocked.body),
    /paid in full/i,
  );
  const confirmed = await post(
    `/staff/v1/bookings/${booking.bookingId}/confirm`,
    a.token,
    { version: 1 },
  );
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  const listed = await get(
    `/staff/v1/bookings/${booking.bookingId}/notifications`,
    a.token,
  );
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(
    listed.body.some(
      (row: { kind: string }) => row.kind === "booking_confirmation",
    ),
    JSON.stringify(listed.body),
  );
  const again = await post(
    `/staff/v1/bookings/${booking.bookingId}/confirm`,
    a.token,
    { version: confirmed.body.version },
  );
  assert.equal(again.status, 201, JSON.stringify(again.body));
  const listedAgain = await get(
    `/staff/v1/bookings/${booking.bookingId}/notifications`,
    a.token,
  );
  assert.equal(
    listedAgain.body.filter(
      (row: { kind: string }) => row.kind === "booking_confirmation",
    ).length,
    1,
  );
});

test("bookings link vessels and accommodations without cross-tenant references", async () => {
  const cruise = await post("/ops/v1/stays/vessels", a.token, {
    name: "Mock Voyager",
  });
  assert.equal(cruise.status, 201, JSON.stringify(cruise.body));
  const hotel = await post("/ops/v1/stays/accommodations", a.token, {
    name: "Mock Harbor Hotel",
    address: "1 Mock Quay",
  });
  assert.equal(hotel.status, 201, JSON.stringify(hotel.body));
  const options = await get("/ops/v1/stays/options", a.token);
  assert.equal(options.status, 200);
  assert.ok(
    options.body.vessels.some(
      (item: { id: string }) => item.id === cruise.body.id,
    ),
  );
  assert.ok(
    options.body.accommodations.some(
      (item: { id: string }) => item.id === hotel.body.id,
    ),
  );
  const dep = await departure(a.token, 5);
  const hold = await post("/staff/v1/holds", a.token, {
    departureId: dep.departureId,
    party: { adult: 1 },
  });
  const booking = await post("/staff/v1/bookings", a.token, {
    holdId: hold.body.holdId,
    leadName: "Mock Cruise Guest",
    leadEmail: "cruise@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
    stay: {
      kind: "cruise",
      vesselId: cruise.body.id,
      vesselName: "Untrusted vessel",
      cabinNumber: "A12",
    },
  });
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  const detail = await get(
    `/staff/v1/bookings/${booking.body.bookingId}`,
    a.token,
  );
  assert.equal(detail.body.vessel_id, cruise.body.id);
  assert.equal(detail.body.stay.vesselName, "Mock Voyager");
  const foreignDeparture = await departure(b.token, 5);
  const foreignHold = await post("/staff/v1/holds", b.token, {
    departureId: foreignDeparture.departureId,
    party: { adult: 1 },
  });
  assert.equal(
    (
      await post("/staff/v1/bookings", b.token, {
        holdId: foreignHold.body.holdId,
        leadName: "Foreign Guest",
        leadEmail: "foreign-stay@example.invalid",
        source: "phone",
        pickup: { kind: "none" },
        stay: {
          kind: "hotel",
          accommodationId: hotel.body.id,
          hotelName: "Mock Harbor Hotel",
          roomNumber: "2",
        },
      })
    ).status,
    404,
  );
});

test("password recovery is non-enumerating, single-use, expiring and revokes prior sessions", async () => {
  const email = `recovery-${randomUUID()}@example.invalid`,
    oldPassword = "RecoveryOld!2026",
    newPassword = "RecoveryNew!2026";
  const invited = await post("/admin/v1/invitations", a.token, {
    name: "Recovery User",
    email,
    role: "reservations",
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const activated = await request(app.getHttpServer())
    .post("/auth/v1/invitations/accept")
    .send({ token: invited.body.token, password: oldPassword });
  assert.equal(activated.status, 201, JSON.stringify(activated.body));
  process.env.EXPOSE_RECOVERY_TOKEN = "1";
  const unknown = await request(app.getHttpServer())
    .post("/auth/v1/password-recovery/request")
    .send({ email: `missing-${randomUUID()}@example.invalid` });
  const requested = await request(app.getHttpServer())
    .post("/auth/v1/password-recovery/request")
    .send({ email });
  delete process.env.EXPOSE_RECOVERY_TOKEN;
  assert.equal(unknown.status, 201);
  assert.equal(requested.status, 201);
  assert.deepEqual(
    { accepted: unknown.body.accepted, delivery: unknown.body.delivery },
    { accepted: requested.body.accepted, delivery: requested.body.delivery },
  );
  assert.ok(requested.body.token);
  const completed = await request(app.getHttpServer())
    .post("/auth/v1/password-recovery/complete")
    .send({ token: requested.body.token, password: newPassword });
  assert.equal(completed.status, 201, JSON.stringify(completed.body));
  assert.equal(
    (await get("/staff/v1/workspace/session", activated.body.token)).status,
    401,
  );
  assert.equal(
    (
      await request(app.getHttpServer())
        .post("/auth/v1/sign-in")
        .send({ email, password: oldPassword })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app.getHttpServer())
        .post("/auth/v1/sign-in")
        .send({ email, password: newPassword })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(app.getHttpServer())
        .post("/auth/v1/password-recovery/complete")
        .send({ token: requested.body.token, password: "AnotherValid!2026" })
    ).status,
    401,
  );
});

test("crew can establish and manage an authenticated session without catalog access", async () => {
  const email = `guide-${randomUUID()}@example.invalid`;
  const invited = await post("/admin/v1/invitations", a.token, {
    name: "Session Guide",
    email,
    role: "guide",
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const activated = await request(app.getHttpServer())
    .post("/auth/v1/invitations/accept")
    .send({ token: invited.body.token, password: "GuidePassword!2026" });
  assert.equal(activated.status, 201, JSON.stringify(activated.body));

  const session = await get(
    "/staff/v1/workspace/session",
    activated.body.token,
  );
  assert.equal(session.status, 200, JSON.stringify(session.body));
  assert.equal(session.body.actorEmail, email);
  assert.equal(session.body.role, "guide");
  assert.equal(session.body.permissions.includes("catalog.read"), false);

  const tenants = await get("/auth/v1/tenants", activated.body.token);
  assert.equal(tenants.status, 200, JSON.stringify(tenants.body));
  assert.equal(tenants.body.tenants.length, 1);

  const signedOut = await request(app.getHttpServer())
    .post("/auth/v1/sign-out")
    .set("Authorization", `Bearer ${activated.body.token}`);
  assert.equal(signedOut.status, 201, JSON.stringify(signedOut.body));
  assert.equal(
    (await get("/staff/v1/workspace/session", activated.body.token)).status,
    401,
  );
});

test("repeated failed sign-ins temporarily block the identity without revealing account existence", async () => {
  const email = `limited-${randomUUID()}@example.invalid`;
  const invited = await post("/admin/v1/invitations", a.token, {
    name: "Rate Limited User",
    email,
    role: "reservations",
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const activated = await request(app.getHttpServer())
    .post("/auth/v1/invitations/accept")
    .send({ token: invited.body.token, password: "ValidPassword!2026" });
  assert.equal(activated.status, 201, JSON.stringify(activated.body));
  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal(
      (
        await request(app.getHttpServer())
          .post("/auth/v1/sign-in")
          .send({ email, password: "WrongPassword!2026" })
      ).status,
      401,
    );
  const blocked = await request(app.getHttpServer())
    .post("/auth/v1/sign-in")
    .send({ email, password: "ValidPassword!2026" });
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.detail.message, "Email or password is incorrect.");
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { DateTime } from "luxon";
import { INestApplication } from "@nestjs/common";
import { localDatabase } from "../scripts/local-database";
import { bootstrapPlatform, issueSession } from "../scripts/sessions";
import { createApp } from "../src/app";
import { Database, digest } from "../src/database";
import { OutboxService } from "../src/operations";
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
async function setupTenant(slug: string, config = mockConfig) {
  const res = await post("/platform/v1/tenants", platform, {
    slug,
    name: `Mock ${slug}`,
    timezone: "America/Antigua",
    ownerName: "Mock Owner",
    ownerEmail: `${slug}@example.invalid`,
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
    startDate: date,
    endDate: date,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    localTime: "09:00",
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
  party = { adult: 1 },
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
  const printablePath = `/ops/v1/departures/${dep.departureId}/pickup-list`;
  const printable = await get(printablePath, a.token);
  assert.equal(printable.status, 200, JSON.stringify(printable.body));
  assert.equal(typeof printable.body.departure.product_name, "string");
  assert.ok(printable.body.departure.product_name.length > 0);
  assert.equal(printable.body.plan.version, 1);
  assert.equal(printable.body.stops[0].location_name, "Mock Hotel");
  assert.equal(printable.body.exceptions.length, 0);
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

before(async () => {
  local = await localDatabase();
  admin = new Pool({ connectionString: local.adminUrl });
  process.env.APP_MODE = "test";
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
  assert.equal(booking.quote.totalMinor, 10750);
  const patch = await request(app.getHttpServer())
    .patch("/admin/v1/tenant/config")
    .auth(demo.token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .send({ version: 1, config: { ...mockConfig, minimumPaidPercent: 100 } });
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
    .send({ version: 1, config: mockConfig });
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
      startDate: d,
      endDate: d,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: "10:00",
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
        startDate: "2030-03-10",
        endDate: "2030-03-10",
        localTime: "02:30",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/admin/v1/schedules", token, {
        ...base,
        startDate: "2030-11-03",
        endDate: "2030-11-03",
        localTime: "01:30",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/admin/v1/schedules", token, {
        ...base,
        startDate: "2030-02-30",
        endDate: "2030-02-30",
        localTime: "09:00",
      })
    ).status,
    400,
  );
  const valid = await post("/admin/v1/schedules", token, {
    ...base,
    startDate: "2030-03-10",
    endDate: "2030-03-12",
    localTime: "09:00",
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

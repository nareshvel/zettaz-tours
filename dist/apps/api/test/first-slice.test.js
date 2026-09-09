"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const pg_1 = require("pg");
const supertest_1 = __importDefault(require("supertest"));
const luxon_1 = require("luxon");
const local_database_1 = require("../scripts/local-database");
const sessions_1 = require("../scripts/sessions");
const app_1 = require("../src/app");
const database_1 = require("../src/database");
const operations_1 = require("../src/operations");
const contracts_1 = require("../../../packages/shared/src/contracts");
const fixtures_1 = require("./fixtures");
const migrate_1 = require("../scripts/migrate");
let local, admin, app, platform;
let a, b;
const key = () => (0, node_crypto_1.randomUUID)();
function post(path, token, body, k = key()) {
    return (0, supertest_1.default)(app.getHttpServer())
        .post(path)
        .timeout({ response: 10000, deadline: 15000 })
        .auth(token, { type: "bearer" })
        .set("Idempotency-Key", k)
        .send(body);
}
function get(path, token) {
    return (0, supertest_1.default)(app.getHttpServer()).get(path).auth(token, { type: "bearer" });
}
async function setupTenant(slug, config = fixtures_1.mockConfig) {
    const res = await post("/platform/v1/tenants", platform, {
        slug,
        name: `Mock ${slug}`,
        timezone: "America/Antigua",
        ownerName: "Mock Owner",
        ownerEmail: `${slug}@example.invalid`,
        config,
    });
    strict_1.default.equal(res.status, 201, JSON.stringify(res.body));
    const { tenantId, ownerId } = res.body;
    return {
        tenantId,
        ownerId,
        token: await (0, sessions_1.issueSession)(admin, ownerId, tenantId),
    };
}
async function departure(token = a.token, capacity = 10, overrides = {}) {
    const p = await post("/admin/v1/products", token, fixtures_1.mockProduct);
    strict_1.default.equal(p.status, 201, JSON.stringify(p.body));
    const date = luxon_1.DateTime.utc().plus({ days: 10 }).toISODate();
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
    strict_1.default.equal(s.status, 201, JSON.stringify(s.body));
    return {
        departureId: s.body.departures[0].departureId,
        productId: p.body.productId,
    };
}
async function heldBooking(dep, token = a.token, party = { adult: 1 }, pickup = { kind: "none" }) {
    const h = await post("/staff/v1/holds", token, { departureId: dep, party });
    strict_1.default.equal(h.status, 201, JSON.stringify(h.body));
    const booking = await post("/staff/v1/bookings", token, {
        holdId: h.body.holdId,
        leadName: "Mock Traveler",
        leadEmail: "traveler@example.invalid",
        source: "phone",
        pickup,
    });
    strict_1.default.equal(booking.status, 201, JSON.stringify(booking.body));
    return { ...booking.body, holdId: h.body.holdId };
}
async function pay(bookingId, amountMinor, token = a.token, status = "settled", k = key()) {
    return post(`/staff/v1/bookings/${bookingId}/payments`, token, {
        amountMinor,
        currency: "USD",
        method: "cash",
        status,
        reference: "mock-receipt",
        reason: "Mock cash collection",
        occurredAt: new Date().toISOString(),
    }, k);
}
const actor = () => ({
    actorId: a.ownerId,
    tenantId: a.tenantId,
    platform: false,
    permissions: [...contracts_1.grants.owner],
    role: "owner",
});
(0, node_test_1.test)("operations board and pickup plans stay scoped, versioned and aligned with reservation changes", async () => {
    const dep = await departure(a.token, 8);
    const booking = await heldBooking(dep.departureId, a.token, { adult: 2 }, { kind: "selected", location: "Mock hotel", instructions: "Lobby" });
    strict_1.default.equal((await pay(booking.bookingId, 20000)).status, 201);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
    })).status, 201);
    const location = await post("/ops/v1/pickup-locations", a.token, {
        slug: "mock_hotel",
        name: "Mock Hotel",
        kind: "hotel",
        notes: "Front lobby",
    });
    strict_1.default.equal(location.status, 201);
    const { rows: [dayRow], } = await admin.query("SELECT local_date::text AS day,starts_at FROM departures WHERE id=$1", [dep.departureId]);
    const board = await get(`/ops/v1/board?date=${dayRow.day}`, a.token);
    strict_1.default.equal(board.status, 200, JSON.stringify(board.body));
    strict_1.default.equal(board.body.items.length, 1);
    strict_1.default.equal(board.body.items[0].pickup_required, 1);
    strict_1.default.equal(board.body.items[0].pickup_planned, 0);
    const planPath = `/ops/v1/departures/${dep.departureId}/pickups`;
    const planInput = {
        notes: "Mock route order",
        stops: [
            {
                bookingId: booking.bookingId,
                locationId: location.body.id,
                pickupAt: new Date(new Date(dayRow.starts_at).getTime() - 30 * 60_000).toISOString(),
                notes: "Lobby",
            },
        ],
    };
    const saved = await post(planPath, a.token, planInput);
    strict_1.default.equal(saved.status, 201, JSON.stringify(saved.body));
    strict_1.default.equal(saved.body.version, 1);
    strict_1.default.equal((await post(planPath, a.token, { ...planInput, version: 2 })).status, 409);
    const plan = await get(planPath, a.token);
    strict_1.default.equal(plan.body.stops.length, 1);
    strict_1.default.equal(plan.body.stops[0].lead_name, "Mock Traveler");
    const printablePath = `/ops/v1/departures/${dep.departureId}/pickup-list`;
    const printable = await get(printablePath, a.token);
    strict_1.default.equal(printable.status, 200, JSON.stringify(printable.body));
    strict_1.default.equal(typeof printable.body.departure.product_name, "string");
    strict_1.default.ok(printable.body.departure.product_name.length > 0);
    strict_1.default.equal(printable.body.plan.version, 1);
    strict_1.default.equal(printable.body.stops[0].location_name, "Mock Hotel");
    strict_1.default.equal(printable.body.exceptions.length, 0);
    const after = await get(`/ops/v1/board?date=${dayRow.day}`, a.token);
    strict_1.default.equal(after.body.items[0].pickup_planned, 1);
    const quote = await changeQuote(booking.bookingId, {
        pickup: { kind: "none" },
    });
    strict_1.default.equal(quote.status, 201);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: quote.body.quoteId,
    })).status, 201);
    strict_1.default.equal((await get(planPath, a.token)).body.stops.length, 0);
    const dispatcherMember = await post("/admin/v1/members", a.token, {
        name: "Mock Dispatcher",
        email: "dispatch-plan@example.invalid",
        role: "dispatcher",
    });
    const dispatcher = await (0, sessions_1.issueSession)(admin, dispatcherMember.body.actorId, a.tenantId);
    strict_1.default.equal((await get(`/ops/v1/board?date=${dayRow.day}`, dispatcher)).status, 200);
    strict_1.default.equal((await post("/ops/v1/pickup-locations", dispatcher, {
        slug: "mock_port",
        name: "Mock Port",
        kind: "port",
        notes: "",
    })).status, 201);
    const reservationsMember = await post("/admin/v1/members", a.token, {
        name: "Mock Reservations",
        email: "reservations-plan@example.invalid",
        role: "reservations",
    });
    const reservations = await (0, sessions_1.issueSession)(admin, reservationsMember.body.actorId, a.tenantId);
    strict_1.default.equal((await post("/ops/v1/pickup-locations", reservations, {
        slug: "denied_stop",
        name: "Denied",
        kind: "other",
        notes: "",
    })).status, 403);
    strict_1.default.equal((await get(planPath, b.token)).status, 404);
    strict_1.default.equal((await get(printablePath, b.token)).status, 404);
});
(0, node_test_1.before)(async () => {
    local = await (0, local_database_1.localDatabase)();
    admin = new pg_1.Pool({ connectionString: local.adminUrl });
    process.env.APP_MODE = "test";
    process.env.DATABASE_URL = local.runtimeUrl;
    app = await (0, app_1.createApp)();
    // Keep one listener open across concurrent Supertest requests.
    await app.listen(0, "127.0.0.1");
    platform = await (0, sessions_1.bootstrapPlatform)(admin);
    a = await setupTenant("mock-harbor");
    b = await setupTenant("mock-river");
});
(0, node_test_1.after)(async () => {
    await app?.close();
    await admin?.end();
    await local?.stop();
});
(0, node_test_1.test)("full manual journey freezes price, requires payment then explicit confirmation, and writes manifest/audit", async () => {
    const dep = await departure();
    const booking = await heldBooking(dep.departureId, a.token, {
        adult: 2,
        child: 1,
        infant: 1,
    });
    const before = await get(`/ops/v1/departures/${dep.departureId}/manifest`, a.token);
    strict_1.default.equal(before.body.bookings.length, 0);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
    })).status, 409);
    strict_1.default.equal((await pay(booking.bookingId, 26000)).status, 201);
    strict_1.default.equal((await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body.state, "held");
    const k = key(), url = `/staff/v1/bookings/${booking.bookingId}/confirm`;
    const confirmed = await post(url, a.token, { version: 1 }, k);
    strict_1.default.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
    const repeated = await post(url, a.token, { version: 1 }, k);
    strict_1.default.deepEqual(repeated.body, confirmed.body);
    strict_1.default.equal((await post(url, a.token, { version: 2 }, k)).status, 409);
    const { rows: [snapshot], } = await admin.query("SELECT quote FROM price_snapshots WHERE booking_id=$1", [booking.bookingId]);
    strict_1.default.equal(snapshot.quote.totalMinor, 26000);
    strict_1.default.equal(snapshot.quote.exchangeRate.source, "same_currency");
    // Simulate a later catalog edit, not a change to the accepted snapshot.
    await admin.query(`UPDATE products SET definition=jsonb_set(definition,'{rates,0,amountMinor}','20000'),version=version+1 WHERE tenant_id=$1 AND id=$2`, [a.tenantId, dep.productId]);
    strict_1.default.equal((await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body.quote
        .totalMinor, 26000);
    const manifest = await get(`/ops/v1/departures/${dep.departureId}/manifest`, a.token);
    strict_1.default.equal(manifest.body.bookings[0].party_size, 4);
    strict_1.default.equal(manifest.body.bookings[0].pickup.kind, "none");
    const available = await get(`/staff/v1/departures/${dep.departureId}/availability`, a.token);
    strict_1.default.equal(available.body.available, 7);
    const { rows: events } = await admin.query("SELECT * FROM audit_events WHERE tenant_id=$1 AND aggregate_id=$2", [a.tenantId, booking.bookingId]);
    strict_1.default.ok(events.some((e) => e.action === "booking.confirmed"));
    strict_1.default.ok(events.every((e) => e.actor_id && e.occurred_at && e.after_data));
});
(0, node_test_1.test)("tenant isolation includes direct unscoped SQL under runtime role and composite foreign keys", async () => {
    const dep = await departure();
    const booking = await heldBooking(dep.departureId);
    strict_1.default.equal((await get(`/staff/v1/bookings/${booking.bookingId}`, b.token)).status, 404);
    strict_1.default.equal((await get(`/ops/v1/departures/${dep.departureId}/manifest`, b.token))
        .status, 404);
    strict_1.default.equal((await post("/staff/v1/holds", b.token, {
        departureId: dep.departureId,
        party: { adult: 1 },
    })).status, 404);
    strict_1.default.equal((await post("/staff/v1/bookings", b.token, {
        holdId: booking.holdId,
        leadName: "Mock",
        leadEmail: "a@example.invalid",
        source: "phone",
        pickup: { kind: "none" },
    })).status, 404);
    const db = app.get(database_1.Database);
    strict_1.default.equal((await db.pool.query("SELECT * FROM bookings")).rowCount, 0);
    await db.transaction(actor(), async (tx) => {
        const rows = await tx.query("SELECT DISTINCT tenant_id FROM bookings");
        strict_1.default.ok(rows.rows.every((r) => r.tenant_id === a.tenantId));
    });
    const foreign = await departure(b.token);
    await strict_1.default.rejects(db.transaction(actor(), (tx) => tx.query(`INSERT INTO schedules VALUES($1,$2,$3,'{}')`, [
        a.tenantId,
        (0, node_crypto_1.randomUUID)(),
        foreign.productId,
    ])), /foreign key/i);
    await strict_1.default.rejects(db.pool.query("SELECT * FROM staff_sessions"), /permission denied/i);
});
(0, node_test_1.test)("hold expiry returns availability without a cleanup worker and cannot confirm", async () => {
    const dep = await departure(a.token, 1), booking = await heldBooking(dep.departureId);
    strict_1.default.equal((await get(`/staff/v1/departures/${dep.departureId}/availability`, a.token))
        .body.available, 0);
    await admin.query(`UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [booking.holdId]);
    strict_1.default.equal((await get(`/staff/v1/departures/${dep.departureId}/availability`, a.token))
        .body.available, 1);
    strict_1.default.equal((await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body.state, "expired");
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
    })).status, 409);
});
(0, node_test_1.test)("concurrent last-seat requests and concurrent confirms never overcommit", async () => {
    const dep = await departure(a.token, 1);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 1 },
    })));
    strict_1.default.equal(attempts.filter((r) => r.status === 201).length, 1);
    strict_1.default.equal(attempts.filter((r) => r.status === 409).length, 7);
    const hold = attempts.find((r) => r.status === 201).body;
    const booking = await post("/staff/v1/bookings", a.token, {
        holdId: hold.holdId,
        leadName: "Mock",
        leadEmail: "a@example.invalid",
        source: "phone",
        pickup: { kind: "none" },
    });
    strict_1.default.equal((await pay(booking.body.bookingId, 10000)).status, 201);
    const confirms = await Promise.all(Array.from({ length: 8 }, () => post(`/staff/v1/bookings/${booking.body.bookingId}/confirm`, a.token, {
        version: 1,
    })));
    strict_1.default.ok(confirms.every((r) => r.status === 201), JSON.stringify(confirms.map((r) => r.body)));
    const { rows: [row], } = await admin.query("SELECT committed FROM departures WHERE id=$1", [
        dep.departureId,
    ]);
    strict_1.default.equal(row.committed, 1);
    strict_1.default.equal((await admin.query("SELECT * FROM price_snapshots WHERE booking_id=$1", [
        booking.body.bookingId,
    ])).rowCount, 1);
});
(0, node_test_1.test)("duplicate concurrent hold key returns a single hold and changed payload conflicts", async () => {
    const dep = await departure(), k = key();
    const replies = await Promise.all(Array.from({ length: 5 }, () => post("/staff/v1/holds", a.token, { departureId: dep.departureId, party: { adult: 1 } }, k)));
    strict_1.default.ok(replies.every((r) => r.status === 201));
    strict_1.default.equal(new Set(replies.map((r) => r.body.holdId)).size, 1);
    strict_1.default.equal((await post("/staff/v1/holds", a.token, { departureId: dep.departureId, party: { adult: 2 } }, k)).status, 409);
});
(0, node_test_1.test)("pending/manual payments, wrong currency and unconfigured methods do not fabricate settlement", async () => {
    const dep = await departure(), booking = await heldBooking(dep.departureId);
    strict_1.default.equal((await pay(booking.bookingId, 10000, a.token, "pending")).status, 201);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
    })).status, 409);
    const payload = {
        amountMinor: 10000,
        currency: "XCD",
        method: "cash",
        status: "settled",
        reference: "mock",
        reason: "Mock",
        occurredAt: new Date().toISOString(),
    };
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/payments`, a.token, payload)).status, 400);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/payments`, a.token, {
        ...payload,
        currency: "USD",
        method: "stripe",
    })).status, 400);
    const k = key();
    const body = { ...payload, currency: "USD" };
    const p = await post(`/staff/v1/bookings/${booking.bookingId}/payments`, a.token, body, k);
    strict_1.default.equal(p.status, 201);
    strict_1.default.deepEqual((await post(`/staff/v1/bookings/${booking.bookingId}/payments`, a.token, body, k)).body, p.body);
    strict_1.default.equal((await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body
        .paidMinor, 10000);
    strict_1.default.equal((await pay(booking.bookingId, 1)).status, 409);
});
(0, node_test_1.test)("permissions, revoked membership and expired session are enforced on every request", async () => {
    const member = await post("/admin/v1/members", a.token, {
        name: "Mock Reader",
        email: "reader@example.invalid",
        role: "auditor",
    });
    strict_1.default.equal(member.status, 201, JSON.stringify(member.body));
    const token = await (0, sessions_1.issueSession)(admin, member.body.actorId, a.tenantId);
    strict_1.default.equal((await post("/admin/v1/products", token, fixtures_1.mockProduct)).status, 403);
    strict_1.default.equal((await post("/platform/v1/tenants", token, {})).status, 403);
    const elevated = await post("/admin/v1/members", a.token, {
        name: "Bad Owner",
        email: "x@example.invalid",
        role: "owner",
    });
    strict_1.default.equal(elevated.status, 400);
    const revoke = await (0, supertest_1.default)(app.getHttpServer())
        .patch(`/admin/v1/members/${member.body.actorId}`)
        .auth(a.token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ role: "auditor", active: false });
    strict_1.default.equal(revoke.status, 200, JSON.stringify(revoke.body));
    strict_1.default.equal((await get("/admin/v1/products", token)).status, 401);
    const expires = await (0, sessions_1.issueSession)(admin, a.ownerId, a.tenantId);
    await admin.query(`UPDATE staff_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1`, [(0, database_1.digest)(expires)]);
    strict_1.default.equal((await get("/admin/v1/products", expires)).status, 401);
    strict_1.default.equal((await (0, supertest_1.default)(app.getHttpServer())
        .get("/admin/v1/products")
        .set("x-tenant-id", a.tenantId)).status, 401);
});
(0, node_test_1.test)("tenant policies are configurable, versioned and snapshotted per hold", async () => {
    const demo = await setupTenant("mock-flexible", {
        ...fixtures_1.mockConfig,
        taxBasisPoints: 750,
        minimumPaidPercent: 25,
        allowUnresolvedPickup: true,
    });
    const dep = await departure(demo.token), booking = await heldBooking(dep.departureId, demo.token, { adult: 1 }, { kind: "unresolved", note: "Mock pickup pending" });
    strict_1.default.equal(booking.quote.totalMinor, 10750);
    const patch = await (0, supertest_1.default)(app.getHttpServer())
        .patch("/admin/v1/tenant/config")
        .auth(demo.token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ version: 1, config: { ...fixtures_1.mockConfig, minimumPaidPercent: 100 } });
    strict_1.default.equal(patch.status, 200);
    strict_1.default.equal((await pay(booking.bookingId, 2688, demo.token)).status, 201);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, demo.token, { version: 1 })).status, 201);
    const stale = await (0, supertest_1.default)(app.getHttpServer())
        .patch("/admin/v1/tenant/config")
        .auth(demo.token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ version: 1, config: fixtures_1.mockConfig });
    strict_1.default.equal(stale.status, 409);
});
(0, node_test_1.test)("strict validation rejects unknown fields, bad rates, empty parties and duplicate recurring departures", async () => {
    strict_1.default.equal((await post("/admin/v1/products", a.token, {
        ...fixtures_1.mockProduct,
        tenantId: b.tenantId,
    })).status, 400);
    strict_1.default.equal((await post("/admin/v1/products", a.token, {
        ...fixtures_1.mockProduct,
        rates: [...fixtures_1.mockProduct.rates, fixtures_1.mockProduct.rates[0]],
    })).status, 400);
    const dep = await departure();
    strict_1.default.equal((await post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 0 },
    })).status, 400);
    strict_1.default.equal((await post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { alien: 1 },
    })).status, 400);
    strict_1.default.equal((await post("/staff/v1/holds", a.token, {
        departureId: dep.departureId,
        party: { adult: 1.5 },
    })).status, 400);
    const d = luxon_1.DateTime.utc().plus({ days: 20 }).toISODate(), body = {
        productId: dep.productId,
        startDate: d,
        endDate: d,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        localTime: "10:00",
        capacity: 5,
        blackoutDates: [],
    }, k = key();
    const first = await post("/admin/v1/schedules", a.token, body, k);
    strict_1.default.equal(first.status, 201);
    strict_1.default.deepEqual((await post("/admin/v1/schedules", a.token, body, k)).body, first.body);
    strict_1.default.equal((await post("/admin/v1/schedules", a.token, body)).status, 409);
});
(0, node_test_1.test)("confirmation failure rolls back capacity, consumption, snapshot, audit and outbox together", async () => {
    const dep = await departure(), booking = await heldBooking(dep.departureId);
    await pay(booking.bookingId, 10000);
    await admin.query(`CREATE FUNCTION test_fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;
    CREATE TRIGGER test_failure BEFORE INSERT ON price_snapshots FOR EACH ROW EXECUTE FUNCTION test_fail_snapshot();`);
    try {
        strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
            version: 1,
        })).status, 500);
        const { rows: [state], } = await admin.query("SELECT committed,consumed FROM departures JOIN holds ON holds.departure_id=departures.id WHERE holds.id=$1", [booking.holdId]);
        strict_1.default.equal(state.committed, 0);
        strict_1.default.equal(state.consumed, false);
        strict_1.default.equal((await admin.query(`SELECT * FROM audit_events WHERE aggregate_id=$1 AND action='booking.confirmed'`, [booking.bookingId])).rowCount, 0);
        strict_1.default.equal((await admin.query(`SELECT * FROM outbox_events WHERE aggregate_id=$1 AND type='booking.confirmed'`, [booking.bookingId])).rowCount, 0);
    }
    finally {
        await admin.query("DROP TRIGGER test_failure ON price_snapshots; DROP FUNCTION test_fail_snapshot()");
    }
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
    })).status, 201);
});
(0, node_test_1.test)("recurring schedules reject DST gaps/ambiguities and honor blackout dates", async () => {
    const ny = await post("/platform/v1/tenants", platform, {
        slug: "mock-new-york",
        name: "Mock DST Tours",
        timezone: "America/New_York",
        ownerName: "Mock Owner",
        ownerEmail: "dst@example.invalid",
        config: fixtures_1.mockConfig,
    });
    strict_1.default.equal(ny.status, 201);
    const token = await (0, sessions_1.issueSession)(admin, ny.body.ownerId, ny.body.tenantId);
    const p = await post("/admin/v1/products", token, fixtures_1.mockProduct);
    const base = {
        productId: p.body.productId,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        capacity: 10,
        blackoutDates: [],
    };
    strict_1.default.equal((await post("/admin/v1/schedules", token, {
        ...base,
        startDate: "2030-03-10",
        endDate: "2030-03-10",
        localTime: "02:30",
    })).status, 400);
    strict_1.default.equal((await post("/admin/v1/schedules", token, {
        ...base,
        startDate: "2030-11-03",
        endDate: "2030-11-03",
        localTime: "01:30",
    })).status, 400);
    strict_1.default.equal((await post("/admin/v1/schedules", token, {
        ...base,
        startDate: "2030-02-30",
        endDate: "2030-02-30",
        localTime: "09:00",
    })).status, 400);
    const valid = await post("/admin/v1/schedules", token, {
        ...base,
        startDate: "2030-03-10",
        endDate: "2030-03-12",
        localTime: "09:00",
        blackoutDates: ["2030-03-11"],
    });
    strict_1.default.equal(valid.status, 201);
    strict_1.default.equal(valid.body.departures.length, 2);
});
(0, node_test_1.test)("unresolved pickup policy and stale booking version block confirmation without consuming capacity", async () => {
    const dep = await departure(), booking = await heldBooking(dep.departureId, a.token, { adult: 1 }, { kind: "unresolved", note: "Mock pending pickup" });
    await pay(booking.bookingId, 10000);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 2,
    })).status, 409);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/confirm`, a.token, {
        version: 1,
    })).status, 409);
    const { rows: [row], } = await admin.query("SELECT committed FROM departures WHERE id=$1", [
        dep.departureId,
    ]);
    strict_1.default.equal(row.committed, 0);
});
(0, node_test_1.test)("financial/audit snapshots are append-only and outbox delivery has one durable receipt per event", async () => {
    await strict_1.default.rejects(admin.query(`UPDATE audit_events SET action='changed' WHERE tenant_id=$1`, [
        a.tenantId,
    ]), /append-only/);
    await strict_1.default.rejects(admin.query(`UPDATE payments SET amount_minor=1 WHERE tenant_id=$1`, [
        a.tenantId,
    ]), /append-only/);
    await strict_1.default.rejects(admin.query(`UPDATE price_snapshots SET quote='{}' WHERE tenant_id=$1`, [
        a.tenantId,
    ]), /append-only/);
    const worker = app.get(operations_1.OutboxService);
    await Promise.all([worker.drain(actor()), worker.drain(actor())]);
    while ((await worker.drain(actor())).delivered) {
        /* drain bounded batches */
    }
    strict_1.default.equal((await worker.drain(actor())).delivered, 0);
    const { rows: [counts], } = await admin.query(`SELECT (SELECT COUNT(*) FROM outbox_events WHERE tenant_id=$1) AS events,(SELECT COUNT(*) FROM event_receipts WHERE tenant_id=$1) AS receipts`, [a.tenantId]);
    strict_1.default.equal(counts.events, counts.receipts);
});
(0, node_test_1.test)("migrations rerun cleanly, OpenAPI is available, and unsafe startup is blocked", async () => {
    await (0, migrate_1.migrate)(local.adminUrl, local.role);
    const api = await (0, supertest_1.default)(app.getHttpServer()).get("/openapi.json");
    strict_1.default.equal(api.status, 200, JSON.stringify(api.body));
    strict_1.default.ok(api.body.paths["/staff/v1/bookings/{id}/confirm"]);
    const old = process.env.APP_MODE;
    process.env.APP_MODE = "production";
    await strict_1.default.rejects((0, app_1.createApp)(), /Production/);
    process.env.APP_MODE = old;
    const db = app.get(database_1.Database);
    const { rows: [role], } = await db.pool.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    strict_1.default.equal(role.rolsuper, false);
    strict_1.default.equal(role.rolbypassrls, false);
    process.env.DATABASE_URL = local.adminUrl;
    await strict_1.default.rejects((0, app_1.createApp)(), /non-owner/);
    process.env.DATABASE_URL = local.runtimeUrl;
});
(0, node_test_1.test)("workspace reads paginate, honor tenant scope and restrict staff directory", async () => {
    const one = await setupTenant("workspace-one");
    const two = await setupTenant("workspace-two");
    const d1 = await departure(one.token);
    await departure(one.token);
    const other = await departure(two.token);
    const session = await get("/staff/v1/workspace/session", one.token);
    strict_1.default.equal(session.status, 200);
    strict_1.default.equal(session.body.tenant.id, one.tenantId);
    strict_1.default.ok(session.body.permissions.includes("members.write"));
    const first = await get("/staff/v1/workspace/departures?limit=1", one.token);
    strict_1.default.equal(first.status, 200);
    strict_1.default.equal(first.body.items.length, 1);
    strict_1.default.ok(first.body.nextCursor);
    const second = await get(`/staff/v1/workspace/departures?limit=1&cursor=${first.body.nextCursor}`, one.token);
    strict_1.default.equal(second.status, 200);
    strict_1.default.equal(second.body.items.length, 1);
    strict_1.default.notEqual(second.body.items[0].id, first.body.items[0].id);
    strict_1.default.equal(second.body.nextCursor, null);
    strict_1.default.ok([first.body.items[0], second.body.items[0]].every((d) => d.id !== other.departureId));
    strict_1.default.equal((await get("/staff/v1/workspace/departures?limit=101", one.token)).status, 400);
    const booked = await heldBooking(d1.departureId, one.token);
    const reservations = await get("/staff/v1/workspace/reservations?search=Mock", one.token);
    strict_1.default.equal(reservations.status, 200);
    strict_1.default.equal(reservations.body.items[0].id, booked.bookingId);
    strict_1.default.equal((await get("/staff/v1/workspace/reservations", two.token)).body.items
        .length, 0);
    strict_1.default.ok((await get(`/staff/v1/bookings/${booked.bookingId}`, one.token)).body
        .expiresAt);
    const summary = await get("/staff/v1/workspace/summary", one.token);
    strict_1.default.equal(summary.status, 200);
    strict_1.default.equal(summary.body.upcoming_departures, 2);
    strict_1.default.equal(summary.body.held_bookings, 1);
    const member = await post("/admin/v1/members", one.token, {
        name: "Mock Dispatcher",
        email: "workspace-dispatcher@example.invalid",
        role: "dispatcher",
    });
    strict_1.default.equal(member.status, 201);
    const directory = await get("/staff/v1/workspace/members", one.token);
    strict_1.default.equal(directory.status, 200);
    strict_1.default.equal(directory.body.items.length, 2);
    strict_1.default.ok(directory.body.items.every((m) => m.id !== two.ownerId));
    const token = await (0, sessions_1.issueSession)(admin, member.body.actorId, one.tenantId);
    strict_1.default.equal((await get("/staff/v1/workspace/members", token)).status, 403);
    strict_1.default.equal((await get("/staff/v1/workspace/departures", token)).status, 200);
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
async function changeQuote(bookingId, overrides = {}) {
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
(0, node_test_1.test)("amendment moves capacity, preserves old prices/payment facts, and cancellation releases seats exactly once", async () => {
    const original = await confirmedForChange(1), target = await departure(a.token, 4);
    const q = await changeQuote(original.bookingId, {
        departureId: target.departureId,
        party: { adult: 2 },
        leadName: "Mock Changed Traveler",
    });
    strict_1.default.equal(q.status, 201, JSON.stringify(q.body));
    strict_1.default.equal(q.body.differenceMinor, 10000);
    strict_1.default.equal(q.body.seatsReserved, false);
    const accepted = await post(`/staff/v1/bookings/${original.bookingId}/changes`, a.token, { version: 2, quoteId: q.body.quoteId });
    strict_1.default.equal(accepted.status, 201, JSON.stringify(accepted.body));
    const read = (await get(`/staff/v1/bookings/${original.bookingId}`, a.token))
        .body;
    strict_1.default.equal(read.version, 3);
    strict_1.default.equal(read.balanceMinor, 10000);
    strict_1.default.equal(read.paidMinor, 10000);
    strict_1.default.equal(read.departure_id, target.departureId);
    strict_1.default.deepEqual(read.party, { adult: 2 });
    strict_1.default.equal((await get(`/staff/v1/departures/${original.departureId}/availability`, a.token)).body.available, 1);
    strict_1.default.equal((await get(`/ops/v1/departures/${target.departureId}/manifest`, a.token))
        .body.bookings[0].party_size, 2);
    strict_1.default.equal((await admin.query("SELECT * FROM price_snapshots WHERE booking_id=$1", [
        original.bookingId,
    ])).rowCount, 2);
    const cancelKey = key(), cancelPath = `/staff/v1/bookings/${original.bookingId}/cancel`;
    const cancelled = await post(cancelPath, a.token, { version: 3, reason: "Mock cancellation" }, cancelKey);
    strict_1.default.equal(cancelled.status, 201);
    strict_1.default.equal(cancelled.body.financeReviewRequired, true);
    strict_1.default.deepEqual((await post(cancelPath, a.token, { version: 3, reason: "Mock cancellation" }, cancelKey)).body, cancelled.body);
    strict_1.default.equal((await post(cancelPath, a.token, { version: 3, reason: "Again" })).status, 409);
    strict_1.default.equal((await get(`/staff/v1/departures/${target.departureId}/availability`, a.token)).body.available, 4);
    strict_1.default.equal((await get(`/ops/v1/departures/${target.departureId}/manifest`, a.token))
        .body.bookings.length, 0);
    strict_1.default.equal((await post(`/staff/v1/bookings/${original.bookingId}/confirm`, a.token, {
        version: 4,
    })).status, 409);
    strict_1.default.equal((await pay(original.bookingId, 1)).status, 409);
    const final = (await get(`/staff/v1/bookings/${original.bookingId}`, a.token))
        .body;
    strict_1.default.equal(final.state, "cancelled");
    strict_1.default.equal(final.balanceMinor, 0);
    strict_1.default.equal(final.paidMinor, 10000);
    const history = await get(`/staff/v1/bookings/${original.bookingId}/changes`, a.token);
    strict_1.default.equal(history.body.length, 2);
    strict_1.default.equal(history.body[1].before_data.quote.totalMinor, 10000);
    strict_1.default.equal((await get(`/staff/v1/bookings/${original.bookingId}/changes`, b.token))
        .status, 404);
    await strict_1.default.rejects(admin.query("UPDATE booking_changes SET reason=$1 WHERE booking_id=$2", [
        "tamper",
        original.bookingId,
    ]), /append-only/);
});
(0, node_test_1.test)("amendment acceptance races for last seat and stale or expired quotes preserve original bookings", async () => {
    const first = await confirmedForChange(), second = await confirmedForChange(), target = await departure(a.token, 1);
    const q1 = await changeQuote(first.bookingId, {
        departureId: target.departureId,
    });
    const q2 = await changeQuote(second.bookingId, {
        departureId: target.departureId,
    });
    const results = await Promise.all([
        [first, q1],
        [second, q2],
    ].map(([booking, q]) => post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: q.body.quoteId,
    })));
    strict_1.default.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const failed = results[0].status === 409 ? first : second;
    strict_1.default.equal((await get(`/staff/v1/bookings/${failed.bookingId}`, a.token)).body
        .departure_id, failed.departureId);
    const stale = await changeQuote(failed.bookingId), fresh = await changeQuote(failed.bookingId, { leadName: "Mock corrected" });
    strict_1.default.equal((await post(`/staff/v1/bookings/${failed.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: fresh.body.quoteId,
    })).status, 201);
    strict_1.default.equal((await post(`/staff/v1/bookings/${failed.bookingId}/changes`, a.token, {
        version: 2,
        quoteId: stale.body.quoteId,
    })).status, 409);
    // Issue with a short expiry using a past target quote timestamp via insert-only admin fixture.
    const expiredId = key();
    await admin.query(`INSERT INTO booking_change_quotes SELECT tenant_id,$2,booking_id,actor_id,3,input,quote,seats,allow_balance,clock_timestamp()-interval '1 second' FROM booking_change_quotes WHERE id=$1`, [fresh.body.quoteId, expiredId]);
    strict_1.default.equal((await post(`/staff/v1/bookings/${failed.bookingId}/changes`, a.token, {
        version: 3,
        quoteId: expiredId,
    })).status, 409);
    strict_1.default.equal((await post(`/staff/v1/bookings/${failed.bookingId}/cancel`, b.token, {
        version: 3,
        reason: "Wrong tenant",
    })).status, 404);
});
(0, node_test_1.test)("held pickup correction retains expiry and cancelled hold immediately returns availability", async () => {
    const d = await departure(a.token, 1), booking = await heldBooking(d.departureId, a.token, { adult: 1 }, { kind: "unresolved", note: "Mock needs pickup" });
    const original = (await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body;
    const q = await changeQuote(booking.bookingId, {
        pickup: { kind: "selected", location: "Mock dock", instructions: "" },
    });
    strict_1.default.equal(q.status, 201);
    strict_1.default.equal(q.body.differenceMinor, 0);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/changes`, a.token, {
        version: 1,
        quoteId: q.body.quoteId,
    })).status, 201);
    strict_1.default.equal((await get(`/staff/v1/bookings/${booking.bookingId}`, a.token)).body
        .expiresAt, original.expiresAt);
    strict_1.default.equal((await post(`/staff/v1/bookings/${booking.bookingId}/cancel`, a.token, {
        version: 2,
        reason: "Mock cancelled hold",
    })).status, 201);
    strict_1.default.equal((await get(`/staff/v1/departures/${d.departureId}/availability`, a.token))
        .body.available, 1);
});
(0, node_test_1.test)("amendment policy, role denial and rollback on history failure protect commercial changes", async () => {
    const t = await setupTenant("mock-strict-amendments", {
        ...fixtures_1.mockConfig,
        allowAmendmentBalance: false,
    });
    const d = await departure(t.token), h = await heldBooking(d.departureId, t.token);
    strict_1.default.equal((await pay(h.bookingId, 10000, t.token)).status, 201);
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
    const q = await post(`/staff/v1/bookings/${h.bookingId}/change-quotes`, t.token, input);
    strict_1.default.equal(q.status, 201);
    strict_1.default.equal((await post(`/staff/v1/bookings/${h.bookingId}/changes`, t.token, {
        version: 2,
        quoteId: q.body.quoteId,
    })).status, 409);
    const member = await post("/admin/v1/members", t.token, {
        name: "Mock Finance",
        email: "review@example.invalid",
        role: "finance",
    });
    const finance = await (0, sessions_1.issueSession)(admin, member.body.actorId, t.tenantId);
    strict_1.default.equal((await post(`/staff/v1/bookings/${h.bookingId}/cancel`, finance, {
        version: 2,
        reason: "Denied",
    })).status, 403);
    strict_1.default.equal((await post(`/staff/v1/bookings/${h.bookingId}/change-quotes`, finance, input)).status, 403);
    const unchanged = await post(`/staff/v1/bookings/${h.bookingId}/change-quotes`, t.token, { ...input, party: { adult: 1 } });
    strict_1.default.equal(unchanged.status, 201);
    await admin.query(`CREATE FUNCTION fail_change_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test history failure'; END $$; CREATE TRIGGER fail_change_test BEFORE INSERT ON booking_changes FOR EACH ROW EXECUTE FUNCTION fail_change_test();`);
    try {
        strict_1.default.equal((await post(`/staff/v1/bookings/${h.bookingId}/changes`, t.token, {
            version: 2,
            quoteId: unchanged.body.quoteId,
        })).status, 500);
        strict_1.default.equal((await get(`/staff/v1/bookings/${h.bookingId}`, t.token)).body.version, 2);
        strict_1.default.equal((await admin.query("SELECT * FROM price_snapshots WHERE booking_id=$1", [
            h.bookingId,
        ])).rowCount, 1);
        strict_1.default.equal((await get(`/staff/v1/departures/${d.departureId}/availability`, t.token))
            .body.committed, 1);
    }
    finally {
        await admin.query("DROP TRIGGER fail_change_test ON booking_changes; DROP FUNCTION fail_change_test();");
    }
});

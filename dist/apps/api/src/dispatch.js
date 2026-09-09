"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DispatchController = exports.DispatchService = exports.pickupPlanSchema = exports.pickupLocationSchema = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
const inventory_1 = require("./inventory");
const day = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const boardQuery = zod_1.z.object({ date: day }).strict();
exports.pickupLocationSchema = zod_1.z
    .object({
    slug: zod_1.z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/),
    name: zod_1.z.string().trim().min(1).max(120),
    kind: zod_1.z.enum(["hotel", "port", "meeting_point", "other"]),
    notes: zod_1.z.string().trim().max(500).default(""),
})
    .strict();
exports.pickupPlanSchema = zod_1.z
    .object({
    version: zod_1.z.number().int().positive().optional(),
    notes: zod_1.z.string().trim().max(500).default(""),
    stops: zod_1.z
        .array(zod_1.z
        .object({
        bookingId: contracts_1.id,
        locationId: contracts_1.id,
        pickupAt: zod_1.z.string().datetime({ offset: true }),
        notes: zod_1.z.string().trim().max(500).default(""),
    })
        .strict())
        .max(500),
})
    .strict();
const operationalStatusSchema = zod_1.z
    .object({
    version: zod_1.z.number().int().positive(),
    status: zod_1.z.enum(["open", "weather_hold", "closed"]),
    reason: zod_1.z.string().trim().min(1).max(500),
})
    .strict();
let DispatchService = class DispatchService {
    db;
    inventory;
    constructor(db, inventory) {
        this.db = db;
        this.inventory = inventory;
    }
    board(actor, raw) {
        const query = (0, http_1.parse)(boardQuery, raw);
        return this.db.transaction(actor, async (tx) => {
            const { rows } = await tx.query(`SELECT d.id,d.starts_at,d.capacity,d.committed,d.operational_status,d.operational_reason,d.operational_version,p.name AS product_name,
        COUNT(b.id) FILTER(WHERE b.state='confirmed')::int AS confirmed_bookings,
        COALESCE(SUM((SELECT SUM(value::int) FROM jsonb_each_text(h.party))) FILTER(WHERE b.state='confirmed'),0)::int AS confirmed_guests,
        COUNT(b.id) FILTER(WHERE b.state='confirmed' AND b.pickup->>'kind'='selected')::int AS pickup_required,
        COUNT(s.id)::int AS pickup_planned,
        COUNT(b.id) FILTER(WHERE b.state='confirmed' AND b.pickup->>'kind'='unresolved')::int AS pickup_unresolved,
        plan.version AS plan_version,plan.notes AS plan_notes
        FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
        LEFT JOIN bookings b ON b.tenant_id=d.tenant_id AND b.departure_id=d.id
        LEFT JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        LEFT JOIN pickup_stops s ON s.tenant_id=b.tenant_id AND s.booking_id=b.id
        LEFT JOIN departure_pickup_plans plan ON plan.tenant_id=d.tenant_id AND plan.departure_id=d.id
        WHERE d.tenant_id=$1 AND d.local_date=$2
        GROUP BY d.id,d.starts_at,d.capacity,d.committed,d.operational_status,d.operational_reason,d.operational_version,p.name,plan.version,plan.notes ORDER BY d.starts_at,d.id`, [actor.tenantId, query.date]);
            return { date: query.date, items: rows };
        });
    }
    locations(actor) {
        return this.db.transaction(actor, async (tx) => (await tx.query("SELECT id,slug,name,kind,notes,active FROM pickup_locations WHERE tenant_id=$1 AND active ORDER BY name,id", [actor.tenantId])).rows);
    }
    createLocation(actor, key, raw) {
        const input = (0, http_1.parse)(exports.pickupLocationSchema, raw);
        return this.db.command(actor, "pickup_location.create", key, input, async (tx) => {
            const idValue = (0, node_crypto_1.randomUUID)();
            try {
                await tx.query("INSERT INTO pickup_locations(tenant_id,id,slug,name,kind,notes) VALUES($1,$2,$3,$4,$5,$6)", [
                    actor.tenantId,
                    idValue,
                    input.slug,
                    input.name,
                    input.kind,
                    input.notes,
                ]);
            }
            catch {
                throw new common_1.ConflictException("Pickup location code already exists");
            }
            await (0, database_1.record)(tx, actor, "pickup_location.created", idValue, null, input);
            return { id: idValue, ...input, active: true };
        });
    }
    savePlan(actor, departureId, key, raw) {
        const input = (0, http_1.parse)(exports.pickupPlanSchema, raw);
        return this.db.command(actor, `pickup_plan.save:${departureId}`, key, input, async (tx) => {
            const dep = await this.inventory.departure(tx, actor, departureId, true);
            const { rows: [future], } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [dep.starts_at]);
            if (!future.future)
                throw new common_1.ConflictException("Departure has already started");
            const { rows: [prior], } = await tx.query("SELECT version,notes FROM departure_pickup_plans WHERE tenant_id=$1 AND departure_id=$2 FOR UPDATE", [actor.tenantId, departureId]);
            if (prior && input.version !== prior.version)
                throw new common_1.ConflictException("Stale pickup plan version");
            if (!prior && input.version !== undefined)
                throw new common_1.ConflictException("Pickup plan does not exist yet");
            const ids = input.stops.map((s) => s.bookingId);
            if (new Set(ids).size !== ids.length)
                throw new common_1.ConflictException("A booking can appear only once in a pickup plan");
            if (ids.length) {
                const { rows: bookings } = await tx.query(`SELECT b.id,b.pickup->>'kind' AS pickup_kind FROM bookings b WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' AND b.id=ANY($3::uuid[])`, [actor.tenantId, departureId, ids]);
                if (bookings.length !== ids.length ||
                    bookings.some((b) => b.pickup_kind !== "selected"))
                    throw new common_1.ConflictException("Only confirmed bookings with arranged pickup can be planned");
                const { rows: locations } = await tx.query("SELECT id FROM pickup_locations WHERE tenant_id=$1 AND active AND id=ANY($2::uuid[])", [actor.tenantId, input.stops.map((s) => s.locationId)]);
                if (locations.length !==
                    new Set(input.stops.map((s) => s.locationId)).size)
                    throw new common_1.ConflictException("Pickup location is not available");
            }
            if (input.stops.some((stop) => new Date(stop.pickupAt).getTime() >
                new Date(dep.starts_at).getTime()))
                throw new common_1.ConflictException("Pickup time cannot be after departure start");
            const before = prior
                ? { version: prior.version, notes: prior.notes }
                : null, version = (prior?.version ?? 0) + 1;
            if (prior)
                await tx.query("UPDATE departure_pickup_plans SET version=$3,notes=$4,updated_at=clock_timestamp(),updated_by=$5 WHERE tenant_id=$1 AND departure_id=$2", [actor.tenantId, departureId, version, input.notes, actor.actorId]);
            else
                await tx.query("INSERT INTO departure_pickup_plans(tenant_id,departure_id,version,notes,updated_by) VALUES($1,$2,$3,$4,$5)", [actor.tenantId, departureId, version, input.notes, actor.actorId]);
            await tx.query("DELETE FROM pickup_stops WHERE tenant_id=$1 AND departure_id=$2", [actor.tenantId, departureId]);
            for (const [i, stop] of input.stops.entries())
                await tx.query("INSERT INTO pickup_stops(tenant_id,id,departure_id,booking_id,location_id,sequence,pickup_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
                    actor.tenantId,
                    (0, node_crypto_1.randomUUID)(),
                    departureId,
                    stop.bookingId,
                    stop.locationId,
                    i + 1,
                    stop.pickupAt,
                    stop.notes,
                ]);
            const after = {
                version,
                notes: input.notes,
                stops: input.stops.map((s, i) => ({ ...s, sequence: i + 1 })),
            };
            await (0, database_1.record)(tx, actor, "pickup_plan.saved", departureId, before, after);
            return after;
        });
    }
    plan(actor, departureId) {
        return this.db.transaction(actor, async (tx) => {
            await this.inventory.departure(tx, actor, departureId);
            const { rows: [plan], } = await tx.query("SELECT version,notes,updated_at FROM departure_pickup_plans WHERE tenant_id=$1 AND departure_id=$2", [actor.tenantId, departureId]);
            const { rows: stops } = await tx.query(`SELECT s.booking_id,s.location_id,s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM pickup_stops s JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE s.tenant_id=$1 AND s.departure_id=$2 ORDER BY s.sequence`, [actor.tenantId, departureId]);
            const { rows: eligible } = await tx.query(`SELECT b.id AS booking_id,b.lead_name,b.pickup,(SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' AND b.pickup->>'kind'='selected' ORDER BY b.id`, [actor.tenantId, departureId]);
            return { plan: plan ?? null, stops, eligible };
        });
    }
    printableList(actor, departureId) {
        return this.db.transaction(actor, async (tx) => {
            const departure = await this.inventory.departure(tx, actor, departureId);
            const { rows: [product], } = await tx.query("SELECT p.name FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id WHERE d.tenant_id=$1 AND d.id=$2", [actor.tenantId, departureId]);
            const { rows: [plan], } = await tx.query("SELECT version,notes,updated_at FROM departure_pickup_plans WHERE tenant_id=$1 AND departure_id=$2", [actor.tenantId, departureId]);
            const { rows: stops } = await tx.query(`SELECT s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM pickup_stops s JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE s.tenant_id=$1 AND s.departure_id=$2 ORDER BY s.sequence`, [actor.tenantId, departureId]);
            const { rows: exceptions } = await tx.query(`SELECT b.id AS booking_id,b.lead_name,b.pickup->>'kind' AS pickup_kind,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' AND (
          b.pickup->>'kind'='unresolved' OR (
            b.pickup->>'kind'='selected' AND NOT EXISTS (
              SELECT 1 FROM pickup_stops s WHERE s.tenant_id=b.tenant_id AND s.departure_id=b.departure_id AND s.booking_id=b.id
            )
          )
        ) ORDER BY b.pickup->>'kind',b.lead_name,b.id`, [actor.tenantId, departureId]);
            return {
                departure: {
                    id: departure.id,
                    starts_at: departure.starts_at,
                    product_name: product.name,
                },
                plan: plan ?? null,
                stops,
                exceptions,
            };
        });
    }
    setOperationalStatus(actor, departureId, key, raw) {
        const input = (0, http_1.parse)(operationalStatusSchema, raw);
        return this.db.command(actor, `departure.operational_status:${departureId}`, key, input, async (tx) => {
            const dep = await this.inventory.departure(tx, actor, departureId, true);
            if (dep.operational_version !== input.version)
                throw new common_1.ConflictException("Stale operational status version");
            const { rows: [row], } = await tx.query("UPDATE departures SET operational_status=$3,operational_reason=$4,operational_version=operational_version+1 WHERE tenant_id=$1 AND id=$2 RETURNING operational_status,operational_reason,operational_version", [actor.tenantId, departureId, input.status, input.reason]);
            await (0, database_1.record)(tx, actor, "departure.operational_status_changed", departureId, {
                status: dep.operational_status,
                reason: dep.operational_reason,
                version: dep.operational_version,
            }, {
                status: row.operational_status,
                reason: row.operational_reason,
                version: row.operational_version,
            });
            return row;
        });
    }
};
exports.DispatchService = DispatchService;
exports.DispatchService = DispatchService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database,
        inventory_1.InventoryService])
], DispatchService);
let DispatchController = class DispatchController {
    service;
    constructor(service) {
        this.service = service;
    }
    board(a, q) {
        return this.service.board(a, q);
    }
    locations(a) {
        return this.service.locations(a);
    }
    createLocation(a, k, b) {
        return this.service.createLocation(a, (0, http_1.parse)(http_1.keySchema, k), b);
    }
    plan(a, d) {
        return this.service.plan(a, (0, http_1.parse)(contracts_1.id, d));
    }
    printableList(a, d) {
        return this.service.printableList(a, (0, http_1.parse)(contracts_1.id, d));
    }
    save(a, d, k, b) {
        return this.service.savePlan(a, (0, http_1.parse)(contracts_1.id, d), (0, http_1.parse)(http_1.keySchema, k), b);
    }
    status(a, d, k, b) {
        return this.service.setOperationalStatus(a, (0, http_1.parse)(contracts_1.id, d), (0, http_1.parse)(http_1.keySchema, k), b);
    }
};
exports.DispatchController = DispatchController;
__decorate([
    (0, common_1.Get)("board"),
    (0, http_1.Access)("manifest.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], DispatchController.prototype, "board", null);
__decorate([
    (0, common_1.Get)("pickup-locations"),
    (0, http_1.Access)("manifest.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DispatchController.prototype, "locations", null);
__decorate([
    (0, common_1.Post)("pickup-locations"),
    (0, http_1.Access)("operations.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Headers)("idempotency-key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DispatchController.prototype, "createLocation", null);
__decorate([
    (0, common_1.Get)("departures/:id/pickups"),
    (0, http_1.Access)("manifest.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DispatchController.prototype, "plan", null);
__decorate([
    (0, common_1.Get)("departures/:id/pickup-list"),
    (0, http_1.Access)("manifest.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DispatchController.prototype, "printableList", null);
__decorate([
    (0, common_1.Post)("departures/:id/pickups"),
    (0, http_1.Access)("operations.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DispatchController.prototype, "save", null);
__decorate([
    (0, common_1.Post)("departures/:id/operational-status"),
    (0, http_1.Access)("operations.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DispatchController.prototype, "status", null);
exports.DispatchController = DispatchController = __decorate([
    (0, common_1.Controller)("ops/v1"),
    __metadata("design:paramtypes", [DispatchService])
], DispatchController);

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
exports.InventoryController = exports.InventoryService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
const tenant_1 = require("./tenant");
const catalog_1 = require("./catalog");
let InventoryService = class InventoryService {
    db;
    catalog;
    constructor(db, catalog) {
        this.db = db;
        this.catalog = catalog;
    }
    async departure(tx, actor, departureId, lock = false) {
        const { rows: [row], } = await tx.query(`SELECT *,local_date::text AS local_day FROM departures WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [actor.tenantId, departureId]);
        if (!row)
            throw new common_1.NotFoundException();
        return row;
    }
    async availability(tx, actor, departureId) {
        // One SQL snapshot prevents a concurrent confirm being counted both as hold and commitment.
        const { rows: [r], } = await tx.query(`SELECT d.capacity,d.committed,d.starts_at,d.operational_status,
      GREATEST(0,d.capacity-d.committed-COALESCE((SELECT SUM(h.seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0))::int AS available
      FROM departures d WHERE d.tenant_id=$1 AND d.id=$2`, [actor.tenantId, departureId]);
        if (!r)
            throw new common_1.NotFoundException();
        return {
            ...r,
            available: new Date(r.starts_at).getTime() <= Date.now() ||
                r.operational_status !== "open"
                ? 0
                : r.available,
        };
    }
    async hold(tx, actor, holdId) {
        const { rows: [row], } = await tx.query("SELECT *,expires_at>clock_timestamp() AS live FROM holds WHERE tenant_id=$1 AND id=$2", [actor.tenantId, holdId]);
        if (!row)
            throw new common_1.NotFoundException();
        return row;
    }
    async price(tx, actor, departureId, party) {
        const settings = await (0, tenant_1.tenant)(tx, actor);
        const dep = await this.departure(tx, actor, departureId);
        const product = await this.catalog.definition(tx, actor, dep.product_id);
        let seats = 0;
        const lines = [];
        for (const [category, quantity] of Object.entries(party)) {
            const definition = product.definition.categories.find((c) => c.slug === category);
            if (!definition)
                throw new common_1.BadRequestException("Unknown passenger category");
            if (!quantity)
                continue;
            const rate = product.definition.rates.find((r) => r.category === category &&
                r.startDate <= dep.local_day &&
                r.endDate >= dep.local_day);
            if (!rate)
                throw new common_1.BadRequestException("No applicable seasonal rate");
            seats += definition.countsTowardCapacity ? quantity : 0;
            lines.push({
                category,
                quantity,
                unitAmountMinor: rate.amountMinor,
                amountMinor: rate.amountMinor * quantity,
            });
        }
        const subtotalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
        // Integer rational arithmetic; round tax half-up once on the subtotal.
        const taxMinor = Number((BigInt(subtotalMinor) * BigInt(settings.config.taxBasisPoints) + 5000n) /
            10000n);
        const currency = settings.config.bookingCurrency;
        const quote = {
            lines,
            subtotalMinor,
            taxMinor,
            totalMinor: subtotalMinor + taxMinor,
            currency,
            exchangeRate: {
                from: currency,
                to: currency,
                numerator: 1,
                denominator: 1,
                source: "same_currency",
            },
            configVersion: settings.version,
            productVersion: product.version,
            minimumPaidPercent: settings.config.minimumPaidPercent,
            allowUnresolvedPickup: settings.config.allowUnresolvedPickup,
        };
        if (!Number.isSafeInteger(quote.totalMinor) ||
            quote.totalMinor > 1_000_000_000_000)
            throw new common_1.BadRequestException("Booking amount exceeds supported range");
        return { quote, seats };
    }
    create(actor, key, input) {
        const data = (0, http_1.parse)(contracts_1.holdSchema, input);
        return this.db.command(actor, "hold.create", key, data, async (tx) => {
            const settings = await (0, tenant_1.tenant)(tx, actor);
            const dep = await this.departure(tx, actor, data.departureId, true);
            const { rows: [future], } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [
                dep.starts_at,
            ]);
            if (!future.future)
                throw new common_1.ConflictException("Departure has already started");
            if (dep.operational_status !== "open")
                throw new common_1.ConflictException("Departure is not available for sale");
            const { quote, seats } = await this.price(tx, actor, data.departureId, data.party);
            const free = await this.availability(tx, actor, data.departureId);
            if (seats > free.available)
                throw new common_1.ConflictException("Insufficient seats");
            const holdId = (0, node_crypto_1.randomUUID)();
            const { rows: [hold], } = await tx.query(`INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,quote,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8*interval '1 second') RETURNING expires_at`, [
                actor.tenantId,
                holdId,
                data.departureId,
                actor.actorId,
                data.party,
                seats,
                quote,
                settings.config.holdSeconds,
            ]);
            await (0, database_1.record)(tx, actor, "booking.held", holdId, null, {
                departureId: data.departureId,
                party: data.party,
                seats,
                quote,
                expiresAt: hold.expires_at,
            });
            return {
                holdId,
                departureId: data.departureId,
                seats,
                quote,
                expiresAt: hold.expires_at.toISOString(),
            };
        });
    }
    async consume(tx, actor, holdId) {
        const initial = await this.hold(tx, actor, holdId);
        const departure = await this.departure(tx, actor, initial.departure_id, true);
        if (departure.operational_status !== "open")
            throw new common_1.ConflictException("Departure is not available for sale");
        const hold = await this.hold(tx, actor, holdId);
        if (!hold.live || hold.consumed)
            throw new common_1.ConflictException("Hold expired or already consumed");
        const { rowCount } = await tx.query(`UPDATE departures SET committed=committed+$3 WHERE tenant_id=$1 AND id=$2
      AND committed+$3<=capacity AND starts_at>clock_timestamp()`, [actor.tenantId, hold.departure_id, hold.seats]);
        if (!rowCount)
            throw new common_1.ConflictException("Departure unavailable");
        await tx.query("UPDATE holds SET consumed=true WHERE tenant_id=$1 AND id=$2", [actor.tenantId, holdId]);
        await (0, database_1.record)(tx, actor, "inventory.hold_consumed", holdId, { consumed: false }, { consumed: true });
        await (0, database_1.record)(tx, actor, "departure.capacity_changed", hold.departure_id, null, { committedDelta: hold.seats });
        return hold;
    }
};
exports.InventoryService = InventoryService;
exports.InventoryService = InventoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database,
        catalog_1.CatalogService])
], InventoryService);
let InventoryController = class InventoryController {
    service;
    db;
    constructor(service, db) {
        this.service = service;
        this.db = db;
    }
    availability(a, dep) {
        return this.db.transaction(a, (tx) => this.service.availability(tx, a, (0, http_1.parse)(contracts_1.id, dep)));
    }
    hold(a, key, body) {
        return this.service.create(a, (0, http_1.parse)(http_1.keySchema, key), body);
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)("departures/:id/availability"),
    (0, http_1.Access)("catalog.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "availability", null);
__decorate([
    (0, common_1.Post)("holds"),
    (0, http_1.Access)("bookings.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Headers)("idempotency-key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "hold", null);
exports.InventoryController = InventoryController = __decorate([
    (0, common_1.Controller)("staff/v1"),
    __metadata("design:paramtypes", [InventoryService,
        database_1.Database])
], InventoryController);

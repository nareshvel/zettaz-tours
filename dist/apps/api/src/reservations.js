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
exports.ReservationController = exports.ReservationService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
const inventory_1 = require("./inventory");
const finance_1 = require("./finance");
const tenant_1 = require("./tenant");
let ReservationService = class ReservationService {
    db;
    inventory;
    finance;
    constructor(db, inventory, finance) {
        this.db = db;
        this.inventory = inventory;
        this.finance = finance;
    }
    async booking(tx, actor, bookingId, lock = false) {
        const { rows: [row], } = await tx.query(`SELECT * FROM bookings WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [actor.tenantId, bookingId]);
        if (!row)
            throw new common_1.NotFoundException();
        return row;
    }
    create(actor, key, input) {
        const data = (0, http_1.parse)(contracts_1.bookingSchema, input);
        return this.db.command(actor, "booking.create", key, data, async (tx) => {
            const settings = await (0, tenant_1.tenant)(tx, actor);
            if (!settings.config.bookingSources.includes(data.source))
                throw new common_1.ConflictException("Booking source is not configured");
            const hold = await this.inventory.hold(tx, actor, data.holdId);
            await this.inventory.departure(tx, actor, hold.departure_id, true);
            const current = await this.inventory.hold(tx, actor, data.holdId);
            if (current.actor_id !== actor.actorId)
                throw new common_1.NotFoundException();
            if (!current.live || current.consumed)
                throw new common_1.ConflictException("Hold expired or consumed");
            const bookingId = (0, node_crypto_1.randomUUID)();
            await tx.query(`INSERT INTO bookings(tenant_id,id,hold_id,departure_id,lead_name,lead_email,source,pickup,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'held')`, [
                actor.tenantId,
                bookingId,
                data.holdId,
                hold.departure_id,
                data.leadName,
                data.leadEmail,
                data.source,
                data.pickup,
            ]);
            await (0, database_1.record)(tx, actor, "booking.created", bookingId, null, data);
            return { bookingId, state: "held", version: 1, quote: hold.quote };
        });
    }
    payment(actor, bookingId, key, input) {
        const data = (0, http_1.parse)(contracts_1.paymentSchema, input);
        return this.db.command(actor, `booking.payment:${bookingId}`, key, data, async (tx) => {
            const booking = await this.booking(tx, actor, bookingId, true);
            if (!["held", "confirmed"].includes(booking.state))
                throw new common_1.ConflictException("Cannot collect on a cancelled reservation");
            const hold = await this.inventory.hold(tx, actor, booking.hold_id);
            if (booking.state !== "confirmed" && !hold.live)
                throw new common_1.ConflictException("Cannot collect on an expired reservation");
            const result = await this.finance.record(tx, actor, bookingId, hold.quote, data);
            return result;
        });
    }
    confirm(actor, bookingId, key, input) {
        const data = (0, http_1.parse)(contracts_1.confirmSchema, input);
        return this.db.command(actor, `booking.confirm:${bookingId}`, key, data, async (tx) => {
            const initial = await this.booking(tx, actor, bookingId);
            await this.inventory.departure(tx, actor, initial.departure_id, true);
            const booking = await this.booking(tx, actor, bookingId, true);
            if (booking.state === "confirmed")
                return { bookingId, state: "confirmed", version: booking.version };
            if (booking.state !== "held")
                throw new common_1.ConflictException("Booking cannot be confirmed");
            if (booking.version !== data.version)
                throw new common_1.ConflictException("Stale booking version");
            const hold = await this.inventory.hold(tx, actor, booking.hold_id), quote = hold.quote;
            if (!hold.live)
                throw new common_1.ConflictException("Hold expired");
            if (booking.pickup.kind === "unresolved" &&
                !quote.allowUnresolvedPickup)
                throw new common_1.ConflictException("Pickup must be resolved before confirmation");
            const paid = await this.finance.paid(tx, actor, bookingId);
            if (BigInt(paid) * 100n <
                BigInt(quote.totalMinor) * BigInt(quote.minimumPaidPercent))
                throw new common_1.ConflictException("Required payment has not settled");
            await this.inventory.consume(tx, actor, booking.hold_id);
            await tx.query(`UPDATE bookings SET state='confirmed',version=version+1 WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, bookingId]);
            await tx.query(`INSERT INTO price_snapshots VALUES($1,$2,$3,$4)`, [
                actor.tenantId,
                bookingId,
                booking.version + 1,
                quote,
            ]);
            await (0, database_1.record)(tx, actor, "price_snapshot.created", bookingId, null, quote);
            await (0, database_1.record)(tx, actor, "booking.confirmed", bookingId, { state: booking.state, version: booking.version }, { state: "confirmed", version: booking.version + 1 });
            return { bookingId, state: "confirmed", version: booking.version + 1 };
        });
    }
    read(actor, bookingId) {
        return this.db.transaction(actor, async (tx) => {
            const booking = await this.booking(tx, actor, bookingId);
            const hold = await this.inventory.hold(tx, actor, booking.hold_id);
            const paidMinor = await this.finance.paid(tx, actor, bookingId);
            // Expiry is derived from database time so the worker is not a correctness dependency.
            return {
                ...booking,
                state: booking.state === "held" && !hold.live ? "expired" : booking.state,
                party: hold.party,
                expiresAt: hold.expires_at,
                quote: hold.quote,
                paidMinor,
                balanceMinor: booking.state === "cancelled" ? 0 : hold.quote.totalMinor - paidMinor,
                historicalBalanceMinor: hold.quote.totalMinor - paidMinor,
                financeReviewRequired: (booking.state === "cancelled" &&
                    (await tx.query("SELECT 1 FROM payments WHERE tenant_id=$1 AND booking_id=$2 LIMIT 1", [actor.tenantId, bookingId])).rowCount > 0) ||
                    paidMinor > hold.quote.totalMinor,
                departure: await this.inventory.departure(tx, actor, booking.departure_id),
            };
        });
    }
};
exports.ReservationService = ReservationService;
exports.ReservationService = ReservationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database,
        inventory_1.InventoryService,
        finance_1.FinanceService])
], ReservationService);
let ReservationController = class ReservationController {
    service;
    constructor(service) {
        this.service = service;
    }
    create(a, k, b) {
        return this.service.create(a, (0, http_1.parse)(http_1.keySchema, k), b);
    }
    read(a, b) {
        return this.service.read(a, (0, http_1.parse)(contracts_1.id, b));
    }
    payment(a, idValue, k, b) {
        return this.service.payment(a, (0, http_1.parse)(contracts_1.id, idValue), (0, http_1.parse)(http_1.keySchema, k), b);
    }
    confirm(a, idValue, k, b) {
        return this.service.confirm(a, (0, http_1.parse)(contracts_1.id, idValue), (0, http_1.parse)(http_1.keySchema, k), b);
    }
};
exports.ReservationController = ReservationController;
__decorate([
    (0, common_1.Post)(),
    (0, http_1.Access)("bookings.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Headers)("idempotency-key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ReservationController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, http_1.Access)("bookings.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReservationController.prototype, "read", null);
__decorate([
    (0, common_1.Post)(":id/payments"),
    (0, http_1.Access)("payment.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ReservationController.prototype, "payment", null);
__decorate([
    (0, common_1.Post)(":id/confirm"),
    (0, http_1.Access)("bookings.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ReservationController.prototype, "confirm", null);
exports.ReservationController = ReservationController = __decorate([
    (0, common_1.Controller)("staff/v1/bookings"),
    __metadata("design:paramtypes", [ReservationService])
], ReservationController);

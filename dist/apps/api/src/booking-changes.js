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
exports.BookingChangeController = exports.BookingChangeService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
const reservations_1 = require("./reservations");
const inventory_1 = require("./inventory");
const finance_1 = require("./finance");
const tenant_1 = require("./tenant");
let BookingChangeService = class BookingChangeService {
    db;
    reservations;
    inventory;
    finance;
    constructor(db, reservations, inventory, finance) {
        this.db = db;
        this.reservations = reservations;
        this.inventory = inventory;
        this.finance = finance;
    }
    async editable(tx, actor, booking) {
        if (!["held", "confirmed"].includes(booking.state))
            throw new common_1.ConflictException("Booking is not editable");
        const hold = await this.inventory.hold(tx, actor, booking.hold_id);
        if (booking.state === "held" && !hold.live)
            throw new common_1.ConflictException("Hold expired");
        const dep = await this.inventory.departure(tx, actor, booking.departure_id);
        const { rows: [r], } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [
            dep.starts_at,
        ]);
        if (!r.future)
            throw new common_1.ConflictException("Departure has already started");
        return hold;
    }
    quote(actor, bookingId, key, input) {
        const data = (0, http_1.parse)(contracts_1.amendmentSchema, input);
        return this.db.command(actor, `booking.change_quote:${bookingId}`, key, data, async (tx) => {
            const booking = await this.reservations.booking(tx, actor, bookingId);
            if (booking.version !== data.version)
                throw new common_1.ConflictException("Stale booking version");
            const hold = await this.editable(tx, actor, booking);
            const sameParty = Object.keys({ ...hold.party, ...data.party }).every((k) => (hold.party[k] ?? 0) === (data.party[k] ?? 0));
            const commercialChange = booking.departure_id !== data.departureId || !sameParty;
            if (commercialChange && booking.state !== "confirmed")
                throw new common_1.ConflictException("Held bookings support guest and pickup corrections only; create a new reservation for departure or party changes");
            const target = await this.inventory.departure(tx, actor, data.departureId);
            const { rows: [future], } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [target.starts_at]);
            if (!future.future)
                throw new common_1.ConflictException("Target departure has already started");
            const priced = commercialChange
                ? await this.inventory.price(tx, actor, data.departureId, data.party)
                : { quote: hold.quote, seats: hold.seats };
            if (priced.quote.currency !== hold.quote.currency)
                throw new common_1.ConflictException("Cross-currency amendment is not supported");
            if (booking.state === "confirmed" &&
                data.pickup.kind === "unresolved" &&
                !priced.quote.allowUnresolvedPickup)
                throw new common_1.ConflictException("Pickup must be resolved");
            const settings = await (0, tenant_1.tenant)(tx, actor), quoteId = (0, node_crypto_1.randomUUID)();
            const { rows: [q], } = await tx.query(`INSERT INTO booking_change_quotes(tenant_id,id,booking_id,actor_id,base_version,input,quote,seats,allow_balance,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,LEAST(clock_timestamp()+$10*interval '1 second',$11::timestamptz)) RETURNING expires_at`, [
                actor.tenantId,
                quoteId,
                bookingId,
                actor.actorId,
                booking.version,
                data,
                priced.quote,
                priced.seats,
                settings.config.allowAmendmentBalance === true,
                settings.config.holdSeconds,
                booking.state === "held" ? hold.expires_at : target.starts_at,
            ]);
            const paidMinor = await this.finance.paid(tx, actor, bookingId);
            const result = {
                quoteId,
                version: booking.version,
                quote: priced.quote,
                previousTotalMinor: hold.quote.totalMinor,
                differenceMinor: priced.quote.totalMinor - hold.quote.totalMinor,
                paidMinor,
                balanceMinor: priced.quote.totalMinor - paidMinor,
                expiresAt: q.expires_at,
                allowAmendmentBalance: settings.config.allowAmendmentBalance === true,
                seatsReserved: false,
            };
            await (0, database_1.record)(tx, actor, "booking.change_quoted", bookingId, null, result, data.reason);
            return result;
        });
    }
    accept(actor, bookingId, key, input) {
        const data = (0, http_1.parse)(contracts_1.acceptAmendmentSchema, input);
        return this.db.command(actor, `booking.change_accept:${bookingId}`, key, data, async (tx) => {
            const { rows: [q], } = await tx.query("SELECT * FROM booking_change_quotes WHERE tenant_id=$1 AND id=$2 AND booking_id=$3", [actor.tenantId, data.quoteId, bookingId]);
            if (!q)
                throw new common_1.NotFoundException();
            const initial = await this.reservations.booking(tx, actor, bookingId);
            // All inventory mutations take departure locks before the booking lock.
            for (const departureId of [
                ...new Set([initial.departure_id, q.input.departureId]),
            ].sort())
                await this.inventory.departure(tx, actor, departureId, true);
            const booking = await this.reservations.booking(tx, actor, bookingId, true);
            if (booking.version !== data.version ||
                booking.version !== q.base_version ||
                booking.departure_id !== initial.departure_id)
                throw new common_1.ConflictException("Stale booking version; request a fresh quote");
            const old = await this.editable(tx, actor, booking);
            const { rows: [live], } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS live", [
                q.expires_at,
            ]);
            if (!live.live)
                throw new common_1.ConflictException("Change quote expired");
            const free = await this.inventory.availability(tx, actor, q.input.departureId);
            const { rows: [future], } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [free.starts_at]);
            if (!future.future)
                throw new common_1.ConflictException("Target departure has already started");
            const paid = await this.finance.paid(tx, actor, bookingId);
            if (booking.state === "confirmed" &&
                !q.allow_balance &&
                BigInt(paid) * 100n <
                    BigInt(q.quote.totalMinor) * BigInt(q.quote.minimumPaidPercent))
                throw new common_1.ConflictException("Tenant amendment policy requires the minimum payment first");
            let holdId = booking.hold_id;
            const before = { ...booking, party: old.party, quote: old.quote };
            if (booking.state === "confirmed") {
                const available = free.available +
                    (booking.departure_id === q.input.departureId ? old.seats : 0);
                if (q.seats > available)
                    throw new common_1.ConflictException("Insufficient seats; original booking is unchanged");
                await tx.query("UPDATE departures SET committed=committed-$3 WHERE tenant_id=$1 AND id=$2", [actor.tenantId, booking.departure_id, old.seats]);
                await tx.query("UPDATE departures SET committed=committed+$3 WHERE tenant_id=$1 AND id=$2", [actor.tenantId, q.input.departureId, q.seats]);
                holdId = (0, node_crypto_1.randomUUID)();
                await tx.query(`INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,quote,expires_at,consumed) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),true)`, [
                    actor.tenantId,
                    holdId,
                    q.input.departureId,
                    actor.actorId,
                    q.input.party,
                    q.seats,
                    q.quote,
                ]);
                await tx.query("INSERT INTO price_snapshots VALUES($1,$2,$3,$4)", [
                    actor.tenantId,
                    bookingId,
                    booking.version + 1,
                    q.quote,
                ]);
                await (0, database_1.record)(tx, actor, "price_snapshot.created", bookingId, null, q.quote, q.input.reason);
                await (0, database_1.record)(tx, actor, "departure.capacity_changed", booking.departure_id, null, { committedDelta: -old.seats }, q.input.reason);
                await (0, database_1.record)(tx, actor, "departure.capacity_changed", q.input.departureId, null, { committedDelta: q.seats }, q.input.reason);
            }
            if (booking.departure_id !== q.input.departureId ||
                q.input.pickup.kind !== "selected")
                await tx.query("DELETE FROM pickup_stops WHERE tenant_id=$1 AND booking_id=$2", [actor.tenantId, bookingId]);
            await tx.query(`UPDATE bookings SET hold_id=$3,departure_id=$4,lead_name=$5,lead_email=$6,pickup=$7,version=version+1 WHERE tenant_id=$1 AND id=$2`, [
                actor.tenantId,
                bookingId,
                holdId,
                q.input.departureId,
                q.input.leadName,
                q.input.leadEmail,
                q.input.pickup,
            ]);
            const after = {
                ...booking,
                hold_id: holdId,
                departure_id: q.input.departureId,
                lead_name: q.input.leadName,
                lead_email: q.input.leadEmail,
                pickup: q.input.pickup,
                party: q.input.party,
                quote: q.quote,
                version: booking.version + 1,
                financeReviewRequired: paid > q.quote.totalMinor,
            };
            await this.history(tx, actor, bookingId, "amendment", before, after, q.input.reason, q.id);
            return { bookingId, version: after.version, state: booking.state };
        });
    }
    cancel(actor, bookingId, key, input) {
        const data = (0, http_1.parse)(contracts_1.cancellationSchema, input);
        return this.db.command(actor, `booking.cancel:${bookingId}`, key, data, async (tx) => {
            const initial = await this.reservations.booking(tx, actor, bookingId);
            await this.inventory.departure(tx, actor, initial.departure_id, true);
            const booking = await this.reservations.booking(tx, actor, bookingId, true);
            if (booking.version !== data.version ||
                booking.departure_id !== initial.departure_id)
                throw new common_1.ConflictException("Stale booking version");
            const hold = await this.editable(tx, actor, booking);
            if (booking.state === "confirmed") {
                await tx.query("UPDATE departures SET committed=committed-$3 WHERE tenant_id=$1 AND id=$2", [actor.tenantId, booking.departure_id, hold.seats]);
                await (0, database_1.record)(tx, actor, "departure.capacity_changed", booking.departure_id, null, { committedDelta: -hold.seats }, data.reason);
            }
            else {
                await tx.query("UPDATE holds SET expires_at=LEAST(expires_at,clock_timestamp()) WHERE tenant_id=$1 AND id=$2", [actor.tenantId, booking.hold_id]);
                await (0, database_1.record)(tx, actor, "inventory.hold_released", booking.hold_id, null, { cancelled: true }, data.reason);
            }
            await tx.query("DELETE FROM pickup_stops WHERE tenant_id=$1 AND booking_id=$2", [actor.tenantId, bookingId]);
            const paidMinor = await this.finance.paid(tx, actor, bookingId);
            const { rows: [payments], } = await tx.query("SELECT COUNT(*)::int AS count FROM payments WHERE tenant_id=$1 AND booking_id=$2", [actor.tenantId, bookingId]);
            await tx.query("UPDATE bookings SET state='cancelled',version=version+1 WHERE tenant_id=$1 AND id=$2", [actor.tenantId, bookingId]);
            const after = {
                ...booking,
                state: "cancelled",
                version: booking.version + 1,
                financeReviewRequired: payments.count > 0,
                paidMinor,
                currency: hold.quote.currency,
            };
            await this.history(tx, actor, bookingId, "cancellation", { ...booking, quote: hold.quote, party: hold.party }, after, data.reason);
            return {
                bookingId,
                state: "cancelled",
                version: after.version,
                financeReviewRequired: after.financeReviewRequired,
            };
        });
    }
    async history(tx, actor, bookingId, kind, before, after, reason, quoteId = null) {
        await tx.query("INSERT INTO booking_changes(tenant_id,id,booking_id,version,kind,quote_id,before_data,after_data,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
            actor.tenantId,
            (0, node_crypto_1.randomUUID)(),
            bookingId,
            after.version,
            kind,
            quoteId,
            before,
            after,
            reason,
            actor.actorId,
        ]);
        await (0, database_1.record)(tx, actor, kind === "cancellation" ? "booking.cancelled" : "booking.amended", bookingId, before, after, reason);
    }
    historyRead(actor, bookingId) {
        return this.db.transaction(actor, async (tx) => {
            await this.reservations.booking(tx, actor, bookingId);
            return (await tx.query("SELECT id,version,kind,before_data,after_data,reason,actor_id,occurred_at FROM booking_changes WHERE tenant_id=$1 AND booking_id=$2 ORDER BY version DESC", [actor.tenantId, bookingId])).rows;
        });
    }
};
exports.BookingChangeService = BookingChangeService;
exports.BookingChangeService = BookingChangeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database,
        reservations_1.ReservationService,
        inventory_1.InventoryService,
        finance_1.FinanceService])
], BookingChangeService);
let BookingChangeController = class BookingChangeController {
    service;
    constructor(service) {
        this.service = service;
    }
    quote(a, b, k, input) {
        return this.service.quote(a, (0, http_1.parse)(contracts_1.id, b), (0, http_1.parse)(http_1.keySchema, k), input);
    }
    accept(a, b, k, input) {
        return this.service.accept(a, (0, http_1.parse)(contracts_1.id, b), (0, http_1.parse)(http_1.keySchema, k), input);
    }
    cancel(a, b, k, input) {
        return this.service.cancel(a, (0, http_1.parse)(contracts_1.id, b), (0, http_1.parse)(http_1.keySchema, k), input);
    }
    history(a, b) {
        return this.service.historyRead(a, (0, http_1.parse)(contracts_1.id, b));
    }
};
exports.BookingChangeController = BookingChangeController;
__decorate([
    (0, common_1.Post)(":id/change-quotes"),
    (0, http_1.Access)("bookings.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], BookingChangeController.prototype, "quote", null);
__decorate([
    (0, common_1.Post)(":id/changes"),
    (0, http_1.Access)("bookings.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], BookingChangeController.prototype, "accept", null);
__decorate([
    (0, common_1.Post)(":id/cancel"),
    (0, http_1.Access)("bookings.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], BookingChangeController.prototype, "cancel", null);
__decorate([
    (0, common_1.Get)(":id/changes"),
    (0, http_1.Access)("bookings.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingChangeController.prototype, "history", null);
exports.BookingChangeController = BookingChangeController = __decorate([
    (0, common_1.Controller)("staff/v1/bookings"),
    __metadata("design:paramtypes", [BookingChangeService])
], BookingChangeController);

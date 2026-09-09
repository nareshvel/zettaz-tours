"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinanceService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
const tenant_1 = require("./tenant");
let FinanceService = class FinanceService {
    async paid(tx, actor, bookingId) {
        const { rows: [r], } = await tx.query(`SELECT COALESCE(SUM(amount_minor),0)::text AS paid FROM payments WHERE tenant_id=$1 AND booking_id=$2 AND status='settled'`, [actor.tenantId, bookingId]);
        const paid = Number(r.paid);
        if (!Number.isSafeInteger(paid))
            throw new common_1.ConflictException("Payment total outside supported range");
        return paid;
    }
    async record(tx, actor, bookingId, quote, input) {
        const data = (0, http_1.parse)(contracts_1.paymentSchema, input);
        const settings = await (0, tenant_1.tenant)(tx, actor);
        if (!settings.config.manualPaymentMethods.includes(data.method))
            throw new common_1.BadRequestException("Payment method is not enabled");
        if (data.currency !== quote.currency)
            throw new common_1.BadRequestException("Cross-currency payment is not enabled");
        if (new Date(data.occurredAt).getTime() > Date.now() + 60_000)
            throw new common_1.BadRequestException("Payment occurredAt is in the future");
        const paid = await this.paid(tx, actor, bookingId);
        if (data.status === "settled" && paid + data.amountMinor > quote.totalMinor)
            throw new common_1.ConflictException("Payment exceeds remaining balance");
        const paymentId = (0, node_crypto_1.randomUUID)();
        await tx.query(`INSERT INTO payments VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
            actor.tenantId,
            paymentId,
            bookingId,
            data.amountMinor,
            data.currency,
            data.method,
            data.status,
            data.reference,
            data.reason,
            data.occurredAt,
            actor.actorId,
        ]);
        await (0, database_1.record)(tx, actor, "payment.manual_recorded", paymentId, null, { bookingId, ...data }, data.reason);
        return {
            paymentId,
            ...data,
            paidMinor: paid + (data.status === "settled" ? data.amountMinor : 0),
        };
    }
};
exports.FinanceService = FinanceService;
exports.FinanceService = FinanceService = __decorate([
    (0, common_1.Injectable)()
], FinanceService);

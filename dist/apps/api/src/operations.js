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
exports.OperationsController = exports.OutboxService = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
let OutboxService = class OutboxService {
    db;
    constructor(db) {
        this.db = db;
    }
    drain(actor) {
        return this.db.transaction(actor, async (tx) => {
            const { rows } = await tx.query(`SELECT id FROM outbox_events WHERE tenant_id=$1 AND delivered_at IS NULL ORDER BY occurred_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`, [actor.tenantId]);
            for (const row of rows) {
                // Local durable consumer only. External consumers need their own retry/deduplication port.
                await tx.query(`INSERT INTO event_receipts VALUES($1,$2,'local-observer-v1') ON CONFLICT DO NOTHING`, [actor.tenantId, row.id]);
                await tx.query("UPDATE outbox_events SET delivered_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2", [actor.tenantId, row.id]);
            }
            return { delivered: rows.length };
        });
    }
};
exports.OutboxService = OutboxService;
exports.OutboxService = OutboxService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database])
], OutboxService);
let OperationsController = class OperationsController {
    db;
    constructor(db) {
        this.db = db;
    }
    manifest(actor, value) {
        const departureId = (0, http_1.parse)(contracts_1.id, value);
        return this.db.transaction(actor, async (tx) => {
            const { rows: [departure], } = await tx.query("SELECT id,starts_at,capacity FROM departures WHERE tenant_id=$1 AND id=$2", [actor.tenantId, departureId]);
            if (!departure)
                throw new common_1.NotFoundException();
            const { rows: bookings } = await tx.query(`SELECT b.id AS booking_id,b.lead_name,b.pickup,h.party,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' ORDER BY b.id`, [actor.tenantId, departureId]);
            return { departure, bookings };
        });
    }
    audit(actor) {
        return this.db.transaction(actor, async (tx) => (await tx.query(`SELECT id,actor_id,action,aggregate_id,reason,occurred_at FROM audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC,id LIMIT 100`, [actor.tenantId])).rows);
    }
};
exports.OperationsController = OperationsController;
__decorate([
    (0, common_1.Get)("departures/:id/manifest"),
    (0, http_1.Access)("manifest.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "manifest", null);
__decorate([
    (0, common_1.Get)("audit"),
    (0, http_1.Access)("audit.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "audit", null);
exports.OperationsController = OperationsController = __decorate([
    (0, common_1.Controller)("ops/v1"),
    __metadata("design:paramtypes", [database_1.Database])
], OperationsController);

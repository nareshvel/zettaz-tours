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
exports.WorkspaceController = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
const tenant_1 = require("./tenant");
const querySchema = zod_1.z
    .object({
    cursor: contracts_1.id.optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(30),
    search: zod_1.z.string().trim().max(100).default(""),
})
    .strict();
function page(rows, limit) {
    return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
}
let WorkspaceController = class WorkspaceController {
    db;
    constructor(db) {
        this.db = db;
    }
    session(actor) {
        return this.db.transaction(actor, async (tx) => ({
            actorId: actor.actorId,
            role: actor.role,
            permissions: actor.permissions,
            tenant: await (0, tenant_1.tenant)(tx, actor),
        }));
    }
    departures(actor, raw) {
        const q = (0, http_1.parse)(querySchema, raw);
        return this.db.transaction(actor, async (tx) => {
            const { rows } = await tx.query(`SELECT d.id,d.product_id,d.starts_at,d.capacity,d.committed,p.name AS product_name,
      p.definition->>'optionName' AS option_name,p.definition->'categories' AS categories,
      CASE WHEN d.starts_at<=clock_timestamp() THEN 0 ELSE GREATEST(0,d.capacity-d.committed-COALESCE((SELECT SUM(h.seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0))::int END AS available
      FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
      WHERE d.tenant_id=$1 AND ($2::uuid IS NULL OR d.id>$2) AND p.name ILIKE $3 ORDER BY d.id LIMIT $4`, [actor.tenantId, q.cursor ?? null, "%" + q.search + "%", q.limit + 1]);
            return page(rows, q.limit);
        });
    }
    reservations(actor, raw) {
        const q = (0, http_1.parse)(querySchema, raw);
        return this.db.transaction(actor, async (tx) => {
            const { rows } = await tx.query(`SELECT b.id,b.departure_id,b.lead_name,b.source,b.pickup,b.version,
      CASE WHEN b.state='held' AND h.expires_at<=clock_timestamp() THEN 'expired' ELSE b.state END AS state,
      d.starts_at,p.name AS product_name,h.party,h.quote->>'currency' AS currency,
      (h.quote->>'totalMinor')::float8 AS total_minor,
      COALESCE((SELECT SUM(amount_minor) FROM payments x WHERE x.tenant_id=b.tenant_id AND x.booking_id=b.id AND x.status='settled'),0)::float8 AS paid_minor
      FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
      JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
      JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
      WHERE b.tenant_id=$1 AND ($2::uuid IS NULL OR b.id>$2) AND (b.lead_name ILIKE $3 OR b.id::text ILIKE $3) ORDER BY b.id LIMIT $4`, [actor.tenantId, q.cursor ?? null, "%" + q.search + "%", q.limit + 1]);
            return page(rows, q.limit);
        });
    }
    members(actor, raw) {
        const q = (0, http_1.parse)(querySchema, raw);
        return this.db.transaction(actor, async (tx) => {
            const { rows } = await tx.query(`SELECT m.actor_id AS id,m.role,m.active,s.name,s.email FROM memberships m JOIN staff_users s ON s.id=m.actor_id
      WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.actor_id>$2) AND s.name ILIKE $3 ORDER BY m.actor_id LIMIT $4`, [actor.tenantId, q.cursor ?? null, "%" + q.search + "%", q.limit + 1]);
            return page(rows, q.limit);
        });
    }
    summary(actor) {
        return this.db.transaction(actor, async (tx) => {
            const { rows: [r], } = await tx.query(`SELECT
      (SELECT COUNT(*)::int FROM departures WHERE tenant_id=$1 AND starts_at>clock_timestamp()) AS upcoming_departures,
      (SELECT COUNT(*)::int FROM bookings WHERE tenant_id=$1 AND state='confirmed') AS confirmed_bookings,
      (SELECT COALESCE(SUM((SELECT SUM(value::int) FROM jsonb_each_text(h.party))),0)::int FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.state='confirmed') AS confirmed_guests,
      (SELECT COUNT(*)::int FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.state='held' AND h.expires_at>clock_timestamp()) AS held_bookings`, [actor.tenantId]);
            return r;
        });
    }
};
exports.WorkspaceController = WorkspaceController;
__decorate([
    (0, common_1.Get)("session"),
    (0, http_1.Access)("catalog.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspaceController.prototype, "session", null);
__decorate([
    (0, common_1.Get)("departures"),
    (0, http_1.Access)("catalog.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WorkspaceController.prototype, "departures", null);
__decorate([
    (0, common_1.Get)("reservations"),
    (0, http_1.Access)("bookings.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WorkspaceController.prototype, "reservations", null);
__decorate([
    (0, common_1.Get)("members"),
    (0, http_1.Access)("members.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WorkspaceController.prototype, "members", null);
__decorate([
    (0, common_1.Get)("summary"),
    (0, http_1.Access)("bookings.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspaceController.prototype, "summary", null);
exports.WorkspaceController = WorkspaceController = __decorate([
    (0, common_1.Controller)("staff/v1/workspace"),
    __metadata("design:paramtypes", [database_1.Database])
], WorkspaceController);

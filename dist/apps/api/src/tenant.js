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
exports.TenantController = exports.PlatformController = exports.TenantService = void 0;
exports.tenant = tenant;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
async function tenant(tx, actor, lock = false) {
    const { rows: [row], } = await tx.query(`SELECT * FROM tenants WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [actor.tenantId]);
    if (!row)
        throw new common_1.NotFoundException();
    return row;
}
let TenantService = class TenantService {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(actor, input) {
        const data = (0, http_1.parse)(contracts_1.tenantSchema, input);
        return this.db.transaction(actor, async (tx) => {
            const tenantId = (0, node_crypto_1.randomUUID)(), ownerId = (0, node_crypto_1.randomUUID)();
            await tx.query(`INSERT INTO tenants(id,slug,name,timezone,config) VALUES($1,$2,$3,$4,$5)`, [tenantId, data.slug, data.name, data.timezone, data.config]);
            await tx.query(`SELECT set_config('app.tenant',$1,true)`, [tenantId]);
            await tx.query(`INSERT INTO staff_users VALUES($1,$2,$3)`, [
                ownerId,
                data.ownerName,
                data.ownerEmail,
            ]);
            await tx.query(`INSERT INTO memberships(tenant_id,actor_id,role,permissions) VALUES($1,$2,'owner',$3)`, [tenantId, ownerId, contracts_1.grants.owner]);
            const scoped = { ...actor, tenantId };
            await (0, database_1.record)(tx, scoped, "tenant.created", tenantId, null, {
                name: data.name,
                config: data.config,
                isMock: true,
            });
            await (0, database_1.record)(tx, scoped, "member.created", ownerId, null, {
                role: "owner",
                active: true,
            });
            return { tenantId, ownerId, isMock: true };
        });
    }
    async config(actor, key, input) {
        const data = (0, http_1.parse)(contracts_1.updateConfigSchema, input);
        return this.db.command(actor, "config.update", key, data, async (tx) => {
            const before = await tenant(tx, actor, true);
            if (before.version !== data.version)
                throw new common_1.ConflictException("Stale configuration version");
            const { rows: [used], } = await tx.query("SELECT EXISTS(SELECT 1 FROM products WHERE tenant_id=$1) AS used", [actor.tenantId]);
            if (used.used &&
                before.config.bookingCurrency !== data.config.bookingCurrency)
                throw new common_1.BadRequestException("Currency changes after catalog setup require a migration workflow");
            await tx.query("UPDATE tenants SET config=$2,version=version+1 WHERE id=$1", [actor.tenantId, data.config]);
            await (0, database_1.record)(tx, actor, "tenant.configured", before.id, { config: before.config, version: before.version }, { config: data.config, version: before.version + 1 });
            return { config: data.config, version: before.version + 1 };
        });
    }
    async member(actor, key, input) {
        const data = (0, http_1.parse)(contracts_1.memberSchema, input);
        return this.db.command(actor, "member.create", key, data, async (tx) => {
            const actorId = (0, node_crypto_1.randomUUID)();
            await tx.query("INSERT INTO staff_users VALUES($1,$2,$3)", [
                actorId,
                data.name,
                data.email,
            ]);
            await tx.query("INSERT INTO memberships(tenant_id,actor_id,role,permissions) VALUES($1,$2,$3,$4)", [actor.tenantId, actorId, data.role, contracts_1.grants[data.role]]);
            await (0, database_1.record)(tx, actor, "member.created", actorId, null, {
                role: data.role,
                active: true,
            });
            return { actorId, role: data.role };
        });
    }
    async updateMember(actor, actorId, key, input) {
        const data = (0, http_1.parse)(contracts_1.memberUpdateSchema, input);
        return this.db.command(actor, `member.update:${actorId}`, key, data, async (tx) => {
            const { rows: [before], } = await tx.query("SELECT role,active FROM memberships WHERE tenant_id=$1 AND actor_id=$2 FOR UPDATE", [actor.tenantId, actorId]);
            if (!before)
                throw new common_1.NotFoundException();
            if (before.role === "owner")
                throw new common_1.BadRequestException("Ownership changes require a separate workflow");
            await tx.query("UPDATE memberships SET role=$3,permissions=$4,active=$5 WHERE tenant_id=$1 AND actor_id=$2", [actor.tenantId, actorId, data.role, contracts_1.grants[data.role], data.active]);
            await (0, database_1.record)(tx, actor, "member.updated", actorId, before, data);
            return { actorId, ...data };
        });
    }
};
exports.TenantService = TenantService;
exports.TenantService = TenantService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database])
], TenantService);
let PlatformController = class PlatformController {
    service;
    constructor(service) {
        this.service = service;
    }
    create(actor, body) {
        return this.service.create(actor, body);
    }
};
exports.PlatformController = PlatformController;
__decorate([
    (0, common_1.Post)(),
    (0, http_1.Access)("tenant.provision"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PlatformController.prototype, "create", null);
exports.PlatformController = PlatformController = __decorate([
    (0, common_1.Controller)("platform/v1/tenants"),
    __metadata("design:paramtypes", [TenantService])
], PlatformController);
let TenantController = class TenantController {
    service;
    db;
    constructor(service, db) {
        this.service = service;
        this.db = db;
    }
    get(actor) {
        return this.db.transaction(actor, (tx) => tenant(tx, actor));
    }
    config(actor, key, body) {
        return this.service.config(actor, (0, http_1.parse)(http_1.keySchema, key), body);
    }
    member(actor, key, body) {
        return this.service.member(actor, (0, http_1.parse)(http_1.keySchema, key), body);
    }
    updateMember(actor, actorId, key, body) {
        return this.service.updateMember(actor, (0, http_1.parse)(contracts_1.id, actorId), (0, http_1.parse)(http_1.keySchema, key), body);
    }
};
exports.TenantController = TenantController;
__decorate([
    (0, common_1.Get)("tenant"),
    (0, http_1.Access)("catalog.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TenantController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)("tenant/config"),
    (0, http_1.Access)("config.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Headers)("idempotency-key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], TenantController.prototype, "config", null);
__decorate([
    (0, common_1.Post)("members"),
    (0, http_1.Access)("members.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Headers)("idempotency-key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], TenantController.prototype, "member", null);
__decorate([
    (0, common_1.Patch)("members/:id"),
    (0, http_1.Access)("members.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Headers)("idempotency-key")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], TenantController.prototype, "updateMember", null);
exports.TenantController = TenantController = __decorate([
    (0, common_1.Controller)("admin/v1"),
    __metadata("design:paramtypes", [TenantService,
        database_1.Database])
], TenantController);

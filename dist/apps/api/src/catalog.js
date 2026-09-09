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
exports.CatalogController = exports.CatalogService = void 0;
exports.validDay = validDay;
exports.validateProduct = validateProduct;
const common_1 = require("@nestjs/common");
const luxon_1 = require("luxon");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const database_1 = require("./database");
const http_1 = require("./http");
const tenant_1 = require("./tenant");
function validDay(value) {
    const d = luxon_1.DateTime.fromISO(value, { zone: "UTC" });
    if (!d.isValid || d.toISODate() !== value)
        throw new common_1.BadRequestException("Invalid calendar date");
    return d;
}
function validateProduct(data) {
    const categories = data.categories.map((c) => c.slug);
    if (new Set(categories).size !== categories.length)
        throw new common_1.BadRequestException("Duplicate categories");
    for (const rate of data.rates) {
        validDay(rate.startDate);
        validDay(rate.endDate);
        if (!categories.includes(rate.category) || rate.startDate > rate.endDate)
            throw new common_1.BadRequestException("Invalid rate/category");
        if (data.rates.some((other) => other !== rate &&
            rate.category === other.category &&
            rate.startDate <= other.endDate &&
            other.startDate <= rate.endDate))
            throw new common_1.BadRequestException("Overlapping seasonal rates");
    }
}
let CatalogService = class CatalogService {
    db;
    constructor(db) {
        this.db = db;
    }
    async definition(tx, actor, productId) {
        const { rows: [row], } = await tx.query("SELECT definition,version FROM products WHERE tenant_id=$1 AND id=$2", [actor.tenantId, productId]);
        if (!row)
            throw new common_1.NotFoundException();
        return row;
    }
    create(actor, key, input) {
        const data = (0, http_1.parse)(contracts_1.productSchema, input);
        validateProduct(data);
        return this.db.command(actor, "product.create", key, data, async (tx) => {
            await (0, tenant_1.tenant)(tx, actor, true);
            const productId = (0, node_crypto_1.randomUUID)();
            await tx.query("INSERT INTO products(tenant_id,id,name,definition) VALUES($1,$2,$3,$4)", [actor.tenantId, productId, data.name, data]);
            await (0, database_1.record)(tx, actor, "catalog.configured", productId, null, data);
            return { productId, ...data, version: 1 };
        });
    }
    schedule(actor, key, input) {
        const data = (0, http_1.parse)(contracts_1.scheduleSchema, input);
        const start = validDay(data.startDate), end = validDay(data.endDate);
        if (end < start || end.diff(start, "days").days > 365)
            throw new common_1.BadRequestException("Schedule must span 0–365 days");
        data.blackoutDates.forEach(validDay);
        return this.db.command(actor, "schedule.create", key, data, async (tx) => {
            const settings = await (0, tenant_1.tenant)(tx, actor);
            const scheduleId = (0, node_crypto_1.randomUUID)();
            await tx.query("INSERT INTO schedules VALUES($1,$2,$3,$4)", [
                actor.tenantId,
                scheduleId,
                data.productId,
                data,
            ]);
            const departures = [];
            for (let date = start; date <= end; date = date.plus({ days: 1 })) {
                const localDate = date.toISODate();
                if (!data.weekdays.includes(date.weekday) ||
                    data.blackoutDates.includes(localDate))
                    continue;
                const local = `${localDate}T${data.localTime}`;
                const zoned = luxon_1.DateTime.fromISO(local, { zone: settings.timezone });
                if (!zoned.isValid ||
                    zoned.toFormat("yyyy-MM-dd'T'HH:mm") !== local ||
                    zoned.getPossibleOffsets().length !== 1)
                    throw new common_1.BadRequestException("Ambiguous or nonexistent local departure time");
                const departureId = (0, node_crypto_1.randomUUID)(), startsAt = zoned.toUTC().toISO();
                await tx.query("INSERT INTO departures(tenant_id,id,product_id,schedule_id,starts_at,local_date,capacity) VALUES($1,$2,$3,$4,$5,$6,$7)", [
                    actor.tenantId,
                    departureId,
                    data.productId,
                    scheduleId,
                    startsAt,
                    localDate,
                    data.capacity,
                ]);
                await (0, database_1.record)(tx, actor, "departure.created", departureId, null, {
                    productId: data.productId,
                    startsAt,
                    capacity: data.capacity,
                });
                departures.push({ departureId, startsAt });
            }
            if (!departures.length)
                throw new common_1.BadRequestException("Schedule generates no departures");
            await (0, database_1.record)(tx, actor, "schedule.created", scheduleId, null, data);
            return { scheduleId, departures };
        });
    }
};
exports.CatalogService = CatalogService;
exports.CatalogService = CatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database])
], CatalogService);
let CatalogController = class CatalogController {
    service;
    db;
    constructor(service, db) {
        this.service = service;
        this.db = db;
    }
    create(a, key, body) {
        return this.service.create(a, (0, http_1.parse)(http_1.keySchema, key), body);
    }
    schedule(a, key, body) {
        return this.service.schedule(a, (0, http_1.parse)(http_1.keySchema, key), body);
    }
    list(a) {
        return this.db.transaction(a, async (tx) => (await tx.query("SELECT id,name,definition,version FROM products WHERE tenant_id=$1 ORDER BY id LIMIT 100", [a.tenantId])).rows);
    }
};
exports.CatalogController = CatalogController;
__decorate([
    (0, common_1.Post)("products"),
    (0, http_1.Access)("catalog.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Headers)("idempotency-key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "create", null);
__decorate([
    (0, common_1.Post)("schedules"),
    (0, http_1.Access)("catalog.write"),
    __param(0, (0, http_1.CurrentActor)()),
    __param(1, (0, common_1.Headers)("idempotency-key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "schedule", null);
__decorate([
    (0, common_1.Get)("products"),
    (0, http_1.Access)("catalog.read"),
    __param(0, (0, http_1.CurrentActor)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "list", null);
exports.CatalogController = CatalogController = __decorate([
    (0, common_1.Controller)("admin/v1"),
    __metadata("design:paramtypes", [CatalogService,
        database_1.Database])
], CatalogController);

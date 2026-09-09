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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
exports.createApp = createApp;
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const express_1 = require("express");
const helmet_1 = __importDefault(require("helmet"));
const node_crypto_1 = require("node:crypto");
const database_1 = require("./database");
const http_1 = require("./http");
const tenant_1 = require("./tenant");
const catalog_1 = require("./catalog");
const inventory_1 = require("./inventory");
const finance_1 = require("./finance");
const reservations_1 = require("./reservations");
const operations_1 = require("./operations");
const openapi_1 = require("./openapi");
const booking_changes_1 = require("./booking-changes");
const workspace_1 = require("./workspace");
const dispatch_1 = require("./dispatch");
let DatabaseModule = class DatabaseModule {
};
DatabaseModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({ providers: [database_1.Database], exports: [database_1.Database] })
], DatabaseModule);
let TenantModule = class TenantModule {
};
TenantModule = __decorate([
    (0, common_1.Module)({
        providers: [tenant_1.TenantService],
        controllers: [tenant_1.PlatformController, tenant_1.TenantController],
    })
], TenantModule);
let CatalogModule = class CatalogModule {
};
CatalogModule = __decorate([
    (0, common_1.Module)({
        providers: [catalog_1.CatalogService],
        controllers: [catalog_1.CatalogController],
        exports: [catalog_1.CatalogService],
    })
], CatalogModule);
let InventoryModule = class InventoryModule {
};
InventoryModule = __decorate([
    (0, common_1.Module)({
        imports: [CatalogModule],
        providers: [inventory_1.InventoryService],
        controllers: [inventory_1.InventoryController],
        exports: [inventory_1.InventoryService],
    })
], InventoryModule);
let FinanceModule = class FinanceModule {
};
FinanceModule = __decorate([
    (0, common_1.Module)({ providers: [finance_1.FinanceService], exports: [finance_1.FinanceService] })
], FinanceModule);
let ReservationModule = class ReservationModule {
};
ReservationModule = __decorate([
    (0, common_1.Module)({
        imports: [InventoryModule, FinanceModule],
        providers: [reservations_1.ReservationService, booking_changes_1.BookingChangeService],
        controllers: [reservations_1.ReservationController, booking_changes_1.BookingChangeController],
    })
], ReservationModule);
let OperationsModule = class OperationsModule {
};
OperationsModule = __decorate([
    (0, common_1.Module)({ providers: [operations_1.OutboxService], controllers: [operations_1.OperationsController] })
], OperationsModule);
let SystemController = class SystemController {
    health() {
        return { status: "ok", mode: process.env.APP_MODE, livePayments: false };
    }
    api() {
        return (0, openapi_1.openapi)();
    }
};
__decorate([
    (0, common_1.Get)("health"),
    (0, http_1.Access)("public"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SystemController.prototype, "health", null);
__decorate([
    (0, common_1.Get)("openapi.json"),
    (0, http_1.Access)("public"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SystemController.prototype, "api", null);
SystemController = __decorate([
    (0, common_1.Controller)()
], SystemController);
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            DatabaseModule,
            TenantModule,
            CatalogModule,
            InventoryModule,
            FinanceModule,
            ReservationModule,
            OperationsModule,
        ],
        controllers: [SystemController, workspace_1.WorkspaceController, dispatch_1.DispatchController],
        providers: [dispatch_1.DispatchService, { provide: core_1.APP_GUARD, useClass: http_1.AuthGuard }],
    })
], AppModule);
async function createApp() {
    if (!["demo", "test"].includes(process.env.APP_MODE ?? "") ||
        process.env.NODE_ENV === "production")
        throw new Error("First slice supports explicit APP_MODE=demo/test only. Production identity and launch checks are not complete.");
    if (!process.env.DATABASE_URL)
        throw new Error("DATABASE_URL is required");
    const app = await core_1.NestFactory.create(AppModule, {
        logger: process.env.APP_MODE === "test" ? false : ["error", "warn", "log"],
        bodyParser: false,
    });
    app.use((0, helmet_1.default)());
    app.use((0, express_1.json)({ limit: "64kb" }));
    app.use((_req, res, next) => {
        res.setHeader("X-Correlation-Id", (0, node_crypto_1.randomUUID)());
        next();
    });
    app.useGlobalFilters(new http_1.ProblemFilter());
    try {
        await app.get(database_1.Database).assertRuntimeRole();
        await app.init();
        return app;
    }
    catch (error) {
        await app.close();
        throw error;
    }
}

import "reflect-metadata";
import { Controller, Get, Global, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { json, raw, static as serveStatic } from "express";
import path from "node:path";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { Database } from "./database";
import { Access, AuthGuard, ProblemFilter } from "./http";
import { PlatformController, TenantController, TenantService } from "./tenant";
import { CatalogController, CatalogService } from "./catalog";
import { InventoryController, InventoryService } from "./inventory";
import { FinanceService } from "./finance";
import { ReservationController, ReservationService } from "./reservations";
import { OperationsController, OutboxService } from "./operations";
import { openapi } from "./openapi";
import {
  BookingChangeService,
  BookingChangeController,
  RebookingController,
} from "./booking-changes";
import { WorkspaceController } from "./workspace";
import { DispatchController, DispatchService } from "./dispatch";
import { WaiverController, WaiverService } from "./waivers";
import { AuthController } from "./auth";
import { ResourceController, ResourceService } from "./resources";
import { PrintController, PrintService } from "./printing";
import { CrewController, CrewService } from "./crew";
import { PartnerController, PartnerService } from "./partners";
import { IntegrationController, IntegrationService } from "./integrations";
import { PassengerController, PassengerService } from "./passengers";
import { NotificationController, NotificationService } from "./notifications";
import { StayController, StayService } from "./stays";
import { CustomerController, CustomerService } from "./customers";
import { ReportController, ReportService } from "./reports";
import {
  PlatformSupportController,
  SupportService,
  TenantSupportController,
} from "./support";

@Global()
@Module({ providers: [Database], exports: [Database] })
class DatabaseModule {}
@Module({
  providers: [TenantService],
  controllers: [PlatformController, TenantController],
})
class TenantModule {}
@Module({
  providers: [CatalogService],
  controllers: [CatalogController],
  exports: [CatalogService],
})
class CatalogModule {}
@Module({
  imports: [CatalogModule],
  providers: [InventoryService],
  controllers: [InventoryController],
  exports: [InventoryService],
})
class InventoryModule {}
@Module({ providers: [FinanceService], exports: [FinanceService] })
class FinanceModule {}
@Module({
  imports: [InventoryModule, FinanceModule],
  providers: [ReservationService, BookingChangeService],
  controllers: [
    ReservationController,
    BookingChangeController,
    RebookingController,
  ],
})
class ReservationModule {}
@Module({ providers: [OutboxService], controllers: [OperationsController] })
class OperationsModule {}
@Controller()
class SystemController {
  @Get("health") @Access("public") health() {
    return { status: "ok", mode: process.env.APP_MODE, livePayments: false };
  }
  @Get("openapi.json") @Access("public") api() {
    return openapi();
  }
}
@Module({
  imports: [
    DatabaseModule,
    TenantModule,
    CatalogModule,
    InventoryModule,
    FinanceModule,
    ReservationModule,
    OperationsModule,
  ],
  controllers: [
    SystemController,
    AuthController,
    ResourceController,
    WorkspaceController,
    DispatchController,
    WaiverController,
    PrintController,
    CrewController,
    PartnerController,
    IntegrationController,
    PassengerController,
    NotificationController,
    StayController,
    CustomerController,
    PlatformSupportController,
    TenantSupportController,
    ReportController,
  ],
  providers: [
    DispatchService,
    WaiverService,
    ResourceService,
    PrintService,
    CrewService,
    PartnerService,
    IntegrationService,
    PassengerService,
    NotificationService,
    StayService,
    CustomerService,
    SupportService,
    ReportService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}

export async function createApp() {
  if (
    !["demo", "test"].includes(process.env.APP_MODE ?? "") ||
    process.env.NODE_ENV === "production"
  )
    throw new Error(
      "First slice supports explicit APP_MODE=demo/test only. Production identity and launch checks are not complete.",
    );
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const app = await NestFactory.create(AppModule, {
    logger: process.env.APP_MODE === "test" ? false : ["error", "warn", "log"],
    bodyParser: false,
  });
  app.use(helmet());
  app.use(
    "/integrations/v1/inbound",
    raw({ type: "application/json", limit: "64kb" }),
  );
  app.use(json({ limit: "64kb" }));
  app.use(
    "/uploads",
    serveStatic(path.resolve("uploads"), { fallthrough: false }),
  );
  app.use(
    (
      _req: unknown,
      res: { setHeader: (key: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader("X-Correlation-Id", randomUUID());
      next();
    },
  );
  app.useGlobalFilters(new ProblemFilter());
  try {
    await app.get(Database).assertRuntimeRole();
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

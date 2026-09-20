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
import { DocumentStorageService } from "./document-storage";
import { DocumentLibraryService } from "./document-library";
import { CrewController, CrewService } from "./crew";
import { CrewOfflineController, CrewOfflineService } from "./crew-offline";
import { PartnerController, PartnerService } from "./partners";
import { ExpenseController, ExpenseService } from "./expenses";
import { IntegrationController, IntegrationService } from "./integrations";
import { PassengerController, PassengerService } from "./passengers";
import { NotificationModule } from "./notifications";
import { StayController, StayService } from "./stays";
import { CustomerController, CustomerService } from "./customers";
import { ReportController, ReportService } from "./reports";
import { LimitsService } from "./limits";
import {
  StripeBillingModule,
  StripeWebhookController,
  BillingPortalController,
  StripeBillingService,
} from "./stripe-billing";
import {
  ZettazPayModule,
  ZettazPayController,
  ZettazPayCheckoutController,
  ZettazPayWebhookController,
  ZettazPayService,
} from "./stripe-pay";
import { startSubscriptionJobs } from "./subscription-jobs";
import {
  PlatformSupportController,
  SupportService,
  TenantSupportController,
} from "./support";

@Global()
@Module({ providers: [Database], exports: [Database] })
class DatabaseModule {}
@Module({
  providers: [TenantService, LimitsService],
  controllers: [PlatformController, TenantController],
  exports: [TenantService, LimitsService],
})
class TenantModule {}
@Module({
  imports: [TenantModule],
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
  imports: [InventoryModule, FinanceModule, NotificationModule],
  providers: [ReservationService, BookingChangeService],
  controllers: [
    ReservationController,
    BookingChangeController,
    RebookingController,
  ],
  exports: [ReservationService],
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
    NotificationModule,
    StripeBillingModule,
    ZettazPayModule,
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
    CrewOfflineController,
    PartnerController,
    ExpenseController,
    IntegrationController,
    PassengerController,
    StayController,
    CustomerController,
    PlatformSupportController,
    TenantSupportController,
    ReportController,
    StripeWebhookController,
    BillingPortalController,
    ZettazPayController,
    ZettazPayCheckoutController,
    ZettazPayWebhookController,
  ],
  providers: [
    DispatchService,
    WaiverService,
    ResourceService,
    PrintService,
    DocumentStorageService,
    DocumentLibraryService,
    CrewService,
    CrewOfflineService,
    PartnerService,
    ExpenseService,
    IntegrationService,
    PassengerService,
    StayService,
    CustomerService,
    SupportService,
    ReportService,
    StripeBillingService,
    ZettazPayService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}

export async function createApp() {
  if (!["demo", "test", "production"].includes(process.env.APP_MODE ?? ""))
    throw new Error(
      "APP_MODE must be demo, test, or production. Set APP_MODE=production for live deployments.",
    );
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const verboseNestLog =
    process.env.NEST_LOG === "verbose" || process.env.NEST_LOG === "log";
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env.APP_MODE === "test"
        ? false
        : verboseNestLog
          ? ["error", "warn", "log"]
          : ["error", "warn"],
    bodyParser: false,
  });
  app.use(helmet());
  app.use(
    "/integrations/v1/inbound",
    raw({ type: "application/json", limit: "64kb" }),
  );
  // Stripe webhook endpoint needs the raw body for signature verification.
  app.use("/webhooks/stripe", raw({ type: "application/json", limit: "1mb" }));
  app.use("/webhooks/stripe-pay", raw({ type: "application/json", limit: "1mb" }));
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
    // Start subscription background jobs (trial reminders, grace period)
    startSubscriptionJobs(app.get(Database).pool);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

import "reflect-metadata";
import { Controller, Get, Global, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { json } from "express";
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
} from "./booking-changes";
import { WorkspaceController } from "./workspace";
import { DispatchController, DispatchService } from "./dispatch";
import { WaiverController, WaiverService } from "./waivers";

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
  controllers: [ReservationController, BookingChangeController],
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
  controllers: [SystemController, WorkspaceController, DispatchController, WaiverController],
  providers: [DispatchService, WaiverService, { provide: APP_GUARD, useClass: AuthGuard }],
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
  app.use(json({ limit: "64kb" }));
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

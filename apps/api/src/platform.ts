import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
} from "@nestjs/common";
import { Actor, id } from "../../../packages/shared/src/contracts";
import { Database } from "./database";
import { Access, CurrentActor, parse } from "./http";

@Controller("platform/v1")
export class PlatformOpsController {
  constructor(private readonly db: Database) {}

  @Get("overview")
  @Access("platform.tenant.read")
  overview(@CurrentActor() actor: Actor) {
    if (!actor.platform) throw new ForbiddenException();
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [row],
      } = await tx.query("SELECT * FROM platform_overview()");
      return row ?? {};
    });
  }

  @Get("health")
  @Access("platform.tenant.read")
  health(@CurrentActor() actor: Actor) {
    if (!actor.platform) throw new ForbiddenException();
    return this.db.transaction(actor, async (tx) => ({
      items: (await tx.query("SELECT * FROM list_platform_health()")).rows,
    }));
  }

  @Get("activity")
  @Access("platform.tenant.read")
  activity(@CurrentActor() actor: Actor) {
    if (!actor.platform) throw new ForbiddenException();
    return this.db.transaction(actor, async (tx) => ({
      items: (await tx.query("SELECT * FROM list_platform_activity()")).rows,
    }));
  }
}

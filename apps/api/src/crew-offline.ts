import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  forwardRef,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { CrewService } from "./crew";
import { Database, digest } from "./database";
import { Access, CurrentActor, parse } from "./http";
import { PassengerService } from "./passengers";
import { WaiverService } from "./waivers";

const enrollSchema = z
  .object({
    clientDeviceId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    platform: z.enum(["ios", "android", "web"]),
  })
  .strict();
const commandSchema = z
  .object({
    clientCommandId: z.string().uuid(),
    kind: z.enum(["checkin", "trip_event", "waiver", "payment"]),
    occurredAt: z.string().datetime({ offset: true }),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
const batchSchema = z
  .object({
    commands: z.array(commandSchema).min(1).max(50),
  })
  .strict();
const checkinPayload = z
  .object({
    passengerId: z.string().uuid(),
    state: z.enum(["arrived", "cleared_to_board", "boarded", "no_show"]),
  })
  .strict();
const eventPayload = z
  .object({
    departureId: z.string().uuid(),
    state: z.enum([
      "preparing",
      "en_route_pickup",
      "boarding",
      "departed",
      "at_stop",
      "delayed",
      "completed",
      "cancelled",
      "emergency",
    ]),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
const waiverPayload = z
  .object({
    passengerId: z.string().uuid(),
    body: z.record(z.string(), z.unknown()),
  })
  .strict();
const paymentPayload = z
  .object({
    bookingId: z.string().uuid(),
    body: z.record(z.string(), z.unknown()),
  })
  .strict();

function leaseHours(config: Record<string, unknown> | undefined) {
  const raw = Number(config?.offlineLeaseHours);
  if (!Number.isFinite(raw)) return 24;
  return Math.min(72, Math.max(4, Math.round(raw)));
}

function secretHash(value: string) {
  return digest(value);
}

export class DeviceRevokedException extends HttpException {
  constructor() {
    super(
      {
        message:
          "This device was revoked. Local tenant data must be wiped on next unlock.",
        code: "device_revoked",
      },
      HttpStatus.GONE,
    );
  }
}

@Injectable()
export class CrewOfflineService {
  constructor(
    private readonly db: Database,
    @Inject(forwardRef(() => CrewService))
    private readonly crew: CrewService,
    private readonly passengers: PassengerService,
    private readonly waivers: WaiverService,
  ) {}

  enroll(actor: Actor, raw: unknown) {
    if (!actor.permissions.includes("crew.trip.read"))
      throw new ForbiddenException();
    const input = parse(enrollSchema, raw);
    const secret = randomBytes(32).toString("hex");
    const id = randomUUID();
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT config FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      await tx.query(
        `UPDATE crew_devices SET revoked_at=clock_timestamp(), revoke_reason='replaced'
         WHERE tenant_id=$1 AND actor_id=$2 AND client_device_id=$3 AND revoked_at IS NULL`,
        [actor.tenantId, actor.actorId, input.clientDeviceId],
      );
      await tx.query(
        `INSERT INTO crew_devices(tenant_id,id,actor_id,client_device_id,name,platform,credential_hash,last_seen_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,
        [
          actor.tenantId,
          id,
          actor.actorId,
          input.clientDeviceId,
          input.name,
          input.platform,
          secretHash(secret),
        ],
      );
      return {
        deviceId: id,
        secret,
        leaseHours: leaseHours(tenant?.config),
      };
    });
  }

  list(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id,name,platform,enrolled_at,last_seen_at,revoked_at
         FROM crew_devices WHERE tenant_id=$1 AND actor_id=$2
         ORDER BY enrolled_at DESC`,
        [actor.tenantId, actor.actorId],
      );
      return { items: rows };
    });
  }

  revoke(actor: Actor, deviceId: string, reason: string) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [device],
      } = await tx.query(
        "SELECT id,actor_id,revoked_at FROM crew_devices WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, deviceId],
      );
      if (!device) throw new NotFoundException();
      if (
        device.actor_id !== actor.actorId &&
        !actor.permissions.includes("members.write")
      )
        throw new ForbiddenException();
      if (device.revoked_at) return { id: deviceId, revoked: true };
      await tx.query(
        `UPDATE crew_devices SET revoked_at=clock_timestamp(), revoke_reason=$3
         WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, deviceId, reason.trim() || "revoked"],
      );
      return { id: deviceId, revoked: true };
    });
  }

  async snapshot(
    actor: Actor,
    deviceId: string,
    secret: string,
    date?: string,
  ) {
    await this.requireDevice(actor, deviceId, secret);
    const today = await this.crew.today(actor, date ? { date } : {});
    const hours = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT timezone,config FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      return {
        hours: leaseHours(tenant?.config),
        timezone: tenant.timezone as string,
      };
    });
    const downloadedAt = new Date().toISOString();
    return {
      ...today,
      deviceId,
      downloadedAt,
      leaseHours: hours.hours,
      leaseExpiresAt: DateTime.fromISO(downloadedAt)
        .plus({ hours: hours.hours })
        .toISO(),
      timezone: hours.timezone,
    };
  }

  async commands(actor: Actor, deviceId: string, secret: string, raw: unknown) {
    const device = await this.requireDevice(actor, deviceId, secret);
    const input = parse(batchSchema, raw);
    const results = [];
    for (const command of input.commands) {
      results.push(await this.applyOne(actor, device.id, command));
    }
    return { results };
  }

  private async requireDevice(actor: Actor, deviceId: string, secret: string) {
    if (!deviceId || !secret)
      throw new UnauthorizedException("Device credentials are required");
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [device],
      } = await tx.query(
        `SELECT id,actor_id,credential_hash,revoked_at FROM crew_devices
         WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, deviceId],
      );
      if (!device || device.actor_id !== actor.actorId)
        throw new NotFoundException();
      if (device.revoked_at) throw new DeviceRevokedException();
      if (device.credential_hash !== secretHash(secret))
        throw new UnauthorizedException("Device credentials are invalid");
      await tx.query(
        "UPDATE crew_devices SET last_seen_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, deviceId],
      );
      return device as { id: string };
    });
  }

  private async applyOne(
    actor: Actor,
    deviceId: string,
    command: z.infer<typeof commandSchema>,
  ) {
    const existing = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [row],
      } = await tx.query(
        `SELECT client_command_id,status,reason,result FROM crew_offline_commands
         WHERE tenant_id=$1 AND client_command_id=$2`,
        [actor.tenantId, command.clientCommandId],
      );
      return row as
        | {
            client_command_id: string;
            status: string;
            reason: string | null;
            result: unknown;
          }
        | undefined;
    });
    if (existing)
      return {
        clientCommandId: command.clientCommandId,
        status: (existing.status === "accepted"
          ? "duplicate"
          : existing.status) as "duplicate" | "rejected" | "conflict",
        reason: existing.reason,
        result: existing.result,
      };
    let status: "accepted" | "rejected" | "conflict" = "accepted";
    let reason: string | null = null;
    let result: unknown = null;
    try {
      result = await this.dispatch(actor, command);
    } catch (error) {
      const http = error as HttpException;
      const message =
        http instanceof HttpException
          ? typeof http.getResponse() === "string"
            ? http.getResponse()
            : ((http.getResponse() as { message?: string }).message ??
              http.message)
          : error instanceof Error
            ? error.message
            : "Command failed";
      const code = http instanceof HttpException ? http.getStatus() : 500;
      status = code === 409 ? "conflict" : "rejected";
      reason = Array.isArray(message)
        ? message.map(String).join("; ")
        : String(message);
    }
    await this.db.transaction(actor, async (tx) => {
      await tx.query(
        `INSERT INTO crew_offline_commands(
           tenant_id,id,device_id,actor_id,client_command_id,kind,occurred_at,status,reason,result
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id, client_command_id) DO NOTHING`,
        [
          actor.tenantId,
          randomUUID(),
          deviceId,
          actor.actorId,
          command.clientCommandId,
          command.kind,
          command.occurredAt,
          status,
          reason,
          result ? JSON.stringify(result) : null,
        ],
      );
    });
    return {
      clientCommandId: command.clientCommandId,
      status,
      reason,
      result,
    };
  }

  private dispatch(actor: Actor, command: z.infer<typeof commandSchema>) {
    if (command.kind === "checkin") {
      const payload = parse(checkinPayload, command.payload);
      return this.passengers.checkIn(
        actor,
        payload.passengerId,
        command.clientCommandId,
        { state: payload.state },
      );
    }
    if (command.kind === "trip_event") {
      const payload = parse(eventPayload, command.payload);
      return this.crew.event(
        actor,
        payload.departureId,
        command.clientCommandId,
        { state: payload.state, reason: payload.reason },
      );
    }
    if (command.kind === "waiver") {
      const payload = parse(waiverPayload, command.payload);
      return this.waivers.crewSign(
        actor,
        payload.passengerId,
        command.clientCommandId,
        payload.body,
      );
    }
    const payload = parse(paymentPayload, command.payload);
    return this.crew.payment(
      actor,
      payload.bookingId,
      command.clientCommandId,
      payload.body,
    );
  }
}

function headerValue(headers: Record<string, unknown>, name: string) {
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );
  const value = match?.[1];
  return String(Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

export function deviceHeaders(headers: Record<string, unknown>) {
  return {
    id: headerValue(headers, "x-crew-device-id"),
    secret: headerValue(headers, "x-crew-device-secret"),
  };
}

@Controller("crew/v1")
export class CrewOfflineController {
  constructor(private readonly offline: CrewOfflineService) {}
  @Post("devices") @Access("crew.trip.read") enroll(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
  ) {
    return this.offline.enroll(actor, body);
  }
  @Get("devices") @Access("crew.trip.read") list(@CurrentActor() actor: Actor) {
    return this.offline.list(actor);
  }
  @Post("devices/:id/revoke") @Access("authenticated") revoke(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Body() body: unknown,
  ) {
    const reason =
      body && typeof body === "object" && "reason" in body
        ? String((body as { reason?: string }).reason ?? "")
        : "";
    return this.offline.revoke(actor, parse(z.string().uuid(), value), reason);
  }
  @Get("offline/snapshot") @Access("crew.trip.read") snapshot(
    @CurrentActor() actor: Actor,
    @Headers() headers: Record<string, unknown>,
    @Query() query: unknown,
  ) {
    const device = deviceHeaders(headers);
    const date =
      query && typeof query === "object" && "date" in query
        ? String((query as { date?: string }).date ?? "")
        : "";
    return this.offline.snapshot(
      actor,
      device.id,
      device.secret,
      date || undefined,
    );
  }
  @Post("offline/commands") @Access("crew.trip.read") commands(
    @CurrentActor() actor: Actor,
    @Headers() headers: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    const device = deviceHeaders(headers);
    return this.offline.commands(actor, device.id, device.secret, body);
  }
}

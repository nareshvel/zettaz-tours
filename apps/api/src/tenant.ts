import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Actor,
  grants,
  id,
  memberSchema,
  memberUpdateSchema,
  tenantSchema,
  TenantConfig,
  updateConfigSchema,
} from "../../../packages/shared/src/contracts";
import { Database, record, Tx } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

export async function tenant(tx: Tx, actor: Actor, lock = false) {
  const {
    rows: [row],
  } = await tx.query(
    `SELECT * FROM tenants WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [actor.tenantId],
  );
  if (!row) throw new NotFoundException();
  return row as {
    id: string;
    name: string;
    timezone: string;
    config: TenantConfig;
    version: number;
    is_mock: boolean;
  };
}
@Injectable()
export class TenantService {
  constructor(private readonly db: Database) {}
  async create(actor: Actor, input: unknown) {
    const data = parse(tenantSchema, input);
    return this.db.transaction(actor, async (tx) => {
      const tenantId = randomUUID(),
        ownerId = randomUUID();
      await tx.query(
        `INSERT INTO tenants(id,slug,name,timezone,config) VALUES($1,$2,$3,$4,$5)`,
        [tenantId, data.slug, data.name, data.timezone, data.config],
      );
      await tx.query(`SELECT set_config('app.tenant',$1,true)`, [tenantId]);
      await tx.query(`INSERT INTO staff_users VALUES($1,$2,$3)`, [
        ownerId,
        data.ownerName,
        data.ownerEmail,
      ]);
      await tx.query(
        `INSERT INTO memberships(tenant_id,actor_id,role,permissions) VALUES($1,$2,'owner',$3)`,
        [tenantId, ownerId, grants.owner],
      );
      const scoped = { ...actor, tenantId };
      await record(tx, scoped, "tenant.created", tenantId, null, {
        name: data.name,
        config: data.config,
        isMock: true,
      });
      await record(tx, scoped, "member.created", ownerId, null, {
        role: "owner",
        active: true,
      });
      return { tenantId, ownerId, isMock: true };
    });
  }
  async config(actor: Actor, key: string, input: unknown) {
    const data = parse(updateConfigSchema, input);
    return this.db.command(actor, "config.update", key, data, async (tx) => {
      const before = await tenant(tx, actor, true);
      if (before.version !== data.version)
        throw new ConflictException("Stale configuration version");
      const {
        rows: [used],
      } = await tx.query(
        "SELECT EXISTS(SELECT 1 FROM products WHERE tenant_id=$1) AS used",
        [actor.tenantId],
      );
      if (
        used.used &&
        before.config.bookingCurrency !== data.config.bookingCurrency
      )
        throw new BadRequestException(
          "Currency changes after catalog setup require a migration workflow",
        );
      await tx.query(
        "UPDATE tenants SET config=$2,version=version+1 WHERE id=$1",
        [actor.tenantId, data.config],
      );
      await record(
        tx,
        actor,
        "tenant.configured",
        before.id,
        { config: before.config, version: before.version },
        { config: data.config, version: before.version + 1 },
      );
      return { config: data.config, version: before.version + 1 };
    });
  }
  async member(actor: Actor, key: string, input: unknown) {
    const data = parse(memberSchema, input);
    return this.db.command(actor, "member.create", key, data, async (tx) => {
      const actorId = randomUUID();
      await tx.query("INSERT INTO staff_users VALUES($1,$2,$3)", [
        actorId,
        data.name,
        data.email,
      ]);
      await tx.query(
        "INSERT INTO memberships(tenant_id,actor_id,role,permissions) VALUES($1,$2,$3,$4)",
        [actor.tenantId, actorId, data.role, grants[data.role]],
      );
      await record(tx, actor, "member.created", actorId, null, {
        role: data.role,
        active: true,
      });
      return { actorId, role: data.role };
    });
  }
  async updateMember(
    actor: Actor,
    actorId: string,
    key: string,
    input: unknown,
  ) {
    const data = parse(memberUpdateSchema, input);
    return this.db.command(
      actor,
      `member.update:${actorId}`,
      key,
      data,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT role,active FROM memberships WHERE tenant_id=$1 AND actor_id=$2 FOR UPDATE",
          [actor.tenantId, actorId],
        );
        if (!before) throw new NotFoundException();
        if (before.role === "owner")
          throw new BadRequestException(
            "Ownership changes require a separate workflow",
          );
        await tx.query(
          "UPDATE memberships SET role=$3,permissions=$4,active=$5 WHERE tenant_id=$1 AND actor_id=$2",
          [actor.tenantId, actorId, data.role, grants[data.role], data.active],
        );
        await record(tx, actor, "member.updated", actorId, before, data);
        return { actorId, ...data };
      },
    );
  }
}
@Controller("platform/v1/tenants")
export class PlatformController {
  constructor(private readonly service: TenantService) {}
  @Post()
  @Access("tenant.provision")
  create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.create(actor, body);
  }
}
@Controller("admin/v1")
export class TenantController {
  constructor(
    private readonly service: TenantService,
    private readonly db: Database,
  ) {}
  @Get("tenant")
  @Access("catalog.read")
  get(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, (tx) => tenant(tx, actor));
  }
  @Patch("tenant/config")
  @Access("config.write")
  config(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.config(actor, parse(keySchema, key), body);
  }
  @Post("members")
  @Access("members.write")
  member(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.member(actor, parse(keySchema, key), body);
  }
  @Patch("members/:id")
  @Access("members.write")
  updateMember(
    @CurrentActor() actor: Actor,
    @Param("id") actorId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateMember(
      actor,
      parse(id, actorId),
      parse(keySchema, key),
      body,
    );
  }
}

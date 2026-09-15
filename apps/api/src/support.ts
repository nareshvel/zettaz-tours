import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Actor, id } from "../../../packages/shared/src/contracts";
import { Database, digest, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const readonlyPermissions = [
  "catalog.read",
  "bookings.read",
  "manifest.read",
  "audit.read",
  "integration.inbox.read",
] as const;
const requestSchema = z
  .object({
    requestId: id,
    tenantId: id,
    purpose: z.string().trim().min(8).max(500),
    permissions: z
      .array(z.enum(readonlyPermissions))
      .min(1)
      .max(readonlyPermissions.length),
  })
  .strict()
  .refine(
    (value) => new Set(value.permissions).size === value.permissions.length,
    "Permissions must be unique",
  );
const decisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    expiresInHours: z.number().int().min(1).max(8).optional(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict()
  .refine(
    (value) =>
      value.decision !== "approved" || value.expiresInHours !== undefined,
    "Approved access requires an expiry",
  );
const revokeSchema = z
  .object({ reason: z.string().trim().min(8).max(500) })
  .strict();

@Injectable()
export class SupportService {
  constructor(private readonly db: Database) {}
  async request(actor: Actor, raw: unknown) {
    if (!actor.platform) throw new ForbiddenException();
    const input = parse(requestSchema, raw);
    const permissions = [...new Set(["catalog.read", ...input.permissions])];
    const { rows } = await this.db.pool.query(
      "SELECT request_support_access($1,$2,$3,$4,$5) AS id",
      [
        input.requestId,
        actor.actorId,
        input.tenantId,
        input.purpose,
        permissions,
      ],
    );
    return { requestId: rows[0].id, status: "pending", permissions };
  }
  list(actor: Actor) {
    return this.db.transaction(actor, async (tx) => ({
      items: (
        await tx.query("SELECT * FROM list_current_tenant_support_access()")
      ).rows,
    }));
  }
  decision(actor: Actor, grantId: string, key: string, raw: unknown) {
    if (actor.role !== "owner")
      throw new ForbiddenException(
        "Only a tenant owner can approve support access",
      );
    const input = parse(decisionSchema, raw);
    return this.db.command(
      actor,
      `support_access.decision:${grantId}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT * FROM support_access_grants WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [actor.tenantId, grantId],
        );
        if (!before)
          throw new BadRequestException("Support request is unavailable");
        if (before.status !== "pending")
          throw new ConflictException("Support request was already decided");
        const expiresAt =
          input.decision === "approved"
            ? new Date(Date.now() + input.expiresInHours! * 3600000)
            : null;
        const {
          rows: [after],
        } = await tx.query(
          `UPDATE support_access_grants SET status=$3,decided_by=$4,decided_at=clock_timestamp(),expires_at=$5,decision_reason=$6
         WHERE tenant_id=$1 AND id=$2 RETURNING id,platform_actor_id,purpose,permissions,status,requested_at,decided_at,expires_at,decision_reason`,
          [
            actor.tenantId,
            grantId,
            input.decision,
            actor.actorId,
            expiresAt,
            input.reason,
          ],
        );
        await record(
          tx,
          actor,
          `support_access.${input.decision}`,
          grantId,
          { status: before.status },
          {
            status: after.status,
            permissions: after.permissions,
            expiresAt: after.expires_at,
          },
          input.reason,
        );
        return after;
      },
    );
  }
  revoke(actor: Actor, grantId: string, key: string, raw: unknown) {
    if (actor.role !== "owner")
      throw new ForbiddenException(
        "Only a tenant owner can revoke support access",
      );
    const input = parse(revokeSchema, raw);
    return this.db.command(
      actor,
      `support_access.revoke:${grantId}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT * FROM support_access_grants WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [actor.tenantId, grantId],
        );
        if (!before)
          throw new BadRequestException("Support grant is unavailable");
        if (before.status !== "approved")
          throw new ConflictException("Only approved access can be revoked");
        await tx.query(
          "UPDATE support_access_grants SET status='revoked',decision_reason=$3 WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, grantId, input.reason],
        );
        await tx.query(
          "UPDATE support_sessions SET revoked=true WHERE tenant_id=$1 AND grant_id=$2",
          [actor.tenantId, grantId],
        );
        await record(
          tx,
          actor,
          "support_access.revoked",
          grantId,
          { status: before.status },
          { status: "revoked" },
          input.reason,
        );
        return { id: grantId, status: "revoked" };
      },
    );
  }
  async use(actor: Actor, grantId: string) {
    if (!actor.platform) throw new ForbiddenException();
    const value = randomBytes(32).toString("base64url");
    const { rows } = await this.db.pool.query(
      "SELECT issue_support_session($1,$2,$3) AS issued",
      [actor.actorId, grantId, digest(value)],
    );
    if (!rows[0]?.issued)
      throw new ForbiddenException("Support grant is unavailable or expired");
    return { token: value };
  }
}

@Controller("platform/v1/support-access")
export class PlatformSupportController {
  constructor(private readonly service: SupportService) {}
  @Post("requests") @Access("platform.support.request") request(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
  ) {
    return this.service.request(actor, body);
  }
  @Post(":id/use") @Access("platform.support.use") use(
    @CurrentActor() actor: Actor,
    @Param("id") grantId: string,
  ) {
    return this.service.use(actor, parse(id, grantId));
  }
}
@Controller("admin/v1/support-access")
export class TenantSupportController {
  constructor(private readonly service: SupportService) {}
  @Get() @Access("members.write") list(@CurrentActor() actor: Actor) {
    return this.service.list(actor);
  }
  @Post(":id/decision") @Access("members.write") decision(
    @CurrentActor() actor: Actor,
    @Param("id") grantId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.decision(
      actor,
      parse(id, grantId),
      parse(keySchema, key),
      body,
    );
  }
  @Post(":id/revoke") @Access("members.write") revoke(
    @CurrentActor() actor: Actor,
    @Param("id") grantId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.revoke(
      actor,
      parse(id, grantId),
      parse(keySchema, key),
      body,
    );
  }
}

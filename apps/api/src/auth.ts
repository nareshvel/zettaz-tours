import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, digest } from "./database";
import { Access, CurrentActor, parse } from "./http";
import type { Actor } from "../../../packages/shared/src/contracts";
import { hashPassword, verifyPassword } from "../scripts/sessions";
import { invitationAcceptSchema } from "../../../packages/shared/src/contracts";

const credentialsSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(1024),
    tenantId: z.string().uuid().optional(),
  })
  .strict();
const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(8).max(1024),
    newPassword: z.string().min(12).max(1024),
  })
  .strict();
const recoveryRequestSchema=z.object({email:z.string().email().max(254)}).strict();
const recoveryCompleteSchema=z.object({token:z.string().min(40).max(100),password:z.string().min(12).max(1024)}).strict();

function token() {
  return randomBytes(32).toString("base64url");
}
function bearer(authorization?: string) {
  const value = authorization?.match(/^Bearer ([a-zA-Z0-9_-]{40,100})$/)?.[1];
  if (!value) throw new UnauthorizedException();
  return value;
}

@Controller("auth/v1")
export class AuthController {
  constructor(private readonly db: Database) {}

  @Post("password-recovery/request")
  @Access("public")
  async requestPasswordRecovery(@Body() body:unknown){
    const input=parse(recoveryRequestSchema,body),value=token();
    const {rows}=await this.db.pool.query("SELECT begin_password_reset($1,$2) AS created",[input.email,digest(value)]);
    return {
      accepted:true,
      delivery:"held_provider",
      ...(rows[0]?.created&&process.env.EXPOSE_RECOVERY_TOKEN==="1"&&process.env.APP_MODE!=="production"?{token:value}:{}),
    };
  }

  @Post("password-recovery/complete")
  @Access("public")
  async completePasswordRecovery(@Body() body:unknown){
    const input=parse(recoveryCompleteSchema,body);
    const {rows}=await this.db.pool.query("SELECT complete_password_reset($1,$2) AS actor_id",[digest(input.token),await hashPassword(input.password)]);
    if(!rows[0]?.actor_id) throw new UnauthorizedException("Recovery token is invalid or expired.");
    return {ok:true};
  }

  @Post("sign-in")
  @Access("public")
  async signIn(@Body() body: unknown) {
    const input = parse(credentialsSchema, body);
    const identityHash = digest(input.email.trim().toLowerCase());
    const { rows: allowed } = await this.db.pool.query("SELECT login_attempt_allowed($1) AS allowed",[identityHash]);
    if (!allowed[0]?.allowed) throw new UnauthorizedException("Email or password is incorrect.");
    const {
      rows: [identity],
    } = await this.db.pool.query("SELECT * FROM staff_login_identity($1)", [
      input.email,
    ]);
    const valid = Boolean(identity) && await verifyPassword(input.password, identity?.password_hash ?? "");
    if (
      !identity ||
      !valid
    ) {
      await this.db.pool.query("SELECT record_login_attempt($1,false)",[identityHash]);
      throw new UnauthorizedException("Email or password is incorrect.");
    }
    const { rows: tenants } = await this.db.pool.query(
      "SELECT * FROM staff_login_tenants($1)",
      [identity.actor_id],
    );
    const selected = input.tenantId
      ? tenants.find((tenant) => tenant.tenant_id === input.tenantId)
      : tenants[0];
    if (!selected) {
      await this.db.pool.query("SELECT record_login_attempt($1,false)",[identityHash]);
      throw new UnauthorizedException("Email or password is incorrect.");
    }
    const value = token();
    const { rows: issued } = await this.db.pool.query(
      "SELECT issue_staff_session($1,$2,$3) AS issued",
      [identity.actor_id, selected.tenant_id, digest(value)],
    );
    if (!issued[0]?.issued) throw new UnauthorizedException();
    await this.db.pool.query("SELECT record_login_attempt($1,true)",[identityHash]);
    return { token: value, tenantId: selected.tenant_id, tenants };
  }

  @Post("invitations/accept")
  @Access("public")
  async acceptInvitation(@Body() body: unknown) {
    const input = parse(invitationAcceptSchema, body);
    const { rows: accepted } = await this.db.pool.query(
      "SELECT * FROM accept_staff_invitation($1,$2)",
      [digest(input.token), await hashPassword(input.password)],
    );
    const invitation = accepted[0];
    if (!invitation) throw new UnauthorizedException("Invitation is invalid or expired.");
    const value = token();
    const { rows: issued } = await this.db.pool.query(
      "SELECT issue_staff_session($1,$2,$3) AS issued",
      [invitation.actor_id, invitation.tenant_id, digest(value)],
    );
    if (!issued[0]?.issued) throw new UnauthorizedException();
    const { rows: tenants } = await this.db.pool.query(
      "SELECT * FROM staff_login_tenants($1)", [invitation.actor_id],
    );
    return { token: value, tenantId: invitation.tenant_id, tenants };
  }

  @Get("tenants")
  @Access("catalog.read")
  tenants(@CurrentActor() actor: Actor) {
    return this.db.pool
      .query("SELECT * FROM staff_login_tenants($1)", [actor.actorId])
      .then(({ rows }) => ({ tenants: rows }));
  }

  @Post("switch-tenant")
  @Access("catalog.read")
  async switchTenant(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const tenantId = parse(
      z.object({ tenantId: z.string().uuid() }).strict(),
      body,
    ).tenantId;
    const value = token();
    const { rows } = await this.db.pool.query(
      "SELECT issue_staff_session($1,$2,$3) AS issued",
      [actor.actorId, tenantId, digest(value)],
    );
    if (!rows[0]?.issued) throw new UnauthorizedException();
    return { token: value, tenantId };
  }

  @Post("sign-out")
  @Access("catalog.read")
  async signOut(@CurrentActor() actor: Actor, @Headers("authorization") authorization?: string) {
    const tokenHash=digest(bearer(authorization));
    await this.db.pool.query(actor.role==="support" ? "SELECT revoke_support_session($1)" : "SELECT revoke_staff_session($1)", [tokenHash]);
    return { ok: true };
  }

  @Post("sign-out-all")
  @Access("catalog.read")
  async signOutAll(@CurrentActor() actor: Actor) {
    const { rows } = await this.db.pool.query(
      "SELECT revoke_all_staff_sessions($1) AS revoked",
      [actor.actorId],
    );
    return { ok: true, revoked: rows[0]?.revoked ?? 0 };
  }

  @Post("change-password")
  @Access("catalog.read")
  async changePassword(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const input = parse(passwordChangeSchema, body);
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [credential],
      } = await tx.query(
        "SELECT password_hash FROM user_credentials WHERE user_id=$1 FOR UPDATE",
        [actor.actorId],
      );
      if (
        !credential?.password_hash ||
        !(await verifyPassword(input.currentPassword, credential.password_hash))
      )
        throw new UnauthorizedException("Current password is incorrect.");
      await tx.query(
        "UPDATE user_credentials SET password_hash=$2 WHERE user_id=$1",
        [actor.actorId, await hashPassword(input.newPassword)],
      );
      return { ok: true };
    });
  }
}

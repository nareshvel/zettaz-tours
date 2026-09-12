import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, digest } from "./database";
import { Access, CurrentActor, parse } from "./http";
import type { Actor } from "../../../packages/shared/src/contracts";
import { hashPassword, verifyPassword } from "../scripts/sessions";
import { sendPasswordRecovery, sendEmailVerification } from "./email";
import { TenantService } from "./tenant";
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
const recoveryRequestSchema = z
  .object({ email: z.string().email().max(254) })
  .strict();
const registerSchema = z
  .object({
    companyName: z.string().min(2).max(120),
    country: z.string().min(2).max(2),
    timezone: z.string().min(1).max(80),
    currency: z.string().min(3).max(3),
    planId: z.string().uuid().optional(),
    ownerName: z.string().min(2).max(120),
    email: z.string().email().max(254),
    password: z.string().min(12).max(1024),
  })
  .strict();
const recoveryCompleteSchema = z
  .object({
    token: z.string().min(40).max(100),
    password: z.string().min(12).max(1024),
  })
  .strict();

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
  constructor(private readonly db: Database, private readonly tenantSvc: TenantService) {}

  @Post("password-recovery/request")
  @Access("public")
  async requestPasswordRecovery(@Body() body: unknown) {
    const input = parse(recoveryRequestSchema, body),
      value = token();
    const { rows } = await this.db.pool.query(
      "SELECT begin_password_reset($1,$2) AS created",
      [input.email, digest(value)],
    );
    if (rows[0]?.created) {
      const resetUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/reset-password?token=${value}`;
      void sendPasswordRecovery({ to: input.email, resetUrl }).catch(() => {});
    }
    return {
      accepted: true,
      delivery: "email",
      ...(rows[0]?.created &&
      process.env.EXPOSE_RECOVERY_TOKEN === "1" &&
      process.env.APP_MODE !== "production"
        ? { token: value }
        : {}),
    };
  }

  @Post("password-recovery/complete")
  @Access("public")
  async completePasswordRecovery(@Body() body: unknown) {
    const input = parse(recoveryCompleteSchema, body);
    const { rows } = await this.db.pool.query(
      "SELECT complete_password_reset($1,$2) AS actor_id",
      [digest(input.token), await hashPassword(input.password)],
    );
    if (!rows[0]?.actor_id)
      throw new UnauthorizedException("Recovery token is invalid or expired.");
    return { ok: true };
  }

  @Post("sign-in")
  @Access("public")
  async signIn(@Body() body: unknown) {
    const input = parse(credentialsSchema, body);
    const identityHash = digest(input.email.trim().toLowerCase());
    const { rows: allowed } = await this.db.pool.query(
      "SELECT login_attempt_allowed($1) AS allowed",
      [identityHash],
    );
    if (!allowed[0]?.allowed)
      throw new UnauthorizedException("Email or password is incorrect.");
    const {
      rows: [identity],
    } = await this.db.pool.query("SELECT * FROM staff_login_identity($1)", [
      input.email,
    ]);
    const valid =
      Boolean(identity) &&
      (await verifyPassword(input.password, identity?.password_hash ?? ""));
    if (!identity || !valid) {
      await this.db.pool.query("SELECT record_login_attempt($1,false)", [
        identityHash,
      ]);
      throw new UnauthorizedException("Email or password is incorrect.");
    }
    // Block sign-in if e-mail not yet verified
    const { rows: verifiedRows } = await this.db.pool.query(
      "SELECT email_verified_at FROM staff_users WHERE id=$1",
      [identity.actor_id],
    );
    if (!verifiedRows[0]?.email_verified_at) {
      throw new UnauthorizedException(
        "Please verify your email address before signing in. Check your inbox for a verification link.",
      );
    }
    const { rows: tenants } = await this.db.pool.query(
      "SELECT * FROM staff_login_tenants($1)",
      [identity.actor_id],
    );
    const selected = input.tenantId
      ? tenants.find((tenant) => tenant.tenant_id === input.tenantId)
      : tenants[0];
    if (!selected) {
      await this.db.pool.query("SELECT record_login_attempt($1,false)", [
        identityHash,
      ]);
      throw new UnauthorizedException("Email or password is incorrect.");
    }
    const value = token();
    const { rows: issued } = await this.db.pool.query(
      "SELECT issue_staff_session($1,$2,$3) AS issued",
      [identity.actor_id, selected.tenant_id, digest(value)],
    );
    if (!issued[0]?.issued) throw new UnauthorizedException();
    await this.db.pool.query("SELECT record_login_attempt($1,true)", [
      identityHash,
    ]);
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
    if (!invitation)
      throw new UnauthorizedException("Invitation is invalid or expired.");
    const value = token();
    const { rows: issued } = await this.db.pool.query(
      "SELECT issue_staff_session($1,$2,$3) AS issued",
      [invitation.actor_id, invitation.tenant_id, digest(value)],
    );
    if (!issued[0]?.issued) throw new UnauthorizedException();
    const { rows: tenants } = await this.db.pool.query(
      "SELECT * FROM staff_login_tenants($1)",
      [invitation.actor_id],
    );
    return { token: value, tenantId: invitation.tenant_id, tenants };
  }

  @Get("tenants")
  @Access("authenticated")
  tenants(@CurrentActor() actor: Actor) {
    return this.db.pool
      .query("SELECT * FROM staff_login_tenants($1)", [actor.actorId])
      .then(({ rows }) => ({ tenants: rows }));
  }

  @Post("switch-tenant")
  @Access("authenticated")
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
  @Access("authenticated")
  async signOut(
    @CurrentActor() actor: Actor,
    @Headers("authorization") authorization?: string,
  ) {
    const tokenHash = digest(bearer(authorization));
    await this.db.pool.query(
      actor.role === "support"
        ? "SELECT revoke_support_session($1)"
        : "SELECT revoke_staff_session($1)",
      [tokenHash],
    );
    return { ok: true };
  }

  @Post("sign-out-all")
  @Access("authenticated")
  async signOutAll(@CurrentActor() actor: Actor) {
    const { rows } = await this.db.pool.query(
      "SELECT revoke_all_staff_sessions($1) AS revoked",
      [actor.actorId],
    );
    return { ok: true, revoked: rows[0]?.revoked ?? 0 };
  }

  @Post("change-password")
  @Access("authenticated")
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

  @Post("register")
  @Access("public")
  async register(@Body() body: unknown) {
    const input = registerSchema.parse(body);
    const { rows: existing } = await this.db.pool.query(
      "SELECT 1 FROM staff_users WHERE lower(email)=lower($1) LIMIT 1",
      [input.email],
    );
    if (existing.length > 0)
      throw new ConflictException("An account with that email address already exists.");
    const slug = input.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) + "-" + Date.now().toString(36);
    const defaultConfig = {
      supportedLocales: ["en"],
      locale: "en",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "12h",
      weekStartsOn: 1,
      numberFormat: "comma_decimal",
      measurementSystem: "metric",
      bookingCurrency: input.currency,
      collectionCurrency: input.currency,
      reportingCurrency: input.currency,
      holdSeconds: 1800,
      minimumPaidPercent: 100,
      taxBasisPoints: 0,
      allowUnresolvedPickup: false,
      allowAmendmentBalance: true,
      manualPaymentMethods: ["cash", "card", "online", "bank_transfer"],
      bookingSources: ["phone", "walk_in", "website", "partner_reseller"],
      documentStorage: { hotProvider: "filesystem", archiveProvider: "none", hotRetentionDays: 7 },
    };
    const platformActor = {
      actorId: "00000000-0000-0000-0000-000000000000",
      tenantId: null,
      platform: true,
      role: "platform",
      permissions: ["tenant.provision"] as string[],
    };
    const { tenantId, ownerId } = await this.tenantSvc.create(platformActor, {
      slug,
      name: input.companyName,
      timezone: input.timezone,
      config: defaultConfig,
      ownerName: input.ownerName,
      ownerEmail: input.email,
      country: input.country,
    });
    // Store password (SECURITY DEFINER bypasses RLS on user_credentials)
    const passwordHash = await hashPassword(input.password);
    await this.db.pool.query("SELECT upsert_user_credentials($1,$2)", [ownerId, passwordHash]);
    // Create trial subscription (Growth plan by default; SECURITY DEFINER bypasses RLS)
    const planId = input.planId ?? "3e595412-81e5-4c76-8216-25321d7ba56a";
    await this.db.pool.query("SELECT create_trial_subscription($1,$2)", [tenantId, planId]);
    // Generate e-mail verification token (24 h TTL)
    const verifValue = token();
    const verifHash = digest(verifValue);
    const verifExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await this.db.pool.query(
      "SELECT set_email_verification_token($1,$2,$3)",
      [ownerId, verifHash, verifExpiry],
    );
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const verifyUrl = `${frontendUrl}/verify-email?token=${verifValue}`;
    void sendEmailVerification({ to: input.email, name: input.ownerName, verifyUrl }).catch(
      (err) => {
        console.error("[Auth] Verification email failed:", err instanceof Error ? err.message : err);
        console.error("[Auth] Manual verify URL (dev/ops only):", verifyUrl);
      },
    );
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("[Auth] SMTP not configured — verification email was not delivered.");
      console.warn("[Auth] Manual verify URL:", verifyUrl);
    }
    return { pending: "email_verification" };
  }

  @Get("verify-email")
  @Access("public")
  async verifyEmail(@Query("token") rawToken: string) {
    if (!rawToken || rawToken.length < 40)
      throw new UnauthorizedException("Verification link is invalid or expired.");
    const tokenHash = digest(rawToken);
    const { rows } = await this.db.pool.query(
      "SELECT consume_email_verification($1) AS user_id",
      [tokenHash],
    );
    const userId: string | null = rows[0]?.user_id ?? null;
    if (!userId) throw new UnauthorizedException("Verification link is invalid or expired.");
    const { rows: tenants } = await this.db.pool.query(
      "SELECT * FROM staff_login_tenants($1)",
      [userId],
    );
    if (!tenants.length) throw new UnauthorizedException("No workspace found for this account.");
    const tenantId = tenants[0].tenant_id;
    const value = token();
    await this.db.pool.query(
      "SELECT issue_staff_session($1,$2,$3) AS issued",
      [userId, tenantId, digest(value)],
    );
    return { token: value, tenantId };
  }

}

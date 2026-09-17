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
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  Actor,
  authorizedContactSchema,
  businessProfileSchema,
  grants,
  id,
  invitationSchema,
  memberSchema,
  memberUpdateSchema,
  roles as systemRoles,
  roleSchema,
  staffCreateSchema,
  staffUpdateSchema,
  tenantSchema,
  TenantConfig,
  updateConfigSchema,
} from "../../../packages/shared/src/contracts";
import { Database, digest, record, Tx } from "./database";
import { sendStaffAccessInvite, smtpConfigured } from "./email";
import { LimitsService } from "./limits";
import { Access, CurrentActor, keySchema, parse } from "./http";
type UploadedLogo = {
  mimetype: string;
  size: number;
  buffer: Buffer;
  originalname: string;
};

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
    logo_path: string | null;
    business_profile: unknown;
    authorized_contact: unknown;
  };
}
@Injectable()
export class TenantService {
  constructor(private readonly db: Database) {}
  async create(actor: Actor, input: unknown) {
    const data = parse(tenantSchema, input);
    return this.db.transaction(actor, async (tx) => {
      // Email uniqueness check inside the platform-mode transaction so RLS
      // does not hide existing rows (bare pool.query has no app.platform set).
      const { rows: existing } = await tx.query(
        "SELECT 1 FROM staff_users WHERE lower(email)=lower($1) LIMIT 1",
        [data.ownerEmail],
      );
      if (existing.length > 0)
        throw new ConflictException(
          "An account with that email address already exists.",
        );

      const tenantId = randomUUID(),
        ownerId = randomUUID();
      await tx.query(
        `INSERT INTO tenants(id,slug,name,timezone,config,base_currency,booking_currency,expense_currency,reporting_currency,business_profile,authorized_contact,is_mock) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          tenantId,
          data.slug,
          data.name,
          data.timezone,
          data.config,
          data.config?.reportingCurrency ?? "XCD",
          data.config?.bookingCurrency ?? "USD",
          data.config?.collectionCurrency ?? "XCD",
          data.config?.reportingCurrency ?? "XCD",
          {
            displayName: data.name,
            streetAddress: "",
            suite: "",
            city: "",
            stateParish: "",
            postalCode: "",
            country: data.country.toUpperCase(),
            email: data.ownerEmail,
            phone: data.ownerPhone,
          },
          {
            name: data.ownerName,
            email: data.ownerEmail,
            phone: data.ownerPhone,
          },
          false,
        ],
      );
      await tx.query(`SELECT set_config('app.tenant',$1,true)`, [tenantId]);
      const roleNames: Record<(typeof systemRoles)[number], string> = {
        owner: "Owner",
        admin: "Administrator",
        reservations: "Reservations",
        dispatcher: "Dispatcher",
        finance: "Finance",
        auditor: "Auditor",
        guide: "Guide",
        driver: "Driver / skipper",
        crew: "Crew",
        captain: "Captain",
        resource_manager: "Resource manager",
        operations_manager: "Operations manager",
        partner_manager: "Partner manager",
      };
      let ownerRoleId = "";
      for (const code of systemRoles) {
        const {
          rows: [role],
        } = await tx.query(
          "INSERT INTO tenant_roles(tenant_id,code,name,is_system) VALUES($1,$2,$3,true) RETURNING id",
          [tenantId, code, roleNames[code]],
        );
        await tx.query(
          "INSERT INTO role_permissions(tenant_id,role_id,permission_code) SELECT $1,$2,unnest($3::text[])",
          [tenantId, role.id, grants[code]],
        );
        if (code === "owner") ownerRoleId = role.id;
      }
      await tx.query(
        `INSERT INTO staff_users(id,name,email,phone_number) VALUES($1,$2,$3,$4)`,
        [ownerId, data.ownerName, data.ownerEmail, data.ownerPhone],
      );
      await tx.query(
        `INSERT INTO memberships(tenant_id,actor_id,role,role_id,permissions) VALUES($1,$2,'owner',$3,$4)`,
        [tenantId, ownerId, ownerRoleId, grants.owner],
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
      // Create trial subscription inside the same transaction so the whole
      // signup is atomic — if this fails, tenant + owner are rolled back too.
      if (data.planId) {
        await tx.query("SELECT create_trial_subscription($1,$2)", [
          tenantId,
          data.planId,
        ]);
      }

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
        `UPDATE tenants SET
           config=$2,
           base_currency=$3,
           booking_currency=$4,
           expense_currency=$5,
           reporting_currency=$6,
           version=version+1
         WHERE id=$1`,
        [
          actor.tenantId,
          data.config,
          data.config.reportingCurrency,
          data.config.bookingCurrency,
          data.config.collectionCurrency,
          data.config.reportingCurrency,
        ],
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
  profile(actor: Actor, key: string, input: unknown) {
    const raw = input as {
      businessProfile: unknown;
      authorizedContact: unknown;
    };
    const businessProfile = parse(businessProfileSchema, raw.businessProfile);
    const authorizedContact = parse(
      authorizedContactSchema,
      raw.authorizedContact,
    );
    return this.db.command(
      actor,
      "tenant.profile.update",
      key,
      { businessProfile, authorizedContact },
      async (tx) => {
        const before = await tenant(tx, actor, true);
        await tx.query(
          "UPDATE tenants SET business_profile=$2,authorized_contact=$3,version=version+1 WHERE id=$1",
          [actor.tenantId, businessProfile, authorizedContact],
        );
        await record(
          tx,
          actor,
          "tenant.profile_updated",
          before.id,
          {
            businessProfile: before.business_profile,
            authorizedContact: before.authorized_contact,
          },
          { businessProfile, authorizedContact },
        );
        return {
          businessProfile,
          authorizedContact,
          version: before.version + 1,
        };
      },
    );
  }
  async logo(actor: Actor, key: string, file?: UploadedLogo) {
    if (!file) throw new BadRequestException("Logo file is required");
    const types: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };
    const ext = types[file.mimetype];
    if (!ext || file.size > 2 * 1024 * 1024)
      throw new BadRequestException(
        "Use a JPG, PNG, WebP or SVG logo under 2 MB",
      );
    if (
      ext === "svg" &&
      /<script|onload=|onerror=|javascript:/i.test(file.buffer.toString("utf8"))
    )
      throw new BadRequestException("SVG contains disallowed content");
    return this.db.command(
      actor,
      "tenant.logo.upload",
      key,
      { name: file.originalname, size: file.size, type: file.mimetype },
      async (tx) => {
        const before = await tenant(tx, actor, true);
        const tenantId = actor.tenantId!;
        const dir = path.resolve("uploads", "tenant-logos", tenantId);
        await mkdir(dir, { recursive: true });
        const filename = `${randomUUID()}.${ext}`,
          relative = `/uploads/tenant-logos/${tenantId}/${filename}`;
        await writeFile(path.join(dir, filename), file.buffer);
        await tx.query(
          "UPDATE tenants SET logo_path=$2,version=version+1 WHERE id=$1",
          [tenantId, relative],
        );
        if (before.logo_path)
          await rm(path.resolve("." + before.logo_path), { force: true });
        await record(
          tx,
          actor,
          "tenant.logo_updated",
          tenantId,
          { logoPath: before.logo_path },
          { logoPath: relative },
        );
        return { logoPath: relative };
      },
    );
  }
  async createStaff(actor: Actor, key: string, input: unknown) {
    const data = parse(staffCreateSchema, input);
    const displayName = [data.firstName, data.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return this.db.command(actor, "staff.create", key, data, async (tx) => {
      const settings = await tenant(tx, actor);
      const countryDefault =
        (settings.business_profile as { country?: string } | null)?.country ||
        "";
      const address = {
        ...data.address,
        country: data.address.country || countryDefault,
      };
      const { rows: roles } = await tx.query(
        "SELECT id,code,name FROM tenant_roles WHERE tenant_id=$1 AND code=$2",
        [actor.tenantId, data.role],
      );
      if (!roles[0])
        throw new BadRequestException("Selected role is unavailable");
      const email = data.email.toLowerCase();
      const { rows: existingMembers } = await tx.query(
        `SELECT 1 FROM memberships m JOIN staff_users s ON s.id=m.actor_id
         WHERE m.tenant_id=$1 AND lower(s.email)=$2`,
        [actor.tenantId, email],
      );
      if (existingMembers[0])
        throw new ConflictException("That email already has tenant access");
      let {
        rows: [user],
      } = await tx.query(
        "SELECT id,name FROM staff_users WHERE lower(email)=$1 FOR UPDATE",
        [email],
      );
      let actorId: string;
      if (user) {
        actorId = user.id;
        await tx.query(
          `UPDATE staff_users
           SET name=$2, first_name=$3, last_name=$4, phone_number=$5, address=$6
           WHERE id=$1`,
          [
            actorId,
            displayName,
            data.firstName,
            data.lastName,
            data.phone,
            address,
          ],
        );
      } else {
        actorId = randomUUID();
        await tx.query(
          `INSERT INTO staff_users(id,name,email,phone_number,first_name,last_name,address,is_active)
           VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
          [
            actorId,
            displayName,
            email,
            data.phone,
            data.firstName,
            data.lastName,
            address,
          ],
        );
        await tx.query(
          "INSERT INTO user_credentials(user_id) VALUES($1) ON CONFLICT DO NOTHING",
          [actorId],
        );
      }
      const { rows: permissions } = await tx.query(
        "SELECT COALESCE(array_agg(permission_code ORDER BY permission_code),'{}') AS codes FROM role_permissions WHERE tenant_id=$1 AND role_id=$2",
        [actor.tenantId, roles[0].id],
      );
      await tx.query(
        `INSERT INTO memberships(tenant_id,actor_id,role,role_id,permissions,active)
         VALUES($1,$2,$3,$4,$5,false)`,
        [actor.tenantId, actorId, data.role, roles[0].id, permissions[0].codes],
      );
      await tx.query(
        `INSERT INTO crew_profiles(tenant_id,membership_actor_id,operational_name,notes,active)
         VALUES($1,$2,$3,'',true)
         ON CONFLICT (tenant_id, membership_actor_id) DO UPDATE
           SET operational_name=EXCLUDED.operational_name, active=true`,
        [actor.tenantId, actorId, displayName],
      );
      await record(tx, actor, "staff.created", actorId, null, {
        role: data.role,
        email,
        active: false,
      });
      return { actorId, role: data.role, email, active: false };
    });
  }

  async updateStaff(
    actor: Actor,
    actorId: string,
    key: string,
    input: unknown,
  ) {
    const data = parse(staffUpdateSchema, input);
    const displayName = [data.firstName, data.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return this.db.command(
      actor,
      `staff.update:${actorId}`,
      key,
      data,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          `SELECT m.role,m.active,s.name,s.email,s.phone_number,s.first_name,s.last_name,s.address
           FROM memberships m JOIN staff_users s ON s.id=m.actor_id
           WHERE m.tenant_id=$1 AND m.actor_id=$2
           FOR UPDATE`,
          [actor.tenantId, actorId],
        );
        if (!before) throw new NotFoundException();
        if (before.role === "owner" && data.role && data.role !== "owner")
          throw new BadRequestException(
            "Ownership changes require a separate workflow",
          );
        if (before.role === "owner" && data.active === false)
          throw new BadRequestException(
            "The owner membership cannot be revoked",
          );
        await tx.query(
          `UPDATE staff_users
           SET name=$2, first_name=$3, last_name=$4, phone_number=$5, address=$6
           WHERE id=$1`,
          [
            actorId,
            displayName,
            data.firstName,
            data.lastName,
            data.phone,
            data.address,
          ],
        );
        if (before.role !== "owner") {
          const nextRole = data.role ?? before.role;
          const nextActive =
            data.active === undefined ? before.active : data.active;
          const { rows: roles } = await tx.query(
            "SELECT id FROM tenant_roles WHERE tenant_id=$1 AND code=$2",
            [actor.tenantId, nextRole],
          );
          if (!roles[0])
            throw new BadRequestException("Selected role is unavailable");
          const { rows: permissions } = await tx.query(
            "SELECT COALESCE(array_agg(permission_code ORDER BY permission_code),'{}') AS codes FROM role_permissions WHERE tenant_id=$1 AND role_id=$2",
            [actor.tenantId, roles[0].id],
          );
          await tx.query(
            `UPDATE memberships SET role=$3,role_id=$4,permissions=$5,active=$6
             WHERE tenant_id=$1 AND actor_id=$2`,
            [
              actor.tenantId,
              actorId,
              nextRole,
              roles[0].id,
              permissions[0].codes,
              nextActive,
            ],
          );
          if (!nextActive)
            await tx.query("SELECT revoke_staff_membership_sessions($1,$2)", [
              actorId,
              actor.tenantId,
            ]);
        }
        await tx.query(
          `INSERT INTO crew_profiles(tenant_id,membership_actor_id,operational_name,notes,active)
           VALUES($1,$2,$3,'',true)
           ON CONFLICT (tenant_id, membership_actor_id) DO UPDATE
             SET operational_name=EXCLUDED.operational_name`,
          [actor.tenantId, actorId, displayName],
        );
        await record(tx, actor, "staff.updated", actorId, before, {
          ...data,
          name: displayName,
        });
        return { actorId, name: displayName };
      },
    );
  }

  async grantAccess(actor: Actor, actorId: string, key: string) {
    return this.db
      .command(
        actor,
        `staff.grant_access:${actorId}`,
        key,
        { actorId },
        async (tx) => {
          const {
            rows: [member],
          } = await tx.query(
            `SELECT m.role,m.active,m.role_id,s.name,s.email,r.name AS role_name,t.name AS tenant_name
           FROM memberships m
           JOIN staff_users s ON s.id=m.actor_id
           JOIN tenant_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_id
           JOIN tenants t ON t.id=m.tenant_id
           WHERE m.tenant_id=$1 AND m.actor_id=$2`,
            [actor.tenantId, actorId],
          );
          if (!member) throw new NotFoundException();
          if (member.role === "owner")
            throw new BadRequestException(
              "Owner access is managed through ownership transfer",
            );
          await tx.query(
            `UPDATE tenant_invitations
           SET revoked_at=clock_timestamp()
           WHERE tenant_id=$1 AND lower(email)=lower($2)
             AND accepted_at IS NULL AND revoked_at IS NULL`,
            [actor.tenantId, member.email],
          );
          const value =
            randomUUID().replaceAll("-", "") +
            randomUUID().replaceAll("-", "").slice(0, 11);
          const { rows: created } = await tx.query(
            `INSERT INTO tenant_invitations(tenant_id,name,email,role,role_id,token_hash,expires_at,invited_by)
           VALUES($1,$2,lower($3),$4,$5,$6,clock_timestamp()+interval '7 days',$7)
           RETURNING id,expires_at`,
            [
              actor.tenantId,
              member.name,
              member.email,
              member.role,
              member.role_id,
              digest(value),
              actor.actorId,
            ],
          );
          await record(tx, actor, "staff.access_granted", actorId, null, {
            invitationId: created[0].id,
            email: member.email,
            expiresAt: created[0].expires_at,
          });
          return {
            actorId,
            invitationId: created[0].id,
            expiresAt: created[0].expires_at,
            token: value,
            email: member.email as string,
            name: member.name as string,
            roleName: member.role_name as string,
            tenantName: member.tenant_name as string,
          };
        },
      )
      .then(async (created) => {
        let emailed = false;
        if (smtpConfigured()) {
          const base =
            process.env.APP_PUBLIC_URL?.replace(/\/$/, "") ||
            "http://127.0.0.1:3191";
          try {
            await sendStaffAccessInvite({
              to: created.email,
              name: created.name,
              tenantName: created.tenantName,
              roleName: created.roleName,
              activateUrl: `${base}/activate`,
              token: created.token,
            });
            emailed = true;
          } catch {
            emailed = false;
          }
        }
        return {
          actorId: created.actorId,
          invitationId: created.invitationId,
          expiresAt: created.expiresAt,
          token: created.token,
          emailed,
        };
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
      let { rows: roles } = await tx.query(
        "SELECT id,code FROM tenant_roles WHERE tenant_id=$1 AND code=$2",
        [actor.tenantId, data.role],
      );
      if (!roles[0]) {
        const defaultPermissions = grants[data.role as keyof typeof grants];
        if (!defaultPermissions)
          throw new BadRequestException("Selected role is unavailable");
        const created = await tx.query(
          "INSERT INTO tenant_roles(tenant_id,code,name,is_system) VALUES($1,$2,$3,true) RETURNING id,code",
          [actor.tenantId, data.role, data.role.replaceAll("_", " ")],
        );
        roles = created.rows;
        await tx.query(
          "INSERT INTO role_permissions(tenant_id,role_id,permission_code) SELECT $1,$2,unnest($3::text[])",
          [actor.tenantId, roles[0].id, defaultPermissions],
        );
      }
      const { rows: permissions } = await tx.query(
        "SELECT COALESCE(array_agg(permission_code ORDER BY permission_code),'{}') AS codes FROM role_permissions WHERE tenant_id=$1 AND role_id=$2",
        [actor.tenantId, roles[0].id],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,actor_id,role,role_id,permissions) VALUES($1,$2,$3,$4,$5)",
        [actor.tenantId, actorId, data.role, roles[0].id, permissions[0].codes],
      );
      await tx.query(
        `INSERT INTO crew_profiles(tenant_id,membership_actor_id,operational_name,notes,active)
         VALUES($1,$2,$3,'',true)
         ON CONFLICT (tenant_id, membership_actor_id) DO NOTHING`,
        [actor.tenantId, actorId, data.name],
      );
      await record(tx, actor, "member.created", actorId, null, {
        role: data.role,
        active: true,
      });
      return { actorId, role: data.role };
    });
  }
  async invite(actor: Actor, key: string, input: unknown) {
    const data = parse(invitationSchema, input);
    return this.db.command(actor, "member.invite", key, data, async (tx) => {
      const { rows: roles } = await tx.query(
        "SELECT id,code FROM tenant_roles WHERE tenant_id=$1 AND code=$2",
        [actor.tenantId, data.role],
      );
      if (!roles[0])
        throw new BadRequestException("Selected role is unavailable");
      const { rows: exists } = await tx.query(
        `SELECT 1 FROM memberships m JOIN staff_users s ON s.id=m.actor_id
         WHERE m.tenant_id=$1 AND lower(s.email)=lower($2)`,
        [actor.tenantId, data.email],
      );
      if (exists[0])
        throw new ConflictException("That email already has tenant access");
      const value =
        randomUUID().replaceAll("-", "") +
        randomUUID().replaceAll("-", "").slice(0, 11);
      const { rows: created } = await tx.query(
        `INSERT INTO tenant_invitations(tenant_id,name,email,role,role_id,token_hash,expires_at,invited_by)
         VALUES($1,$2,lower($3),$4,$5,$6,clock_timestamp()+interval '7 days',$7)
         RETURNING id,expires_at`,
        [
          actor.tenantId,
          data.name,
          data.email,
          data.role,
          roles[0].id,
          digest(value),
          actor.actorId,
        ],
      );
      await record(tx, actor, "member.invited", created[0].id, null, {
        email: data.email,
        role: data.role,
        expiresAt: created[0].expires_at,
      });
      // Delivery belongs to the future transactional-email adapter. Return once so an
      // authorized administrator can deliver it through an approved channel.
      return {
        invitationId: created[0].id,
        expiresAt: created[0].expires_at,
        token: value,
      };
    });
  }
  async role(actor: Actor, key: string, input: unknown) {
    const data = parse(roleSchema, input);
    return this.db.command(actor, "role.create", key, data, async (tx) => {
      const allowed = await tx.query(
        "SELECT code FROM permissions WHERE code = ANY($1)",
        [data.permissions],
      );
      if (allowed.rowCount !== data.permissions.length)
        throw new BadRequestException("One or more permissions are unknown");
      const code = `custom_${randomUUID().replaceAll("-", "")}`;
      const { rows: created } = await tx.query(
        "INSERT INTO tenant_roles(tenant_id,code,name) VALUES($1,$2,$3) RETURNING id,code,name",
        [actor.tenantId, code, data.name],
      );
      await tx.query(
        "INSERT INTO role_permissions(tenant_id,role_id,permission_code) SELECT $1,$2,unnest($3::text[])",
        [actor.tenantId, created[0].id, data.permissions],
      );
      await record(tx, actor, "role.created", created[0].id, null, data);
      return created[0];
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
        const { rows: roles } = await tx.query(
          "SELECT id FROM tenant_roles WHERE tenant_id=$1 AND code=$2",
          [actor.tenantId, data.role],
        );
        if (!roles[0])
          throw new BadRequestException("Selected role is unavailable");
        const { rows: permissions } = await tx.query(
          "SELECT COALESCE(array_agg(permission_code ORDER BY permission_code),'{}') AS codes FROM role_permissions WHERE tenant_id=$1 AND role_id=$2",
          [actor.tenantId, roles[0].id],
        );
        await tx.query(
          "UPDATE memberships SET role=$3,role_id=$4,permissions=$5,active=$6 WHERE tenant_id=$1 AND actor_id=$2",
          [
            actor.tenantId,
            actorId,
            data.role,
            roles[0].id,
            permissions[0].codes,
            data.active,
          ],
        );
        if (!data.active)
          await tx.query("SELECT revoke_staff_membership_sessions($1,$2)", [
            actorId,
            actor.tenantId,
          ]);
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
    private readonly limits: LimitsService,
  ) {}
  @Get("tenant")
  @Access("catalog.read")
  get(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, (tx) => tenant(tx, actor));
  }
  /**
   * What is still missing before this tenant can actually take and run a
   * booking.
   *
   * One query rather than six client fetches, because the settings sidebar
   * shows this on every visit. Each flag is a hard operational blocker, not
   * advice: without a product there is nothing to sell, without an upcoming
   * departure nothing to sell it on, without a pickup location staff cannot
   * record where to collect a guest, without a published waiver no signature
   * can be captured, and without a logo every printed manifest and receipt
   * goes out unbranded.
   */
  @Get("tenant/readiness")
  @Access("catalog.read")
  readiness(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [r],
      } = await tx.query(
        `SELECT
          (SELECT COUNT(*)::int FROM products
            WHERE tenant_id=$1 AND status='active') AS products,
          (SELECT COUNT(*)::int FROM departures
            WHERE tenant_id=$1 AND starts_at>clock_timestamp()) AS upcoming_departures,
          (SELECT COUNT(*)::int FROM pickup_locations WHERE tenant_id=$1 AND active) AS pickup_locations,
          (SELECT COUNT(*)::int FROM waiver_templates WHERE tenant_id=$1 AND active) AS waiver_templates,
          (SELECT COUNT(*)::int FROM memberships WHERE tenant_id=$1) AS members,
          (SELECT logo_path IS NOT NULL AND logo_path<>'' FROM tenants WHERE id=$1) AS has_logo`,
        [actor.tenantId],
      );
      return {
        products: r.products > 0,
        departures: r.upcoming_departures > 0,
        pickupLocations: r.pickup_locations > 0,
        waiver: r.waiver_templates > 0,
        team: r.members > 1,
        logo: Boolean(r.has_logo),
      };
    });
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
  @Patch("tenant/profile")
  @Access("config.write")
  profile(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.profile(actor, parse(keySchema, key), body);
  }
  @Post("tenant/logo")
  @Access("config.write")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  logo(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @UploadedFile() file?: UploadedLogo,
  ) {
    return this.service.logo(actor, parse(keySchema, key), file);
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
  @Post("staff")
  @Access("members.write")
  async createStaff(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    await this.limits.enforce(actor, "staff");
    return this.service.createStaff(actor, parse(keySchema, key), body);
  }
  @Patch("staff/:id")
  @Access("members.write")
  updateStaff(
    @CurrentActor() actor: Actor,
    @Param("id") actorId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateStaff(
      actor,
      parse(id, actorId),
      parse(keySchema, key),
      body,
    );
  }
  @Post("staff/:id/grant-access")
  @Access("members.write")
  grantAccess(
    @CurrentActor() actor: Actor,
    @Param("id") actorId: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.grantAccess(
      actor,
      parse(id, actorId),
      parse(keySchema, key),
    );
  }
  @Post("roles")
  @Access("members.write")
  role(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.role(actor, parse(keySchema, key), body);
  }
  @Get("invitations")
  @Access("members.write")
  invitations(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id,name,email,role,expires_at,accepted_at,revoked_at,created_at
         FROM tenant_invitations WHERE tenant_id=$1 ORDER BY created_at DESC`,
        [actor.tenantId],
      );
      return { invitations: rows };
    });
  }
  @Post("invitations")
  @Access("members.write")
  async invite(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    await this.limits.enforce(actor, "staff");
    return this.service.invite(actor, parse(keySchema, key), body);
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

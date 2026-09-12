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
  tenantSchema,
  TenantConfig,
  updateConfigSchema,
} from "../../../packages/shared/src/contracts";
import { Database, digest, record, Tx } from "./database";
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
      const tenantId = randomUUID(),
        ownerId = randomUUID();
      await tx.query(
        `INSERT INTO tenants(id,slug,name,timezone,config,business_profile,authorized_contact,is_mock) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          tenantId,
          data.slug,
          data.name,
          data.timezone,
          data.config,
          {
            displayName: data.name,
            streetAddress: "",
            suite: "",
            city: "",
            stateParish: "",
            postalCode: "",
            country: data.country.toUpperCase(),
            email: data.ownerEmail,
            phone: "",
          },
          { name: data.ownerName, email: data.ownerEmail, phone: "" },
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
      await tx.query(`INSERT INTO staff_users VALUES($1,$2,$3)`, [
        ownerId,
        data.ownerName,
        data.ownerEmail,
      ]);
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

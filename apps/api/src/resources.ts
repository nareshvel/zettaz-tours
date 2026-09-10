import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const resourceSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{1,49}$/),
    name: z.string().trim().min(1).max(120),
    type: z.string().trim().min(1).max(50),
    capacity: z.number().int().positive().max(100000).nullable().default(null),
    notes: z.string().trim().max(1000).default(""),
  })
  .strict();
const crewSchema = z
  .object({
    actorId: z.string().uuid(),
    operationalName: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).default(""),
  })
  .strict();
const documentSchema = z
  .object({
    resourceId: z.string().uuid().optional(),
    crewActorId: z.string().uuid().optional(),
    documentType: z.string().trim().min(1).max(80),
    expiresOn: z.string().date(),
    evidencePath: z.string().trim().max(500).default(""),
    notes: z.string().trim().max(1000).default(""),
  })
  .refine(
    (value) => Boolean(value.resourceId) !== Boolean(value.crewActorId),
    "Select exactly one resource or crew member",
  )
  .strict();
const assignmentSchema = z
  .object({
    departureId: z.string().uuid(),
    resourceId: z.string().uuid().optional(),
    crewActorId: z.string().uuid().optional(),
    assignmentRole: z.string().trim().min(1).max(80),
    overrideReason: z.string().trim().min(8).max(1000).optional(),
  })
  .refine(
    (value) => Boolean(value.resourceId) !== Boolean(value.crewActorId),
    "Select exactly one resource or crew member",
  )
  .strict();

@Injectable()
export class ResourceService {
  constructor(private readonly db: Database) {}
  listResources(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,code,name,type,capacity,notes,active FROM operational_resources WHERE tenant_id=$1 ORDER BY active DESC,name,id",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  listCrew(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT c.membership_actor_id AS actor_id,c.operational_name,c.notes,c.active,s.name,s.email FROM crew_profiles c JOIN staff_users s ON s.id=c.membership_actor_id WHERE c.tenant_id=$1 ORDER BY c.active DESC,c.operational_name",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  documents(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,resource_id,crew_actor_id,document_type,expires_on,evidence_path,notes FROM compliance_documents WHERE tenant_id=$1 ORDER BY expires_on,id",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  createResource(actor: Actor, key: string, raw: unknown) {
    const input = parse(resourceSchema, raw);
    return this.db.command(actor, "resource.create", key, input, async (tx) => {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO operational_resources(tenant_id,id,code,name,type,capacity,notes) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          actor.tenantId,
          id,
          input.code,
          input.name,
          input.type,
          input.capacity,
          input.notes,
        ],
      );
      await record(tx, actor, "resource.created", id, null, input);
      return { id, ...input, active: true };
    });
  }
  createCrew(actor: Actor, key: string, raw: unknown) {
    const input = parse(crewSchema, raw);
    return this.db.command(
      actor,
      "crew_profile.create",
      key,
      input,
      async (tx) => {
        const member = await tx.query(
          "SELECT active FROM memberships WHERE tenant_id=$1 AND actor_id=$2",
          [actor.tenantId, input.actorId],
        );
        if (!member.rows[0]?.active)
          throw new BadRequestException("Active tenant member required");
        await tx.query(
          "INSERT INTO crew_profiles(tenant_id,membership_actor_id,operational_name,notes) VALUES($1,$2,$3,$4)",
          [actor.tenantId, input.actorId, input.operationalName, input.notes],
        );
        await record(
          tx,
          actor,
          "crew_profile.created",
          input.actorId,
          null,
          input,
        );
        return { ...input, active: true };
      },
    );
  }
  createDocument(actor: Actor, key: string, raw: unknown) {
    const input = parse(documentSchema, raw);
    return this.db.command(
      actor,
      "compliance_document.create",
      key,
      input,
      async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO compliance_documents(tenant_id,id,resource_id,crew_actor_id,document_type,expires_on,evidence_path,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            actor.tenantId,
            id,
            input.resourceId ?? null,
            input.crewActorId ?? null,
            input.documentType,
            input.expiresOn,
            input.evidencePath,
            input.notes,
          ],
        );
        await record(tx, actor, "compliance_document.created", id, null, input);
        return { id, ...input };
      },
    );
  }
  createAssignment(actor: Actor, key: string, raw: unknown) {
    const input = parse(assignmentSchema, raw);
    return this.db.command(
      actor,
      "departure_assignment.create",
      key,
      input,
      async (tx) => {
        const {
          rows: [departure],
        } = await tx.query(
          `SELECT d.starts_at,d.local_date,(d.starts_at + make_interval(mins => (p.definition->>'durationMinutes')::int)) AS ends_at
         FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1 AND d.id=$2`,
          [actor.tenantId, input.departureId],
        );
        if (!departure)
          throw new BadRequestException("Departure is unavailable");
        const { rows: expired } = await tx.query(
          `SELECT id,document_type FROM compliance_documents WHERE tenant_id=$1
         AND (($2::uuid IS NOT NULL AND resource_id=$2) OR ($3::uuid IS NOT NULL AND crew_actor_id=$3))
         AND expires_on < $4::date`,
          [
            actor.tenantId,
            input.resourceId ?? null,
            input.crewActorId ?? null,
            departure.local_date,
          ],
        );
        if (expired.length && !input.overrideReason)
          throw new ConflictException(
            "Expired compliance document blocks assignment",
          );
        if (
          expired.length &&
          !actor.permissions.includes("safety.assignment.override")
        )
          throw new BadRequestException(
            "An authorized safety override is required for expired documents",
          );
        if (input.overrideReason && !expired.length)
          throw new BadRequestException(
            "A safety override is allowed only when a document is expired",
          );
        const id = randomUUID();
        await tx.query(
          "INSERT INTO departure_assignments(tenant_id,id,departure_id,resource_id,crew_actor_id,assignment_role,starts_at,ends_at,override_reason,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            actor.tenantId,
            id,
            input.departureId,
            input.resourceId ?? null,
            input.crewActorId ?? null,
            input.assignmentRole,
            departure.starts_at,
            departure.ends_at,
            input.overrideReason ?? null,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "departure_assignment.created",
          id,
          null,
          { ...input, expiredDocuments: expired.map((document) => document.document_type) },
        );
        return {
          id,
          ...input,
          startsAt: departure.starts_at,
          endsAt: departure.ends_at,
        };
      },
    );
  }
  assignments(actor: Actor, departureId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: departure } = await tx.query(
        "SELECT local_date FROM departures WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, departureId],
      );
      if (!departure[0])
        throw new BadRequestException("Departure is unavailable");
      const { rows } = await tx.query(
        `SELECT a.id,a.assignment_role,a.status,a.starts_at,a.ends_at,a.override_reason,
          r.id AS resource_id,r.name AS resource_name,r.type AS resource_type,
          c.membership_actor_id AS crew_actor_id,c.operational_name AS crew_name
         FROM departure_assignments a
         LEFT JOIN operational_resources r ON r.tenant_id=a.tenant_id AND r.id=a.resource_id
         LEFT JOIN crew_profiles c ON c.tenant_id=a.tenant_id AND c.membership_actor_id=a.crew_actor_id
         WHERE a.tenant_id=$1 AND a.departure_id=$2 ORDER BY a.starts_at,a.assignment_role,a.id`,
        [actor.tenantId, departureId],
      );
      const subjectIds = rows.flatMap((row) =>
        [row.resource_id, row.crew_actor_id].filter(Boolean),
      );
      const { rows: expiredDocuments } = subjectIds.length
        ? await tx.query(
            `SELECT id,resource_id,crew_actor_id,document_type,expires_on
             FROM compliance_documents WHERE tenant_id=$1 AND expires_on<$2
             AND (resource_id=ANY($3::uuid[]) OR crew_actor_id=ANY($3::uuid[]))`,
            [actor.tenantId, departure[0].local_date, subjectIds],
          )
        : { rows: [] };
      const overriddenSubjects = new Set(
        rows
          .filter((row) => row.override_reason)
          .flatMap((row) => [row.resource_id, row.crew_actor_id].filter(Boolean)),
      );
      const blockingDocuments = expiredDocuments.filter(
        (document) =>
          !overriddenSubjects.has(document.resource_id ?? document.crew_actor_id),
      );
      return {
        items: rows,
        expiredDocuments: blockingDocuments,
        readiness: blockingDocuments.length
          ? "blocked"
          : rows.length
            ? "ready"
            : "unassigned",
      };
    });
  }
}
@Controller("ops/v1")
export class ResourceController {
  constructor(private readonly service: ResourceService) {}
  @Get("resources") @Access("resources.write") resources(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.listResources(actor);
  }
  @Get("crew") @Access("resources.write") crew(@CurrentActor() actor: Actor) {
    return this.service.listCrew(actor);
  }
  @Get("compliance-documents") @Access("documents.expiry.manage") documents(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.documents(actor);
  }
  @Post("resources") @Access("resources.write") resource(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createResource(actor, parse(keySchema, key), body);
  }
  @Post("crew") @Access("resources.write") crewCreate(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createCrew(actor, parse(keySchema, key), body);
  }
  @Post("compliance-documents") @Access("documents.expiry.manage") document(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createDocument(actor, parse(keySchema, key), body);
  }
  @Post("assignments") @Access("assignments.write") assignment(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createAssignment(actor, parse(keySchema, key), body);
  }
  @Get("departures/:id/assignments") @Access("manifest.read") assignments(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
  ) {
    return this.service.assignments(actor, z.string().uuid().parse(id));
  }
}

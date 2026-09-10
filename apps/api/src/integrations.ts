import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Request } from "express";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, digest, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const accountSchema = z
  .object({
    connectorCode: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,63}$/),
  })
  .strict();
const accountStatusSchema = z
  .object({ status: z.enum(["disabled", "enabled"]) })
  .strict();
const mappingSchema = z
  .object({
    connectorAccountId: z.string().uuid(),
    entityType: z.enum(["product", "option"]),
    externalId: z.string().trim().min(1).max(160),
    internalProductId: z.string().uuid(),
  })
  .strict();
const importRowSchema = z
  .object({
    externalReference: z.string().trim().min(1).max(160),
    externalProductId: z.string().trim().min(1).max(160),
    departureAt: z.string().datetime({ offset: true }),
    partySize: z.coerce.number().int().positive().max(500),
    leadName: z.string().trim().min(1).max(120),
    leadEmail: z.string().email().max(254),
    source: z.string().trim().min(1).max(80),
    sourceStatus: z.string().trim().min(1).max(80),
    pickupDisposition: z.enum(["none", "resolved", "unresolved"]),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    totalMinor: z.coerce.number().int().nonnegative(),
    paidMinor: z.coerce.number().int().nonnegative(),
    partnerReference: z.string().trim().max(160).optional().default(""),
    invoiceOwner: z.enum(["guest", "tenant", "partner", "none"]),
  })
  .strict();
const importSchema = z
  .object({
    source: z.string().trim().min(1).max(80),
    fileName: z.string().trim().min(1).max(255).optional(),
    connectorAccountId: z.string().uuid().optional(),
    rows: z.array(importRowSchema).min(1).max(5000),
  })
  .strict();
const inboxActionSchema = z
  .object({
    action: z.enum(["retry", "dead_letter"]),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
const id = z.string().uuid();
const runtimeKey = () => {
  const value = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!value)
    throw new ConflictException("Webhook secret encryption is not configured");
  return createHash("sha256").update(value).digest();
};
const encrypt = (value: string) => {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", runtimeKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};
const decrypt = (value: string) => {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Invalid connector secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    runtimeKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
@Injectable()
export class IntegrationService {
  constructor(private readonly db: Database) {}
  drainRetries(actor: Actor, limit = 25) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT i.id,i.payload,i.retry_count,c.status AS account_status
         FROM webhook_inbox i
         JOIN connector_accounts c ON c.tenant_id=i.tenant_id AND c.id=i.connector_account_id
         WHERE i.tenant_id=$1 AND i.status='retry_pending' AND i.next_attempt_at<=clock_timestamp()
         ORDER BY i.next_attempt_at,i.id LIMIT $2 FOR UPDATE OF i SKIP LOCKED`,
        [actor.tenantId, Math.max(1, Math.min(limit, 100))],
      );
      let released = 0,
        quarantined = 0,
        deadLettered = 0;
      for (const row of rows) {
        const payload = row.payload;
        const event =
          payload && typeof payload === "object"
            ? (payload.id ?? payload.event_id ?? payload.order_id)
            : undefined;
        let status = "received",
          failure = "";
        if (row.account_status !== "enabled")
          failure = "Connector account is disabled";
        else if (payload?.invalid_json) failure = "Invalid JSON payload";
        else if (typeof event !== "string" && typeof event !== "number")
          failure = "Missing external event identifier";
        if (failure)
          status = row.retry_count >= 5 ? "dead_letter" : "quarantined";
        await tx.query(
          `UPDATE webhook_inbox SET status=$3,failure_reason=$4,next_attempt_at=NULL,
             processed_at=NULL,dead_lettered_at=CASE WHEN $3='dead_letter' THEN clock_timestamp() ELSE NULL END
           WHERE tenant_id=$1 AND id=$2`,
          [actor.tenantId, row.id, status, failure],
        );
        if (status === "received") released++;
        else if (status === "dead_letter") deadLettered++;
        else quarantined++;
        await record(
          tx,
          actor,
          "integration.inbox.retry_consumed",
          row.id,
          { status: "retry_pending", retryCount: row.retry_count },
          { status, failureReason: failure },
          failure || undefined,
        );
      }
      return { claimed: rows.length, released, quarantined, deadLettered };
    });
  }
  catalog(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT code,name,category,lifecycle_status,provisioning_available,capabilities,description FROM connector_definitions ORDER BY sort_order,code",
          )
        ).rows,
    );
  }
  list(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,connector_code,public_inbound_id,status,created_at,updated_at FROM connector_accounts WHERE tenant_id=$1 ORDER BY connector_code",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  create(actor: Actor, key: string, raw: unknown) {
    const input = parse(accountSchema, raw);
    return this.db.command(
      actor,
      "connector.create",
      key,
      input,
      async (tx) => {
        const definition = (
          await tx.query(
            "SELECT provisioning_available FROM connector_definitions WHERE code=$1",
            [input.connectorCode],
          )
        ).rows[0];
        if (!definition)
          throw new ConflictException("Connector is not registered");
        if (!definition.provisioning_available)
          throw new ConflictException(
            "This connector requires provider approval before it can be configured",
          );
        const secret = randomBytes(32).toString("base64url"),
          result = {
            id: randomUUID(),
            publicInboundId: randomUUID(),
            connectorCode: input.connectorCode,
            secret,
            status: "disabled",
          };
        await tx.query(
          "INSERT INTO connector_accounts(tenant_id,id,connector_code,public_inbound_id,secret_ciphertext,secret_key_version,created_by) VALUES($1,$2,$3,$4,$5,'local-v1',$6)",
          [
            actor.tenantId,
            result.id,
            result.connectorCode,
            result.publicInboundId,
            encrypt(secret),
            actor.actorId,
          ],
        );
        await record(tx, actor, "connector.created", result.id, null, {
          id: result.id,
          publicInboundId: result.publicInboundId,
          connectorCode: result.connectorCode,
          status: result.status,
        });
        return result;
      },
    );
  }
  update(actor: Actor, accountId: string, key: string, raw: unknown) {
    const input = parse(accountStatusSchema, raw);
    return this.db.command(
      actor,
      `connector.status:${accountId}`,
      key,
      input,
      async (tx) => {
        const before = (
          await tx.query(
            "SELECT id,status,connector_code,public_inbound_id FROM connector_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [actor.tenantId, accountId],
          )
        ).rows[0];
        if (!before) throw new ConflictException("Connector account not found");
        await tx.query(
          "UPDATE connector_accounts SET status=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, accountId, input.status],
        );
        const result = { id: accountId, status: input.status };
        await record(
          tx,
          actor,
          "connector.status_changed",
          accountId,
          before,
          result,
        );
        return result;
      },
    );
  }
  mappings(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT m.id,m.connector_account_id,m.entity_type,m.external_id,m.internal_product_id,p.name AS product_name FROM external_mappings m JOIN products p ON p.tenant_id=m.tenant_id AND p.id=m.internal_product_id WHERE m.tenant_id=$1 ORDER BY m.entity_type,m.external_id",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  inbox(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT i.id,i.external_event_id,i.status,i.failure_reason,i.retry_count,i.next_attempt_at,i.last_reviewed_at,i.dead_lettered_at,i.received_at,c.connector_code FROM webhook_inbox i JOIN connector_accounts c ON c.tenant_id=i.tenant_id AND c.id=i.connector_account_id WHERE i.tenant_id=$1 ORDER BY i.received_at DESC,i.id DESC LIMIT 100",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  reviewInbox(actor: Actor, eventId: string, key: string, raw: unknown) {
    const input = parse(inboxActionSchema, raw);
    return this.db.command(
      actor,
      `integration.inbox.review:${eventId}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          `SELECT i.*,c.status AS account_status FROM webhook_inbox i JOIN connector_accounts c ON c.tenant_id=i.tenant_id AND c.id=i.connector_account_id WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE`,
          [actor.tenantId, eventId],
        );
        if (!before) throw new ConflictException("Inbox event not found");
        if (input.action === "retry") {
          if (!["quarantined", "dead_letter"].includes(before.status))
            throw new ConflictException(
              "Only quarantined or dead-letter events can be retried",
            );
          if (before.account_status !== "enabled")
            throw new ConflictException(
              "Enable the connector before scheduling a retry",
            );
          if (before.retry_count >= 5)
            throw new ConflictException(
              "Retry limit reached; retain this event for review",
            );
          await tx.query(
            "UPDATE webhook_inbox SET status='retry_pending',retry_count=retry_count+1,next_attempt_at=clock_timestamp(),last_reviewed_at=clock_timestamp(),dead_lettered_at=NULL,failure_reason=$3 WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, eventId, input.reason],
          );
        } else {
          if (before.status === "processed")
            throw new ConflictException(
              "Processed events cannot be dead-lettered",
            );
          await tx.query(
            "UPDATE webhook_inbox SET status='dead_letter',next_attempt_at=NULL,last_reviewed_at=clock_timestamp(),dead_lettered_at=clock_timestamp(),failure_reason=$3 WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, eventId, input.reason],
          );
        }
        const result = {
          id: eventId,
          status: input.action === "retry" ? "retry_pending" : "dead_letter",
          retryCount:
            input.action === "retry"
              ? before.retry_count + 1
              : before.retry_count,
          reason: input.reason,
        };
        await record(
          tx,
          actor,
          `integration.inbox.${input.action}`,
          eventId,
          { status: before.status, retryCount: before.retry_count },
          result,
          input.reason,
        );
        return result;
      },
    );
  }
  map(actor: Actor, key: string, raw: unknown) {
    const input = parse(mappingSchema, raw);
    return this.db.command(
      actor,
      "connector.mapping.create",
      key,
      input,
      async (tx) => {
        const account = await tx.query(
          "SELECT id FROM connector_accounts WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, input.connectorAccountId],
        );
        const product = await tx.query(
          "SELECT id FROM products WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, input.internalProductId],
        );
        if (!account.rowCount || !product.rowCount)
          throw new ConflictException("Connector account or product not found");
        const result = { id: randomUUID(), ...input };
        await tx.query(
          "INSERT INTO external_mappings(tenant_id,id,connector_account_id,entity_type,external_id,internal_product_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            actor.tenantId,
            result.id,
            input.connectorAccountId,
            input.entityType,
            input.externalId,
            input.internalProductId,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "connector.mapping_created",
          result.id,
          null,
          result,
        );
        return result;
      },
    );
  }
  imports(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,source,file_name,status,total_rows,valid_rows,quarantined_rows,duplicate_rows,currency,total_minor,paid_minor,reconciliation,created_at FROM assisted_imports WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  importReport(actor: Actor, importId: string) {
    return this.db.transaction(actor, async (tx) => {
      const summary = (
        await tx.query(
          "SELECT id,source,file_name,status,total_rows,valid_rows,quarantined_rows,duplicate_rows,currency,total_minor,paid_minor,reconciliation,created_at FROM assisted_imports WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, importId],
        )
      ).rows[0];
      if (!summary) throw new ConflictException("Assisted import not found");
      const rows = (
        await tx.query(
          "SELECT row_number,status,failure_reason,payload FROM assisted_import_rows WHERE tenant_id=$1 AND import_id=$2 ORDER BY row_number",
          [actor.tenantId, importId],
        )
      ).rows;
      return { schemaVersion: 1, dryRun: true, summary, rows };
    });
  }
  importRows(actor: Actor, key: string, raw: unknown) {
    const input = parse(importSchema, raw);
    return this.db.command(
      actor,
      "assisted-import.validate",
      key,
      input,
      async (tx) => {
        const importId = randomUUID();
        let valid = 0,
          quarantined = 0,
          duplicates = 0,
          totalMinor = 0,
          paidMinor = 0;
        const references = new Set<string>(),
          currencies = new Set(input.rows.map((row) => row.currency));
        await tx.query(
          "INSERT INTO assisted_imports(tenant_id,id,source,file_name,status,created_by) VALUES($1,$2,$3,$4,'draft',$5)",
          [
            actor.tenantId,
            importId,
            input.source,
            input.fileName ?? null,
            actor.actorId,
          ],
        );
        for (const [index, row] of input.rows.entries()) {
          const reasons: string[] = [];
          if (currencies.size > 1)
            reasons.push("Multiple currencies require separate import files");
          const normalizedReference = row.externalReference.toLocaleLowerCase();
          if (references.has(normalizedReference)) {
            reasons.push("Duplicate external reference in this file");
            duplicates++;
          } else references.add(normalizedReference);
          if (row.paidMinor > row.totalMinor)
            reasons.push("Paid amount exceeds booking total");
          if (row.invoiceOwner === "partner" && !row.partnerReference)
            reasons.push(
              "Partner invoice ownership requires a partner reference",
            );
          const mapping = await tx.query(
            "SELECT id FROM external_mappings WHERE tenant_id=$1 AND entity_type='product' AND external_id=$2" +
              [input.connectorAccountId ? " AND connector_account_id=$3" : ""],
            [
              actor.tenantId,
              row.externalProductId,
              ...(input.connectorAccountId ? [input.connectorAccountId] : []),
            ],
          );
          if (!mapping.rowCount)
            reasons.push("No mapped internal product for external product ID");
          const reason = reasons.join("; ");
          totalMinor += row.totalMinor;
          paidMinor += row.paidMinor;
          const status = reason ? "quarantined" : "valid";
          if (reason) quarantined++;
          else valid++;
          await tx.query(
            "INSERT INTO assisted_import_rows(tenant_id,id,import_id,row_number,payload,status,failure_reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              actor.tenantId,
              randomUUID(),
              importId,
              index + 1,
              row,
              status,
              reason,
            ],
          );
        }
        const reconciliation = {
          balanceMinor: totalMinor - paidMinor,
          currencyMismatch: currencies.size > 1,
          communicationsSuppressed: true,
          bookingWrites: 0,
        };
        const status = quarantined ? "quarantined" : "validated";
        await tx.query(
          "UPDATE assisted_imports SET status=$3,total_rows=$4,valid_rows=$5,quarantined_rows=$6,duplicate_rows=$7,currency=$8,total_minor=$9,paid_minor=$10,reconciliation=$11 WHERE tenant_id=$1 AND id=$2",
          [
            actor.tenantId,
            importId,
            status,
            input.rows.length,
            valid,
            quarantined,
            duplicates,
            currencies.size === 1 ? [...currencies][0] : null,
            totalMinor,
            paidMinor,
            reconciliation,
          ],
        );
        const result = {
          importId,
          status,
          valid,
          quarantined,
          duplicates,
          totalMinor,
          paidMinor,
          balanceMinor: totalMinor - paidMinor,
          currency: currencies.size === 1 ? [...currencies][0] : null,
          dryRun: true,
        };
        await record(
          tx,
          actor,
          "assisted_import.validated",
          importId,
          null,
          result,
        );
        return result;
      },
    );
  }
  async inbound(publicId: string, signature: string | undefined, body: Buffer) {
    const { rows } = await this.db.pool.query(
      "SELECT * FROM resolve_connector_account($1)",
      [publicId],
    );
    const account = rows[0];
    if (!account || account.status !== "enabled" || !signature) return null;
    const expectedHex = createHmac("sha256", decrypt(account.secret_ciphertext))
      .update(body)
      .digest("hex");
    const supplied = signature.replace(/^sha256=/, "");
    if (
      supplied.length !== expectedHex.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedHex))
    )
      return null;
    const actor: Actor = {
      actorId: account.account_id,
      tenantId: account.tenant_id,
      platform: false,
      permissions: [],
      role: "connector",
    };
    return this.db.transaction(actor, async (tx) => {
      let payload: unknown,
        status = "received",
        failure = "";
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        payload = { invalid_json: true };
        status = "quarantined";
        failure = "Invalid JSON payload";
      }
      const event =
        payload && typeof payload === "object"
          ? ((payload as any).id ??
            (payload as any).event_id ??
            (payload as any).order_id)
          : undefined;
      const externalEventId =
        typeof event === "string" || typeof event === "number"
          ? String(event)
          : digest(body.toString("base64"));
      if (!event) {
        status = "quarantined";
        failure = failure || "Missing external event identifier";
      }
      const prior = await tx.query(
        "SELECT id,status FROM webhook_inbox WHERE tenant_id=$1 AND connector_account_id=$2 AND external_event_id=$3",
        [account.tenant_id, account.account_id, externalEventId],
      );
      if (prior.rowCount)
        return {
          receiptId: prior.rows[0].id,
          status: prior.rows[0].status,
          duplicate: true,
        };
      const result = { receiptId: randomUUID(), status, duplicate: false };
      await tx.query(
        "INSERT INTO webhook_inbox(tenant_id,id,connector_account_id,external_event_id,payload_hash,payload,status,failure_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          account.tenant_id,
          result.receiptId,
          account.account_id,
          externalEventId,
          digest(body.toString("base64")),
          payload,
          status,
          failure,
        ],
      );
      await record(
        tx,
        actor,
        "integration.webhook.received",
        result.receiptId,
        null,
        { connectorAccountId: account.account_id, externalEventId, status },
      );
      return result;
    });
  }
}
@Controller("integrations/v1")
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}
  @Get("catalog") @Access("integration.manage") catalog(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.catalog(actor);
  }
  @Get("accounts") @Access("integration.manage") list(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.list(actor);
  }
  @Post("accounts") @Access("integration.manage") create(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.create(actor, parse(keySchema, key), body);
  }
  @Patch("accounts/:id") @Access("integration.manage") update(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.update(
      actor,
      parse(id, value),
      parse(keySchema, key),
      body,
    );
  }
  @Get("mappings") @Access("integration.manage") mappings(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.mappings(actor);
  }
  @Get("inbox") @Access("integration.inbox.read") inbox(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.inbox(actor);
  }
  @Post("inbox/:id/review") @Access("integration.manage") reviewInbox(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.reviewInbox(
      actor,
      parse(id, value),
      parse(keySchema, key),
      body,
    );
  }
  @Post("mappings") @Access("integration.manage") map(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.map(actor, parse(keySchema, key), body);
  }
  @Get("assisted-imports") @Access("integration.manage") imports(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.imports(actor);
  }
  @Get("assisted-imports/:id/report")
  @Access("integration.manage")
  importReport(@CurrentActor() actor: Actor, @Param("id") value: string) {
    return this.service.importReport(actor, parse(id, value));
  }
  @Post("assisted-imports") @Access("integration.manage") importRows(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.importRows(actor, parse(keySchema, key), body);
  }
  @Post("inbound/:id") @Access("public") async inbound(
    @Param("id") value: string,
    @Headers("x-zettaz-signature") signature: string | undefined,
    @Req() request: Request & { body: Buffer },
  ) {
    const result = await this.service.inbound(
      parse(id, value),
      signature,
      Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
    );
    if (!result) throw new UnauthorizedException();
    return result;
  }
}

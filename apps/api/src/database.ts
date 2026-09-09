import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../../packages/shared/src/contracts";
import { ConflictException } from "@nestjs/common";

export type Tx = PoolClient;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 12,
    connectionTimeoutMillis: 5000,
  });
  async assertRuntimeRole() {
    const {
      rows: [r],
    } = await this.pool.query(`SELECT rolsuper,rolbypassrls,
      EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user) AS owns_tables
      FROM pg_roles WHERE rolname=current_user`);
    if (r.rolsuper || r.rolbypassrls || r.owns_tables)
      throw new Error(
        "DATABASE_URL must use a non-owner, non-bypass-RLS runtime role",
      );
  }
  async transaction<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query(
        `SELECT set_config('app.tenant',$1,true),set_config('app.actor',$2,true),
        set_config('app.platform',$3,true),set_config('app.member_admin',$4,true),set_config('lock_timeout','5s',true)`,
        [
          actor.tenantId ?? "",
          actor.actorId,
          String(actor.platform),
          String(actor.permissions.includes("members.write")),
        ],
      );
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  }
  async command<T>(
    actor: Actor,
    operation: string,
    key: string,
    input: unknown,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.transaction(actor, async (tx) => {
      const scope = [actor.tenantId, actor.actorId, operation, key].join(":");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        scope,
      ]);
      const hash = digest(canonical(input));
      const {
        rows: [prior],
      } = await tx.query(
        `SELECT request_hash,response FROM idempotency_keys WHERE tenant_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`,
        [actor.tenantId, actor.actorId, operation, key],
      );
      if (prior) {
        if (prior.request_hash !== hash)
          throw new ConflictException(
            "Idempotency key reused with different input",
          );
        return prior.response as T;
      }
      const result = await fn(tx);
      await tx.query("INSERT INTO idempotency_keys VALUES($1,$2,$3,$4,$5,$6)", [
        actor.tenantId,
        actor.actorId,
        operation,
        key,
        hash,
        JSON.stringify(result),
      ]);
      return result;
    });
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
export async function record(
  tx: Tx,
  actor: Actor,
  action: string,
  aggregateId: string,
  before: unknown,
  after: unknown,
  reason?: string,
) {
  const eventId = randomUUID();
  await tx.query(
    `INSERT INTO audit_events(tenant_id,id,actor_id,action,aggregate_id,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      actor.tenantId,
      eventId,
      actor.actorId,
      action,
      aggregateId,
      JSON.stringify(before),
      JSON.stringify(after),
      reason ?? null,
    ],
  );
  await tx.query(
    `INSERT INTO outbox_events(tenant_id,id,type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)`,
    [
      actor.tenantId,
      eventId,
      action,
      aggregateId,
      JSON.stringify({ version: 1, actorId: actor.actorId, aggregateId }),
    ],
  );
}

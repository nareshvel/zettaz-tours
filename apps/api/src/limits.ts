/**
 * Plan limit enforcement.
 *
 * Reads the tenant's active subscription plan limits and throws 403 with
 * { upgrade: true } when the tenant has reached or exceeded a limit.
 *
 * Limit keys in subscription_plans.limits (jsonb):
 *   "Staff users"   → integer | "Unlimited"
 *   "Locations"     → integer | "Unlimited"
 *   "Tour products" → integer | "Unlimited"  (stored as "1,000" for display)
 *
 * Usage:
 *   await checkLimit(db, actor, "staff");
 *   await checkLimit(db, actor, "locations");
 *   await checkLimit(db, actor, "products");
 */

import { ForbiddenException, Injectable } from "@nestjs/common";
import { Database } from "./database";
import type { Actor } from "../../../packages/shared/src/contracts";

export type LimitKind = "staff" | "locations" | "products";

const QUERY = `
  SELECT
    sp.limits,
    (SELECT count(*)::int FROM memberships WHERE tenant_id = $1 AND status = 'active') AS staff_count,
    (SELECT count(*)::int FROM pickup_locations WHERE tenant_id = $1 AND active = true) AS location_count,
    (SELECT count(*)::int FROM products WHERE tenant_id = $1) AS product_count
  FROM tenant_subscriptions ts
  JOIN subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = $1
    AND ts.status IN ('trial','active')
  LIMIT 1
`;

function parseLimit(raw: unknown): number | null {
  if (raw === "Unlimited" || raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw;
  // Handle display strings like "1,000"
  const n = parseInt(String(raw).replace(/,/g, ""), 10);
  return isNaN(n) ? null : n;
}

@Injectable()
export class LimitsService {
  constructor(private readonly db: Database) {}

  /**
   * Enforce a limit. Call BEFORE inserting a new record.
   * No-ops if the tenant has no active subscription (open / dev mode).
   */
  async enforce(actor: Actor, kind: LimitKind): Promise<void> {
    const { rows } = await this.db.pool.query(QUERY, [actor.tenantId]);
    if (!rows[0]) return; // no active subscription — don't block

    const { limits, staff_count, location_count, product_count } = rows[0];

    let cap: number | null;
    let current: number;
    let label: string;

    switch (kind) {
      case "staff":
        cap = parseLimit(limits["Staff users"]);
        current = staff_count;
        label = "staff members";
        break;
      case "locations":
        cap = parseLimit(limits["Locations"]);
        current = location_count;
        label = "locations";
        break;
      case "products":
        cap = parseLimit(limits["Tour products"]);
        current = product_count;
        label = "tour products";
        break;
    }

    if (cap !== null && current >= cap) {
      throw new ForbiddenException({
        message: `Your plan allows up to ${cap} ${label}. Upgrade to add more.`,
        upgrade: true,
      });
    }
  }
}

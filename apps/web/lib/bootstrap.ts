import "server-only";
import { cookies } from "next/headers";
import type { DemoTenant, Session } from "@/lib/types";
import { sessionCookie, upstream } from "@/lib/server";

export type WorkspaceBootstrap = {
  session: Session | null;
  tenants: DemoTenant[];
};

/** Server-side session read so the first paint is not the public landing page. */
export async function loadWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  try {
    const cookie = (await cookies()).get(sessionCookie);
    if (!cookie) return { session: null, tenants: [] };
    const res = await upstream("/staff/v1/workspace/session");
    if (!res.ok) return { session: null, tenants: [] };
    const session = (await res.json()) as Session;
    const memberships = await upstream("/auth/v1/tenants");
    const tenants = memberships.ok
      ? (
          ((await memberships.json()) as { tenants?: Array<{
            tenant_id: string;
            name: string;
            email: string;
          }> }).tenants ?? []
        ).map((tenant) => ({
          tenantId: tenant.tenant_id,
          name: tenant.name,
          email: tenant.email,
        }))
      : [];
    return { session, tenants };
  } catch {
    return { session: null, tenants: [] };
  }
}

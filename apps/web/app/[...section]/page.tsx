import { Workspace } from "@/components/workspace";
import { loadWorkspaceBootstrap } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function Page() {
  const bootstrap = await loadWorkspaceBootstrap();
  return (
    <Workspace
      initialSession={bootstrap.session}
      initialTenants={bootstrap.tenants}
    />
  );
}

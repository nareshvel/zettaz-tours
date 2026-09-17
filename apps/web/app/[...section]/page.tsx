import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { loadWorkspaceBootstrap } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ section: string[] }>;
}) {
  const section = (await params).section;
  if (section[0] === "api") notFound();
  const bootstrap = await loadWorkspaceBootstrap();
  return (
    <Workspace
      initialSession={bootstrap.session}
      initialTenants={bootstrap.tenants}
    />
  );
}

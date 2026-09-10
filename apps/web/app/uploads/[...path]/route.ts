import { upstream } from "@/lib/server";

export const dynamic = "force-dynamic";

const tenantLogoPath =
  /^tenant-logos\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp|svg)$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join("/");
  if (!tenantLogoPath.test(path)) return new Response(null, { status: 404 });
  try {
    const response = await upstream("/uploads/" + path);
    if (!response.ok) return new Response(null, { status: response.status });
    return new Response(await response.arrayBuffer(), {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/png",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}

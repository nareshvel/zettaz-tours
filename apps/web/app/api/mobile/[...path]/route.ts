import { isCrewMobilePath } from "@/lib/mobile-api";
import { upstream } from "@/lib/server";

export const dynamic = "force-dynamic";

async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join("/");
  if (!isCrewMobilePath(request.method, path))
    return Response.json({ message: "Route unavailable." }, { status: 404 });
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-zA-Z0-9_-]{40,100})$/)?.[1];
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    if (typeof body === "string" && Buffer.byteLength(body) > 65536)
      return Response.json(
        { message: "Request is too large." },
        { status: 413 },
      );
    const idempotency = request.headers.get("idempotency-key");
    const res = await upstream(
      "/" + path + new URL(request.url).search,
      {
        method: request.method,
        body,
        headers: {
          ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
        },
      },
      token ?? "",
    );
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        message:
          "The crew service is temporarily unavailable. Check your connection and try again.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;

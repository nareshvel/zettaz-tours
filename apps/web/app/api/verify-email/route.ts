import { unavailable, upstream, validOrigin } from "@/lib/server";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!validOrigin(request))
    return Response.json({ message: "Request origin rejected." }, { status: 403 });
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const res = await upstream(`/auth/v1/verify-email?token=${encodeURIComponent(token)}`, {
      method: "GET",
    });
    const body = await res.json();
    if (!res.ok)
      return Response.json(
        { message: body.message ?? "Verification failed." },
        { status: 400 },
      );
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}

import { problemMessage, unavailable, upstream } from "@/lib/server";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Public email-link verification; Origin is often omitted on same-origin GET fetch.
  // Mutating session establishment still goes through /api/session with origin checks.
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const res = await upstream(`/auth/v1/verify-email?token=${encodeURIComponent(token)}`, {
      method: "GET",
    });
    const body = await res.json();
    if (!res.ok)
      return Response.json(
        { message: problemMessage(body, "Verification failed.") },
        { status: 400 },
      );
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}

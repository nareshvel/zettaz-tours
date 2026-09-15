import {
  problemMessage,
  unavailable,
  upstream,
  validOrigin,
} from "@/lib/server";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!validOrigin(request))
    return Response.json(
      { message: "Request origin rejected." },
      { status: 403 },
    );
  try {
    const input = await request.json();
    const res = await upstream("/auth/v1/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const body = await res.json();
    if (!res.ok)
      return Response.json(
        { message: problemMessage(body, "Registration failed.") },
        { status: res.status === 409 ? 409 : 400 },
      );
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}

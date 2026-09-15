import {
  problemMessage,
  unavailable,
  upstream,
  validOrigin,
} from "@/lib/server";
export async function POST(request: Request) {
  if (!validOrigin(request))
    return Response.json(
      { message: "Request origin rejected." },
      { status: 403 },
    );
  try {
    const input = await request.json();
    const path = input.token
      ? "/auth/v1/password-recovery/complete"
      : "/auth/v1/password-recovery/request";
    const response = await upstream(path, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const body = await response.json();
    return Response.json(
      response.ok
        ? body
        : { message: problemMessage(body, "Recovery request failed.") },
      { status: response.status },
    );
  } catch {
    return unavailable();
  }
}

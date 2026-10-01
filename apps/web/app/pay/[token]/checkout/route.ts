import { problemMessage, upstream } from "@/lib/server";

export const dynamic = "force-dynamic";

function back(request: Request, token: string, error?: string) {
  const origin = (
    process.env.WEB_ORIGIN ?? new URL(request.url).origin
  ).replace(/\/$/, "");
  const url = new URL(`${origin}/pay/${token}`);
  if (error) url.searchParams.set("error", error);
  return Response.redirect(url.toString(), 303);
}

/** Guest pressed "Pay": create (or reuse) a Stripe Checkout Session and redirect. */
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token))
    return Response.json({ message: "Invalid link." }, { status: 404 });
  try {
    const res = await upstream(
      `/pay/v1/${token}/checkout`,
      { method: "POST", body: "{}" },
      "",
    );
    const body = (await res.json().catch(() => ({}))) as { url?: string };
    if (!res.ok || !body.url)
      return back(
        request,
        token,
        problemMessage(
          body,
          "Card checkout could not start. Please try again.",
        ),
      );
    const target = new URL(body.url);
    if (target.protocol !== "https:" || !target.hostname.endsWith("stripe.com"))
      return back(request, token, "Card checkout could not start.");
    return Response.redirect(target.toString(), 303);
  } catch {
    return back(
      request,
      token,
      "Card checkout is temporarily unavailable. Please try again shortly.",
    );
  }
}

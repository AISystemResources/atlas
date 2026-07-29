import Stripe from "stripe";
import { getUserFromRequest } from "@/lib/auth/context";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

// POST /api/v1/stripe/checkout — create a Stripe Checkout Session for Pro
export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let priceId: string | undefined;
  try {
    const body = await req.json() as { price_id?: unknown };
    priceId = typeof body.price_id === "string" ? body.price_id : undefined;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!priceId) {
    return Response.json({ error: "price_id is required" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "https://atlas-broker.vercel.app";

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    client_reference_id: user.userId,
    metadata: { userId: user.userId },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/dashboard`,
  });

  return Response.json({ url: session.url });
}

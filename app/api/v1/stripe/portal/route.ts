import Stripe from "stripe";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

// POST /api/v1/stripe/portal — create a Stripe billing portal session
export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.userId)
    .maybeSingle();

  const customerId = (profile as Record<string, unknown> | null)?.["stripe_customer_id"] as string | null;
  if (!customerId) {
    return Response.json({ error: "No active subscription" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "https://atlas-broker.vercel.app";

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard`,
  });

  return Response.json({ url: session.url });
}

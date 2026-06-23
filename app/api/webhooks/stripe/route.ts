import Stripe from "stripe";
import { getServiceClient } from "@/lib/supabase-server";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

// POST /api/webhooks/stripe — Stripe event handler (no Clerk auth — verified by signature)
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getServiceClient();

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId ?? session.client_reference_id;
      const customerId = typeof session.customer === "string" ? session.customer : null;
      if (userId) {
        await supabase
          .from("profiles")
          .update({ tier: "pro", ...(customerId ? { stripe_customer_id: customerId } : {}) })
          .eq("id", userId);
      }
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : null;
      if (customerId) {
        const tier = sub.status === "active" ? "pro" : "free";
        await supabase.from("profiles").update({ tier }).eq("stripe_customer_id", customerId);
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : null;
      if (customerId) {
        await supabase.from("profiles").update({ tier: "free" }).eq("stripe_customer_id", customerId);
      }
    }
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    // Return 200 anyway — Stripe retries on non-2xx
  }

  return Response.json({ received: true });
}

/**
 * POST /api/webhooks/clerk — handle Clerk lifecycle events.
 *
 * user.created: create profile row + portfolio in Supabase.
 *
 * Signature verified via svix (same library Clerk uses server-side).
 * Port of backend/api/routes/webhooks.py.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function verifySvix(
  payload: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const { Webhook } = await import("svix");
  if (!CLERK_WEBHOOK_SECRET) throw new Error("CLERK_WEBHOOK_SECRET not configured");
  const wh = new Webhook(CLERK_WEBHOOK_SECRET);
  return wh.verify(payload, headers) as Record<string, unknown>;
}

export async function POST(req: Request): Promise<Response> {
  const payload = await req.text();
  const headers: Record<string, string> = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let event: Record<string, unknown>;
  try {
    event = await verifySvix(payload, headers);
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const eventType = event["type"] as string;
  if (eventType !== "user.created") {
    return Response.json({ status: "ok" });
  }

  const data = (event["data"] ?? {}) as Record<string, unknown>;
  const userId = data["id"] as string;
  const emailEntries = (data["email_addresses"] as Record<string, unknown>[] | undefined) ?? [];
  const primaryId = data["primary_email_address_id"] as string | undefined;
  const primaryEntry = emailEntries.find((e) => e["id"] === primaryId) ?? emailEntries[0];
  const email = (primaryEntry?.["email_address"] as string | undefined) ?? "";
  const firstName = (data["first_name"] as string | undefined) ?? "";
  const lastName = (data["last_name"] as string | undefined) ?? "";
  const displayName = `${firstName} ${lastName}`.trim() || email;

  const sb = getServiceClient();

  // Upsert profile with advisory defaults
  try {
    await sb.from("profiles").upsert({
      id: userId,
      email,
      display_name: displayName,
      boundary_mode: "advisory",
      onboarding_completed: false,
    });
  } catch (err) {
    console.error("Failed to upsert profile for user_id=%s: %s", userId, err);
  }

  // Create paper portfolio if none exists
  try {
    const { data: existing } = await sb
      .from("portfolios")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existing) {
      await sb.from("portfolios").insert({
        user_id: userId,
        name: "Paper Portfolio",
        cash: 100000.0,
      });
    }
  } catch (err) {
    console.error("Failed to create portfolio for user_id=%s: %s", userId, err);
  }

  return Response.json({ status: "ok" });
}

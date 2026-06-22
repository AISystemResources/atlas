/**
 * GET /api/v1/admin/stats   — platform usage stats (admin only)
 * GET /api/v1/admin/users   — all users with broker connection status (admin only)
 *
 * PATCH /api/v1/admin/users/:id/tier and /role are in the [user_id] sub-route.
 *
 * Port of backend/api/routes/admin.py.
 */
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/auth/context";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function requireAdmin(req: Request): Promise<{ userId: string } | null> {
  const user = await getUserFromRequest(req);
  if (!user) return null;
  const sb = getServiceClient();
  const { data } = await sb
    .from("profiles")
    .select("role")
    .eq("id", user.userId)
    .maybeSingle();
  const role = (data as Record<string, unknown> | null)?.["role"] as string | undefined;
  if (!role || !["admin", "superadmin"].includes(role)) return null;
  return user;
}

async function getClerkEmails(userIds: string[]): Promise<Record<string, string>> {
  if (!CLERK_SECRET_KEY || userIds.length === 0) return {};
  const result: Record<string, string> = {};
  await Promise.allSettled(
    userIds.map(async (uid) => {
      const res = await fetch(`https://api.clerk.com/v1/users/${uid}`, {
        headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>;
      const emails = (data["email_addresses"] as Record<string, unknown>[] | undefined) ?? [];
      const primaryId = data["primary_email_address_id"] as string | undefined;
      const primary = emails.find((e) => e["id"] === primaryId);
      if (primary) result[uid] = primary["email_address"] as string;
    }),
  );
  return result;
}

export async function GET(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!admin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const path = url.searchParams.get("_path") ?? "";

  if (path === "users") {
    return getUsers();
  }
  return getStats();
}

async function getStats(): Promise<Response> {
  const sb = getServiceClient();

  let totalUsers = 0, freeCount = 0, proCount = 0, maxCount = 0, executionsToday = 0;

  try {
    const { data } = await sb.from("profiles").select("id, tier");
    for (const row of data ?? []) {
      totalUsers++;
      const tier = (row as Record<string, unknown>)["tier"] as string | undefined;
      if (tier === "pro") proCount++;
      else if (tier === "max") maxCount++;
      else freeCount++;
    }
  } catch { /* continue */ }

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { data } = await sb
      .from("trades")
      .select("id")
      .eq("status", "filled")
      .gte("executed_at", today.toISOString());
    executionsToday = (data ?? []).length;
  } catch { /* continue */ }

  return Response.json({ total_users: totalUsers, free_count: freeCount, pro_count: proCount, max_count: maxCount, signals_today: 0, executions_today: executionsToday });
}

async function getUsers(): Promise<Response> {
  const sb = getServiceClient();

  const { data: profiles, error } = await sb.from("profiles").select("*");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const userIds = (profiles ?? []).map((p) => (p as Record<string, unknown>)["id"] as string);

  const { data: brokerData } = await sb
    .from("broker_connections")
    .select("user_id")
    .eq("active", true);
  const connectedIds = new Set((brokerData ?? []).map((r) => (r as Record<string, unknown>)["user_id"] as string));

  const emailMap = await getClerkEmails(userIds);

  return Response.json(
    (profiles ?? []).map((p) => {
      const row = p as Record<string, unknown>;
      return {
        id: row["id"],
        display_name: row["display_name"] ?? "",
        email: emailMap[row["id"] as string] ?? "",
        tier: row["tier"] ?? "free",
        role: row["role"] ?? "user",
        created_at: row["created_at"] ?? "",
        broker_connected: connectedIds.has(row["id"] as string),
      };
    }),
  );
}

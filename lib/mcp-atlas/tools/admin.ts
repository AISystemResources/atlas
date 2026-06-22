import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const ADMIN_TOOL_DEFS = [
  {
    name: "get_admin_stats",
    description: "Get platform-wide usage statistics. Admin only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_users",
    description: "List all users with their profiles and broker connection status. Admin only.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

function textContent(payload: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function toolError(message: string, code = "internal_error") {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code, message }, null, 2) }],
  };
}

async function getClerkEmails(userIds: string[]): Promise<Record<string, string>> {
  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (!clerkKey || userIds.length === 0) return {};
  const result: Record<string, string> = {};
  await Promise.allSettled(
    userIds.map(async (uid) => {
      const res = await fetch(`https://api.clerk.com/v1/users/${uid}`, {
        headers: { Authorization: `Bearer ${clerkKey}` },
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

export async function handleAdminTool(name: string, _args: Record<string, unknown>) {
  try {
    switch (name) {
      case "get_admin_stats": {
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

        return textContent({
          total_users: totalUsers,
          free_count: freeCount,
          pro_count: proCount,
          max_count: maxCount,
          executions_today: executionsToday,
        });
      }

      case "list_users": {
        const sb = getServiceClient();

        const { data: profiles, error } = await sb.from("profiles").select("*");
        if (error) return toolError(error.message);

        const userIds = (profiles ?? []).map(
          (p) => (p as Record<string, unknown>)["id"] as string,
        );

        const { data: brokerData } = await sb
          .from("broker_connections")
          .select("user_id")
          .eq("active", true);

        const connectedIds = new Set(
          (brokerData ?? []).map((r) => (r as Record<string, unknown>)["user_id"] as string),
        );

        const emailMap = await getClerkEmails(userIds);

        return textContent(
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

      default:
        return toolError(`Unknown admin tool: ${name}`, "not_found");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}

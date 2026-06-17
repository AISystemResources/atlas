/**
 * GET /api/v1/insights/today — return the most recent daily_learnings entry for the user.
 * Used by the BottomTabs Insights tab and the dashboard "yesterday's reflection" banner.
 */
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("daily_learnings")
    .select("trading_date, trade_count, win_count, learnings_summary, source, recommendations")
    .eq("user_id", user.userId)
    .order("trading_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json(null);
  return Response.json(data);
}

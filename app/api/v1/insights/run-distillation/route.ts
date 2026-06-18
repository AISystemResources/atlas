/**
 * POST /api/v1/insights/run-distillation
 *
 * Manual trigger for the daily distillation. Same code path as the 21:00 UTC
 * Inngest cron, scoped to the authenticated user only. Useful for debugging
 * (when the cron hasn't fired or errored) and for users who want their
 * reflection earlier than 17:00 ET without waiting.
 *
 * Optional query param ?date=YYYY-MM-DD — defaults to today in NY tz.
 */
import { getUserFromRequest } from "@/lib/auth/context";
import { distillUserDay } from "@/lib/scheduler/daily-distillation";
import { getNyTodayDate } from "@/lib/mcp-atlas/utils";

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rawDate = url.searchParams.get("date")?.trim();
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getNyTodayDate();

  try {
    const result = await distillUserDay(user.userId, date);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "distillation failed",
        trading_date: date,
      },
      { status: 500 },
    );
  }
}

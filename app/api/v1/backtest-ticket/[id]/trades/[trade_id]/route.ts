/**
 * GET /api/v1/backtest-ticket/[id]/trades/[trade_id] — single trade detail.
 *
 * Sprint 053c. Includes bars_around_entry jsonb so the inspector chart can
 * render without re-fetching from Yahoo. This payload is heavier than the
 * list endpoint by design — only fetched when the user drills in.
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; trade_id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, trade_id } = await params;
  const sb = getServiceClient();

  // Ownership check via the parent backtest row.
  const { data: backtest, error: btErr } = await sb
    .from("ticket_backtests")
    .select("id, user_id, ticker, timeframe, ticket_logics(name, version)")
    .eq("id", id)
    .maybeSingle();
  if (btErr) return Response.json({ error: btErr.message }, { status: 500 });
  if (!backtest) return Response.json({ error: "not found" }, { status: 404 });
  if (backtest.user_id !== user.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: trade, error: trErr } = await sb
    .from("ticket_backtest_trades")
    .select("*")
    .eq("backtest_id", id)
    .eq("id", trade_id)
    .maybeSingle();

  if (trErr) return Response.json({ error: trErr.message }, { status: 500 });
  if (!trade) return Response.json({ error: "trade not found" }, { status: 404 });

  const { data: review } = await sb
    .from("ticket_backtest_trade_reviews")
    .select("*")
    .eq("trade_id", trade_id)
    .maybeSingle();

  return Response.json({ backtest, trade, review: review ?? null });
}

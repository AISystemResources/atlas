/**
 * GET /api/v1/backtest-ticket/[id] — fetch one backtest with all trades.
 *
 * Sprint 053c. Single response so the detail page renders without a follow-up
 * round-trip. Trades are returned in entry_bar_index order.
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const sb = getServiceClient();

  const { data: backtest, error: btErr } = await sb
    .from("ticket_backtests")
    .select(
      "id, ticket_logic_id, user_id, ticker, timeframe, start_date, end_date, total_trades, winning_trades, losing_trades, win_rate, total_pnl_dollars, avg_pnl_dollars, max_drawdown_dollars, notional_per_trade, total_bars, created_at, ticket_logics(name, version, description)",
    )
    .eq("id", id)
    .maybeSingle();

  if (btErr) {
    return Response.json({ error: btErr.message }, { status: 500 });
  }
  if (!backtest) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (backtest.user_id !== user.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: trades, error: trErr } = await sb
    .from("ticket_backtest_trades")
    .select(
      "id, entry_bar_index, entry_ts, entry_price, take_profit_price, stop_loss_price, exit_bar_index, exit_ts, exit_price, exit_reason, pnl_dollars, pnl_pct, qty, indicator_snapshot",
    )
    .eq("backtest_id", id)
    .order("entry_bar_index", { ascending: true });

  if (trErr) {
    return Response.json({ error: trErr.message }, { status: 500 });
  }

  return Response.json({ backtest, trades: trades ?? [] });
}

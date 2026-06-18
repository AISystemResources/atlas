/**
 * POST /api/v1/backtest-ticket/[id]/trades/[trade_id]/review — Sprint 053d.
 *
 * Runs the per-trade AI reviewer synchronously, persists the result, and
 * returns it. The LLM call takes ~2s on Groq; no queuing.
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";
import { loadTicketLogic } from "@/lib/strategies/loader";
import { reviewTrade, saveTradeReview } from "@/lib/strategies/review-trade";

interface BacktestRow {
  user_id: string;
  ticker: string;
  timeframe: string;
  ticket_logic_id: string;
}

interface TradeRow {
  id: string;
  entry_bar_index: number;
  entry_ts: string;
  entry_price: number;
  take_profit_price: number;
  stop_loss_price: number;
  exit_bar_index: number | null;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  pnl_dollars: number | null;
  pnl_pct: number | null;
  indicator_snapshot: Record<string, number>;
  bars_around_entry: Array<{
    timestamp?: string;
    open?: number;
    high: number;
    low: number;
    close: number;
  }>;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; trade_id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, trade_id } = await params;
  const sb = getServiceClient();

  const { data: backtestData, error: btErr } = await sb
    .from("ticket_backtests")
    .select("user_id, ticker, timeframe, ticket_logic_id")
    .eq("id", id)
    .maybeSingle();
  if (btErr) return Response.json({ error: btErr.message }, { status: 500 });
  if (!backtestData) return Response.json({ error: "backtest not found" }, { status: 404 });
  const backtest = backtestData as BacktestRow;
  if (backtest.user_id !== user.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: tradeData } = await sb
    .from("ticket_backtest_trades")
    .select("*")
    .eq("backtest_id", id)
    .eq("id", trade_id)
    .maybeSingle();
  if (!tradeData) {
    return Response.json({ error: "trade not found" }, { status: 404 });
  }
  const trade = tradeData as TradeRow;

  // Load the Ticket Logic by id to get the body + description for prompt context.
  const { data: logicRow } = await sb
    .from("ticket_logics")
    .select("name, version")
    .eq("id", backtest.ticket_logic_id)
    .maybeSingle();
  if (!logicRow) {
    return Response.json({ error: "ticket_logic not found" }, { status: 404 });
  }
  const logic = await loadTicketLogic(
    (logicRow as { name: string }).name,
    (logicRow as { version: number }).version,
  );
  if (!logic) {
    return Response.json({ error: "ticket_logic load failed" }, { status: 500 });
  }

  const sliceStart = Math.max(0, trade.entry_bar_index - 50);
  const entryLocal = trade.entry_bar_index - sliceStart;
  const exitLocal =
    trade.exit_bar_index !== null ? trade.exit_bar_index - sliceStart : null;

  try {
    const result = await reviewTrade({
      trade_id: trade.id,
      strategy: {
        name: logic.name,
        version: logic.version,
        description: logic.description,
        body: logic.body,
      },
      ticker: backtest.ticker,
      timeframe: backtest.timeframe,
      entry: {
        timestamp: trade.entry_ts,
        price: Number(trade.entry_price),
        take_profit: Number(trade.take_profit_price),
        stop_loss: Number(trade.stop_loss_price),
        indicator_snapshot: trade.indicator_snapshot ?? {},
      },
      exit: {
        timestamp: trade.exit_ts,
        price: trade.exit_price !== null ? Number(trade.exit_price) : null,
        reason: trade.exit_reason,
        pnl_dollars: trade.pnl_dollars !== null ? Number(trade.pnl_dollars) : null,
        pnl_pct: trade.pnl_pct !== null ? Number(trade.pnl_pct) : null,
      },
      bars_around_entry: trade.bars_around_entry ?? [],
      entry_bar_index_local: entryLocal,
      exit_bar_index_local: exitLocal,
    });

    const saved = await saveTradeReview(trade.id, result);

    return Response.json({
      id: saved.id,
      review: result.review,
      model: result.model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[trade-review] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

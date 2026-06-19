/**
 * POST /api/v1/backtest-ticket/[id]/insight — Sprint 053e.
 *
 * Runs the aggregate backtest reviewer over all trades (+ any per-trade
 * reviews) and persists the insight. Returns the structured analysis with
 * the recommendation and any proposed parameter changes.
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";
import { loadTicketLogic } from "@/lib/strategies/loader";
import {
  reviewBacktest,
  saveBacktestInsight,
} from "@/lib/strategies/review-backtest";

interface BacktestRow {
  id: string;
  user_id: string;
  ticker: string;
  timeframe: string;
  ticket_logic_id: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number | null;
  total_pnl_dollars: number | null;
  avg_pnl_dollars: number | null;
  max_drawdown_dollars: number | null;
}

interface TradeRowLite {
  id: string;
  entry_ts: string;
  exit_ts: string | null;
  exit_reason: string | null;
  pnl_dollars: number | null;
  pnl_pct: number | null;
}

interface ReviewRowLite {
  trade_id: string;
  skill_or_luck: string;
  rationale: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const sb = getServiceClient();

  const { data: backtestData } = await sb
    .from("ticket_backtests")
    .select(
      "id, user_id, ticker, timeframe, ticket_logic_id, total_trades, winning_trades, losing_trades, win_rate, total_pnl_dollars, avg_pnl_dollars, max_drawdown_dollars",
    )
    .eq("id", id)
    .maybeSingle();
  if (!backtestData) {
    return Response.json({ error: "backtest not found" }, { status: 404 });
  }
  const backtest = backtestData as BacktestRow;
  if (backtest.user_id !== user.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (backtest.total_trades === 0) {
    return Response.json(
      { error: "cannot review a backtest with zero trades" },
      { status: 422 },
    );
  }

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

  const { data: tradeRows } = await sb
    .from("ticket_backtest_trades")
    .select("id, entry_ts, exit_ts, exit_reason, pnl_dollars, pnl_pct")
    .eq("backtest_id", id)
    .order("entry_bar_index", { ascending: true });

  const trades = (tradeRows ?? []) as TradeRowLite[];

  const { data: reviewRows } = await sb
    .from("ticket_backtest_trade_reviews")
    .select("trade_id, skill_or_luck, rationale")
    .in(
      "trade_id",
      trades.map((t) => t.id),
    );
  const reviewByTrade = new Map<string, ReviewRowLite>();
  for (const r of (reviewRows ?? []) as ReviewRowLite[]) {
    reviewByTrade.set(r.trade_id, r);
  }

  try {
    const result = await reviewBacktest({
      backtest_id: backtest.id,
      strategy: {
        name: logic.name,
        version: logic.version,
        description: logic.description,
        body: logic.body,
      },
      ticker: backtest.ticker,
      timeframe: backtest.timeframe,
      performance: {
        total_trades: backtest.total_trades,
        winning_trades: backtest.winning_trades,
        losing_trades: backtest.losing_trades,
        win_rate: backtest.win_rate,
        total_pnl_dollars: backtest.total_pnl_dollars,
        avg_pnl_dollars: backtest.avg_pnl_dollars,
        max_drawdown_dollars: backtest.max_drawdown_dollars,
      },
      trades: trades.map((t) => {
        const rev = reviewByTrade.get(t.id);
        return {
          entry_ts: t.entry_ts,
          exit_ts: t.exit_ts,
          exit_reason: t.exit_reason,
          pnl_dollars: t.pnl_dollars !== null ? Number(t.pnl_dollars) : null,
          pnl_pct: t.pnl_pct !== null ? Number(t.pnl_pct) : null,
          review_summary: rev
            ? { skill_or_luck: rev.skill_or_luck, rationale: rev.rationale }
            : undefined,
        };
      }),
    });

    const saved = await saveBacktestInsight(backtest.id, result);

    return Response.json({
      id: saved.id,
      insight: result.insight,
      model: result.model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backtest-insight] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * Sprint 079F: shared Llama-distillation pipeline.
 *
 * Extracted from the run_distillation MCP handler so it can also be invoked
 * automatically right after a backtest completes. Same code path; non-fatal
 * on failure so a distillation hiccup (LLM down, schema mismatch) never
 * fails the backtest itself.
 *
 * Used by:
 *   - lib/mcp-atlas/tools/write.ts → run_distillation (explicit user call)
 *   - lib/mcp-atlas/tools/write.ts → run_ticket_backtest (auto on success)
 *   - app/api/v1/backtest-ticket/route.ts → POST (auto on success)
 */

import { getServiceClient } from "@/lib/supabase-server";
import { loadTicketLogic } from "./loader";
import { reviewBacktest, saveBacktestInsight } from "./review-backtest";
import { runAbForwardTest, persistAbComparison } from "./ab-harness";

export interface AutoDistillResult {
  status: "ok";
  insight_id: string;
  model: string;
  recommendation: string;
  proposed_change_count: number;
  ab_comparison: unknown;
}

export interface AutoDistillSkipped {
  status: "skipped";
  reason: string;
}

export async function runLlamaDistillation(
  backtestId: string,
): Promise<AutoDistillResult | AutoDistillSkipped> {
  const sb = getServiceClient();

  // Load backtest summary (ownership not enforced here — caller is
  // expected to have already verified it).
  const { data: btData } = await sb
    .from("ticket_backtests")
    .select(
      "id, ticker, timeframe, ticket_logic_id, total_trades, winning_trades, losing_trades, win_rate, total_pnl_dollars, avg_pnl_dollars, max_drawdown_dollars",
    )
    .eq("id", backtestId)
    .maybeSingle();
  const bt = btData as
    | {
        id: string;
        ticker: string;
        timeframe: string;
        ticket_logic_id: string;
        total_trades: number;
        winning_trades: number | null;
        losing_trades: number | null;
        win_rate: number | null;
        total_pnl_dollars: number | null;
        avg_pnl_dollars: number | null;
        max_drawdown_dollars: number | null;
      }
    | null;
  if (!bt) return { status: "skipped", reason: "backtest not found" };
  if (bt.total_trades === 0) {
    return { status: "skipped", reason: "zero trades" };
  }

  const { data: logicRow } = await sb
    .from("ticket_logics")
    .select("name, version")
    .eq("id", bt.ticket_logic_id)
    .maybeSingle();
  if (!logicRow) return { status: "skipped", reason: "logic not found" };
  const logic = await loadTicketLogic(
    (logicRow as { name: string }).name,
    (logicRow as { version: number }).version,
  );
  if (!logic) return { status: "skipped", reason: "logic load failed" };

  const { data: tradeRows } = await sb
    .from("ticket_backtest_trades")
    .select("id, entry_ts, exit_ts, exit_reason, pnl_dollars, pnl_pct")
    .eq("backtest_id", backtestId)
    .order("entry_bar_index", { ascending: true });
  const trades = (tradeRows ?? []) as Array<{
    id: string;
    entry_ts: string;
    exit_ts: string | null;
    exit_reason: string | null;
    pnl_dollars: number | null;
    pnl_pct: number | null;
  }>;

  const { data: reviewRows } = await sb
    .from("ticket_backtest_trade_reviews")
    .select("trade_id, skill_or_luck, rationale")
    .in("trade_id", trades.map((t) => t.id));
  const reviewByTrade = new Map<string, { skill_or_luck: string; rationale: string }>();
  for (const r of (reviewRows ?? []) as Array<{
    trade_id: string;
    skill_or_luck: string;
    rationale: string;
  }>) {
    reviewByTrade.set(r.trade_id, { skill_or_luck: r.skill_or_luck, rationale: r.rationale });
  }

  const result = await reviewBacktest({
    backtest_id: bt.id,
    strategy: {
      name: logic.name,
      version: logic.version,
      description: logic.description,
      body: logic.body,
    },
    ticker: bt.ticker,
    timeframe: bt.timeframe,
    performance: {
      total_trades: bt.total_trades,
      winning_trades: bt.winning_trades ?? 0,
      losing_trades: bt.losing_trades ?? 0,
      win_rate: bt.win_rate,
      total_pnl_dollars: bt.total_pnl_dollars,
      avg_pnl_dollars: bt.avg_pnl_dollars,
      max_drawdown_dollars: bt.max_drawdown_dollars,
    },
    trades: trades.map((t) => {
      const rev = reviewByTrade.get(t.id);
      return {
        id: t.id,
        entry_ts: t.entry_ts,
        exit_ts: t.exit_ts,
        exit_reason: t.exit_reason,
        pnl_dollars: t.pnl_dollars != null ? Number(t.pnl_dollars) : null,
        pnl_pct: t.pnl_pct != null ? Number(t.pnl_pct) : null,
        review_summary: rev,
      };
    }),
  });
  const saved = await saveBacktestInsight(bt.id, result);

  // Forward A/B if proposed_changes is non-empty. Non-fatal.
  let abComparison: unknown = null;
  if (result.insight.proposed_changes.length > 0) {
    try {
      abComparison = await runAbForwardTest({
        original_backtest_id: bt.id,
        proposed_changes: result.insight.proposed_changes.map((c) => ({
          name: c.name,
          proposed_value: c.proposed_value,
        })),
      });
      await persistAbComparison(
        saved.id,
        abComparison as Awaited<ReturnType<typeof runAbForwardTest>>,
      );
    } catch (abErr) {
      console.error("[runLlamaDistillation] ab-harness failed (non-fatal):", abErr);
    }
  }

  return {
    status: "ok",
    insight_id: saved.id,
    model: result.model,
    recommendation: result.insight.recommendation,
    proposed_change_count: result.insight.proposed_changes.length,
    ab_comparison: abComparison,
  };
}

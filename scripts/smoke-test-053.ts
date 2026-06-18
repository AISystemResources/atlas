/**
 * Smoke test for the Sprint 053 arc — runs end-to-end via the backend.
 *
 * What it exercises:
 *   1. backtestTicketLogic on ^DJI 5m 58d
 *   2. reviewTrade on the first trade (if any)
 *   3. reviewBacktest aggregate
 *   4. (if recommendation = promote) applyParameterChanges + insert v2
 *
 * Run with:
 *   npx tsx scripts/smoke-test-053.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { backtestTicketLogic } from "@/lib/backtest-ticket/run";
import { reviewTrade, saveTradeReview } from "@/lib/strategies/review-trade";
import { reviewBacktest, saveBacktestInsight } from "@/lib/strategies/review-backtest";
import { loadTicketLogic } from "@/lib/strategies/loader";
import { applyParameterChanges } from "@/lib/strategies/tunable-params";
import { ticketLogicBodySchema } from "@/lib/strategies/schema";
import { getServiceClient } from "@/lib/supabase-server";

const EDMUND_USER_ID = "user_3B4k96FjK9wZUDi8Xs0AzeNLnvy";
const TICKER = "^DJI";
const LOGIC_NAME = "sandy-s1-long";
const TIMEFRAME = "5m" as const;

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("─".repeat(70));
  console.log("Sprint 053 end-to-end smoke test");
  console.log("─".repeat(70));

  // Date range: last 58 days (within Yahoo's 60-day 5m window).
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 57);

  console.log(`\n[1/4] Running backtest: ${LOGIC_NAME} on ${TICKER}`);
  console.log(`      range: ${dayString(start)} → ${dayString(end)} @ ${TIMEFRAME}`);
  console.log(`      user_id: ${EDMUND_USER_ID}`);

  let summary;
  try {
    summary = await backtestTicketLogic({
      logic_name: LOGIC_NAME,
      ticker: TICKER,
      start_date: dayString(start),
      end_date: dayString(end),
      timeframe: TIMEFRAME,
      userId: EDMUND_USER_ID,
    });
  } catch (err) {
    console.error("\n  ✗ FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`\n  ✓ Backtest created: ${summary.backtest_id}`);
  console.log(`     bars=${summary.total_bars}  trades=${summary.total_trades}`);
  console.log(
    `     wins=${summary.winning_trades}/${summary.losing_trades}  ` +
      `winrate=${summary.win_rate != null ? (summary.win_rate * 100).toFixed(1) + "%" : "—"}`,
  );
  console.log(
    `     totalPnL=$${summary.total_pnl_dollars?.toFixed(2) ?? "—"}  ` +
      `avg=$${summary.avg_pnl_dollars?.toFixed(2) ?? "—"}  ` +
      `maxDD=$${summary.max_drawdown_dollars?.toFixed(2) ?? "—"}`,
  );

  if (summary.total_trades === 0) {
    console.log("\n  ⚠ Zero trades — can't exercise reviewers. Stopping here.");
    console.log(`     This may mean S1 didn't fire on ${TICKER} in this window.`);
    console.log(`     The backtest itself succeeded (data flowed). UI is testable.`);
    return;
  }

  // ── Per-trade review on the first trade ─────────────────────────────────
  console.log(`\n[2/4] Running per-trade AI review on first trade`);
  const sb = getServiceClient();
  const { data: firstTrade } = await sb
    .from("ticket_backtest_trades")
    .select("*")
    .eq("backtest_id", summary.backtest_id)
    .order("entry_bar_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstTrade) {
    console.error("  ✗ No trade row found despite summary claiming trades");
    process.exit(1);
  }

  const logic = await loadTicketLogic(LOGIC_NAME);
  if (!logic) {
    console.error("  ✗ Cannot load ticket logic");
    process.exit(1);
  }

  const trade = firstTrade as Record<string, unknown>;
  const sliceStart = Math.max(0, Number(trade.entry_bar_index) - 50);
  const entryLocal = Number(trade.entry_bar_index) - sliceStart;
  const exitLocal =
    trade.exit_bar_index !== null
      ? Number(trade.exit_bar_index) - sliceStart
      : null;

  let reviewResult;
  try {
    reviewResult = await reviewTrade({
      trade_id: String(trade.id),
      strategy: {
        name: logic.name,
        version: logic.version,
        description: logic.description,
        body: logic.body,
      },
      ticker: TICKER,
      timeframe: TIMEFRAME,
      entry: {
        timestamp: String(trade.entry_ts),
        price: Number(trade.entry_price),
        take_profit: Number(trade.take_profit_price),
        stop_loss: Number(trade.stop_loss_price),
        indicator_snapshot: (trade.indicator_snapshot as Record<string, number>) ?? {},
      },
      exit: {
        timestamp: trade.exit_ts as string | null,
        price: trade.exit_price !== null ? Number(trade.exit_price) : null,
        reason: trade.exit_reason as string | null,
        pnl_dollars: trade.pnl_dollars !== null ? Number(trade.pnl_dollars) : null,
        pnl_pct: trade.pnl_pct !== null ? Number(trade.pnl_pct) : null,
      },
      bars_around_entry:
        (trade.bars_around_entry as unknown as Array<{
          timestamp?: string;
          open?: number;
          high: number;
          low: number;
          close: number;
        }>) ?? [],
      entry_bar_index_local: entryLocal,
      exit_bar_index_local: exitLocal,
    });
    await saveTradeReview(String(trade.id), reviewResult);
  } catch (err) {
    console.error("  ✗ Per-trade review failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`  ✓ Trade review: ${reviewResult.review.skill_or_luck} (conf=${(reviewResult.review.confidence * 100).toFixed(0)}%)`);
  console.log(`     ${reviewResult.review.rationale.slice(0, 120)}${reviewResult.review.rationale.length > 120 ? "…" : ""}`);
  if (reviewResult.review.suggested_adjustment) {
    const a = reviewResult.review.suggested_adjustment;
    console.log(`     suggestion: ${a.parameter} ${a.current_value} → ${a.proposed_value}`);
  }

  // ── Aggregate review ────────────────────────────────────────────────────
  console.log(`\n[3/4] Running aggregate review`);
  const { data: allTrades } = await sb
    .from("ticket_backtest_trades")
    .select("id, entry_ts, exit_ts, exit_reason, pnl_dollars, pnl_pct")
    .eq("backtest_id", summary.backtest_id)
    .order("entry_bar_index", { ascending: true });

  let insightResult;
  try {
    insightResult = await reviewBacktest({
      backtest_id: summary.backtest_id,
      strategy: {
        name: logic.name,
        version: logic.version,
        description: logic.description,
        body: logic.body,
      },
      ticker: TICKER,
      timeframe: TIMEFRAME,
      performance: {
        total_trades: summary.total_trades,
        winning_trades: summary.winning_trades,
        losing_trades: summary.losing_trades,
        win_rate: summary.win_rate,
        total_pnl_dollars: summary.total_pnl_dollars,
        avg_pnl_dollars: summary.avg_pnl_dollars,
        max_drawdown_dollars: summary.max_drawdown_dollars,
      },
      trades: ((allTrades ?? []) as Array<Record<string, unknown>>).map((t) => ({
        entry_ts: String(t.entry_ts),
        exit_ts: t.exit_ts as string | null,
        exit_reason: t.exit_reason as string | null,
        pnl_dollars: t.pnl_dollars !== null ? Number(t.pnl_dollars) : null,
        pnl_pct: t.pnl_pct !== null ? Number(t.pnl_pct) : null,
      })),
    });
    await saveBacktestInsight(summary.backtest_id, insightResult);
  } catch (err) {
    console.error("  ✗ Aggregate review failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`  ✓ Aggregate insight: ${insightResult.insight.recommendation}`);
  console.log(`     winning_pattern: ${insightResult.insight.winning_pattern.slice(0, 100)}…`);
  console.log(`     losing_pattern:  ${insightResult.insight.losing_pattern.slice(0, 100)}…`);
  console.log(`     ${insightResult.insight.proposed_changes.length} parameter change(s) proposed`);
  for (const c of insightResult.insight.proposed_changes) {
    console.log(`       · ${c.name}: ${c.current_value} → ${c.proposed_value}`);
  }

  // ── Promote (if recommended) ────────────────────────────────────────────
  if (
    insightResult.insight.recommendation === "promote" &&
    insightResult.insight.proposed_changes.length > 0
  ) {
    console.log(`\n[4/4] Promoting to v(N+1) — applying changes locally`);
    try {
      const newBody = applyParameterChanges(
        logic.body as unknown as Record<string, unknown>,
        insightResult.insight.proposed_changes,
        logic.name,
      );
      const valid = ticketLogicBodySchema.safeParse(newBody);
      if (!valid.success) {
        console.error("  ✗ New body fails Zod validation");
        console.error("    details:", JSON.stringify(valid.error.flatten(), null, 2));
        process.exit(1);
      }
      console.log(`  ✓ applyParameterChanges + Zod validate OK`);
      console.log(
        `     (skipping DB insert in smoke test — would create v${logic.version + 1} as draft)`,
      );
    } catch (err) {
      console.error("  ✗ Promotion failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    console.log(
      `\n[4/4] Skipped promote step — recommendation was "${insightResult.insight.recommendation}"`,
    );
  }

  console.log("\n" + "─".repeat(70));
  console.log(`✓ ALL CHECKS PASSED`);
  console.log("─".repeat(70));
  console.log(`Backtest URL: /dashboard/backtests/${summary.backtest_id}`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});

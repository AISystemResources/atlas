/**
 * Backtest runner for Ticket Logic — Sprint 053b.
 *
 * Synchronous, in-memory. Total runtime for 60 days of 5-min bars on ^DJI
 * is under one second — no Inngest needed at this scale.
 *
 * Sizing convention: backtests use FRACTIONAL qty (notional / entry_price)
 * regardless of asset class. Live execution rounds to whole shares for
 * equities, fractional for crypto. The fractional convention here makes
 * backtest statistics agnostic to share-count rounding noise.
 */

import { evaluate } from "@/lib/strategies/evaluate";
import { loadTicketLogic } from "@/lib/strategies/loader";
import { getServiceClient } from "@/lib/supabase-server";
import { type BacktestTimeframe } from "./fetch-bars";
import { fetchHistoricalBarsCached } from "./fetch-bars-cached";
import { simulateExit } from "./simulate-exit";

const BARS_AROUND_ENTRY = 50;

export interface BacktestInput {
  logic_name: string;
  version?: number;
  ticker: string;
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD */
  end_date: string;
  timeframe: BacktestTimeframe;
  /** Clerk user id; omitted for system-triggered backtests */
  userId?: string;
  /** Override the strategy's default sizing value */
  notionalPerTrade?: number;
}

export interface BacktestSummary {
  backtest_id: string;
  ticker: string;
  total_bars: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number | null;
  total_pnl_dollars: number;
  avg_pnl_dollars: number | null;
  max_drawdown_dollars: number;
}

export async function backtestTicketLogic(
  input: BacktestInput,
): Promise<BacktestSummary> {
  const logic = await loadTicketLogic(input.logic_name, input.version);
  if (!logic) {
    throw new Error(
      `Ticket Logic '${input.logic_name}'${input.version ? ` v${input.version}` : ""} not found`,
    );
  }

  const startDate = new Date(`${input.start_date}T00:00:00Z`);
  const endDate = new Date(`${input.end_date}T23:59:59Z`);

  const bars = await fetchHistoricalBarsCached(
    input.ticker,
    startDate,
    endDate,
    input.timeframe,
  );

  const entries = evaluate(logic.body, bars);

  const notional =
    input.notionalPerTrade ?? logic.body.entry.sizing.value;

  const sb = getServiceClient();

  const { data: btRow, error: btErr } = await sb
    .from("ticket_backtests")
    .insert({
      ticket_logic_id: logic.id,
      user_id: input.userId ?? null,
      ticker: input.ticker,
      timeframe: input.timeframe,
      start_date: input.start_date,
      end_date: input.end_date,
      notional_per_trade: notional,
      total_bars: bars.length,
    })
    .select("id")
    .single();
  if (btErr || !btRow) {
    throw new Error(`insert ticket_backtests: ${btErr?.message ?? "no row returned"}`);
  }
  const backtestId = btRow.id as string;

  interface TradeRow {
    backtest_id: string;
    entry_bar_index: number;
    entry_ts: string;
    entry_price: number;
    take_profit_price: number;
    stop_loss_price: number;
    exit_bar_index: number;
    exit_ts: string;
    exit_price: number;
    exit_reason: string;
    pnl_dollars: number;
    pnl_pct: number;
    qty: number;
    indicator_snapshot: Record<string, number>;
    bars_around_entry: unknown[];
  }

  const tradeRows: TradeRow[] = [];
  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;
  let winning = 0;
  let losing = 0;
  let totalPnl = 0;

  for (const entry of entries) {
    const exit = simulateExit({
      entryBarIndex: entry.bar_index,
      entryPrice: entry.entry_price,
      takeProfitPrice: entry.take_profit,
      stopLossPrice: entry.stop_loss,
      direction: entry.direction,
      bars,
      timeStop: logic.body.exit.time_stop,
    });

    const qty = round5(notional / entry.entry_price);
    if (qty <= 0) continue;

    const pnlPerShare =
      entry.direction === "long"
        ? exit.exitPrice - entry.entry_price
        : entry.entry_price - exit.exitPrice;
    const pnlDollars = round2(pnlPerShare * qty);
    const pnlPct = round4(pnlPerShare / entry.entry_price);

    totalPnl += pnlDollars;
    cumulativePnl += pnlDollars;
    peakPnl = Math.max(peakPnl, cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl);

    if (pnlDollars > 0) winning++;
    else if (pnlDollars < 0) losing++;

    const sliceStart = Math.max(0, entry.bar_index - BARS_AROUND_ENTRY);
    const sliceEnd = Math.min(bars.length, exit.exitBarIndex + 1 + 5); // a few bars past exit for context
    const barsAroundEntry = bars.slice(sliceStart, sliceEnd);

    tradeRows.push({
      backtest_id: backtestId,
      entry_bar_index: entry.bar_index,
      entry_ts: entry.bar_timestamp ?? "",
      entry_price: entry.entry_price,
      take_profit_price: entry.take_profit,
      stop_loss_price: entry.stop_loss,
      exit_bar_index: exit.exitBarIndex,
      exit_ts: exit.exitTimestamp,
      exit_price: exit.exitPrice,
      exit_reason: exit.exitReason,
      pnl_dollars: pnlDollars,
      pnl_pct: pnlPct,
      qty,
      indicator_snapshot: entry.indicator_snapshot,
      bars_around_entry: barsAroundEntry,
    });
  }

  const winRate =
    winning + losing > 0 ? round4(winning / (winning + losing)) : null;
  const avgPnl =
    tradeRows.length > 0 ? round2(totalPnl / tradeRows.length) : null;

  // From here on, if anything throws we delete the parent row so an orphaned
  // ticket_backtests row with total_trades=0 doesn't accumulate in the table.
  try {
    if (tradeRows.length > 0) {
      const { error: trErr } = await sb
        .from("ticket_backtest_trades")
        .insert(tradeRows);
      if (trErr) {
        throw new Error(`insert ticket_backtest_trades: ${trErr.message}`);
      }
    }

    const { error: upErr } = await sb
      .from("ticket_backtests")
      .update({
        total_trades: tradeRows.length,
        winning_trades: winning,
        losing_trades: losing,
        win_rate: winRate,
        total_pnl_dollars: round2(totalPnl),
        avg_pnl_dollars: avgPnl,
        max_drawdown_dollars: round2(maxDrawdown),
      })
      .eq("id", backtestId);
    if (upErr) {
      throw new Error(`update ticket_backtests: ${upErr.message}`);
    }
  } catch (err) {
    await sb.from("ticket_backtests").delete().eq("id", backtestId);
    throw err;
  }

  return {
    backtest_id: backtestId,
    ticker: input.ticker,
    total_bars: bars.length,
    total_trades: tradeRows.length,
    winning_trades: winning,
    losing_trades: losing,
    win_rate: winRate,
    total_pnl_dollars: round2(totalPnl),
    avg_pnl_dollars: avgPnl,
    max_drawdown_dollars: round2(maxDrawdown),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

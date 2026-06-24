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

import { loadTicketLogic } from "@/lib/strategies/loader";
import { getServiceClient } from "@/lib/supabase-server";
import { type BacktestTimeframe } from "./fetch-bars";
import { fetchHistoricalBarsCached } from "./fetch-bars-cached";
import { getBrokerProfile } from "@/lib/brokers/profiles";
import { inferAsset, simulateBacktest } from "./simulate";

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
  /** Sprint 077B.1: BrokerProfile id to apply during fill simulation.
   *  Default 'pure' (frictionless) so previous behaviour is preserved. */
  brokerProfileId?: string;
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
  /** Sprint 077B.1 */
  broker_profile_id: string;
  total_friction_dollars: number;
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

  // Sprint 080E: fetch secondary bar series for any indicators with a
  // timeframe override different from the primary timeframe.
  const secondaryTimeframes = [
    ...new Set(
      logic.body.indicators
        .filter((i) => i.timeframe && i.timeframe !== input.timeframe)
        .map((i) => i.timeframe!),
    ),
  ];
  const secondaryBarsMap: Record<string, import("@/lib/strategies/indicators").Bar[]> = {};
  for (const tf of secondaryTimeframes) {
    secondaryBarsMap[tf] = await fetchHistoricalBarsCached(
      input.ticker,
      startDate,
      endDate,
      tf as import("./fetch-bars").BacktestTimeframe,
    );
  }

  const notional =
    input.notionalPerTrade ?? logic.body.entry.sizing.value;

  // Sprint 077B.1: load the profile up-front; throws if invalid id.
  const profile = getBrokerProfile(input.brokerProfileId ?? "pure");
  const asset = inferAsset(input.ticker);

  // Sprint 053.2: pure compute extracted to simulate.ts so the A/B harness
  // can reuse it on forward windows without DB writes.
  const { trades: simTrades, stats } = simulateBacktest({
    body: logic.body,
    bars,
    notional,
    profile,
    asset,
    secondaryBars: secondaryTimeframes.length > 0 ? secondaryBarsMap : undefined,
  });

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
      broker_profile_id: profile.id,
    })
    .select("id")
    .single();
  if (btErr || !btRow) {
    throw new Error(`insert ticket_backtests: ${btErr?.message ?? "no row returned"}`);
  }
  const backtestId = btRow.id as string;

  const tradeRows = simTrades.map((t) => ({
    backtest_id: backtestId,
    entry_bar_index: t.entry_bar_index,
    entry_ts: t.entry_ts,
    entry_price: t.entry_price,
    take_profit_price: t.take_profit_price,
    stop_loss_price: t.stop_loss_price,
    exit_bar_index: t.exit_bar_index,
    exit_ts: t.exit_ts,
    exit_price: t.exit_price,
    exit_reason: t.exit_reason,
    pnl_dollars: t.pnl_dollars,
    pnl_points: t.pnl_points,
    pnl_pct: t.pnl_pct,
    qty: t.qty,
    indicator_snapshot: t.indicator_snapshot,
    bars_around_entry: t.bars_around_entry,
  }));

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
        total_trades: stats.total_trades,
        winning_trades: stats.winning_trades,
        losing_trades: stats.losing_trades,
        win_rate: stats.win_rate,
        total_pnl_dollars: stats.total_pnl_dollars,
        avg_pnl_dollars: stats.avg_pnl_dollars,
        max_drawdown_dollars: stats.max_drawdown_dollars,
        total_friction_dollars: stats.total_friction_dollars,
        total_pnl_points: stats.total_pnl_points,
        avg_pnl_points: stats.avg_pnl_points,
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
    total_bars: stats.total_bars,
    total_trades: stats.total_trades,
    winning_trades: stats.winning_trades,
    losing_trades: stats.losing_trades,
    win_rate: stats.win_rate,
    total_pnl_dollars: stats.total_pnl_dollars,
    avg_pnl_dollars: stats.avg_pnl_dollars,
    max_drawdown_dollars: stats.max_drawdown_dollars,
    broker_profile_id: profile.id,
    total_friction_dollars: stats.total_friction_dollars,
  };
}

/**
 * /dashboard/backtests/[id] — backtest detail.
 * Server-side fetches summary + trades + ownership-check, then renders client.
 */

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { BacktestDetailClient, type BacktestDetail, type Trade, type ExistingInsight } from "./BacktestDetailClient";

interface BacktestRowRaw {
  id: string;
  ticket_logic_id: string;
  user_id: string;
  ticker: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number | null;
  total_pnl_points: number | null;
  avg_pnl_points: number | null;
  max_drawdown_dollars: number | null;
  notional_per_trade: number;
  total_bars: number;
  created_at: string;
  ticket_logics: { name: string; version: number; description: string } | null;
}

export default async function BacktestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const { id } = await params;
  const sb = getServiceClient();

  const { data: row } = await sb
    .from("ticket_backtests")
    .select(
      "id, ticket_logic_id, user_id, ticker, timeframe, start_date, end_date, total_trades, winning_trades, losing_trades, win_rate, total_pnl_points, avg_pnl_points, max_drawdown_dollars, notional_per_trade, total_bars, created_at, ticket_logics(name, version, description)",
    )
    .eq("id", id)
    .maybeSingle();

  const backtest = row as unknown as BacktestRowRaw | null;
  if (!backtest) notFound();
  if (backtest.user_id !== userId) notFound();

  const { data: tradeRows } = await sb
    .from("ticket_backtest_trades")
    .select(
      "id, entry_bar_index, entry_ts, entry_price, take_profit_price, stop_loss_price, exit_bar_index, exit_ts, exit_price, exit_reason, pnl_points, pnl_pct, qty",
    )
    .eq("backtest_id", id)
    .order("entry_bar_index", { ascending: true });

  const trades = (tradeRows ?? []) as unknown as Trade[];

  const detail: BacktestDetail = {
    id: backtest.id,
    ticker: backtest.ticker,
    timeframe: backtest.timeframe,
    start_date: backtest.start_date,
    end_date: backtest.end_date,
    total_trades: backtest.total_trades,
    winning_trades: backtest.winning_trades,
    losing_trades: backtest.losing_trades,
    win_rate: backtest.win_rate,
    total_pnl_points: backtest.total_pnl_points,
    avg_pnl_points: backtest.avg_pnl_points,
    max_drawdown_dollars: backtest.max_drawdown_dollars,
    notional_per_trade: backtest.notional_per_trade,
    total_bars: backtest.total_bars,
    created_at: backtest.created_at,
    logic_name: backtest.ticket_logics?.name ?? null,
    logic_version: backtest.ticket_logics?.version ?? null,
    logic_description: backtest.ticket_logics?.description ?? null,
    ticket_logic_id: backtest.ticket_logic_id ?? null,
  };

  const { data: insightRow } = await sb
    .from("ticket_backtest_insights")
    .select("*")
    .eq("backtest_id", id)
    .maybeSingle();
  const insight = (insightRow ?? null) as ExistingInsight | null;

  return (
    <BacktestDetailClient
      detail={detail}
      trades={trades}
      initialInsight={insight}
    />
  );
}

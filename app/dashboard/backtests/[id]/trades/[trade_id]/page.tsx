/**
 * /dashboard/backtests/[id]/trades/[trade_id] — single-trade inspector.
 * Sprint 053c.
 */

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { TradeInspectorClient, type TradeWithBars, type ParentBacktest, type ExistingReview } from "./TradeInspectorClient";

interface BacktestRow {
  id: string;
  user_id: string;
  ticker: string;
  timeframe: string;
  ticket_logics: { name: string; version: number } | null;
}

export default async function TradeInspectorPage({
  params,
}: {
  params: Promise<{ id: string; trade_id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const { id, trade_id } = await params;
  const sb = getServiceClient();

  const { data: backtestRow } = await sb
    .from("ticket_backtests")
    .select("id, user_id, ticker, timeframe, ticket_logics(name, version)")
    .eq("id", id)
    .maybeSingle();

  const backtest = backtestRow as unknown as BacktestRow | null;
  if (!backtest) notFound();
  if (backtest.user_id !== userId) notFound();

  const { data: tradeRow } = await sb
    .from("ticket_backtest_trades")
    .select("*")
    .eq("backtest_id", id)
    .eq("id", trade_id)
    .maybeSingle();

  if (!tradeRow) notFound();

  const trade = tradeRow as unknown as TradeWithBars;

  const { data: reviewRow } = await sb
    .from("ticket_backtest_trade_reviews")
    .select("*")
    .eq("trade_id", trade_id)
    .maybeSingle();

  const review = (reviewRow ?? null) as ExistingReview | null;

  const parent: ParentBacktest = {
    id: backtest.id,
    ticker: backtest.ticker,
    timeframe: backtest.timeframe,
    logic_name: backtest.ticket_logics?.name ?? null,
    logic_version: backtest.ticket_logics?.version ?? null,
  };

  return <TradeInspectorClient backtest={parent} trade={trade} initialReview={review} />;
}

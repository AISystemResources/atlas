/**
 * /dashboard/backtests/compare?ids=<id1>,<id2>,... — Sprint 053f.
 *
 * Side-by-side comparison of multiple backtests. Server fetches each picked
 * backtest's summary + trades (PnL only, no bars_around_entry), filters out
 * any not owned by the current user, and renders the comparison client.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getServiceClient } from "@/lib/supabase-server";
import {
  CompareClient,
  type ComparedBacktest,
} from "./CompareClient";

interface BacktestRow {
  id: string;
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
  created_at: string;
  ticket_logics: { name: string; version: number } | null;
}

interface TradePnlRow {
  backtest_id: string;
  entry_bar_index: number;
  pnl_points: number | null;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const params = await searchParams;
  const idsParam = params.ids ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return (
      <div className="mx-auto p-6 text-gray-100" style={{ maxWidth: 1100 }}>
        <Link
          href="/dashboard/backtests"
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← All backtests
        </Link>
        <h1 className="text-2xl font-bold mt-4">Compare</h1>
        <p className="text-sm text-gray-400 mt-2">
          Pick two or more backtests from the list to compare them.
        </p>
      </div>
    );
  }

  const sb = getServiceClient();
  const { data: rows } = await sb
    .from("ticket_backtests")
    .select(
      "id, user_id, ticker, timeframe, start_date, end_date, total_trades, winning_trades, losing_trades, win_rate, total_pnl_points, avg_pnl_points, max_drawdown_dollars, notional_per_trade, created_at, ticket_logics(name, version)",
    )
    .in("id", ids);

  const rowsTyped = ((rows ?? []) as unknown as BacktestRow[]).filter(
    (r) => r.user_id === userId,
  );

  if (rowsTyped.length === 0) {
    return (
      <div className="mx-auto p-6 text-gray-100" style={{ maxWidth: 1100 }}>
        <Link
          href="/dashboard/backtests"
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← All backtests
        </Link>
        <h1 className="text-2xl font-bold mt-4">Compare</h1>
        <p className="text-sm text-red-400 mt-2">
          None of the picked backtests were found (or none owned by you).
        </p>
      </div>
    );
  }

  const { data: tradeRows } = await sb
    .from("ticket_backtest_trades")
    .select("backtest_id, entry_bar_index, pnl_points")
    .in(
      "backtest_id",
      rowsTyped.map((r) => r.id),
    )
    .order("entry_bar_index", { ascending: true });

  const trades = (tradeRows ?? []) as TradePnlRow[];

  const tradesByBacktest = new Map<string, number[]>();
  for (const t of trades) {
    const arr = tradesByBacktest.get(t.backtest_id) ?? [];
    arr.push(t.pnl_points != null ? Number(t.pnl_points) : 0);
    tradesByBacktest.set(t.backtest_id, arr);
  }

  // Preserve the order given in the URL so v1, v2, v3 line up visually.
  const sortedById = new Map(rowsTyped.map((r) => [r.id, r]));
  const compared: ComparedBacktest[] = ids
    .map((id) => sortedById.get(id))
    .filter((r): r is BacktestRow => Boolean(r))
    .map((r) => ({
      id: r.id,
      ticker: r.ticker,
      timeframe: r.timeframe,
      start_date: r.start_date,
      end_date: r.end_date,
      total_trades: r.total_trades,
      winning_trades: r.winning_trades,
      losing_trades: r.losing_trades,
      win_rate: r.win_rate,
      total_pnl_points: r.total_pnl_points,
      avg_pnl_points: r.avg_pnl_points,
      max_drawdown_dollars: r.max_drawdown_dollars,
      notional_per_trade: r.notional_per_trade,
      created_at: r.created_at,
      logic_name: r.ticket_logics?.name ?? null,
      logic_version: r.ticket_logics?.version ?? null,
      trade_pnls: tradesByBacktest.get(r.id) ?? [],
    }));

  return <CompareClient backtests={compared} />;
}

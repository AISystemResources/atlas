import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { PortfolioPageClient } from "./PortfolioPageClient";

export type StrategyHealth = {
  id: string;
  name: string;
  version: number;
  latestBacktest: {
    ticker: string;
    win_rate: number | null;
    total_pnl_points: number | null;
    total_trades: number;
    created_at: string;
  } | null;
};

export type BacktestTradeLite = {
  id: string;
  entry_ts: string;
  entry_price: number;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  pnl_points: number | null;
  qty: number | null;
  ticker: string;
  strategy_name: string;
};

export default async function PortfolioPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();

  const [profileResult, strategiesResult, pendingResult, tradesResult] = await Promise.all([
    sb.from("profiles").select("tier").eq("id", userId).maybeSingle(),

    sb.from("ticket_logics")
      .select("id, name, version, ticket_backtests(ticker, win_rate, total_pnl_points, total_trades, created_at)")
      .eq("status", "active")
      .order("created_at", { ascending: false }),

    sb.from("ticket_logics")
      .select("id", { count: "exact", head: true })
      .eq("status", "proposed"),

    sb.from("ticket_backtest_trades")
      .select("id, entry_ts, entry_price, exit_ts, exit_price, exit_reason, pnl_points, qty, ticket_backtests(ticker, ticket_logics(name))")
      .order("entry_ts", { ascending: false })
      .limit(20),
  ]);

  const p = profileResult.data as Record<string, unknown> | null;
  const VALID_TIERS = ["free", "pro", "max"] as const;
  const rawTier = String(p?.["tier"] ?? "free");
  const tier = (VALID_TIERS.includes(rawTier as typeof VALID_TIERS[number]) ? rawTier : "free") as "free" | "pro" | "max";

  // Build StrategyHealth list — pick the latest backtest per strategy
  const strategies: StrategyHealth[] = ((strategiesResult.data ?? []) as Record<string, unknown>[]).map((row) => {
    const backtests = (row["ticket_backtests"] as Record<string, unknown>[] | null) ?? [];
    const latest = backtests.sort((a, b) =>
      new Date(b["created_at"] as string).getTime() - new Date(a["created_at"] as string).getTime()
    )[0] ?? null;
    return {
      id: row["id"] as string,
      name: row["name"] as string,
      version: row["version"] as number,
      latestBacktest: latest ? {
        ticker: latest["ticker"] as string,
        win_rate: latest["win_rate"] as number | null,
        total_pnl_points: latest["total_pnl_points"] as number | null,
        total_trades: latest["total_trades"] as number,
        created_at: latest["created_at"] as string,
      } : null,
    };
  });

  const pendingCount = pendingResult.count ?? 0;

  // Flatten nested backtest trade rows
  const recentTrades: BacktestTradeLite[] = ((tradesResult.data ?? []) as Record<string, unknown>[]).map((row) => {
    const bt = row["ticket_backtests"] as Record<string, unknown> | null;
    const tl = bt?.["ticket_logics"] as Record<string, unknown> | null;
    return {
      id: row["id"] as string,
      entry_ts: row["entry_ts"] as string,
      entry_price: row["entry_price"] as number,
      exit_ts: row["exit_ts"] as string | null,
      exit_price: row["exit_price"] as number | null,
      exit_reason: row["exit_reason"] as string | null,
      pnl_points: row["pnl_points"] as number | null,
      qty: row["qty"] as number | null,
      ticker: (bt?.["ticker"] as string) ?? "—",
      strategy_name: (tl?.["name"] as string) ?? "—",
    };
  });

  return (
    <PortfolioPageClient
      tier={tier}
      strategies={strategies}
      pendingCount={pendingCount}
      recentTrades={recentTrades}
    />
  );
}

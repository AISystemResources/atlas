import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { getEffectiveTier } from "@/lib/auth/effective-tier";
import { PortfolioPageClient } from "./PortfolioPageClient";
import type { PublicStrategyPreview } from "./FreeDashboard";

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

export default async function PortfolioPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();

  // Sprint 103: dashboard splits cleanly by tier. Free users land on a
  // marketplace landing (top public strategies + how-it-works), Pro users
  // see the existing analytical view (their active strategies + recent
  // trades + watchlist). The split happens at the server fetch level so
  // we don't pull unused data.
  const tierInfo = await getEffectiveTier(userId);
  const tier = tierInfo.effective;

  if (tier === "free") {
    const topPicks = await fetchTopPublicStrategies(sb);
    return <PortfolioPageClient tier="free" topPicks={topPicks} />;
  }

  // Pro path — analytics dashboard
  const [strategiesResult, pendingResult] = await Promise.all([
    sb.from("ticket_logics")
      .select("id, name, version, ticket_backtests(ticker, win_rate, total_pnl_points, total_trades, created_at)")
      .neq("status", "archived")
      .order("created_at", { ascending: false }),

    sb.from("ticket_logics")
      .select("id", { count: "exact", head: true })
      .eq("status", "proposed"),
  ]);

  const allStrategies: StrategyHealth[] = ((strategiesResult.data ?? []) as Record<string, unknown>[]).map((row) => {
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

  // Collapse to latest version per family (matches Strategies + Research pages).
  const latestByFamily = new Map<string, StrategyHealth>();
  for (const s of allStrategies) {
    const prev = latestByFamily.get(s.name);
    if (!prev || s.version > prev.version) latestByFamily.set(s.name, s);
  }
  const strategies = Array.from(latestByFamily.values()).sort(
    (a, b) =>
      (b.latestBacktest?.total_pnl_points ?? -Infinity) -
      (a.latestBacktest?.total_pnl_points ?? -Infinity),
  );

  const pendingCount = pendingResult.count ?? 0;

  return (
    <PortfolioPageClient
      tier="pro"
      strategies={strategies}
      pendingCount={pendingCount}
    />
  );
}

// Sprint 103: rank public strategies by net pts so the dashboard surfaces
// the proven ones first. Verdict computation happens client-side from the
// same shape — kept in sync with FreeDashboard / StrategiesClient.
async function fetchTopPublicStrategies(
  sb: ReturnType<typeof getServiceClient>,
): Promise<PublicStrategyPreview[]> {
  type Row = {
    id: string;
    name: string;
    version: number;
    ticker: string | null;
    description: string;
    tags: string[] | null;
    ticket_backtests:
      | Array<{
          win_rate: number | null;
          total_pnl_points: number | null;
          total_trades: number;
          created_at: string;
        }>
      | null;
  };
  const { data: rows } = await sb
    .from("ticket_logics")
    .select(
      "id, name, version, ticker, description, tags, ticket_backtests(win_rate, total_pnl_points, total_trades, created_at)",
    )
    .eq("visibility", "public")
    .neq("status", "archived")
    .limit(40);

  const previews: PublicStrategyPreview[] = ((rows ?? []) as Row[]).map((r) => {
    const bts = r.ticket_backtests ?? [];
    const latest = bts
      .slice()
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ?? null;
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      ticker: r.ticker,
      description: r.description,
      win_rate: latest?.win_rate ?? null,
      total_pnl_points: latest?.total_pnl_points ?? null,
      total_trades: latest?.total_trades ?? 0,
      backtest_count: bts.length,
      paper_extracted: (r.tags ?? []).includes("paper-extracted"),
    };
  });

  // Sort: positive PnL first (descending), untested rows go to the bottom.
  previews.sort((a, b) => {
    const ap = a.total_pnl_points ?? -Infinity;
    const bp = b.total_pnl_points ?? -Infinity;
    return bp - ap;
  });

  return previews.slice(0, 5);
}

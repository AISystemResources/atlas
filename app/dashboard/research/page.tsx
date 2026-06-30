import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { ResearchClient, type ExtractedStrategy, type PaperRow } from "./ResearchClient";

export default async function ResearchPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data: paperData, error } = await sb
    .from("signal_papers")
    .select("id, title, source, source_url, abstract, ingested_at")
    .order("ingested_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[ResearchPage] signal_papers query failed:", error.message);
  }

  const papers = (paperData ?? []) as Array<{
    id: string;
    title: string;
    source: string;
    source_url: string | null;
    abstract: string | null;
    ingested_at: string;
  }>;

  // Sprint 105: enrich each paper with the strategies that were extracted
  // from it (paper → many strategies via parent_paper_id). Show only the
  // strategies visible to the caller: their own + public.
  const paperIds = papers.map((p) => p.id);
  const extractedByPaper = new Map<string, ExtractedStrategy[]>();

  if (paperIds.length > 0) {
    type StrategyRow = {
      id: string;
      name: string;
      version: number;
      ticker: string | null;
      visibility: "private" | "unlisted" | "public";
      created_by_user_id: string | null;
      parent_paper_id: string | null;
    };

    const { data: strategyRows } = await sb
      .from("ticket_logics")
      .select(
        "id, name, version, ticker, visibility, created_by_user_id, parent_paper_id",
      )
      .in("parent_paper_id", paperIds)
      .neq("status", "archived")
      .or(`visibility.eq.public,created_by_user_id.eq.${userId}`);

    const strategies = (strategyRows ?? []) as StrategyRow[];

    // Pull latest backtest per strategy + total backtest counts.
    const strategyIds = strategies.map((s) => s.id);
    const backtestCounts = new Map<string, number>();
    const latestBt = new Map<
      string,
      { win_rate: number | null; total_pnl_points: number | null; total_trades: number }
    >();
    if (strategyIds.length > 0) {
      type BtRow = {
        ticket_logic_id: string;
        win_rate: number | null;
        total_pnl_points: number | null;
        total_trades: number;
        created_at: string;
      };
      const { data: btRows } = await sb
        .from("ticket_backtests")
        .select("ticket_logic_id, win_rate, total_pnl_points, total_trades, created_at")
        .in("ticket_logic_id", strategyIds)
        .order("created_at", { ascending: false });
      for (const bt of (btRows ?? []) as BtRow[]) {
        backtestCounts.set(bt.ticket_logic_id, (backtestCounts.get(bt.ticket_logic_id) ?? 0) + 1);
        if (!latestBt.has(bt.ticket_logic_id)) {
          latestBt.set(bt.ticket_logic_id, {
            win_rate: bt.win_rate,
            total_pnl_points: bt.total_pnl_points,
            total_trades: bt.total_trades,
          });
        }
      }
    }

    for (const s of strategies) {
      if (!s.parent_paper_id) continue;
      const bucket = extractedByPaper.get(s.parent_paper_id) ?? [];
      const bt = latestBt.get(s.id);
      bucket.push({
        id: s.id,
        name: s.name,
        version: s.version,
        ticker: s.ticker,
        is_mine: s.created_by_user_id === userId,
        visibility: s.visibility,
        win_rate: bt?.win_rate ?? null,
        total_pnl_points: bt?.total_pnl_points ?? null,
        total_trades: bt?.total_trades ?? 0,
        backtest_count: backtestCounts.get(s.id) ?? 0,
      });
      extractedByPaper.set(s.parent_paper_id, bucket);
    }
  }

  const enriched: PaperRow[] = papers.map((p) => ({
    ...p,
    extracted_strategies: extractedByPaper.get(p.id) ?? [],
  }));

  return <ResearchClient initialPapers={enriched} />;
}

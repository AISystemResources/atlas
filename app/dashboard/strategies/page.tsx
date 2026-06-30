/**
 * /dashboard/strategies — Strategy Library (Sprint 061B).
 *
 * Server-fetches the caller's own strategies + all public strategies.
 * Replaces the backtests page as the primary "what does Atlas do" entry
 * point. Backtests become a per-strategy sub-view (clickable from detail).
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { buildAccessContext } from "@/lib/strategies/access";
import { StrategiesClient, type StrategyCard, type PaperRow } from "./StrategiesClient";

interface StrategyRow {
  id: string;
  name: string;
  version: number;
  parent_version_id: string | null;
  forked_from_id: string | null;
  parent_paper_id: string | null;
  created_by: string;
  description: string;
  status: "draft" | "active" | "archived";
  visibility: "private" | "unlisted" | "public";
  created_by_user_id: string | null;
  created_at: string;
  ticker: string | null;
  tags: string[] | null;
}

interface BacktestSummaryRow {
  ticket_logic_id: string;
  win_rate: number | null;
  total_pnl_points: number | null;
  total_trades: number;
  created_at: string;
}

export default async function StrategiesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const access = await buildAccessContext(userId);

  // Pull everything the user can see in one round trip:
  //   - their own strategies (any visibility)
  //   - public strategies
  //   - strategies shared with their email (Sprint 075a)
  // Bucket client-side.
  const sharedIds = [...access.sharedStrategyIds];
  const orClauses = [
    `created_by_user_id.eq.${userId}`,
    `visibility.eq.public`,
    ...(sharedIds.length > 0 ? [`id.in.(${sharedIds.join(",")})`] : []),
  ];
  const { data: rows } = await sb
    .from("ticket_logics")
    .select(
      "id, name, version, parent_version_id, forked_from_id, parent_paper_id, created_by, description, status, visibility, created_by_user_id, created_at, ticker, tags",
    )
    .or(orClauses.join(","))
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  const strategies = (rows ?? []) as unknown as StrategyRow[];

  // Group by (created_by_user_id, name) — show only the latest non-archived
  // version of each strategy family. Earlier versions are reachable via the
  // detail page's version navigator (Sprint 061C).
  const familyMap = new Map<string, StrategyRow>();
  for (const s of strategies) {
    const key = `${s.created_by_user_id ?? "—"}::${s.name}`;
    const existing = familyMap.get(key);
    if (!existing || s.version > existing.version) familyMap.set(key, s);
  }
  const latest = [...familyMap.values()];

  // Backtest counts + latest performance per strategy_id.
  const backtestCounts = new Map<string, number>();
  const latestBtMap = new Map<string, BacktestSummaryRow>();
  if (latest.length > 0) {
    const ids = latest.map((s) => s.id);
    const { data: btRows } = await sb
      .from("ticket_backtests")
      .select("ticket_logic_id, win_rate, total_pnl_points, total_trades, created_at")
      .in("ticket_logic_id", ids)
      .order("created_at", { ascending: false });
    for (const r of (btRows ?? []) as BacktestSummaryRow[]) {
      backtestCounts.set(r.ticket_logic_id, (backtestCounts.get(r.ticket_logic_id) ?? 0) + 1);
      if (!latestBtMap.has(r.ticket_logic_id)) latestBtMap.set(r.ticket_logic_id, r);
    }
  }

  // Which strategy is currently the user's scalper?
  const { data: profile } = await sb
    .from("profiles")
    .select("scalper_strategy_id")
    .eq("id", userId)
    .maybeSingle();
  const myScalperId =
    (profile as { scalper_strategy_id: string | null } | null)
      ?.scalper_strategy_id ?? null;

  // Sprint 102: enrich rows with provenance — paper title for paper-extracted
  // strategies, source strategy name for forks. Two batched lookups so the
  // card can render "From arXiv: <title>" / "Forked from <name>" directly.
  const paperIdsForLookup = [
    ...new Set(
      latest.map((s) => s.parent_paper_id).filter((v): v is string => v != null),
    ),
  ];
  const paperTitleMap = new Map<string, string>();
  if (paperIdsForLookup.length > 0) {
    try {
      const { data: paperRows } = await sb
        .from("signal_papers")
        .select("id, title")
        .in("id", paperIdsForLookup);
      for (const p of (paperRows ?? []) as { id: string; title: string }[]) {
        paperTitleMap.set(p.id, p.title);
      }
    } catch {
      // signal_papers may not exist in older envs — degrade gracefully
    }
  }

  const forkIdsForLookup = [
    ...new Set(
      latest.map((s) => s.forked_from_id).filter((v): v is string => v != null),
    ),
  ];
  const forkSourceMap = new Map<string, string>();
  if (forkIdsForLookup.length > 0) {
    const { data: forkRows } = await sb
      .from("ticket_logics")
      .select("id, name")
      .in("id", forkIdsForLookup);
    for (const f of (forkRows ?? []) as { id: string; name: string }[]) {
      forkSourceMap.set(f.id, f.name);
    }
  }

  const cards: StrategyCard[] = latest.map((s) => {
    const bt = latestBtMap.get(s.id);
    return {
      id: s.id,
      name: s.name,
      version: s.version,
      description: s.description,
      visibility: s.visibility,
      status: s.status,
      forked_from_id: s.forked_from_id,
      fork_source_name: s.forked_from_id ? forkSourceMap.get(s.forked_from_id) ?? null : null,
      parent_paper_id: s.parent_paper_id,
      parent_paper_title: s.parent_paper_id ? paperTitleMap.get(s.parent_paper_id) ?? null : null,
      created_by: s.created_by,
      is_mine: s.created_by_user_id === userId,
      owner_label: s.created_by_user_id === userId ? "you" : truncateUser(s.created_by_user_id),
      backtest_count: backtestCounts.get(s.id) ?? 0,
      is_my_scalper: s.id === myScalperId,
      created_at: s.created_at,
      ticker: s.ticker ?? null,
      tags: s.tags ?? [],
      paper_extracted: (s.tags ?? []).includes("paper-extracted"),
      latest_backtest: bt
        ? {
            win_rate: bt.win_rate,
            total_pnl_points: bt.total_pnl_points,
            total_trades: bt.total_trades,
          }
        : undefined,
    };
  });

  // Fetch arXiv papers — graceful empty fallback if migration not yet applied
  let papers: PaperRow[] = [];
  const extractedPaperIds = new Set<string>();
  try {
    const { data: paperRows } = await sb
      .from("signal_papers")
      .select("id, title, source, source_url, abstract, ingested_at")
      .order("ingested_at", { ascending: false })
      .limit(50);
    papers = (paperRows ?? []) as PaperRow[];

    // Which of these papers has the user already extracted into a strategy?
    if (papers.length > 0) {
      const paperIds = papers.map((p) => p.id);
      const { data: extractedRows } = await sb
        .from("ticket_logics")
        .select("parent_paper_id")
        .in("parent_paper_id", paperIds)
        .eq("created_by_user_id", userId)
        .neq("status", "archived");
      for (const r of (extractedRows ?? []) as { parent_paper_id: string }[]) {
        if (r.parent_paper_id) extractedPaperIds.add(r.parent_paper_id);
      }
    }
  } catch {
    // signal_papers table not yet created — show empty Papers tab
  }

  return <StrategiesClient cards={cards} papers={papers} extractedPaperIds={[...extractedPaperIds]} />;
}

function truncateUser(userId: string | null): string {
  if (!userId) return "—";
  if (userId.startsWith("user_")) return `@${userId.slice(5, 11)}`;
  return `@${userId.slice(0, 6)}`;
}

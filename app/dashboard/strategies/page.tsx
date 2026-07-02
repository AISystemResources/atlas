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

  // Sprint 125: group by (created_by_user_id, name). Show LATEST non-archived
  // version as the card headline. Sprint 127: fetch ALL versions per family
  // (including archived) in a separate query so the chevron widget can walk
  // the FULL improvement journey, not just the currently-active versions.
  const familyMap = new Map<string, StrategyRow[]>();
  for (const s of strategies) {
    const key = `${s.created_by_user_id ?? "—"}::${s.name}`;
    const arr = familyMap.get(key) ?? [];
    arr.push(s);
    familyMap.set(key, arr);
  }
  for (const arr of familyMap.values()) {
    arr.sort((a, b) => a.version - b.version);
  }
  const latest = [...familyMap.values()].map((arr) => arr[arr.length - 1]);

  // Sprint 127: separate query for the FULL version history per family
  // (including archived). The card headline still comes from `latest` above,
  // but the chevrons need the complete arc so users can walk v1 → v(n).
  const allVersionsByFamily = new Map<string, StrategyRow[]>();
  if (latest.length > 0) {
    const names = [...new Set(latest.map((s) => s.name))];
    const ownerIds = [
      ...new Set(
        latest
          .map((s) => s.created_by_user_id)
          .filter((v): v is string => v != null),
      ),
    ];
    const { data: allRows } = await sb
      .from("ticket_logics")
      .select(
        "id, name, version, parent_version_id, forked_from_id, parent_paper_id, created_by, description, status, visibility, created_by_user_id, created_at, ticker, tags",
      )
      .in("name", names)
      .in("created_by_user_id", ownerIds)
      .order("version", { ascending: true });
    for (const s of (allRows ?? []) as unknown as StrategyRow[]) {
      const key = `${s.created_by_user_id ?? "—"}::${s.name}`;
      const arr = allVersionsByFamily.get(key) ?? [];
      arr.push(s);
      allVersionsByFamily.set(key, arr);
    }
  }

  // Union of non-archived + full-history for the backtest lookup below.
  const allVersionsForListing = [
    ...new Map(
      [...familyMap.values(), ...allVersionsByFamily.values()]
        .flat()
        .map((s) => [s.id, s] as const),
    ).values(),
  ];

  // Backtest counts + latest performance per strategy_id (all versions).
  const backtestCounts = new Map<string, number>();
  const latestBtMap = new Map<string, BacktestSummaryRow>();
  if (allVersionsForListing.length > 0) {
    const ids = allVersionsForListing.map((s) => s.id);
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

  // Sprint 121: which strategies is the caller watching? Batched lookup so
  // every row can carry its own ⭐ prefix in the listing.
  const watchedSet = new Set<string>();
  {
    const { data: watchRows } = await sb
      .from("watched_strategies")
      .select("strategy_id")
      .eq("user_id", userId);
    for (const r of (watchRows ?? []) as Array<{ strategy_id: string }>) {
      watchedSet.add(r.strategy_id);
    }
  }

  // Sprint 102: enrich rows with provenance — paper title for paper-extracted
  // strategies, source strategy name for forks. Two batched lookups so the
  // card can render "From arXiv: <title>" / "Forked from <name>" directly.
  const paperIdsForLookup = [
    ...new Set(
      latest.map((s) => s.parent_paper_id).filter((v): v is string => v != null),
    ),
  ];
  const paperTitleMap = new Map<string, string>();
  // Sprint 126: also grab source_url so the row-hover source card can link
  // out to the arXiv paper directly.
  const paperUrlMap = new Map<string, string>();
  if (paperIdsForLookup.length > 0) {
    try {
      const { data: paperRows } = await sb
        .from("signal_papers")
        .select("id, title, source_url")
        .in("id", paperIdsForLookup);
      for (const p of (paperRows ?? []) as { id: string; title: string; source_url: string | null }[]) {
        paperTitleMap.set(p.id, p.title);
        if (p.source_url) paperUrlMap.set(p.id, p.source_url);
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
    // Sprint 127: pull ALL siblings (including archived) from the full-history
    // map, not the non-archived-only familyMap. Sprint 125's chevron widget
    // otherwise silently tops out at whatever's non-archived — e.g.,
    // sandy-s1-long only exposes v3+v4 while v1+v2 are archived in DB.
    const familyKey = `${s.created_by_user_id ?? "—"}::${s.name}`;
    const siblings =
      allVersionsByFamily.get(familyKey) ?? familyMap.get(familyKey) ?? [];
    const versions = siblings.map((sib) => {
      const sbt = latestBtMap.get(sib.id);
      return {
        id: sib.id,
        version: sib.version,
        created_at: sib.created_at,
        status: sib.status,
        latest_backtest: sbt
          ? {
              win_rate: sbt.win_rate,
              total_pnl_points: sbt.total_pnl_points,
              total_trades: sbt.total_trades,
            }
          : null,
      };
    });
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
      parent_paper_source_url: s.parent_paper_id ? paperUrlMap.get(s.parent_paper_id) ?? null : null,
      created_by: s.created_by,
      is_mine: s.created_by_user_id === userId,
      owner_label: s.created_by_user_id === userId ? "you" : truncateUser(s.created_by_user_id),
      backtest_count: backtestCounts.get(s.id) ?? 0,
      is_my_scalper: s.id === myScalperId,
      // Sprint 121: watch marker + recency signal.
      watched_by_me: watchedSet.has(s.id),
      created_at: s.created_at,
      ticker: s.ticker ?? null,
      tags: s.tags ?? [],
      paper_extracted: (s.tags ?? []).includes("paper-extracted"),
      // Sprint 125: sibling versions with per-version bt for the chevron toggle.
      versions,
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

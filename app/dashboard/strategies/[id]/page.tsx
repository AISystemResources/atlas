/**
 * /dashboard/strategies/[id] — strategy detail (Sprint 061C).
 *
 * Fetches: the strategy, its full version family (other versions chained by
 * name+author), recent backtests, and a preview of the structured rules
 * (rendered server-side so the page paints instantly).
 */

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { parseTicketLogicBody } from "@/lib/strategies/schema";
import { renderTicketLogicBody } from "@/lib/strategies/render-rules";
import { buildAccessContext, canRead } from "@/lib/strategies/access";
import {
  StrategyDetailClient,
  type StrategyDetail,
  type VersionFamilyEntry,
  type BacktestListEntry,
  type PendingProposal,
} from "./StrategyDetailClient";

interface StrategyRow {
  id: string;
  name: string;
  version: number;
  parent_version_id: string | null;
  forked_from_id: string | null;
  parent_paper_id: string | null;
  description: string;
  body: unknown;
  status: "draft" | "active" | "archived";
  visibility: "private" | "unlisted" | "public";
  created_by_user_id: string | null;
  created_at: string;
  ticker: string | null;
  tags: string[] | null;
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const { id } = await params;
  const sb = getServiceClient();

  const { data: rowData } = await sb
    .from("ticket_logics")
    .select(
      "id, name, version, parent_version_id, forked_from_id, parent_paper_id, description, body, status, visibility, created_by_user_id, created_at, ticker, tags",
    )
    .eq("id", id)
    .maybeSingle();

  const row = rowData as unknown as StrategyRow | null;
  if (!row) notFound();

  const isOwner = row.created_by_user_id === userId;

  // Sprint 075a: access check includes per-email shares.
  const access = await buildAccessContext(userId);
  if (!canRead(row, access)) notFound();
  const isSharedWithMe = !isOwner && access.sharedStrategyIds.has(row.id);

  // Version family: same (name, created_by_user_id) pair, ordered v1, v2, ...
  const { data: familyRows } = await sb
    .from("ticket_logics")
    .select("id, version, status, created_at")
    .eq("name", row.name)
    .eq("created_by_user_id", row.created_by_user_id)
    .order("version", { ascending: true });

  const family: VersionFamilyEntry[] = ((familyRows ?? []) as Array<{
    id: string;
    version: number;
    status: string;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    created_at: r.created_at,
    is_current: r.id === row.id,
  }));

  // Sprint 079E: surface the concrete next version number on the Promote
  // button instead of the abstract "v(N+1)" so non-technical users can
  // see exactly what they're creating before clicking.
  const nextVersion =
    family.length > 0 ? Math.max(...family.map((f) => f.version)) + 1 : row.version + 1;

  // Recent backtests targeting this exact strategy version.
  const { data: btRows } = await sb
    .from("ticket_backtests")
    .select(
      "id, ticker, timeframe, start_date, end_date, total_trades, win_rate, total_pnl_dollars, created_at",
    )
    .eq("ticket_logic_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  const backtests: BacktestListEntry[] = ((btRows ?? []) as Array<{
    id: string;
    ticker: string;
    timeframe: string;
    start_date: string;
    end_date: string;
    total_trades: number;
    win_rate: number | null;
    total_pnl_dollars: number | null;
    created_at: string;
  }>).map((r) => r);

  // Sprint 053.3: pending promote-proposals for THIS version. Owner-only —
  // promote is owner-gated anyway, no point showing the section to viewers
  // who couldn't act on it.
  let pendingProposals: PendingProposal[] = [];
  if (isOwner && backtests.length > 0) {
    const backtestIds = backtests.map((b) => b.id);
    const { data: insightRows } = await sb
      .from("ticket_backtest_insights")
      .select(
        "id, backtest_id, rationale, proposed_changes, ab_comparison, winning_trade_ids, losing_trade_ids, created_at, model",
      )
      .in("backtest_id", backtestIds)
      .eq("recommendation", "promote")
      .is("promoted_to_version_id", null)
      .order("created_at", { ascending: false });

    type ProposedChangeRow = {
      name: string;
      current_value: number;
      proposed_value: number;
      reason: string;
      supporting_trade_ids?: string[];
      original_proposed_value?: number;
      was_clamped?: boolean;
      clamp_reason?: string;
      max_step_pct?: number | null;
    };
    type InsightRowLite = {
      id: string;
      backtest_id: string;
      rationale: string | null;
      proposed_changes: ProposedChangeRow[] | null;
      ab_comparison: unknown;
      winning_trade_ids: string[] | null;
      losing_trade_ids: string[] | null;
      created_at: string;
      model: string;
    };
    const btMeta = new Map(
      backtests.map((b) => [b.id, { ticker: b.ticker, timeframe: b.timeframe }] as const),
    );
    pendingProposals = ((insightRows ?? []) as InsightRowLite[]).map((r) => ({
      insight_id: r.id,
      backtest_id: r.backtest_id,
      backtest_ticker: btMeta.get(r.backtest_id)?.ticker ?? "",
      backtest_timeframe: btMeta.get(r.backtest_id)?.timeframe ?? "",
      created_at: r.created_at,
      model: r.model,
      rationale: r.rationale,
      proposed_changes: (r.proposed_changes ?? []).map((c) => ({
        name: c.name,
        current_value: c.current_value,
        applied_value: c.proposed_value, // post-clamp value persisted into proposed_value
        original_proposed_value:
          c.original_proposed_value ?? c.proposed_value,
        was_clamped: c.was_clamped ?? false,
        clamp_reason: (c.clamp_reason ?? "") as
          | ""
          | "step"
          | "min"
          | "max",
        max_step_pct: c.max_step_pct ?? null,
        reason: c.reason,
        supporting_trade_ids: c.supporting_trade_ids ?? [],
      })),
      winning_trade_count: r.winning_trade_ids?.length ?? 0,
      losing_trade_count: r.losing_trade_ids?.length ?? 0,
      ab_comparison: r.ab_comparison as PendingProposal["ab_comparison"],
    }));
  }

  // Forked-from info, if any.
  let forkedFromLabel: string | null = null;
  if (row.forked_from_id) {
    const { data: src } = await sb
      .from("ticket_logics")
      .select("name, version, created_by_user_id")
      .eq("id", row.forked_from_id)
      .maybeSingle();
    if (src) {
      const r = src as { name: string; version: number; created_by_user_id: string | null };
      const author = r.created_by_user_id === userId ? "you" : truncateUser(r.created_by_user_id);
      forkedFromLabel = `${r.name} v${r.version} by ${author}`;
    }
  }

  // Am I currently using this as my scalper?
  const { data: profile } = await sb
    .from("profiles")
    .select("scalper_strategy_id")
    .eq("id", userId)
    .maybeSingle();
  const isMyScalper =
    ((profile as { scalper_strategy_id: string | null } | null)
      ?.scalper_strategy_id ?? null) === row.id;

  // If this strategy was extracted from a paper, fetch the source URL for the badge link.
  let paperSourceUrl: string | null = null;
  if (row.parent_paper_id) {
    const { data: paperRow } = await sb
      .from("signal_papers")
      .select("source_url")
      .eq("id", row.parent_paper_id)
      .maybeSingle();
    paperSourceUrl = (paperRow as { source_url: string } | null)?.source_url ?? null;
  }

  // Render the body to structured prose server-side.
  const body = parseTicketLogicBody(row.body);
  const rendered = renderTicketLogicBody(body);

  // Sprint 075a: when the caller is the owner, surface the share list.
  let shares: Array<{ email: string; granted_at: string }> = [];
  if (isOwner) {
    const { data: shareRows } = await sb
      .from("strategy_shares")
      .select("email, granted_at")
      .eq("strategy_id", row.id)
      .order("granted_at", { ascending: false });
    shares = (shareRows ?? []) as Array<{ email: string; granted_at: string }>;
  }

  const detail: StrategyDetail = {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    is_mine: isOwner,
    is_shared_with_me: isSharedWithMe,
    owner_label: isOwner ? "you" : truncateUser(row.created_by_user_id),
    forked_from_id: row.forked_from_id,
    forked_from_label: forkedFromLabel,
    parent_version_id: row.parent_version_id,
    is_my_scalper: isMyScalper,
    created_at: row.created_at,
    rendered,
    tunable_parameters: body.tunable_parameters ?? [],
    timeframe: body.timeframe,
    direction: body.direction,
    ticker: row.ticker ?? null,
    tags: row.tags ?? [],
    paper_extracted: (row.tags ?? []).includes("paper-extracted"),
    paper_source_url: paperSourceUrl,
    shares,
  };

  return (
    <StrategyDetailClient
      detail={detail}
      family={family}
      backtests={backtests}
      pendingProposals={pendingProposals}
      nextVersion={nextVersion}
    />
  );
}

function truncateUser(userId: string | null): string {
  if (!userId) return "—";
  if (userId.startsWith("user_")) return `@${userId.slice(5, 11)}`;
  return `@${userId.slice(0, 6)}`;
}

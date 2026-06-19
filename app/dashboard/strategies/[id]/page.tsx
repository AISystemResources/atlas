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
import {
  StrategyDetailClient,
  type StrategyDetail,
  type VersionFamilyEntry,
  type BacktestListEntry,
} from "./StrategyDetailClient";

interface StrategyRow {
  id: string;
  name: string;
  version: number;
  parent_version_id: string | null;
  forked_from_id: string | null;
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
      "id, name, version, parent_version_id, forked_from_id, description, body, status, visibility, created_by_user_id, created_at, ticker, tags",
    )
    .eq("id", id)
    .maybeSingle();

  const row = rowData as unknown as StrategyRow | null;
  if (!row) notFound();

  const isOwner = row.created_by_user_id === userId;
  const isReadable =
    row.visibility === "public" || row.visibility === "unlisted";
  if (!isOwner && !isReadable) notFound();

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

  // Render the body to structured prose server-side.
  const body = parseTicketLogicBody(row.body);
  const rendered = renderTicketLogicBody(body);

  const detail: StrategyDetail = {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    is_mine: isOwner,
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
  };

  return (
    <StrategyDetailClient
      detail={detail}
      family={family}
      backtests={backtests}
    />
  );
}

function truncateUser(userId: string | null): string {
  if (!userId) return "—";
  if (userId.startsWith("user_")) return `@${userId.slice(5, 11)}`;
  return `@${userId.slice(0, 6)}`;
}

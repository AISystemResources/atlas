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
import { StrategiesClient, type StrategyCard } from "./StrategiesClient";

interface StrategyRow {
  id: string;
  name: string;
  version: number;
  parent_version_id: string | null;
  forked_from_id: string | null;
  description: string;
  status: "draft" | "active" | "archived";
  visibility: "private" | "unlisted" | "public";
  created_by_user_id: string | null;
  created_at: string;
}

export default async function StrategiesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();

  // Pull everything the user can see in one round trip, then bucket client-side.
  const { data: rows } = await sb
    .from("ticket_logics")
    .select(
      "id, name, version, parent_version_id, forked_from_id, description, status, visibility, created_by_user_id, created_at",
    )
    .or(`created_by_user_id.eq.${userId},visibility.eq.public`)
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

  // Backtest counts per strategy_id (for "N backtests" badge).
  const backtestCounts = new Map<string, number>();
  if (latest.length > 0) {
    const ids = latest.map((s) => s.id);
    const { data: btRows } = await sb
      .from("ticket_backtests")
      .select("ticket_logic_id")
      .in("ticket_logic_id", ids);
    for (const r of (btRows ?? []) as Array<{ ticket_logic_id: string }>) {
      backtestCounts.set(r.ticket_logic_id, (backtestCounts.get(r.ticket_logic_id) ?? 0) + 1);
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

  const cards: StrategyCard[] = latest.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    description: s.description,
    visibility: s.visibility,
    status: s.status,
    forked_from_id: s.forked_from_id,
    is_mine: s.created_by_user_id === userId,
    owner_label: s.created_by_user_id === userId ? "you" : truncateUser(s.created_by_user_id),
    backtest_count: backtestCounts.get(s.id) ?? 0,
    is_my_scalper: s.id === myScalperId,
    created_at: s.created_at,
  }));

  return <StrategiesClient cards={cards} />;
}

function truncateUser(userId: string | null): string {
  if (!userId) return "—";
  if (userId.startsWith("user_")) return `@${userId.slice(5, 11)}`;
  return `@${userId.slice(0, 6)}`;
}

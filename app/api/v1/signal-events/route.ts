/**
 * GET /api/v1/signal-events
 *
 * Sprint 109 Phase 3: caller's recent signal events with strategy metadata
 * joined for display. Powers the Recent Signals card on the Execution page.
 *
 * Query params:
 *   limit=<number>   default 20, max 100
 *   include_executed=1  include already-executed rows (default: everything)
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(1, Number(limitRaw ?? 20) || 20), 100);

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("signal_events")
    .select(
      "id, strategy_id, bar_ts, direction, entry_price, take_profit, stop_loss, current_price, ticker, timeframe, detected_at, executed_at, tx_hash, execution_error, ticket_logics(name, version)",
    )
    .eq("user_id", user.userId)
    .order("detected_at", { ascending: false })
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const events = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const tl = r["ticket_logics"] as { name?: string; version?: number } | null;
    return {
      id: r["id"] as string,
      strategy_id: r["strategy_id"] as string,
      strategy_name: tl?.name ?? "—",
      strategy_version: tl?.version ?? null,
      bar_ts: r["bar_ts"] as string,
      direction: r["direction"] as "long" | "short",
      entry_price: r["entry_price"] as number | null,
      take_profit: r["take_profit"] as number | null,
      stop_loss: r["stop_loss"] as number | null,
      current_price: r["current_price"] as number | null,
      ticker: r["ticker"] as string | null,
      timeframe: r["timeframe"] as string | null,
      detected_at: r["detected_at"] as string,
      executed_at: r["executed_at"] as string | null,
      tx_hash: r["tx_hash"] as string | null,
      execution_error: r["execution_error"] as string | null,
    };
  });

  return Response.json({ events });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

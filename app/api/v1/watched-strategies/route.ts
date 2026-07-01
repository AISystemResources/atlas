/**
 * GET  /api/v1/watched-strategies   — list caller's watched strategies (with strategy name/ticker joined for UI)
 * POST /api/v1/watched-strategies   — { strategy_id } add a watch
 * DELETE /api/v1/watched-strategies?strategy_id=<uuid> — remove a watch
 *
 * Sprint 109 Phase 1: minimal REST for the watch toggle. UI wires in Phase 3.
 * Users can only watch strategies they can see (their own + public).
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("watched_strategies")
    .select("strategy_id, created_at, ticket_logics(id, name, version, ticker, visibility)")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ watched: data ?? [] });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { strategy_id } = body as { strategy_id?: string };
  if (!strategy_id) {
    return Response.json({ error: "strategy_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // Enforce visibility: caller must own the strategy OR it must be public.
  const { data: strat } = await sb
    .from("ticket_logics")
    .select("id, created_by_user_id, visibility, status")
    .eq("id", strategy_id)
    .maybeSingle();

  if (!strat) {
    return Response.json({ error: "strategy not found" }, { status: 404 });
  }
  const owns = strat.created_by_user_id === user.userId;
  const isPublic = strat.visibility === "public";
  if (!owns && !isPublic) {
    return Response.json({ error: "not authorized to watch this strategy" }, { status: 403 });
  }
  if (strat.status === "archived") {
    return Response.json({ error: "cannot watch archived strategy" }, { status: 400 });
  }

  const { error: upsertErr } = await sb
    .from("watched_strategies")
    .upsert(
      { user_id: user.userId, strategy_id },
      { onConflict: "user_id,strategy_id", ignoreDuplicates: true },
    );

  if (upsertErr) return Response.json({ error: upsertErr.message }, { status: 500 });

  return Response.json({ ok: true, strategy_id });
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const strategy_id = url.searchParams.get("strategy_id");
  if (!strategy_id) {
    return Response.json({ error: "strategy_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { error } = await sb
    .from("watched_strategies")
    .delete()
    .eq("user_id", user.userId)
    .eq("strategy_id", strategy_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, strategy_id });
}

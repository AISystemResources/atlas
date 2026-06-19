/**
 * POST /api/v1/user/scalper-strategy — set the caller's scalper_strategy_id.
 *
 * Sprint 061D. Body: { strategy_id }
 *
 * Validates that the caller owns the strategy OR it's public/unlisted. Any
 * row outside that set is rejected (private strategies of others can't be
 * pointed at). On success, the next minute's scalper tick for this user
 * uses the new strategy.
 */

import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

const BodySchema = z.object({
  strategy_id: z.string().uuid(),
});

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 422 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const sb = getServiceClient();

  // Verify the target strategy is one the caller can run.
  const { data: stratData } = await sb
    .from("ticket_logics")
    .select("id, created_by_user_id, visibility")
    .eq("id", parsed.data.strategy_id)
    .maybeSingle();
  const strat = stratData as
    | { id: string; created_by_user_id: string | null; visibility: string }
    | null;
  if (!strat) return Response.json({ error: "strategy not found" }, { status: 404 });

  const isMine = strat.created_by_user_id === user.userId;
  const isOpen = strat.visibility === "public" || strat.visibility === "unlisted";
  if (!isMine && !isOpen) {
    return Response.json(
      { error: "cannot run a private strategy you do not own" },
      { status: 403 },
    );
  }

  const { error } = await sb
    .from("profiles")
    .update({ scalper_strategy_id: strat.id })
    .eq("id", user.userId);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, scalper_strategy_id: strat.id });
}

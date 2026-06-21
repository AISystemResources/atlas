/**
 * PATCH /api/v1/watchlist/:ticker — Sprint 077A.7.
 *
 * Per-row update for the watchlist row. Today supports flipping
 * execution_mode (sim ↔ alpaca). The full PUT /v1/watchlist endpoint
 * is wipe-and-recreate; this is the surgical version for in-place
 * setting changes that don't touch the ticker / schedule.
 *
 * Switching a row to 'alpaca' is allowed even when the user hasn't
 * connected a broker — the scalper just skips the row until creds
 * appear. Caller UX should warn ahead of time.
 */

import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

const PatchSchema = z.object({
  execution_mode: z.enum(["sim", "alpaca"]).optional(),
  scalper_enabled: z.boolean().optional(),
  strategy_id: z.string().uuid().nullable().optional(),
  // Sprint 077B.2 — only consulted when execution_mode='sim'
  broker_profile_id: z
    .enum(["pure", "alpaca-paper", "alpaca-live", "ibkr-paper", "pepperstone-cfd-dow"])
    .optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 422 });
  }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "no updatable fields supplied" }, { status: 422 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("watchlist")
    .update(parsed.data)
    .eq("user_id", user.userId)
    .eq("ticker", ticker)
    .select("ticker, schedule, scalper_enabled, strategy_id, execution_mode, broker_profile_id")
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) {
    return Response.json(
      { error: `no watchlist row for ${ticker}` },
      { status: 404 },
    );
  }
  return Response.json(data);
}

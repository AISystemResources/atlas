/**
 * GET /api/v1/watchlist — return the user's watchlist
 * PUT /api/v1/watchlist — replace the user's watchlist (full overwrite)
 *
 * Response shape parity with backend/api/routes/watchlist.py.
 */
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient as _getServiceClientForTier } from "@/lib/supabase-server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

const WatchlistEntrySchema = z.object({
  ticker: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => /^[A-Z]{1,5}$/.test(v), "Ticker must be 1–5 letters"),
  schedule: z.enum(["1x", "3x", "6x"]),
});

const SaveWatchlistSchema = z.object({
  entries: z.array(WatchlistEntrySchema),
});

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("watchlist")
    .select("ticker, schedule")
    .eq("user_id", user.userId)
    .order("created_at");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

export async function PUT(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 422 });
  }

  const parsed = SaveWatchlistSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // Free tier: cap at 5 tickers
  if (parsed.data.entries.length > 5) {
    const sbTier = _getServiceClientForTier();
    const { data: prof } = await sbTier
      .from("profiles")
      .select("tier")
      .eq("id", user.userId)
      .maybeSingle();
    const tier = (prof as Record<string, unknown> | null)?.["tier"] as string ?? "free";
    if (tier === "free") {
      return Response.json(
        { error: "Free plan limited to 5 tickers", upgrade_url: "/pricing" },
        { status: 403 }
      );
    }
  }

  const sb = getServiceClient();

  // Sprint 068 + 077A.5: PUT does a wipe-and-recreate, but per-(user, ticker)
  // fields the caller doesn't send must survive — scalper_enabled, strategy_id,
  // and execution_mode (sim vs alpaca). Pull existing rows first so we can
  // re-stamp them on any ticker that survives the save.
  const { data: prev } = await sb
    .from("watchlist")
    .select("ticker, scalper_enabled, strategy_id, execution_mode")
    .eq("user_id", user.userId);
  const prevByTicker = new Map<
    string,
    { scalper_enabled: boolean; strategy_id: string | null; execution_mode: string }
  >();
  for (const r of (prev ?? []) as Array<{
    ticker: string;
    scalper_enabled: boolean | null;
    strategy_id: string | null;
    execution_mode: string | null;
  }>) {
    prevByTicker.set(r.ticker, {
      scalper_enabled: Boolean(r.scalper_enabled),
      strategy_id: r.strategy_id,
      execution_mode: r.execution_mode ?? "sim",
    });
  }

  await sb.from("watchlist").delete().eq("user_id", user.userId);

  if (parsed.data.entries.length > 0) {
    const rows = parsed.data.entries.map((e) => {
      const carried = prevByTicker.get(e.ticker);
      return {
        user_id: user.userId,
        ticker: e.ticker,
        schedule: e.schedule,
        scalper_enabled: carried?.scalper_enabled ?? false,
        strategy_id: carried?.strategy_id ?? null,
        execution_mode: carried?.execution_mode ?? "sim",
      };
    });
    const { error } = await sb.from("watchlist").insert(rows);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  const { data, error } = await sb
    .from("watchlist")
    .select("ticker, schedule")
    .eq("user_id", user.userId)
    .order("created_at");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

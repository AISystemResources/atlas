/**
 * GET /api/v1/trades — return the user's trade history from Supabase.
 *
 * Response shape parity with backend/api/routes/trades.py.
 */
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/auth/context";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = Math.min(
    rawLimit ? Math.max(1, parseInt(rawLimit, 10)) : 100,
    100,
  );

  const sb = getServiceClient();
  const [liveResult, simResult] = await Promise.all([
    sb
      .from("trades")
      .select("id, ticker, action, shares, price, status, boundary_mode, strategy, executed_at, order_id, realized_pnl")
      .eq("user_id", user.userId)
      .order("executed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit),
    // Sprint 077A.6: simulated_trades merged into the unified feed so the
    // Recent trades tab works for sim-only users too.
    sb
      .from("simulated_trades")
      .select("id, ticker, action, qty, price, strategy, sim_role, occurred_at")
      .eq("user_id", user.userId)
      .order("occurred_at", { ascending: false })
      .limit(limit),
  ]);

  if (liveResult.error) return Response.json({ error: liveResult.error.message }, { status: 500 });

  type TradeOut = {
    id: string;
    ticker: string;
    action: string;
    shares: number;
    price: number;
    status: string;
    boundary_mode: string | null;
    strategy: string | null;
    executed_at: string | null;
    order_id: string | null;
    realized_pnl: number | null;
    venue: "alpaca" | "sim";
  };

  const live: TradeOut[] = ((liveResult.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    ticker: String(r.ticker),
    action: String(r.action),
    shares: Number(r.shares),
    price: Number(r.price),
    status: String(r.status),
    boundary_mode: (r.boundary_mode as string | null) ?? null,
    strategy: (r.strategy as string | null) ?? null,
    executed_at: (r.executed_at as string | null) ?? null,
    order_id: (r.order_id as string | null) ?? null,
    realized_pnl: r.realized_pnl == null ? null : Number(r.realized_pnl),
    venue: "alpaca",
  }));

  const sim: TradeOut[] = ((simResult.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    ticker: String(r.ticker),
    action: String(r.action),
    shares: Number(r.qty),
    price: Number(r.price),
    status: "filled",
    boundary_mode: null,
    strategy: (r.strategy as string | null) ?? "scalper",
    executed_at: (r.occurred_at as string) ?? null,
    order_id: null,
    realized_pnl: null,
    venue: "sim",
  }));

  const merged = [...live, ...sim].sort((a, b) => {
    const ta = a.executed_at ? new Date(a.executed_at).getTime() : 0;
    const tb = b.executed_at ? new Date(b.executed_at).getTime() : 0;
    return tb - ta;
  });

  return Response.json(merged.slice(0, limit));
}

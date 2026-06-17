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
  const { data, error } = await sb
    .from("trades")
    .select("id, ticker, action, shares, price, status, boundary_mode, strategy, executed_at, order_id, realized_pnl")
    .eq("user_id", user.userId)
    .order("executed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

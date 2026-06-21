/**
 * GET  /api/v1/portfolio  — return user's portfolio summary from Alpaca + Supabase.
 * POST /api/v1/portfolio  — record a simulated trade in Supabase (no real broker call).
 *
 * Response shapes are parity with backend/api/routes/portfolio.py.
 */
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/auth/context";
import { loadSimPortfolio } from "@/lib/portfolio/sim-portfolio";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

const BASE_CAPITAL = 100_000.0;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();

  // Sprint 077A.6: sim portfolio is fetched in parallel with Alpaca and
  // merged into the response so users without a broker connection still
  // see their paper-trading state. Cash + positions + total value all
  // aggregate across the two venues.
  const simPromise = loadSimPortfolio(user.userId);

  // Fetch broker credentials from Supabase
  const connResult = await sb
    .from("broker_connections")
    .select("api_key, api_secret, environment")
    .eq("user_id", user.userId)
    .eq("broker", "alpaca")
    .eq("is_active", true)
    .maybeSingle();

  if (connResult.error) {
    console.error("[portfolio] broker_connections query error:", connResult.error.message);
  }
  if (!connResult.data) {
    // No Alpaca: return sim-only portfolio.
    const sim = await simPromise;
    if (!sim.has_simulator) {
      return Response.json({
        total_value: 0,
        cash: 0,
        pnl_today: 0,
        pnl_total: 0,
        positions: [],
      });
    }
    const pnlTotal = sim.equity - sim.starting_cash;
    const pnlOpen = sim.positions.reduce((s, p) => s + p.pnl, 0);
    return Response.json({
      total_value: sim.equity,
      cash: sim.cash,
      pnl_today: pnlOpen,
      pnl_total: pnlTotal,
      positions: sim.positions,
    });
  }

  const { api_key, api_secret, environment } = connResult.data;
  const baseUrl =
    environment === "paper"
      ? "https://paper-api.alpaca.markets"
      : "https://api.alpaca.markets";

  const headers = {
    "APCA-API-KEY-ID": api_key as string,
    "APCA-API-SECRET-KEY": api_secret as string,
  };

  try {
    const [accountRes, positionsRes] = await Promise.all([
      fetch(`${baseUrl}/v2/account`, { headers }),
      fetch(`${baseUrl}/v2/positions`, { headers }),
    ]);

    if (!accountRes.ok || !positionsRes.ok) {
      const body = await (accountRes.ok ? positionsRes : accountRes).text();
      console.error("[portfolio] Alpaca API error:", accountRes.status, positionsRes.status, body);
      return Response.json(
        { error: "Failed to fetch from Alpaca" },
        { status: 502 }
      );
    }

    const account = await accountRes.json();
    const rawPositions: unknown[] = await positionsRes.json();

    // Fetch trade metadata from Supabase for override button support
    let tradeByTicker: Record<string, Record<string, unknown>> = {};
    try {
      const tradesResult = await sb
        .from("trades")
        .select("id, ticker, executed_at, boundary_mode")
        .eq("user_id", user.userId)
        .neq("status", "overridden")
        .order("executed_at", { ascending: false });

      for (const t of tradesResult.data ?? []) {
        const row = t as Record<string, unknown>;
        const ticker = row["ticker"] as string;
        if (!(ticker in tradeByTicker)) {
          tradeByTicker = { ...tradeByTicker, [ticker]: row };
        }
      }
    } catch {
      // Graceful degradation — positions still return without override metadata
    }

    const alpacaPositions = (rawPositions as Record<string, unknown>[]).map((p) => {
      const ticker = p["symbol"] as string;
      const meta = tradeByTicker[ticker] ?? {};
      return {
        ticker,
        shares: Number(p["qty"]),
        avg_cost: Number(p["avg_entry_price"]),
        current_price: Number(p["current_price"]),
        pnl: Number(p["unrealized_pl"]),
        trade_id: (meta["id"] as string | undefined) ?? null,
        executed_at: (meta["executed_at"] as string | undefined) ?? null,
        boundary_mode: (meta["boundary_mode"] as string | undefined) ?? null,
        venue: "alpaca" as const,
      };
    });

    // Sprint 077A.6: merge sim portfolio in.
    const sim = await simPromise;
    const positions = [...alpacaPositions, ...sim.positions];
    const alpacaUnrealizedPl = alpacaPositions.reduce((sum, p) => sum + p.pnl, 0);
    const simUnrealizedPl = sim.positions.reduce((sum, p) => sum + p.pnl, 0);
    const alpacaEquity = Number(account["equity"]);
    const alpacaPnlTotal = alpacaEquity - BASE_CAPITAL;
    const simPnlTotal = sim.has_simulator ? sim.equity - sim.starting_cash : 0;

    return Response.json({
      total_value: Number(account["portfolio_value"]) + (sim.has_simulator ? sim.equity : 0),
      cash: Number(account["cash"]) + (sim.has_simulator ? sim.cash : 0),
      pnl_today: alpacaUnrealizedPl + simUnrealizedPl,
      pnl_total: alpacaPnlTotal + simPnlTotal,
      positions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

// ─── POST — simulated trade ───────────────────────────────────────────────────

interface SimulatedTradeRequest {
  ticker: string;
  action: "BUY" | "SELL";
  shares: number;
  price: number;
  boundary_mode?: string;
}

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SimulatedTradeRequest;
  try {
    body = (await req.json()) as SimulatedTradeRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 422 });
  }

  if (!body.ticker || !body.action || body.shares == null || body.price == null) {
    return Response.json(
      { error: "ticker, action, shares, and price are required" },
      { status: 422 }
    );
  }

  if (!["BUY", "SELL"].includes(body.action)) {
    return Response.json(
      { error: "action must be BUY or SELL" },
      { status: 422 }
    );
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("trades")
    .insert({
      user_id: user.userId,
      ticker: body.ticker.toUpperCase(),
      action: body.action,
      shares: body.shares,
      price: body.price,
      status: "simulated",
      boundary_mode: body.boundary_mode ?? null,
      executed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data, { status: 201 });
}

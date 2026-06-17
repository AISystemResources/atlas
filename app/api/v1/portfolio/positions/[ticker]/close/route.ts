/**
 * POST /api/v1/portfolio/positions/:ticker/close
 *
 * Manual close — user-triggered SELL of the full position via Alpaca.
 * Records the trade with closed_by='human' so the 4-cell autonomy attribution
 * tracks accurately. Idempotent on Alpaca's side (one position → one close order).
 */
import { AlpacaAdapter, BrokerError } from "@/lib/broker";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  if (!ticker) {
    return Response.json({ error: "ticker is required" }, { status: 400 });
  }

  let creds: Awaited<ReturnType<typeof getBrokerCredentials>>;
  try {
    creds = await getBrokerCredentials(user.userId);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Broker credentials unavailable" },
      { status: 400 },
    );
  }

  const broker = new AlpacaAdapter(creds.apiKey, creds.secretKey, creds.paper);

  // Confirm the user actually has a position to close
  const positions = await broker.getPositions();
  const position = positions.find((p) => p.ticker.toUpperCase() === ticker);
  if (!position) {
    return Response.json(
      { error: `No open position in ${ticker}` },
      { status: 404 },
    );
  }
  if (position.marketValue <= 0) {
    return Response.json(
      { error: `Position ${ticker} has zero market value` },
      { status: 400 },
    );
  }

  // Submit the SELL order
  let orderId: string | undefined;
  let status = "rejected";
  let placedShares: number | null = null;
  let errorMessage: string | undefined;
  try {
    const order = await broker.submitOrder({
      ticker,
      action: "SELL",
      notional: position.marketValue,
    });
    orderId = order.orderId;
    placedShares = order.qty;
    status =
      order.status === "filled"
        ? "filled"
        : order.status === "rejected" || order.status === "cancelled" || order.status === "expired"
          ? "rejected"
          : "pending";
  } catch (err) {
    errorMessage = err instanceof BrokerError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  // Look up portfolio_id for the trade insert
  const sb = getServiceClient();
  const { data: portfolio } = await sb
    .from("portfolios")
    .select("id")
    .eq("user_id", user.userId)
    .maybeSingle();
  const portfolioId = portfolio?.id as string | undefined;

  // Compute realized_pnl from the last BUY price
  let realizedPnl: number | null = null;
  const lastClose = position.currentPrice ?? position.avgCost;
  if (status === "filled" && placedShares != null && placedShares > 0) {
    const { data: lastBuy } = await sb
      .from("trades")
      .select("price")
      .eq("user_id", user.userId)
      .eq("ticker", ticker)
      .eq("action", "BUY")
      .eq("status", "filled")
      .order("executed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastBuy?.price) {
      realizedPnl =
        Math.round(((lastClose - Number(lastBuy.price)) * placedShares) * 10000) / 10000;
    }
  }

  if (portfolioId) {
    await sb.from("trades").insert({
      portfolio_id: portfolioId,
      user_id: user.userId,
      ticker,
      action: "SELL",
      shares: placedShares ?? 0,
      price: lastClose,
      status,
      boundary_mode: "autonomous", // any valid value; closed_by carries the human attribution
      signal_id: null,
      order_id: orderId ?? null,
      executed_at: status === "filled" ? new Date().toISOString() : null,
      realized_pnl: realizedPnl,
      // Sprint 048 Day 3 — user manually closed, not AI
      closed_by: "human",
      strategy: "manual",
    });
  }

  if (errorMessage) {
    return Response.json(
      {
        success: false,
        error: errorMessage,
        order_id: orderId ?? null,
        status,
      },
      { status: 500 },
    );
  }

  return Response.json({
    success: true,
    ticker,
    order_id: orderId ?? null,
    status,
    shares: placedShares,
    realized_pnl: realizedPnl,
    closed_by: "human",
  });
}

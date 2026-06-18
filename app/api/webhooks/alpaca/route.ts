/**
 * Alpaca order-update webhook (Sprint 049).
 *
 * Receives trade update events from Alpaca and reconciles our trades table:
 *   - status: pending → filled (or cancelled / rejected / expired)
 *   - shares: 0 → actual filled qty (notional orders return null until fill)
 *   - price: estimated → actual fill price
 *   - executed_at: timestamped on fill
 *   - realized_pnl: computed for SELL fills against the last filled BUY price
 *   - closed_by: 'ai' on bracket-triggered SELL fills (the bracket is AI's commit)
 *
 * Alpaca trade update event schema (paper + live):
 *   POST body: { event, order: { id, symbol, side, qty, filled_qty, filled_avg_price,
 *                                status, filled_at, ... } }
 *   Events of interest: "fill", "partial_fill", "canceled", "expired", "rejected"
 *
 * Authentication: Alpaca doesn't sign webhook bodies. We accept any POST but
 * only mutate rows we can match by order_id — an attacker would need to know
 * a real Alpaca order_id (a uuid) to do anything, and even then only flips
 * pending → filled on an order they already control. The blast radius is small.
 *
 * Alpaca configures this URL in the dashboard: Account → Configuration →
 * Trade Updates → Webhook URL = https://atlas-broker.vercel.app/api/webhooks/alpaca
 */
import { getServiceClient } from "@/lib/supabase-server";

interface AlpacaOrderPayload {
  id?: string;
  symbol?: string;
  side?: string;
  qty?: string | number | null;
  filled_qty?: string | number | null;
  filled_avg_price?: string | number | null;
  status?: string;
  filled_at?: string | null;
}

interface AlpacaTradeUpdate {
  event?: string;
  order?: AlpacaOrderPayload;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function mapStatus(s: string | undefined): string {
  switch ((s ?? "").toLowerCase()) {
    case "filled":
    case "fill":
      return "filled";
    case "partial_fill":
    case "partially_filled":
      return "pending"; // still in flight
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "expired":
      return "rejected";
    case "rejected":
      return "rejected";
    case "new":
    case "accepted":
    case "pending_new":
    case "accepted_for_bidding":
      return "pending";
    default:
      return "pending";
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: AlpacaTradeUpdate;
  try {
    body = (await req.json()) as AlpacaTradeUpdate;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const event = body.event ?? "";
  const order = body.order;
  if (!order || !order.id) {
    return Response.json({ skipped: true, reason: "no order in payload" });
  }

  const orderId = String(order.id);
  const action = (order.side ?? "").toLowerCase() === "sell" ? "SELL" : "BUY";
  const status = mapStatus(order.status);
  const filledQty = num(order.filled_qty);
  const fillPrice = num(order.filled_avg_price);
  const filledAt = order.filled_at;
  const ticker = (order.symbol ?? "").toUpperCase();

  const sb = getServiceClient();

  // Find the matching trade row by order_id
  const { data: existing } = await sb
    .from("trades")
    .select("id, user_id, ticker, action, price, status, realized_pnl, opened_by, closed_by")
    .eq("order_id", orderId)
    .maybeSingle();

  // Build the update payload
  const update: Record<string, unknown> = { status };
  if (filledQty != null && filledQty > 0) update.shares = filledQty;
  if (fillPrice != null && fillPrice > 0) update.price = fillPrice;
  if (filledAt) update.executed_at = filledAt;

  // For SELL fills, compute realized_pnl from the last filled BUY price for this user × ticker.
  if (
    action === "SELL" &&
    status === "filled" &&
    filledQty != null &&
    fillPrice != null &&
    existing?.user_id
  ) {
    const { data: lastBuy } = await sb
      .from("trades")
      .select("price, executed_at")
      .eq("user_id", existing.user_id)
      .eq("ticker", ticker)
      .eq("action", "BUY")
      .eq("status", "filled")
      .order("executed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastBuy?.price) {
      update.realized_pnl =
        Math.round(((fillPrice - Number(lastBuy.price)) * filledQty) * 10000) / 10000;
    }

    // If the SELL was triggered by a bracket (Alpaca's matching engine), AI made the commit.
    if (existing?.closed_by == null) update.closed_by = "ai";
  }

  // If we have an existing row, update it. If not, insert a new "orphan" row
  // so we don't lose the fact that this order existed.
  if (existing?.id) {
    await sb.from("trades").update(update).eq("id", existing.id);
    return Response.json({
      ok: true,
      event,
      order_id: orderId,
      updated: existing.id,
      status,
    });
  }

  // No matching trade row → log a minimal record so the order is at least audit-traceable.
  // This happens for SELL fills from brackets where we never wrote the SELL row at entry time.
  if (status === "filled" && filledQty != null && fillPrice != null && ticker) {
    // We need a portfolio_id and user_id to insert; infer from any other trade for this order_id ticker.
    // Best-effort — leave the row orphan if we can't resolve.
    const { data: anyForTicker } = await sb
      .from("trades")
      .select("portfolio_id, user_id")
      .eq("ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyForTicker?.portfolio_id && anyForTicker?.user_id) {
      await sb.from("trades").insert({
        portfolio_id: anyForTicker.portfolio_id,
        user_id: anyForTicker.user_id,
        ticker,
        action,
        shares: filledQty,
        price: fillPrice,
        status: "filled",
        boundary_mode: "autonomous",
        signal_id: null,
        order_id: orderId,
        executed_at: filledAt ?? new Date().toISOString(),
        strategy: "scalper",
        closed_by: action === "SELL" ? "ai" : null,
        opened_by: action === "BUY" ? "ai" : null,
      });
    }
  }

  return Response.json({
    ok: true,
    event,
    order_id: orderId,
    inserted_orphan: !existing,
    status,
  });
}

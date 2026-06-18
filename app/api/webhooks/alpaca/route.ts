/**
 * Alpaca order-update webhook (Sprint 049 / 049b).
 *
 * Receives trade update events from Alpaca's Broker API tier. NOT exercised
 * on the regular Trading API (paper / live) because that tier does not expose
 * a configurable webhook URL — order updates only stream via WebSocket, which
 * is not Vercel-friendly. For the Trading API tier, the polling reconciler at
 * lib/scheduler/order-reconciler-cron.ts handles fill reconciliation instead.
 *
 * Both paths share the same reconciliation logic in lib/scheduler/reconcile-order.ts.
 */
import { reconcileOrderUpdate } from "@/lib/scheduler/reconcile-order";

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
      return "pending";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "expired":
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

  const result = await reconcileOrderUpdate({
    orderId: String(order.id),
    ticker: (order.symbol ?? "").toUpperCase(),
    action: (order.side ?? "").toLowerCase() === "sell" ? "SELL" : "BUY",
    status: mapStatus(order.status),
    filledQty: num(order.filled_qty),
    fillPrice: num(order.filled_avg_price),
    filledAt: order.filled_at ?? null,
  });

  return Response.json({
    ok: true,
    event,
    order_id: order.id,
    ...result,
  });
}

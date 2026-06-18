/**
 * Sprint 049b — order reconciliation.
 *
 * Shared logic between two callers:
 *   1. POST /api/webhooks/alpaca — if Atlas is ever upgraded to the Broker API
 *      tier where Alpaca pushes trade updates to a webhook.
 *   2. Inngest cron (lib/scheduler/order-reconciler-cron.ts) — current path
 *      for the Trading API tier. Polls pending trades every minute during
 *      market hours and re-queries Alpaca per order.
 *
 * Both paths converge here: given an order's current state, update the
 * matching trades row (status, shares, price, executed_at, realized_pnl,
 * closed_by). On SELL fills, set closed_by='ai' so bracket-triggered exits
 * are attributed to the AI's committed bracket, not to a human action.
 */

import { getServiceClient } from "@/lib/supabase-server";

export interface ReconcilableOrderState {
  orderId: string;
  ticker: string;
  action: "BUY" | "SELL";
  status: string;            // expected to be in our internal vocabulary already
  filledQty: number | null;  // null when not yet filled
  fillPrice: number | null;  // null when not yet filled
  filledAt: string | null;   // ISO timestamp
}

export interface ReconcileResult {
  updated_row?: string;
  inserted_orphan?: boolean;
  skipped_reason?: string;
}

/**
 * Apply the latest order state to the trades table. Idempotent — running this
 * twice with the same fill data produces the same final row.
 */
export async function reconcileOrderUpdate(
  state: ReconcilableOrderState,
): Promise<ReconcileResult> {
  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("trades")
    .select(
      "id, user_id, ticker, action, price, status, realized_pnl, opened_by, closed_by",
    )
    .eq("order_id", state.orderId)
    .maybeSingle();

  const update: Record<string, unknown> = { status: state.status };
  if (state.filledQty != null && state.filledQty > 0) update.shares = state.filledQty;
  if (state.fillPrice != null && state.fillPrice > 0) update.price = state.fillPrice;
  if (state.filledAt) update.executed_at = state.filledAt;

  // realized_pnl for SELL fills — compute against the last filled BUY for this
  // user × ticker. closed_by defaults to 'ai' because bracket-triggered exits
  // (and webhook-driven manual closes) are both "AI's committed bracket fired".
  if (
    state.action === "SELL" &&
    state.status === "filled" &&
    state.filledQty != null &&
    state.fillPrice != null &&
    existing?.user_id
  ) {
    const { data: lastBuy } = await sb
      .from("trades")
      .select("price, executed_at")
      .eq("user_id", existing.user_id)
      .eq("ticker", state.ticker)
      .eq("action", "BUY")
      .eq("status", "filled")
      .order("executed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastBuy?.price) {
      update.realized_pnl =
        Math.round(((state.fillPrice - Number(lastBuy.price)) * state.filledQty) * 10000) /
        10000;
    }

    if (existing.closed_by == null) update.closed_by = "ai";
  }

  if (existing?.id) {
    // Skip the round-trip if the row is already in the target state.
    if (
      existing.status === state.status &&
      (state.filledQty == null || Number(existing.price) === state.fillPrice)
    ) {
      return { skipped_reason: "already_in_target_state" };
    }
    await sb.from("trades").update(update).eq("id", existing.id);
    return { updated_row: existing.id };
  }

  // Orphan path — no matching trade row exists. Insert a minimal record so we
  // don't lose the fact that this order existed. Rare in practice; happens if
  // a bracket SELL fires before we've recorded the entry BUY row.
  if (
    state.status === "filled" &&
    state.filledQty != null &&
    state.fillPrice != null &&
    state.ticker
  ) {
    const { data: anyForTicker } = await sb
      .from("trades")
      .select("portfolio_id, user_id")
      .eq("ticker", state.ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyForTicker?.portfolio_id && anyForTicker?.user_id) {
      await sb.from("trades").insert({
        portfolio_id: anyForTicker.portfolio_id,
        user_id: anyForTicker.user_id,
        ticker: state.ticker,
        action: state.action,
        shares: state.filledQty,
        price: state.fillPrice,
        status: "filled",
        boundary_mode: "autonomous",
        signal_id: null,
        order_id: state.orderId,
        executed_at: state.filledAt ?? new Date().toISOString(),
        strategy: "scalper",
        closed_by: state.action === "SELL" ? "ai" : null,
        opened_by: state.action === "BUY" ? "ai" : null,
      });
      return { inserted_orphan: true };
    }
  }

  return { skipped_reason: "no_matching_row_and_no_ticker_anchor" };
}

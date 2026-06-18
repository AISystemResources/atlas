/**
 * Order reconciler — Sprint 049b.
 *
 * Polls Alpaca for fills on any trades.status='pending' row. Updates the row
 * via reconcileOrderUpdate. Runs every minute during market hours via the
 * Inngest cron at order-reconciler-cron.ts.
 *
 * Why this exists: Alpaca's Trading API does not push trade updates to a
 * configurable webhook URL (that's a Broker API tier feature). The polling
 * loop is how we close the fill-reconciliation gap on the Vercel + Inngest
 * stack without needing a long-running WebSocket listener.
 */

import { createClient } from "@supabase/supabase-js";
import { AlpacaAdapter } from "@/lib/broker";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { reconcileOrderUpdate } from "./reconcile-order";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

const PENDING_AGE_SECONDS = 30; // wait this long before re-querying — gives Alpaca time to settle
const MAX_ROWS_PER_RUN = 100;   // cap to avoid pathological runs

interface PendingTradeRow {
  id: string;
  user_id: string;
  ticker: string;
  action: "BUY" | "SELL";
  order_id: string;
}

export interface ReconcilerResult {
  checked: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

export async function reconcilePendingTrades(): Promise<ReconcilerResult> {
  const result: ReconcilerResult = { checked: 0, updated: 0, skipped: 0, errors: [] };

  const sb = getServiceClient();
  const cutoff = new Date(Date.now() - PENDING_AGE_SECONDS * 1000).toISOString();

  const { data: pending, error } = await sb
    .from("trades")
    .select("id, user_id, ticker, action, order_id, created_at")
    .eq("status", "pending")
    .not("order_id", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS_PER_RUN);

  if (error) {
    result.errors.push(`pending query: ${error.message}`);
    return result;
  }
  if (!pending || pending.length === 0) return result;

  // Group by user — each user's Alpaca creds are different.
  const byUser = new Map<string, PendingTradeRow[]>();
  for (const row of pending as PendingTradeRow[]) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  for (const [userId, rows] of byUser.entries()) {
    let creds: { apiKey: string; secretKey: string; paper: boolean };
    try {
      creds = await getBrokerCredentials(userId);
    } catch (err) {
      // No credentials for this user — skip silently, the orders will stay pending.
      result.errors.push(
        `creds ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      result.skipped += rows.length;
      continue;
    }

    const broker = new AlpacaAdapter(creds.apiKey, creds.secretKey, creds.paper);

    for (const row of rows) {
      result.checked++;
      try {
        const order = await broker.getOrder(row.order_id);

        // Map our internal Order status to the reconciler vocabulary
        const status = order.status === "open" ? "pending" : order.status;

        const recRes = await reconcileOrderUpdate({
          orderId: order.orderId,
          ticker: order.ticker.toUpperCase(),
          action: order.action,
          status,
          filledQty: order.filledQty ?? null,
          fillPrice: order.filledAvgPrice ?? null,
          filledAt: order.filledAt ?? null,
        });

        if (recRes.updated_row || recRes.inserted_orphan) {
          result.updated++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors.push(
          `getOrder ${row.order_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return result;
}

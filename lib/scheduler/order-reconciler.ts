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

interface OpenBracketRow {
  user_id: string;
  ticker: string;
  take_profit_order_id: string | null;
  stop_loss_order_id: string | null;
}

export async function reconcilePendingTrades(): Promise<ReconcilerResult> {
  const result: ReconcilerResult = { checked: 0, updated: 0, skipped: 0, errors: [] };

  const sb = getServiceClient();
  const cutoff = new Date(Date.now() - PENDING_AGE_SECONDS * 1000).toISOString();

  // Query 1: pending entries (the historical reconciler path).
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

  // Query 2: open paired-bracket exits (Sprint 052). Filled entries with TP/SL
  // orders that haven't been reconciled yet — we poll them every minute too.
  const { data: openBrackets } = await sb
    .from("trades")
    .select("user_id, ticker, take_profit_order_id, stop_loss_order_id")
    .eq("strategy", "scalper")
    .eq("action", "BUY")
    .eq("status", "filled")
    .is("closed_by", null)
    .or("take_profit_order_id.not.is.null,stop_loss_order_id.not.is.null")
    .limit(MAX_ROWS_PER_RUN);

  const pendingRows = (pending ?? []) as PendingTradeRow[];
  const bracketRows = (openBrackets ?? []) as OpenBracketRow[];

  if (pendingRows.length === 0 && bracketRows.length === 0) return result;

  // Collect every (userId → orderIds[]) we need to poll, dedup across queries.
  const ordersByUser = new Map<string, Set<string>>();
  function add(userId: string, orderId: string | null) {
    if (!orderId) return;
    const set = ordersByUser.get(userId) ?? new Set<string>();
    set.add(orderId);
    ordersByUser.set(userId, set);
  }
  for (const row of pendingRows) add(row.user_id, row.order_id);
  for (const row of bracketRows) {
    add(row.user_id, row.take_profit_order_id);
    add(row.user_id, row.stop_loss_order_id);
  }

  for (const [userId, orderSet] of ordersByUser.entries()) {
    let creds: { apiKey: string; secretKey: string; paper: boolean };
    try {
      creds = await getBrokerCredentials(userId);
    } catch (err) {
      result.errors.push(
        `creds ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      result.skipped += orderSet.size;
      continue;
    }

    const broker = new AlpacaAdapter(creds.apiKey, creds.secretKey, creds.paper);

    for (const orderId of orderSet) {
      result.checked++;
      try {
        const order = await broker.getOrder(orderId);
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
          `getOrder ${orderId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return result;
}

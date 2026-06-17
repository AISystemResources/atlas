/**
 * Live trade execution step.
 *
 * Wires the autonomous-trading loop the BUILD ops checklist had parked
 * post-capstone. Called from pipeline-handler.ts after runGraph completes
 * a scheduler-triggered pipeline run.
 *
 * Trigger condition (all must hold):
 *   - boundary_mode === "autonomous"
 *   - portfolio_decision.action !== "HOLD"
 *   - portfolio_decision.confidence >= EBC confidence gate (0.65 green, 0.75 yellow, 1.0 red)
 *   - EBC canExecute === true (red blocks)
 *   - No existing trades row already exists for this signal_id (Inngest retry guard)
 *
 * On execute:
 *   - Resolves Alpaca credentials from broker_connections (per-user)
 *   - Calls AlpacaAdapter.submitOrder with notional = risk.position_value * ebcGate.notionalMultiplier
 *   - Inserts a row in `trades` (status: pending|filled|rejected based on Alpaca response)
 *   - Patches the reasoning_trace doc's `execution` field with order_id + status + shares + price
 *
 * Out of scope for this MVP (intentionally deferred):
 *   - Win/loss outcome wiring back into evaluateCircuitBreaker. That requires
 *     tracking exit price vs. entry, which happens at fill settlement, not at
 *     order submission. Follow-up sprint will hook trade settlement → EBC update.
 *   - Partial fills, GTC orders, limit orders, sophisticated retry. Market
 *     orders with day TIF only for now.
 *   - Market hours pre-check. Paper Alpaca accepts orders 24/7; live rejects
 *     outside hours and we surface that as a "rejected" trade row, no crash.
 */

import { MongoClient, ObjectId } from "mongodb";
import { createClient } from "@supabase/supabase-js";
import { AlpacaAdapter, BrokerError } from "@/lib/broker";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { getEffectiveGate } from "@/lib/boundary/circuit-breaker";

const MONGO_URI = process.env.MONGODB_URI!;
const MONGO_DB = process.env.MONGODB_DB_NAME ?? "atlas";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
}

interface PortfolioDecisionSlice {
  action?: string;
  confidence?: number;
  reasoning?: string;
}

interface RiskSlice {
  position_value?: number;
  position_size?: number;
  current_price?: number;
}

export interface ExecuteTradeInput {
  userId: string;
  ticker: string;
  mode: string;
  signalId: string | undefined;
  portfolioDecision: PortfolioDecisionSlice | undefined;
  risk: RiskSlice | undefined;
}

export interface ExecuteTradeOutcome {
  skipped: boolean;
  reason?: string;
  orderId?: string;
  tradeRowId?: string;
  status?: string;
}

export async function executeTrade(input: ExecuteTradeInput): Promise<ExecuteTradeOutcome> {
  const { userId, ticker, mode, signalId, portfolioDecision, risk } = input;

  // ── Trigger gate ────────────────────────────────────────────────────────
  if (mode !== "autonomous") {
    return { skipped: true, reason: "mode is not autonomous" };
  }
  const action = (portfolioDecision?.action ?? "HOLD").toUpperCase();
  if (action !== "BUY" && action !== "SELL") {
    return { skipped: true, reason: `action=${action} is not BUY or SELL` };
  }
  const confidence = portfolioDecision?.confidence ?? 0;
  const notional = risk?.position_value ?? 0;
  if (notional <= 0) {
    return { skipped: true, reason: "risk.position_value is 0" };
  }
  if (!signalId) {
    // save_trace runs before us in the graph, so this should always be set.
    // If it isn't, bail rather than risk an Alpaca order that can't be traced.
    return { skipped: true, reason: "signal_id missing — refusing to execute" };
  }

  // EBC gate — confidence threshold + notional multiplier depend on green/yellow/red.
  const ebcGate = await getEffectiveGate(userId);
  if (!ebcGate.canExecute) {
    return { skipped: true, reason: `ebc state ${ebcGate.state} blocks execution` };
  }
  if (confidence < ebcGate.confidenceGate) {
    return {
      skipped: true,
      reason: `confidence ${confidence} below ${ebcGate.state} gate ${ebcGate.confidenceGate}`,
    };
  }
  const scaledNotional = Math.round(notional * ebcGate.notionalMultiplier * 100) / 100;

  const sb = getServiceClient();

  // ── Idempotency check ─────────────────────────────────────────────────
  // The partial unique index on trades.signal_id is the DB-layer guard, but
  // we pre-check so we can return a clear outcome instead of swallowing a
  // 23505 constraint violation.
  const { data: existing } = await sb
    .from("trades")
    .select("id, status, order_id")
    .eq("signal_id", signalId)
    .maybeSingle();

  if (existing) {
    return {
      skipped: true,
      reason: "trade already exists for this signal_id (idempotent retry)",
      orderId: existing.order_id ?? undefined,
      tradeRowId: existing.id as string,
      status: existing.status as string,
    };
  }

  // ── Resolve broker creds + portfolio_id ──────────────────────────────
  let creds: { apiKey: string; secretKey: string; paper: boolean };
  try {
    creds = await getBrokerCredentials(userId);
  } catch (err) {
    return {
      skipped: true,
      reason: `getBrokerCredentials failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { data: portfolio } = await sb
    .from("portfolios")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  const portfolioId = portfolio?.id as string | undefined;
  if (!portfolioId) {
    return { skipped: true, reason: "no portfolio row for user" };
  }

  // ── Submit Alpaca order ───────────────────────────────────────────────
  const broker = new AlpacaAdapter(creds.apiKey, creds.secretKey, creds.paper);

  let alpacaOrderId: string | undefined;
  let alpacaStatus = "rejected";
  let errorMessage: string | undefined;
  let placedShares: number | null = null;
  const placedPrice: number | null = risk?.current_price ?? null;

  try {
    const order = await broker.submitOrder({
      ticker,
      action,
      notional: scaledNotional,
    });
    alpacaOrderId = order.orderId;
    alpacaStatus =
      order.status === "filled"
        ? "filled"
        : order.status === "rejected" || order.status === "cancelled" || order.status === "expired"
          ? "rejected"
          : "pending";
    placedShares = order.qty;
  } catch (err) {
    if (err instanceof BrokerError) {
      errorMessage = err.message;
    } else {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Persist trades row ────────────────────────────────────────────────
  // Insert even on rejection so the rejection is auditable. The unique index
  // on signal_id guards against the Inngest-retry-double-order race.
  const insertPayload: Record<string, unknown> = {
    portfolio_id: portfolioId,
    user_id: userId,
    ticker,
    action,
    shares: placedShares ?? 0,
    price: placedPrice ?? 0,
    status: alpacaStatus,
    boundary_mode: mode,
    signal_id: signalId,
    order_id: alpacaOrderId ?? null,
    executed_at: alpacaStatus === "filled" ? new Date().toISOString() : null,
  };

  const { data: insertedTrade, error: insertError } = await sb
    .from("trades")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError) {
    // 23505 = unique_violation. Means a parallel run beat us to it; treat as
    // successful idempotent skip.
    if (insertError.code === "23505") {
      return {
        skipped: true,
        reason: "concurrent execute lost the race (unique_violation on signal_id)",
      };
    }
    return {
      skipped: true,
      reason: `failed to insert trades row: ${insertError.message}`,
      orderId: alpacaOrderId,
    };
  }

  // ── Patch reasoning_trace.execution ──────────────────────────────────
  // Stamps the trace doc so dashboards and downstream consumers see the
  // outcome side-by-side with the signal that generated it.
  const mongo = new MongoClient(MONGO_URI);
  try {
    await mongo.connect();
    await mongo
      .db(MONGO_DB)
      .collection("reasoning_traces")
      .updateOne(
        { _id: new ObjectId(signalId) },
        {
          $set: {
            execution: {
              status: alpacaStatus,
              order_id: alpacaOrderId ?? null,
              shares: placedShares,
              price: placedPrice,
              error: errorMessage ?? null,
              executed_at: new Date().toISOString(),
            },
          },
        },
      );
  } catch (err) {
    console.error(
      "[execute_trade] failed to patch reasoning_traces.execution:",
      err instanceof Error ? err.message : String(err),
    );
    // Don't fail the step — the trades row is the source of truth; the
    // trace doc patch is convenience for the UI.
  } finally {
    await mongo.close();
  }

  if (errorMessage) {
    console.error(`[execute_trade] ${ticker} ${action} rejected: ${errorMessage}`);
  } else {
    console.info(
      `[execute_trade] ${ticker} ${action} notional=$${scaledNotional} status=${alpacaStatus} order_id=${alpacaOrderId ?? "n/a"}`,
    );
  }

  return {
    skipped: false,
    orderId: alpacaOrderId,
    tradeRowId: insertedTrade.id as string,
    status: alpacaStatus,
  };
}

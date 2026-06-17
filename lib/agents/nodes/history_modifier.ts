/**
 * History Modifier — deterministic confidence modifier based on past trade P&L.
 *
 * Reads closed SELL trades (with realized_pnl) from Supabase that were executed
 * STRICTLY BEFORE as_of_date (look-ahead guard). Computes a bounded modifier
 * in [-0.15, +0.15] that adjusts the portfolio decision's confidence score.
 *
 * Modifier function:
 *   modifier = clamp(2 * (win_rate - 0.5) * min(1, n / 20), -0.15, +0.15)
 *
 * Cold-start: returns modifier=0 when fewer than 5 matched trades exist.
 * Error path: falls through to modifier=0 (safe, not silent — logged).
 *
 * This is NOT the review_analyst (LLM-based, reads MongoDB reasoning_traces).
 * This node is entirely deterministic — no LLM calls on the modifier path.
 */

import { createClient } from "@supabase/supabase-js";
import type { AtlasState } from "../state";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

const COLD_START_MINIMUM = 5;
const MODIFIER_CAP = 0.15;
const FULL_WEIGHT_THRESHOLD = 20;
const QUERY_LIMIT = 50;

export interface HistoryModifierResult {
  win_rate: number;
  n_trades: number;
  modifier: number;
  confidence_modified: number;
  enabled: boolean;
}

export interface ComputeHistoryModifierOptions {
  userId: string;
  asOfDate: string;
  baseConfidence: number;
  enabled?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure computation logic — exported for unit testing without graph wiring.
 */
export async function computeHistoryModifier(
  opts: ComputeHistoryModifierOptions,
): Promise<HistoryModifierResult> {
  const { userId, asOfDate, baseConfidence, enabled = true } = opts;

  if (!enabled) {
    return {
      win_rate: 0,
      n_trades: 0,
      modifier: 0,
      confidence_modified: baseConfidence,
      enabled: false,
    };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  // Look-ahead guard: only trades executed strictly before as_of_date.
  // No realized_pnl filter at query level — null rows are filtered in TypeScript below.
  const { data, error } = await sb
    .from("trades")
    .select("realized_pnl, executed_at")
    .eq("user_id", userId)
    .eq("action", "SELL")
    .eq("status", "filled")
    .lt("executed_at", asOfDate)
    .order("executed_at", { ascending: false })
    .limit(QUERY_LIMIT);

  if (error || !data) {
    console.error(
      `[history_modifier] Supabase query failed for user=${userId}: ${error?.message ?? "null data"}`,
    );
    return {
      win_rate: 0,
      n_trades: 0,
      modifier: 0,
      confidence_modified: baseConfidence,
      enabled: true,
    };
  }

  // Only count trades where realized_pnl was recorded (populated on SELL insertion)
  const tradesWithPnl = (data as { realized_pnl: number | null; executed_at: string }[]).filter(
    (t) => t.realized_pnl !== null,
  );

  const n = tradesWithPnl.length;

  if (n < COLD_START_MINIMUM) {
    return {
      win_rate: 0,
      n_trades: n,
      modifier: 0,
      confidence_modified: baseConfidence,
      enabled: true,
    };
  }

  const wins = tradesWithPnl.filter((t) => (t.realized_pnl as number) > 0).length;
  const winRate = wins / n;

  const modifier = clamp(
    2 * (winRate - 0.5) * Math.min(1, n / FULL_WEIGHT_THRESHOLD),
    -MODIFIER_CAP,
    MODIFIER_CAP,
  );

  return {
    win_rate: winRate,
    n_trades: n,
    modifier,
    confidence_modified: clamp(baseConfidence + modifier, 0, 1),
    enabled: true,
  };
}

/**
 * LangGraph node — wraps computeHistoryModifier with state I/O.
 */
export async function historyModifierNode(
  state: AtlasState,
): Promise<Partial<AtlasState>> {
  const baseConfidence = state.portfolio_decision?.confidence ?? 0;
  const asOfDate = state.as_of_date ?? new Date().toISOString().slice(0, 10);
  const enabled = state.history_agent_enabled !== false;

  const result = await computeHistoryModifier({
    userId: state.user_id,
    asOfDate,
    baseConfidence,
    enabled,
  });

  console.info(
    `[history_modifier] user=${state.user_id} n=${result.n_trades} win_rate=${result.win_rate.toFixed(2)} modifier=${result.modifier.toFixed(4)} confidence=${baseConfidence.toFixed(3)}→${result.confidence_modified.toFixed(3)} enabled=${result.enabled}`,
  );

  return { history_modifier: result };
}

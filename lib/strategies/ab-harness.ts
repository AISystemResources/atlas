/**
 * A/B forward-test harness — Sprint 053.2.
 *
 * After distillation proposes parameter changes, this module re-runs both
 * the current params (control) and the proposed params (treatment) on a
 * forward window that begins immediately after the original backtest ends.
 *
 * Why forward, not in-sample: the LLM drew its proposal from the in-sample
 * trades. An in-sample A/B would just confirm the LLM optimized for what
 * it was shown — generates no new evidence. The forward window is the
 * smallest honest out-of-sample test we can run synchronously, without
 * waiting for live data.
 *
 * Honest failure: if the original backtest ends close to today (e.g. our
 * smoke test runs through yesterday), there are zero forward bars. The
 * harness returns { status: "insufficient_forward_data" } and the audit
 * JSONB records that fact rather than fabricating a result.
 */

import { getServiceClient } from "@/lib/supabase-server";
import { loadTicketLogic } from "./loader";
import { applyParameterChanges } from "./tunable-params";
import { getBrokerProfile } from "@/lib/brokers/profiles";
import {
  inferAsset,
  simulateBacktest,
  type SimulatedStats,
} from "@/lib/backtest-ticket/simulate";
import { fetchHistoricalBarsCached } from "@/lib/backtest-ticket/fetch-bars-cached";
import type { BacktestTimeframe } from "@/lib/backtest-ticket/fetch-bars";

export const DEFAULT_FORWARD_DAYS = 14;
export const MIN_BARS_TO_RUN = 30;

interface BacktestRow {
  ticker: string;
  timeframe: BacktestTimeframe;
  end_date: string;
  notional_per_trade: number;
  broker_profile_id: string;
  ticket_logic_id: string;
}

interface LogicRow {
  name: string;
  version: number;
}

export interface AbForwardWindow {
  start_date: string;
  end_date: string;
  days_requested: number;
}

export interface AbStatsDelta {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number | null;
  total_pnl_dollars: number;
  avg_pnl_dollars: number | null;
  max_drawdown_dollars: number;
}

export type AbComparison =
  | { status: "no_changes" }
  | {
      status: "insufficient_forward_data";
      forward_window: AbForwardWindow;
      bars_returned: number;
      reason: string;
    }
  | {
      status: "ok";
      forward_window: AbForwardWindow;
      control: SimulatedStats;
      treatment: SimulatedStats;
      delta: AbStatsDelta;
    };

export interface RunAbForwardTestInput {
  /** The backtest whose params + range we A/B against. */
  original_backtest_id: string;
  /** Proposed parameter changes (already ratchet-clamped). */
  proposed_changes: Array<{ name: string; proposed_value: number }>;
  /** Override default 14 trading-day forward window. */
  forward_days?: number;
}

export function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute the forward window for an A/B test. Exposed for testing.
 * Returns null when no out-of-sample window exists (original backtest ran
 * through today or later).
 */
export function computeForwardWindow(
  originalEndDate: string,
  todayYyyymmdd: string,
  forwardDays: number,
): { window: AbForwardWindow; hasWindow: boolean } {
  const start = addDays(originalEndDate, 1);
  const cappedEnd = addDays(originalEndDate, forwardDays);
  const end = cappedEnd < todayYyyymmdd ? cappedEnd : addDays(todayYyyymmdd, -1);
  return {
    window: { start_date: start, end_date: end, days_requested: forwardDays },
    hasWindow: end >= start,
  };
}

export function statsDelta(
  control: SimulatedStats,
  treatment: SimulatedStats,
): AbStatsDelta {
  return {
    total_trades: treatment.total_trades - control.total_trades,
    winning_trades: treatment.winning_trades - control.winning_trades,
    losing_trades: treatment.losing_trades - control.losing_trades,
    win_rate:
      treatment.win_rate !== null && control.win_rate !== null
        ? Math.round((treatment.win_rate - control.win_rate) * 10000) / 10000
        : null,
    total_pnl_dollars:
      Math.round((treatment.total_pnl_dollars - control.total_pnl_dollars) * 100) / 100,
    avg_pnl_dollars:
      treatment.avg_pnl_dollars !== null && control.avg_pnl_dollars !== null
        ? Math.round((treatment.avg_pnl_dollars - control.avg_pnl_dollars) * 100) / 100
        : null,
    max_drawdown_dollars:
      Math.round(
        (treatment.max_drawdown_dollars - control.max_drawdown_dollars) * 100,
      ) / 100,
  };
}

export async function runAbForwardTest(
  input: RunAbForwardTestInput,
): Promise<AbComparison> {
  if (input.proposed_changes.length === 0) {
    return { status: "no_changes" };
  }

  const sb = getServiceClient();
  const { data: btRow } = await sb
    .from("ticket_backtests")
    .select(
      "ticker, timeframe, end_date, notional_per_trade, broker_profile_id, ticket_logic_id",
    )
    .eq("id", input.original_backtest_id)
    .maybeSingle();
  if (!btRow) {
    throw new Error(`ab-harness: original backtest ${input.original_backtest_id} not found`);
  }
  const backtest = btRow as BacktestRow;

  const { data: logicRow } = await sb
    .from("ticket_logics")
    .select("name, version")
    .eq("id", backtest.ticket_logic_id)
    .maybeSingle();
  if (!logicRow) {
    throw new Error(`ab-harness: logic for backtest ${input.original_backtest_id} not found`);
  }
  const lr = logicRow as LogicRow;
  const logic = await loadTicketLogic(lr.name, lr.version);
  if (!logic) {
    throw new Error(`ab-harness: logic ${lr.name} v${lr.version} failed to load`);
  }

  const forwardDays = input.forward_days ?? DEFAULT_FORWARD_DAYS;
  const today = todayUtc();
  const { window: forward_window, hasWindow } = computeForwardWindow(
    backtest.end_date,
    today,
    forwardDays,
  );

  if (!hasWindow) {
    return {
      status: "insufficient_forward_data",
      forward_window,
      bars_returned: 0,
      reason: `original backtest ended ${backtest.end_date}; no out-of-sample window available before today (${today})`,
    };
  }

  const bars = await fetchHistoricalBarsCached(
    backtest.ticker,
    new Date(`${forward_window.start_date}T00:00:00Z`),
    new Date(`${forward_window.end_date}T23:59:59Z`),
    backtest.timeframe,
  );

  if (bars.length < MIN_BARS_TO_RUN) {
    return {
      status: "insufficient_forward_data",
      forward_window,
      bars_returned: bars.length,
      reason: `only ${bars.length} bars returned for ${forward_window.start_date}..${forward_window.end_date} (need ≥${MIN_BARS_TO_RUN})`,
    };
  }

  const profile = getBrokerProfile(backtest.broker_profile_id ?? "pure");
  const asset = inferAsset(backtest.ticker);
  const notional = backtest.notional_per_trade ?? logic.body.entry.sizing.value;

  const treatmentBody = applyParameterChanges(logic.body, input.proposed_changes);

  const control = simulateBacktest({
    body: logic.body,
    bars,
    notional,
    profile,
    asset,
  }).stats;
  const treatment = simulateBacktest({
    body: treatmentBody,
    bars,
    notional,
    profile,
    asset,
  }).stats;

  return {
    status: "ok",
    forward_window,
    control,
    treatment,
    delta: statsDelta(control, treatment),
  };
}

export async function persistAbComparison(
  insightId: string,
  comparison: AbComparison,
): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb
    .from("ticket_backtest_insights")
    .update({ ab_comparison: comparison })
    .eq("id", insightId);
  if (error) {
    throw new Error(`persistAbComparison: ${error.message}`);
  }
}

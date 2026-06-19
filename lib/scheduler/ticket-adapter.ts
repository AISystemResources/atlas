/**
 * Ticket Logic adapter for the live intraday scalper — Sprint 054.
 *
 * Bridges the academic-loop side of Atlas (lib/strategies/* — ticket_logics
 * table, evaluator, AI reviews) into the production execution path
 * (lib/scheduler/intraday-scalper.ts).
 *
 * Two-step design so the scalper only loads from the DB once per cron tick
 * (not per user × per ticker):
 *   1. loadActiveStrategy() — call once at the top of the scalper run
 *   2. detectStrategySignal(strategy, bars) — pure, runs per ticker
 *
 * Fail-closed semantics: if the active strategy can't be loaded, the
 * scalper run aborts. There is intentionally no hardcoded fallback —
 * production execution must follow the ticket_logics record, otherwise
 * the "AI-evolvable strategy" thesis is just a backtest demo.
 */

import { evaluate } from "@/lib/strategies/evaluate";
import type { Bar } from "@/lib/strategies/indicators";
import { loadTicketLogic, loadTicketLogicById } from "@/lib/strategies/loader";
import { getServiceClient } from "@/lib/supabase-server";
import type { TicketLogic } from "@/lib/strategies/types";

export interface ActiveStrategy {
  logic: TicketLogic;
}

export interface StrategySignal {
  /** Reference entry price from the strategy's evaluator (4 dp rounded) */
  entry_price: number;
  take_profit: number;
  stop_loss: number;
  direction: "long" | "short";
  /** Notional in dollars, from the strategy's sizing rule */
  notional_dollars: number;
  /** Source of truth for the entries fired */
  logic_name: string;
  logic_version: number;
  logic_id: string;
  /** Indicator values at the entry bar — for logging */
  indicator_snapshot: Record<string, number>;
}

/**
 * Load the active version of a strategy from ticket_logics by name.
 * Returns null when no active row exists. Retained for tests and legacy
 * callers; production runUserScalper uses loadStrategyForUser instead
 * (Sprint 060C).
 */
export async function loadActiveStrategy(
  strategyName = "sandy-s1-long",
): Promise<ActiveStrategy | null> {
  const logic = await loadTicketLogic(strategyName);
  if (!logic) return null;
  return { logic };
}

/**
 * Sprint 060C: load the strategy this specific user has configured for the
 * scalper. Reads profiles.scalper_strategy_id, then loads that exact
 * ticket_logics row by id. Returns null when the user hasn't configured a
 * strategy — the scalper produces no entries for that user (fail-closed).
 */
export async function loadStrategyForUser(
  userId: string,
): Promise<ActiveStrategy | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("profiles")
    .select("scalper_strategy_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const strategyId = (data as { scalper_strategy_id: string | null })
    .scalper_strategy_id;
  if (!strategyId) return null;

  const logic = await loadTicketLogicById(strategyId);
  if (!logic) return null;
  return { logic };
}

/**
 * Detect a strategy signal at the LATEST bar in `bars`. Pure function —
 * no DB I/O. Returns null when no entry fires on the latest bar.
 */
export function detectStrategySignal(
  strategy: ActiveStrategy,
  bars: Bar[],
): StrategySignal | null {
  if (bars.length === 0) return null;

  const entries = evaluate(strategy.logic.body, bars);
  const lastBarIdx = bars.length - 1;
  const lastEntry = entries.find((e) => e.bar_index === lastBarIdx);
  if (!lastEntry) return null;

  const sizing = lastEntry.sizing;
  if (sizing.method !== "fixed_notional" && sizing.method !== "fixed_shares") {
    console.warn(
      `[ticket-adapter] Sizing method '${sizing.method}' not yet supported by live scalper; skipping signal.`,
    );
    return null;
  }

  return {
    entry_price: lastEntry.entry_price,
    take_profit: lastEntry.take_profit,
    stop_loss: lastEntry.stop_loss,
    direction: lastEntry.direction,
    notional_dollars: sizing.value,
    logic_name: strategy.logic.name,
    logic_version: strategy.logic.version,
    logic_id: strategy.logic.id,
    indicator_snapshot: lastEntry.indicator_snapshot,
  };
}

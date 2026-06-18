/**
 * Ticket Logic evaluator — Sprint 053a.
 *
 * Walks a bar series and emits an EntrySignal at every bar where the strategy's
 * regime filter holds AND all entry conditions hold. Each EntrySignal carries
 * the prices needed to submit a bracket order downstream (053b backtest
 * engine and the future live-scalper rewire).
 *
 * Numerical conventions:
 *   - bar_offset 0 = signal bar (the bar being evaluated)
 *   - bar_offset -1 = previous bar
 *   - entry_price, take_profit, stop_loss rounded to 4 dp at emission
 *   - sizing is returned as-is; caller computes qty given asset-class context
 *     (equity = whole shares, crypto = fractional)
 */

import { computeAllIndicators, type Bar, type IndicatorArrays } from "./indicators";
import type {
  Condition,
  Expression,
  Sizing,
  TicketLogicBody,
} from "./types";

export interface EntrySignal {
  bar_index: number;
  bar_timestamp: string | undefined;
  direction: "long" | "short";
  entry_price: number;
  take_profit: number;
  stop_loss: number;
  sizing: Sizing;
  /** Indicator values at the entry bar — used by Trade Inspector UI (053c) */
  indicator_snapshot: Record<string, number>;
}

/**
 * Run a Ticket Logic against a bar series. Returns one EntrySignal per
 * bar where the strategy fires. Empty array means no entries.
 */
export function evaluate(logic: TicketLogicBody, bars: Bar[]): EntrySignal[] {
  const indicators = computeAllIndicators(logic.indicators, bars);
  const entries: EntrySignal[] = [];

  for (let i = 0; i < bars.length; i++) {
    let fired: EntrySignal | null = null;
    try {
      fired = evaluateAtBar(logic, bars, indicators, i);
    } catch {
      // Warmup bars throw when an indicator value is null or a bar_offset
      // points before the series. That's expected; skip silently.
      continue;
    }
    if (fired) entries.push(fired);
  }

  return entries;
}

function evaluateAtBar(
  logic: TicketLogicBody,
  bars: Bar[],
  indicators: IndicatorArrays,
  barIdx: number,
): EntrySignal | null {
  if (logic.regime_filter) {
    if (!evaluateCondition(logic.regime_filter, bars, indicators, {}, barIdx)) {
      return null;
    }
  }

  for (const cond of logic.entry.conditions) {
    if (!evaluateCondition(cond, bars, indicators, {}, barIdx)) return null;
  }

  // Resolve computed values in declaration order. (No dependency resolution
  // in v1; computed entries cannot reference each other. If two are needed,
  // declare them in evaluation order.)
  const computed: Record<string, number> = {};
  if (logic.computed) {
    for (const [id, expr] of Object.entries(logic.computed)) {
      computed[id] = evaluateExpression(expr, bars, indicators, computed, barIdx);
    }
  }

  const entryPrice = round4(
    computed.entry_price ?? evaluateExpression(
      { type: "ohlc", field: "close", bar_offset: 0 },
      bars,
      indicators,
      computed,
      barIdx,
    ),
  );
  const takeProfit = round4(
    evaluateExpression(logic.exit.take_profit, bars, indicators, computed, barIdx),
  );
  const stopLoss = round4(
    evaluateExpression(logic.exit.stop_loss, bars, indicators, computed, barIdx),
  );

  // Sanity: for long, TP > entry > SL. For short, TP < entry < SL.
  if (logic.direction === "long") {
    if (takeProfit <= entryPrice || stopLoss >= entryPrice) return null;
  } else {
    if (takeProfit >= entryPrice || stopLoss <= entryPrice) return null;
  }

  return {
    bar_index: barIdx,
    bar_timestamp: bars[barIdx].timestamp,
    direction: logic.direction,
    entry_price: entryPrice,
    take_profit: takeProfit,
    stop_loss: stopLoss,
    sizing: logic.entry.sizing,
    indicator_snapshot: snapshotIndicators(indicators, barIdx),
  };
}

function evaluateCondition(
  cond: Condition,
  bars: Bar[],
  indicators: IndicatorArrays,
  computed: Record<string, number>,
  barIdx: number,
): boolean {
  const L = evaluateExpression(cond.left, bars, indicators, computed, barIdx);
  const R = evaluateExpression(cond.right, bars, indicators, computed, barIdx);
  switch (cond.op) {
    case "gt":  return L > R;
    case "lt":  return L < R;
    case "gte": return L >= R;
    case "lte": return L <= R;
    case "eq":  return L === R;
    case "neq": return L !== R;
  }
}

function evaluateExpression(
  expr: Expression,
  bars: Bar[],
  indicators: IndicatorArrays,
  computed: Record<string, number>,
  barIdx: number,
): number {
  switch (expr.type) {
    case "constant":
      return expr.value;
    case "ohlc": {
      const idx = barIdx + expr.bar_offset;
      if (idx < 0 || idx >= bars.length) throw new Error("ohlc out of bounds");
      const bar = bars[idx];
      const v = bar[expr.field];
      if (v === undefined) throw new Error(`ohlc.${expr.field} missing at ${idx}`);
      return v;
    }
    case "indicator": {
      const idx = barIdx + expr.bar_offset;
      const arr = indicators[expr.id];
      if (!arr) throw new Error(`unknown indicator '${expr.id}'`);
      if (idx < 0 || idx >= arr.length) throw new Error("indicator out of bounds");
      const v = arr[idx];
      if (v === null) throw new Error(`indicator '${expr.id}' not warmed up at ${idx}`);
      return v;
    }
    case "computed": {
      const v = computed[expr.id];
      if (v === undefined) throw new Error(`computed '${expr.id}' not defined`);
      return v;
    }
    case "binary": {
      const L = evaluateExpression(expr.left, bars, indicators, computed, barIdx);
      const R = evaluateExpression(expr.right, bars, indicators, computed, barIdx);
      switch (expr.op) {
        case "+": return L + R;
        case "-": return L - R;
        case "*": return L * R;
        case "/": return R === 0 ? NaN : L / R;
      }
    }
  }
}

function snapshotIndicators(
  indicators: IndicatorArrays,
  barIdx: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, arr] of Object.entries(indicators)) {
    const v = arr[barIdx];
    if (v !== null && v !== undefined) out[id] = v;
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

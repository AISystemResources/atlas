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
import { isBarInSession } from "./time-filter";
import type {
  Condition,
  Direction,
  Expression,
  Sizing,
  StopLossMethod,
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
  // Sprint 069: session-window + weekday filter runs before any condition
  // evaluation. Cheap reject path.
  if (!isBarInSession(bars[barIdx], logic)) return null;

  // Resolve computed values FIRST so entry conditions can reference them
  // (e.g. "entry_price < ema_13" — the mean-reversion guard in Sandy S1 v2).
  // Computed entries are evaluated in declaration order and cannot reference
  // each other (no dependency resolution in this engine).
  const computed: Record<string, number> = {};
  if (logic.computed) {
    for (const [id, expr] of Object.entries(logic.computed)) {
      computed[id] = evaluateExpression(expr, bars, indicators, computed, barIdx);
    }
  }

  if (logic.regime_filter) {
    if (!evaluateCondition(logic.regime_filter, bars, indicators, computed, barIdx)) {
      return null;
    }
  }

  for (const cond of logic.entry.conditions) {
    if (!evaluateCondition(cond, bars, indicators, computed, barIdx)) return null;
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
  // Sprint 079G: sl_method overrides the legacy stop_loss expression when set.
  const stopLoss = round4(
    logic.exit.sl_method
      ? computeStopLossFromMethod(
          logic.exit.sl_method,
          entryPrice,
          bars,
          indicators,
          barIdx,
          logic.direction,
        )
      : evaluateExpression(
          // Schema enforces stop_loss when sl_method is absent; the !
          // is safe at runtime, but guard explicitly for older callers.
          logic.exit.stop_loss ??
            ({ type: "constant", value: 0 } as const),
          bars,
          indicators,
          computed,
          barIdx,
        ),
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

/**
 * Sprint 080A: build a per-bar exit condition checker for use in the
 * backtest simulator. Returns a function that, given a bar index, returns
 * true if ANY exit condition in `conditions` fires on that bar.
 *
 * Errors (warmup bars, missing indicators) are caught and treated as
 * "condition not met" so they don't abort the simulation.
 */
export function buildExitConditionChecker(
  conditions: Condition[],
  bars: Bar[],
  indicators: IndicatorArrays,
): (barIdx: number) => boolean {
  return (barIdx: number): boolean => {
    try {
      return conditions.some((cond) =>
        evaluateCondition(cond, bars, indicators, {}, barIdx),
      );
    } catch {
      return false;
    }
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

/**
 * Sprint 079G: compute SL price from a declarative method instead of an
 * expression. All three methods produce a price the caller compares
 * against entry for the long/short sanity check.
 */
function computeStopLossFromMethod(
  method: StopLossMethod,
  entryPrice: number,
  bars: Bar[],
  indicators: IndicatorArrays,
  barIdx: number,
  direction: Direction,
): number {
  const sign = direction === "long" ? -1 : +1;
  switch (method.type) {
    case "fixed_buffer": {
      // Equivalent to legacy signal_bar.low − value (long).
      const anchor = direction === "long" ? bars[barIdx].low : bars[barIdx].high;
      return anchor + sign * method.value;
    }
    case "atr_multiple": {
      const atrSeries = indicators[method.atr_indicator_id];
      const atr = atrSeries?.[barIdx];
      if (atr == null || !Number.isFinite(atr)) {
        // Missing indicator OR no ATR at this bar (warmup). Surface as
        // a sentinel that fails the long/short sanity check downstream
        // — no signal fires, no throw. Consistent with how missing
        // indicator warmup is handled elsewhere in the evaluator.
        return direction === "long" ? Infinity : -Infinity;
      }
      return entryPrice + sign * method.value * atr;
    }
    case "pct_of_entry": {
      return entryPrice * (1 + sign * method.value);
    }
    // Sprint 080B: trailing variants. Initial stop at entry is identical to
    // the static equivalent (atr_multiple / pct_of_entry). The ratchet logic
    // lives in the backtest simulator which tracks peak/trough price per bar.
    case "trailing_atr": {
      const atrSeries = indicators[method.atr_indicator_id];
      const atr = atrSeries?.[barIdx];
      if (atr == null || !Number.isFinite(atr)) {
        return direction === "long" ? Infinity : -Infinity;
      }
      return entryPrice + sign * method.value * atr;
    }
    case "trailing_pct": {
      return entryPrice * (1 + sign * method.value);
    }
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

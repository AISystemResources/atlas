/**
 * Plain-English renderer for TicketLogicBody conditions and expressions.
 * Sprint 061A.
 *
 * The strategy detail page (and future MCP descriptions) need a readable
 * version of the JSON rules. This module is a small DSL that walks the
 * Expression / Condition AST and produces phrases.
 *
 * Two output modes:
 *   - terse:    `low[-1] <= kc_lower_outer[-1]`
 *   - prose:    "previous bar's low ≤ outer lower Keltner band"
 *
 * The detail page uses prose for the rule blocks. The MCP `get_ticket_logic`
 * tool can return both so the AI consumer picks the appropriate form.
 *
 * The renderer recognizes a few common patterns and renders them as idioms
 * (e.g. `close[0] > open[0]` → "bullish (close > open)"). Anything it can't
 * match falls back to the structural form.
 */

import type {
  Condition,
  Direction,
  Expression,
  IndicatorSpec,
  StopLossMethod,
  TicketLogicBody,
} from "./types";
import { describeSessionWindow, describeWeekdays } from "./time-filter";

// ── Expression rendering ─────────────────────────────────────────────────────

const BAR_LABEL: Record<number, string> = {
  0: "signal bar",
  [-1]: "previous bar",
  [-2]: "two bars ago",
  [-3]: "three bars ago",
};

function barLabel(offset: number): string {
  return BAR_LABEL[offset] ?? `${Math.abs(offset)} bars ago`;
}

function ohlcLabel(field: "open" | "high" | "low" | "close"): string {
  return field;
}

function indicatorLabel(id: string, indicators: IndicatorSpec[]): string {
  const spec = indicators.find((i) => i.id === id);
  if (!spec) return id;
  switch (spec.type) {
    case "rsi":
      return `RSI(${spec.params.period})`;
    case "ema":
      return `EMA(${spec.params.period})`;
    case "sma":
      return `SMA(${spec.params.period})`;
    case "atr":
      return `ATR(${spec.params.period})`;
    case "kc_upper":
      return `upper Keltner band (${spec.params.multiplier}× ATR)`;
    case "kc_lower":
      return `lower Keltner band (${spec.params.multiplier}× ATR)`;
    default:
      return id;
  }
}

export function renderExpressionProse(
  expr: Expression,
  indicators: IndicatorSpec[],
  computed?: Record<string, Expression>,
): string {
  switch (expr.type) {
    case "constant":
      return String(expr.value);
    case "ohlc": {
      const bar = expr.bar_offset === 0 ? "signal bar's" : `${barLabel(expr.bar_offset)}'s`;
      return `${bar} ${ohlcLabel(expr.field)}`;
    }
    case "indicator": {
      const label = indicatorLabel(expr.id, indicators);
      if (expr.bar_offset === 0) return label;
      return `${label} on ${barLabel(expr.bar_offset)}`;
    }
    case "computed": {
      // Render the named computed value as its own name. Detail page will list
      // them separately so the reader can drill into the definition.
      return expr.id.replace(/_/g, " ");
    }
    case "binary": {
      const L = renderExpressionProse(expr.left, indicators, computed);
      const R = renderExpressionProse(expr.right, indicators, computed);
      // Idioms: `X + N` reads as "X plus N points" for numeric N
      if (expr.op === "+" && expr.right.type === "constant") {
        return `${L} + ${expr.right.value} points`;
      }
      if (expr.op === "-" && expr.right.type === "constant") {
        return `${L} − ${expr.right.value} points`;
      }
      if (expr.op === "*" && expr.right.type === "constant") {
        return `${L} × ${expr.right.value}`;
      }
      return `${L} ${expr.op} ${R}`;
    }
  }
}

// ── Condition rendering ──────────────────────────────────────────────────────

const OP_SYMBOL: Record<string, string> = {
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  eq: "=",
  neq: "≠",
};

const OP_WORDS: Record<string, string> = {
  gt: "is greater than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  eq: "equals",
  neq: "does not equal",
};

/**
 * Render a single condition as a sentence. Recognizes common idioms:
 *   - close[0] > open[0]              → "Bullish (close > open)"
 *   - close[0] < open[0]              → "Bearish (close < open)"
 *   - close[0] > kc_lower_inner[0]    → "Close is above the lower KC band"
 */
export function renderConditionProse(
  cond: Condition,
  indicators: IndicatorSpec[],
  computed?: Record<string, Expression>,
): string {
  const { op, left, right } = cond;

  // Idiom: bullish / bearish bar
  if (
    left.type === "ohlc" &&
    right.type === "ohlc" &&
    left.bar_offset === right.bar_offset &&
    left.field === "close" &&
    right.field === "open"
  ) {
    if (op === "gt") return `Bullish bar (close > open)`;
    if (op === "lt") return `Bearish bar (close < open)`;
  }

  const L = renderExpressionProse(left, indicators, computed);
  const R = renderExpressionProse(right, indicators, computed);
  return `${capitalize(L)} ${OP_WORDS[op] ?? OP_SYMBOL[op] ?? op} ${R}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Top-level: structured sections for the detail page ───────────────────────

export interface RenderedSections {
  signalBar: string[];
  entry: string[];
  stopLoss: string;
  takeProfit: string;
  timeStop: string | null;
  indicators: Array<{ id: string; label: string }>;
  /** Sprint 069: optional when-it-can-fire summary */
  whenItFires: string | null;
}

/**
 * Sprint 079G: human-friendly description of a declarative SL method.
 * Used on the strategy detail page in place of the expression renderer
 * when the strategy uses sl_method.
 */
export function renderSlMethodProse(
  method: StopLossMethod,
  direction: Direction,
): string {
  const dir = direction === "long" ? "below" : "above";
  const sign = direction === "long" ? "−" : "+";
  switch (method.type) {
    case "fixed_buffer": {
      const anchor = direction === "long" ? "signal bar's low" : "signal bar's high";
      return `${anchor} ${sign} ${method.value} points (fixed buffer)`;
    }
    case "atr_multiple": {
      return `entry price ${sign} ${method.value} × ${method.atr_indicator_id} (${method.value}× ATR ${dir} entry)`;
    }
    case "pct_of_entry": {
      const pct = (method.value * 100).toFixed(2);
      return `${pct}% ${dir} entry price (pct_of_entry)`;
    }
  }
}

export function renderTicketLogicBody(body: TicketLogicBody): RenderedSections {
  const signalBar = body.entry.conditions.map((c) =>
    renderConditionProse(c, body.indicators, body.computed),
  );
  if (body.regime_filter) {
    signalBar.unshift(
      `(Regime) ${renderConditionProse(body.regime_filter, body.indicators, body.computed)}`,
    );
  }

  const entryPriceExpr = body.computed?.entry_price;
  const entryLines: string[] = [];
  if (entryPriceExpr) {
    entryLines.push(
      `Entry price = ${renderExpressionProse(entryPriceExpr, body.indicators, body.computed)}`,
    );
  } else {
    entryLines.push(`Entry price = close of signal bar (no buffer)`);
  }
  const sizing = body.entry.sizing;
  if (sizing.method === "fixed_notional") {
    entryLines.push(`Position size: $${sizing.value} notional per trade`);
  } else if (sizing.method === "fixed_shares") {
    entryLines.push(`Position size: ${sizing.value} shares per trade`);
  } else {
    entryLines.push(`Position size: ${sizing.value}% portfolio risk per trade`);
  }

  // Sprint 079G: render sl_method as prose when set; fall back to the
  // legacy expression-based stop_loss otherwise.
  const stopLoss = body.exit.sl_method
    ? renderSlMethodProse(body.exit.sl_method, body.direction)
    : body.exit.stop_loss
      ? renderExpressionProse(
          body.exit.stop_loss,
          body.indicators,
          body.computed,
        )
      : "(stop loss not defined)";
  const takeProfit = renderExpressionProse(
    body.exit.take_profit,
    body.indicators,
    body.computed,
  );

  let timeStop: string | null = null;
  if (body.exit.time_stop === "eod") {
    timeStop = "Close position before end of trading day (no overnight carry)";
  } else if (body.exit.time_stop && typeof body.exit.time_stop === "object") {
    timeStop = `Close position after ${body.exit.time_stop.bars} bars`;
  }

  const indicators = body.indicators.map((i) => ({
    id: i.id,
    label: indicatorLabel(i.id, body.indicators),
  }));

  // Sprint 069: "When it fires" combines session window + valid weekdays
  // into a single line. Renders nothing when both are omitted.
  let whenItFires: string | null = null;
  const parts: string[] = [];
  if (body.session_window) parts.push(describeSessionWindow(body.session_window));
  if (body.valid_weekdays) parts.push(describeWeekdays(body.valid_weekdays));
  if (parts.length > 0) whenItFires = parts.join(" · ");

  return { signalBar, entry: entryLines, stopLoss, takeProfit, timeStop, indicators, whenItFires };
}

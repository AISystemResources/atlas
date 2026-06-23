/**
 * Ticket Logic — Sprint 053a.
 *
 * Versioned, AI-evolvable strategy definitions stored as JSON in the
 * `ticket_logics` table. Replaces hardcoded S1 in lib/indicators/index.ts.
 *
 * Design call: Conditions are an implicit AND across an array. Explicit
 * AND/OR/NOT compound conditions are a v2 concern — Sandy S1, S2, and most
 * retail mean-reversion strategies don't need them.
 */

export type AssetClass = "equity" | "crypto" | "any";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";
export type Direction = "long" | "short";

// ── Indicator specs ──────────────────────────────────────────────────────────

export type IndicatorType =
  | "rsi"
  | "ema"
  | "sma"
  | "atr"
  | "kc_upper"
  | "kc_lower"
  // Sprint 080C: extended indicator vocabulary
  | "macd"           // MACD line (EMA_fast − EMA_slow). Params: { fast_period, slow_period, signal_period }
  | "macd_signal"    // MACD signal line (EMA of MACD line). Same params as macd.
  | "macd_histogram" // MACD histogram (line − signal). Same params as macd.
  | "bb_upper"       // Bollinger Band upper. Params: { period, std_dev }
  | "bb_lower"       // Bollinger Band lower. Params: { period, std_dev }
  | "bb_middle"      // Bollinger Band middle (SMA). Params: { period }
  | "stoch_k"        // Stochastic %K (raw). Params: { period }
  | "stoch_d"        // Stochastic %D (SMA of %K). Params: { k_period, d_period }
  | "vwap"           // Session VWAP, resets each calendar day. No params. Requires volume in bars.
  | "volume_sma";    // SMA of bar volume. Params: { period }. Requires volume in bars.

export interface IndicatorSpec {
  /** Unique identifier within the strategy — referenced by expressions */
  id: string;
  type: IndicatorType;
  /** Params shape depends on type. rsi/ema/sma/atr: { period }. kc_*: { ema_period, atr_period, multiplier } */
  params: Record<string, number>;
  /**
   * Sprint 080E: optional timeframe override. When set, this indicator is
   * computed on a secondary bar series of this timeframe instead of the
   * strategy's primary timeframe. Values are re-indexed onto the primary
   * timeline using last-known-value semantics (the most recent secondary
   * bar at or before each primary bar's timestamp).
   *
   * Typical use: a 1h RSI as a trend filter on a 5m entry strategy — the
   * 1h RSI value stays constant between 1h bar completions.
   */
  timeframe?: Timeframe;
}

// ── Expression tree ──────────────────────────────────────────────────────────

export type OhlcField = "open" | "high" | "low" | "close";
export type BinaryOp = "+" | "-" | "*" | "/";

export type Expression =
  | { type: "constant"; value: number }
  | { type: "ohlc"; field: OhlcField; bar_offset: number }
  | { type: "indicator"; id: string; bar_offset: number }
  | { type: "computed"; id: string }
  | { type: "binary"; op: BinaryOp; left: Expression; right: Expression };

// ── Conditions ───────────────────────────────────────────────────────────────

export type ComparisonOp = "gt" | "lt" | "gte" | "lte" | "eq" | "neq";

/** Leaf comparison — the original v1 condition type. */
export interface Condition {
  op: ComparisonOp;
  left: Expression;
  right: Expression;
}

/**
 * Sprint 080D: compound condition tree.
 *
 * A ConditionNode is either a leaf Condition (backward-compatible; detected
 * by the presence of the `op` field) or one of three compound nodes:
 *   - and: ALL children must be true
 *   - or:  ANY child must be true
 *   - not: child must be false
 *
 * `entry.conditions`, `exit.exit_conditions`, and `regime_filter` now accept
 * ConditionNode so strategies can express e.g. "(RSI < 30 OR price < BB_lower)
 * AND volume > volume_sma" without extra entries in the conditions array.
 */
export type ConditionNode =
  | Condition
  | { type: "and"; children: ConditionNode[] }
  | { type: "or"; children: ConditionNode[] }
  | { type: "not"; child: ConditionNode };

// ── Sizing ───────────────────────────────────────────────────────────────────

export type SizingMethod = "fixed_notional" | "fixed_shares" | "atr_risk";

export interface Sizing {
  method: SizingMethod;
  /** fixed_notional: dollars. fixed_shares: whole shares. atr_risk: percent of portfolio at risk */
  value: number;
}

// ── Exit ─────────────────────────────────────────────────────────────────────

export type TimeStop = "eod" | { bars: number };

/**
 * Sprint 079G: declarative stop-loss methodology. Lifts SL geometry from
 * a hard-coded body expression to a first-class tunable concept.
 *
 *   - fixed_buffer: SL = signal_bar.low − value (long) / signal_bar.high + value (short).
 *     Equivalent to the legacy expression-based SL; provided for parity.
 *   - atr_multiple: SL = entry_price − value × ATR (long) / entry_price + value × ATR (short).
 *     `atr_indicator_id` must reference an ATR indicator declared in `indicators`.
 *   - pct_of_entry: SL = entry_price × (1 − value) (long) / entry_price × (1 + value) (short).
 *     `value` is a fraction (e.g. 0.005 = 0.5%).
 *
 * Tunables can target the `value` field of any sl_method via the standard
 * path mechanism — e.g. `path: ["exit", "sl_method", "value"]`.
 */
export type StopLossMethod =
  | { type: "fixed_buffer"; value: number }
  | { type: "atr_multiple"; value: number; atr_indicator_id: string }
  | { type: "pct_of_entry"; value: number }
  /**
   * Sprint 080B: trailing stops. Stop ratchets with the best price seen
   * since entry (highest high for long; lowest low for short). Initial stop
   * at entry is equivalent to the static variant; thereafter it only moves
   * in the profitable direction.
   *
   * trailing_atr: stop = peak_price − value × ATR (long) / trough + value × ATR (short).
   * trailing_pct: stop = peak_price × (1 − value) (long) / trough × (1 + value) (short).
   *   `value` is a fraction (e.g. 0.005 = 0.5%). Max 1 enforced by Zod.
   */
  | { type: "trailing_atr"; value: number; atr_indicator_id: string }
  | { type: "trailing_pct"; value: number };

// ── Tunable parameter (embedded in body) — Sprint 060B ───────────────────────

export interface TunableParameter {
  /** Human-readable name shown to the AI and rendered in the UI */
  name: string;
  /** Dot-path into TicketLogicBody, as an array of keys */
  path: string[];
  /** What this parameter controls — sent to the AI */
  description: string;
  /** Optional soft bounds. The reviewer should respect these. */
  min?: number;
  max?: number;
  /**
   * Sprint 053.1: per-promote ratchet. Max fractional move from the current
   * value in one distillation step (e.g. 0.25 = ±25%). Omit to use the global
   * default of 0.25. Bigger steps the LLM proposes are clamped, not rejected —
   * the original proposal is preserved on the JSONB for audit.
   */
  max_step_pct?: number;
}

// ── Session window + weekday filter — Sprint 069 ─────────────────────────────

/**
 * Intraday session window. Strategy only fires on bars whose timestamp
 * falls inside [start, end) in the named IANA timezone.
 *
 * Sandy S1 was calibrated for the 09:31–11:00 ET morning window — applying
 * it to bars outside that window changes the strategy in practice. By
 * making the window a first-class field we stop pretending it doesn't
 * matter and let the live scalper enforce what the backtest assumed.
 *
 * Crypto strategies that should run 24/7 simply omit this field.
 */
export interface SessionWindow {
  /** 24-hour "HH:MM" — inclusive */
  start: string;
  /** 24-hour "HH:MM" — exclusive */
  end: string;
  /** IANA timezone, e.g. "America/New_York", "UTC", "Asia/Singapore" */
  timezone: string;
}

// ── Top-level TicketLogic ────────────────────────────────────────────────────

export interface TicketLogicBody {
  universe: {
    asset_class: AssetClass;
    tickers?: string[];
  };
  timeframe: Timeframe;
  direction: Direction;
  indicators: IndicatorSpec[];
  /** Optional pre-condition that must hold on the signal bar */
  regime_filter?: ConditionNode;
  entry: {
    /** All nodes must hold on the signal bar (implicit AND across the array) */
    conditions: ConditionNode[];
    sizing: Sizing;
  };
  /** Named intermediate values referenceable from exit expressions */
  computed?: Record<string, Expression>;
  exit: {
    take_profit: Expression;
    /**
     * Sprint 079G: optional. When omitted, `sl_method` is required.
     * Legacy strategies use this expression-based SL; new strategies
     * SHOULD use sl_method instead so the SL methodology itself is
     * tunable (the structural fix both reviewers flagged on 079D).
     */
    stop_loss?: Expression;
    /**
     * Sprint 079G: structured SL declaration. When set, overrides the
     * `stop_loss` expression. Exposes SL method + magnitude as first-class
     * tunables, so distillation can propose changes to either the method
     * or its parameter via the standard ratchet path.
     */
    sl_method?: StopLossMethod;
    time_stop?: TimeStop;
    /**
     * Sprint 080A: indicator-based exit triggers. Evaluated bar-by-bar after
     * entry; if ANY condition fires the position is closed at that bar's close.
     * Checked after time-stops, before SL/TP (so hard stops still take priority).
     * Enables RSI cross-back exits, EMA cross exits, and any indicator-triggered
     * close — the primary exit mechanism for momentum strategies like S2.
     *
     * Each condition uses the same Condition type as entry.conditions and
     * may reference any indicator declared in the strategy's `indicators` array.
     * exit must define at least one of stop_loss, sl_method, or exit_conditions.
     */
    exit_conditions?: ConditionNode[];
  };
  /**
   * Self-describing parameters that the AI Distillation may propose changes
   * to. Each tunable carries its own path into the body so the strategy
   * declares everything about itself — no per-strategy code changes needed
   * when new strategies are created.
   */
  tunable_parameters?: TunableParameter[];
  /**
   * Sprint 069: intraday window the strategy is allowed to fire in. Bars
   * outside the window produce no entry, even when conditions hold.
   * Omit for 24/7 strategies (crypto).
   */
  session_window?: SessionWindow;
  /**
   * Sprint 069: weekdays the strategy is allowed to fire on. Uses ISO
   * weekday numbers: 1 = Monday … 7 = Sunday. Omit to allow every day
   * the calendar admits.
   */
  valid_weekdays?: number[];
}

/** The full database row including metadata */
export interface TicketLogic {
  id: string;
  name: string;
  version: number;
  parent_version_id: string | null;
  description: string;
  body: TicketLogicBody;
  status: "draft" | "active" | "archived";
  created_by: "default" | "claude_chat" | "distillation" | "user";
  created_at: string;
}

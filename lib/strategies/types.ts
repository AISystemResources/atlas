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
  | "kc_lower";

export interface IndicatorSpec {
  /** Unique identifier within the strategy — referenced by expressions */
  id: string;
  type: IndicatorType;
  /** Params shape depends on type. rsi/ema/sma/atr: { period }. kc_*: { ema_period, atr_period, multiplier } */
  params: Record<string, number>;
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

// ── Conditions (implicit AND across an array; no AND/OR/NOT in v1) ───────────

export type ComparisonOp = "gt" | "lt" | "gte" | "lte" | "eq" | "neq";

export interface Condition {
  op: ComparisonOp;
  left: Expression;
  right: Expression;
}

// ── Sizing ───────────────────────────────────────────────────────────────────

export type SizingMethod = "fixed_notional" | "fixed_shares" | "atr_risk";

export interface Sizing {
  method: SizingMethod;
  /** fixed_notional: dollars. fixed_shares: whole shares. atr_risk: percent of portfolio at risk */
  value: number;
}

// ── Exit ─────────────────────────────────────────────────────────────────────

export type TimeStop = "eod" | { bars: number };

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
  regime_filter?: Condition;
  entry: {
    /** All conditions must hold on the signal bar (implicit AND) */
    conditions: Condition[];
    sizing: Sizing;
  };
  /** Named intermediate values referenceable from exit expressions */
  computed?: Record<string, Expression>;
  exit: {
    take_profit: Expression;
    stop_loss: Expression;
    time_stop?: TimeStop;
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

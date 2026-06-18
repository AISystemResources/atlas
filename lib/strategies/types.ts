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

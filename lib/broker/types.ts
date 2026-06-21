/**
 * Atlas broker domain types.
 *
 * All types use camelCase (TypeScript convention).
 * The Python layer uses snake_case dicts; AlpacaAdapter normalises SDK
 * responses to these shapes before returning them to callers.
 *
 * Shape parity with backend/broker/base.py:
 *   Python "order_id"       → TS "orderId"
 *   Python "ticker"         → TS "ticker"
 *   Python "action"         → TS "action"  ("BUY" | "SELL")
 *   Python "notional"       → TS "notional"
 *   Python "avg_cost"       → TS "avgCost"
 *   Python "current_price"  → TS "currentPrice"
 *   Python "market_value"   → TS "marketValue"
 *   Python "unrealized_pl"  → TS "unrealizedPl"
 *   Python "buying_power"   → TS "buyingPower"
 *   Python "portfolio_value"→ TS "portfolioValue"
 */

export type OrderAction = "BUY" | "SELL";

export type OrderStatus =
  | "pending"
  | "open"
  | "filled"
  | "cancelled"
  | "expired"
  | "rejected";

/**
 * Input to submitOrder — the minimum required to place a market order.
 */
export interface OrderRequest {
  /** Equity ticker (e.g. "AAPL") or crypto pair (e.g. "BTC/USD") */
  ticker: string;
  /** Direction of the trade */
  action: OrderAction;
  /** Dollar notional amount to trade, e.g. 1000.00 */
  notional: number;
  /** Alpaca time-in-force. "day" for equities (default), "gtc" required for crypto. */
  timeInForce?: "day" | "gtc";
  /**
   * Sprint 077A: optional fill price for in-process simulators (Atlas Sim).
   * Real brokers ignore this — they fill at the current market price. The
   * sim adapter requires it because it has no market access.
   */
  referencePrice?: number;
  /** Sprint 077A: strategy hint stored on simulated_trades. */
  strategy?: string;
}

/**
 * A broker order with full lifecycle fields.
 */
export interface Order {
  orderId: string;
  ticker: string;
  action: OrderAction;
  status: OrderStatus;
  /** Dollar notional — may be null for qty-based orders */
  notional: number | null;
  /** Share quantity — may be null for notional-based orders */
  qty: number | null;
  /** Filled share quantity — populated by Alpaca as the order fills */
  filledQty?: number | null;
  /** Average fill price across all fills */
  filledAvgPrice?: number | null;
  /** ISO timestamp the order most recently filled */
  filledAt?: string | null;
  createdAt?: string;
}

/**
 * A single open position.
 */
export interface Position {
  ticker: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
}

/**
 * Brokerage account summary.
 */
export interface Account {
  equity: number;
  cash: number;
  buyingPower: number;
  portfolioValue: number;
}

/**
 * Optional filter for listOrders.
 */
export interface OrderFilter {
  /** Restrict to a specific ticker */
  ticker?: string;
  /** Restrict to orders with this status */
  status?: OrderStatus;
}

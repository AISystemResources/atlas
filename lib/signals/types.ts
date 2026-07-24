/**
 * Atlas signal-layer types — Ticket Logic (Sprint 049).
 *
 * The Ticket is the atomic unit of trade intent. A signal node produces a
 * Ticket; the execution layer converts it to a bracket order on Alpaca.
 *
 * Key invariant: a Ticket carries ALL the risk decisions at the time it's
 * generated. Entry price, stop loss, and take profit are committed numbers,
 * not vibes-to-be-decided-later. This is the deterministic discipline that
 * removes the every-minute cron exit poll from the architecture.
 */

export type TicketAction = "BUY" | "SELL";

export type TicketTimeInForce = "day" | "gtc";

/**
 * The deterministic trade idea produced by a signal node.
 *
 * Once submitted as a bracket order:
 *   - Entry: market order at submission
 *   - Take-profit: limit SELL at take_profit price, sits on Alpaca's matching engine
 *   - Stop-loss: stop SELL at stop_loss price, sits on Alpaca's matching engine
 *   - First exit to trigger cancels the other (Alpaca OCO semantics)
 */
export interface Ticket {
  ticker: string;
  action: TicketAction;
  /** Whole-share quantity. Bracket orders require integer qty (no fractional / notional). */
  qty: number;
  /** Reference entry price (the market may fill slightly different) */
  entry_price: number;
  /** Stop-loss trigger price; SELL fires when market <= stop_loss */
  stop_loss: number;
  /** Take-profit limit price; SELL fires when market >= take_profit */
  take_profit: number;
  /** Time-in-force for the bracket. "day" cancels overnight; "gtc" persists. */
  time_in_force: TicketTimeInForce;
  /**
   * Provenance for the academic audit trail.
   * Which strategy + which signal generation produced this ticket.
   */
  strategy: "scalper" | "swing";
  signal_metadata?: Record<string, unknown>;
}

/**
 * Compute whole-share qty from notional dollars + a current reference price.
 *
 * Returns 0 if the notional cannot afford even one share. The scalper should
 * skip those tickers (or warn the user) rather than enter a degenerate position.
 */
export function computeWholeShareQty(notionalDollars: number, referencePrice: number): number {
  if (referencePrice <= 0 || notionalDollars <= 0) return 0;
  return Math.floor(notionalDollars / referencePrice);
}

/**
 * Build a long-side Ticket from Edmund S1 signal mechanics + per-user parameters.
 *
 * Defaults if no per-user parameters loaded:
 *   stop_buffer_pct = 0.5  (signal_bar_low * (1 - 0.005))
 *   target_atr_multiple = 0.5  (entry + ATR/2)
 *
 * These were the Sprint 043 numbers; Distillation v2 (Sprint 050) refines them.
 */
export function buildS1LongTicket(input: {
  ticker: string;
  signal_bar_high: number;
  signal_bar_low: number;
  atr: number;
  notional_dollars: number;
  current_price: number;
  stop_buffer_pct?: number;        // default 0.5
  target_atr_multiple?: number;    // default 0.5
  entry_buffer_pct?: number;       // default 0.05 (Edmund: SB high + 0.05%)
}): Ticket | null {
  const stop_buffer_pct = input.stop_buffer_pct ?? 0.5;
  const target_atr_multiple = input.target_atr_multiple ?? 0.5;
  const entry_buffer_pct = input.entry_buffer_pct ?? 0.05;

  const entry_price = round4(input.signal_bar_high * (1 + entry_buffer_pct / 100));
  const stop_loss = round4(input.signal_bar_low * (1 - stop_buffer_pct / 100));
  const take_profit = round4(entry_price + input.atr * target_atr_multiple);

  const qty = computeWholeShareQty(input.notional_dollars, input.current_price);
  if (qty === 0) return null;

  // Sanity guard: target must be above entry, stop must be below entry, and
  // entry must clear the stop with a sensible reward-to-risk ratio.
  if (take_profit <= entry_price || stop_loss >= entry_price) return null;

  return {
    ticker: input.ticker,
    action: "BUY",
    qty,
    entry_price,
    stop_loss,
    take_profit,
    time_in_force: "day",
    strategy: "scalper",
    signal_metadata: {
      signal_bar_high: input.signal_bar_high,
      signal_bar_low: input.signal_bar_low,
      atr: input.atr,
      stop_buffer_pct,
      target_atr_multiple,
      entry_buffer_pct,
    },
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

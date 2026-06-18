/**
 * AlpacaAdapter — live/paper trading implementation of BrokerAdapter.
 *
 * Uses @alpacahq/alpaca-trade-api (JS SDK, not alpaca-py).
 * Reads ALPACA_API_KEY and ALPACA_SECRET_KEY from environment.
 * Set ALPACA_PAPER=true (default) for paper trading.
 *
 * Rate limit: Alpaca paper API is 200 req/min.
 *
 * Normalisation notes:
 *   SDK `order.id`          → Atlas `orderId`
 *   SDK `order.symbol`      → Atlas `ticker`
 *   SDK `order.side`        → Atlas `action`  ("buy"→"BUY", "sell"→"SELL")
 *   SDK `order.status`      → Atlas `status`  (mapped to OrderStatus union)
 *   SDK `position.symbol`   → Atlas `ticker`
 *   SDK `position.qty`      → Atlas `qty`      (parsed as float)
 *   SDK `position.avg_entry_price` → Atlas `avgCost`
 *   SDK `position.current_price`   → Atlas `currentPrice`
 *   SDK `position.market_value`    → Atlas `marketValue`
 *   SDK `position.unrealized_pl`   → Atlas `unrealizedPl`
 *   SDK `account.equity`    → Atlas `equity`
 *   SDK `account.cash`      → Atlas `cash`
 *   SDK `account.buying_power`  → Atlas `buyingPower`
 *   SDK `account.portfolio_value` → Atlas `portfolioValue`
 */

import Alpaca from "@alpacahq/alpaca-trade-api";
import { BrokerAdapter, BrokerError } from "./base";
import type {
  Account,
  Order,
  OrderFilter,
  OrderRequest,
  OrderStatus,
  Position,
} from "./types";

const PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const LIVE_BASE_URL = "https://api.alpaca.markets";

function mapStatus(raw: string): OrderStatus {
  const s = raw.toLowerCase();
  if (s === "new" || s === "accepted" || s === "pending_new") return "pending";
  if (s === "open" || s === "held" || s === "partially_filled") return "open";
  if (s === "filled" || s === "done_for_day") return "filled";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s === "expired") return "expired";
  if (s === "rejected" || s === "suspended") return "rejected";
  return "open";
}

export class AlpacaAdapter implements BrokerAdapter {
  private readonly client: InstanceType<typeof Alpaca>;

  constructor(
    apiKey: string = process.env.ALPACA_API_KEY ?? "",
    secretKey: string = process.env.ALPACA_SECRET_KEY ?? "",
    paper: boolean = (process.env.ALPACA_PAPER ?? "true") !== "false",
  ) {
    if (!apiKey) {
      throw new BrokerError("AlpacaAdapter: ALPACA_API_KEY is required");
    }
    if (!secretKey) {
      throw new BrokerError("AlpacaAdapter: ALPACA_SECRET_KEY is required");
    }

    this.client = new Alpaca({
      keyId: apiKey,
      secretKey,
      baseUrl: paper ? PAPER_BASE_URL : LIVE_BASE_URL,
    });
  }

  /**
   * Place a notional market order.
   *
   * Crypto pairs (containing "/") MUST use time_in_force="gtc" — Alpaca
   * rejects "day" TIF on crypto. Callers should pass timeInForce explicitly
   * for crypto; equities default to "day".
   */
  async submitOrder(request: OrderRequest): Promise<Order> {
    try {
      const symbol = request.ticker.toUpperCase();
      const tif = request.timeInForce ?? (symbol.includes("/") ? "gtc" : "day");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await this.client.createOrder({
        symbol,
        notional: String(Math.round(request.notional * 100) / 100),
        side: request.action.toLowerCase(),
        type: "market",
        time_in_force: tif,
      });
      return normaliseOrder(raw);
    } catch (err) {
      throw new BrokerError(
        `submitOrder failed for ${request.ticker}: ${errorMessage(err)}`,
        err,
      );
    }
  }

  /**
   * Place a bracket order — entry + take-profit + stop-loss atomic submission.
   *
   * Alpaca semantics:
   *   - Entry: market BUY at qty shares (whole shares only — bracket orders
   *     do NOT support notional or fractional)
   *   - Take-profit: limit SELL at take_profit_price, sits on the matching engine
   *   - Stop-loss: stop SELL at stop_loss_price, sits on the matching engine
   *   - OCO: first exit to trigger cancels the other
   *
   * The two exits are committed by Alpaca's matching engine on entry fill —
   * no Atlas cron is required to manage them. This is the safety guarantee
   * that the old polling-exit scalper architecture didn't have.
   */
  async submitBracketOrder(input: {
    ticker: string;
    qty: number;
    take_profit_price: number;
    stop_loss_price: number;
    time_in_force?: "day" | "gtc";
  }): Promise<Order> {
    if (input.qty <= 0 || !Number.isInteger(input.qty)) {
      throw new BrokerError(
        `submitBracketOrder requires integer qty > 0 (got ${input.qty})`,
      );
    }
    if (input.take_profit_price <= 0 || input.stop_loss_price <= 0) {
      throw new BrokerError(
        `submitBracketOrder requires positive take_profit and stop_loss prices`,
      );
    }
    if (input.take_profit_price <= input.stop_loss_price) {
      throw new BrokerError(
        `submitBracketOrder: take_profit (${input.take_profit_price}) must be > stop_loss (${input.stop_loss_price})`,
      );
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await this.client.createOrder({
        symbol: input.ticker.toUpperCase(),
        qty: String(input.qty),
        side: "buy",
        type: "market",
        time_in_force: input.time_in_force ?? "day",
        order_class: "bracket",
        take_profit: { limit_price: String(round2(input.take_profit_price)) },
        stop_loss: { stop_price: String(round2(input.stop_loss_price)) },
      });
      return normaliseOrder(raw);
    } catch (err) {
      throw new BrokerError(
        `submitBracketOrder failed for ${input.ticker}: ${errorMessage(err)}`,
        err,
      );
    }
  }

  /**
   * Return all open positions.
   * Handles accounts with >100 positions by fetching all pages.
   * (The JS SDK returns all positions in one call; noted for future pagination.)
   */
  async getPositions(): Promise<Position[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any[] = await this.client.getPositions();
      return raw.map(normalisePosition);
    } catch (err) {
      throw new BrokerError(`getPositions failed: ${errorMessage(err)}`, err);
    }
  }

  /**
   * Return account equity, cash, and buying power.
   */
  async getAccount(): Promise<Account> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await this.client.getAccount();
      return {
        equity: parseFloat(raw.equity),
        cash: parseFloat(raw.cash),
        buyingPower: parseFloat(raw.buying_power),
        portfolioValue: parseFloat(raw.portfolio_value),
      };
    } catch (err) {
      throw new BrokerError(`getAccount failed: ${errorMessage(err)}`, err);
    }
  }

  /**
   * Fetch a single order by ID. Used by the order reconciler to poll for fill
   * status — Alpaca's Trading API does not push trade updates to a webhook;
   * we poll pending orders every minute during market hours.
   */
  async getOrder(orderId: string): Promise<Order> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await this.client.getOrder(orderId);
      return normaliseOrder(raw);
    } catch (err) {
      throw new BrokerError(
        `getOrder failed for ${orderId}: ${errorMessage(err)}`,
        err,
      );
    }
  }

  /**
   * Cancel an open order by ID.
   */
  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.client.cancelOrder(orderId);
    } catch (err) {
      throw new BrokerError(
        `cancelOrder failed for ${orderId}: ${errorMessage(err)}`,
        err,
      );
    }
  }

  /**
   * List orders, optionally filtered by ticker and/or status.
   * Fetches up to 500 orders per call (SDK default).
   * For larger result sets a pagination loop would be added here.
   */
  async listOrders(filter?: OrderFilter): Promise<Order[]> {
    try {
      // Map Atlas OrderStatus values to Alpaca's query status vocabulary
      const statusMap: Record<string, string> = {
        open: "open",
        pending: "open",
        filled: "closed",
        cancelled: "closed",
        expired: "closed",
        rejected: "closed",
      };
      const queryStatus =
        filter?.status !== undefined
          ? (statusMap[filter.status] ?? "all")
          : "all";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let orders: any[] = await this.client.getOrders({
        status: queryStatus,
        until: undefined,
        after: undefined,
        limit: undefined,
        direction: undefined,
        nested: undefined,
        symbols: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      if (filter?.ticker !== undefined) {
        const upper = filter.ticker.toUpperCase();
        orders = orders.filter((o) => o.symbol === upper);
      }

      const mapped = orders.map(normaliseOrder);

      // If a finer-grained status filter was requested, apply it in-memory
      if (filter?.status !== undefined) {
        return mapped.filter((o) => o.status === filter.status);
      }
      return mapped;
    } catch (err) {
      throw new BrokerError(`listOrders failed: ${errorMessage(err)}`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseOrder(raw: any): Order {
  return {
    orderId: String(raw.id),
    ticker: String(raw.symbol),
    action: (raw.side ?? "").toLowerCase() === "sell" ? "SELL" : "BUY",
    status: mapStatus(String(raw.status ?? "")),
    notional: raw.notional != null ? parseFloat(raw.notional) : null,
    qty: raw.qty != null ? parseFloat(raw.qty) : null,
    filledQty:
      raw.filled_qty != null && raw.filled_qty !== ""
        ? parseFloat(raw.filled_qty)
        : null,
    filledAvgPrice:
      raw.filled_avg_price != null && raw.filled_avg_price !== ""
        ? parseFloat(raw.filled_avg_price)
        : null,
    filledAt: raw.filled_at ? String(raw.filled_at) : null,
    createdAt: raw.created_at ? String(raw.created_at) : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalisePosition(raw: any): Position {
  return {
    ticker: String(raw.symbol),
    qty: parseFloat(raw.qty),
    avgCost: parseFloat(raw.avg_entry_price),
    currentPrice: parseFloat(raw.current_price),
    marketValue: parseFloat(raw.market_value),
    unrealizedPl: parseFloat(raw.unrealized_pl),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

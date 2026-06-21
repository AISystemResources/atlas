/**
 * Atlas Simulator — Sprint 077A.
 *
 * In-process paper-trading adapter. Implements BrokerAdapter so the
 * scalper, dashboard, and admin tools can use the same interface
 * regardless of execution venue.
 *
 * Sprint 077A semantics: frictionless v1.
 *   - Fills happen at the caller-supplied referencePrice (signal price).
 *   - No spread, no commission, no slippage.
 *   - Bracket TP/SL are recorded on the position and evaluated on each
 *     scalper tick via tickBrackets() against the latest bar's high/low.
 *   - getAccount.portfolioValue uses entry-price mark-to-market (no live
 *     prices needed). This is wrong by a few % during open positions but
 *     correct at close; sufficient for v1.
 *
 * Sprint 077B will parameterise this by a BrokerProfile so the fill
 * engine can model alpaca-paper vs ibkr-paper vs pepperstone-cfd
 * frictions per profile.
 *
 * No broker credentials are required — that's the whole point. A user
 * onboarded via the founder invite code can paper-trade with $100K
 * virtual cash before ever connecting Alpaca.
 */

import { getServiceClient } from "@/lib/supabase-server";
import type { BrokerAdapter } from "./base";
import { BrokerError } from "./base";
import type { Account, Order, OrderFilter, OrderRequest, Position } from "./types";

const STARTING_CASH = 100_000.0;

interface SimPositionRow {
  id: string;
  user_id: string;
  ticker: string;
  qty: string | number;
  entry_price: string | number;
  take_profit_price: string | number | null;
  stop_loss_price: string | number | null;
  status: "open" | "closed";
  strategy_id: string | null;
}

export interface BarLike {
  high: number;
  low: number;
  close: number;
}

export interface TickBracketsResult {
  filled: number;
  details: Array<{
    ticker: string;
    reason: "tp" | "sl";
    price: number;
    qty: number;
  }>;
}

export class AtlasSimAdapter implements BrokerAdapter {
  constructor(private readonly userId: string) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get sb(): any {
    return getServiceClient();
  }

  private async ensurePortfolio(): Promise<void> {
    const { data } = await this.sb
      .from("simulated_portfolios")
      .select("user_id")
      .eq("user_id", this.userId)
      .maybeSingle();
    if (!data) {
      await this.sb.from("simulated_portfolios").insert({
        user_id: this.userId,
        cash: STARTING_CASH,
        starting_cash: STARTING_CASH,
      });
    }
  }

  // ── BrokerAdapter contract ─────────────────────────────────────────────

  async submitOrder(req: OrderRequest): Promise<Order> {
    if (!req.referencePrice || req.referencePrice <= 0) {
      throw new BrokerError(
        "atlas-sim requires referencePrice — the caller must pass the signal price",
      );
    }
    await this.ensurePortfolio();

    if (req.action === "BUY") {
      const qty = req.notional / req.referencePrice;
      if (qty <= 0) throw new BrokerError("invalid qty after rounding");

      // Debit cash atomically. Read-modify-write here is acceptable for a
      // single-user simulator; if multi-tab contention becomes real, this
      // moves to a SECURITY DEFINER plpgsql function.
      const { data: portfolio } = await this.sb
        .from("simulated_portfolios")
        .select("cash")
        .eq("user_id", this.userId)
        .maybeSingle();
      const cash = Number((portfolio as { cash: number } | null)?.cash ?? 0);
      if (cash < req.notional) {
        throw new BrokerError(`insufficient sim cash (have ${cash.toFixed(2)}, need ${req.notional.toFixed(2)})`);
      }

      const { data: positionRow, error: posErr } = await this.sb
        .from("simulated_positions")
        .insert({
          user_id: this.userId,
          ticker: req.ticker,
          qty,
          entry_price: req.referencePrice,
          status: "open",
        })
        .select("id")
        .single();
      if (posErr || !positionRow) {
        throw new BrokerError(`sim position insert failed: ${posErr?.message ?? "no row"}`);
      }
      const positionId = (positionRow as { id: string }).id;

      await this.sb.from("simulated_trades").insert({
        user_id: this.userId,
        position_id: positionId,
        ticker: req.ticker,
        action: "BUY",
        qty,
        price: req.referencePrice,
        strategy: req.strategy ?? null,
        sim_role: "entry",
      });

      await this.sb
        .from("simulated_portfolios")
        .update({ cash: cash - req.notional, updated_at: new Date().toISOString() })
        .eq("user_id", this.userId);

      return {
        orderId: `sim-${positionId}`,
        ticker: req.ticker,
        action: "BUY",
        status: "filled",
        notional: req.notional,
        qty,
        filledQty: qty,
        filledAvgPrice: req.referencePrice,
        filledAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    }

    // SELL — close oldest open position for this ticker.
    const { data: openRows } = await this.sb
      .from("simulated_positions")
      .select("id, qty, entry_price")
      .eq("user_id", this.userId)
      .eq("ticker", req.ticker)
      .eq("status", "open")
      .order("opened_at", { ascending: true })
      .limit(1);
    const row = ((openRows ?? []) as Array<{ id: string; qty: number; entry_price: number }>)[0];
    if (!row) {
      throw new BrokerError(`no open sim position for ${req.ticker}`);
    }

    const sellPrice = req.referencePrice;
    const proceeds = Number(row.qty) * sellPrice;

    await this.sb
      .from("simulated_positions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        close_reason: "manual",
      })
      .eq("id", row.id);

    await this.sb.from("simulated_trades").insert({
      user_id: this.userId,
      position_id: row.id,
      ticker: req.ticker,
      action: "SELL",
      qty: row.qty,
      price: sellPrice,
      strategy: req.strategy ?? null,
      sim_role: "manual",
    });

    const { data: portfolio } = await this.sb
      .from("simulated_portfolios")
      .select("cash")
      .eq("user_id", this.userId)
      .maybeSingle();
    const cash = Number((portfolio as { cash: number } | null)?.cash ?? 0);
    await this.sb
      .from("simulated_portfolios")
      .update({ cash: cash + proceeds, updated_at: new Date().toISOString() })
      .eq("user_id", this.userId);

    return {
      orderId: `sim-${row.id}`,
      ticker: req.ticker,
      action: "SELL",
      status: "filled",
      notional: proceeds,
      qty: Number(row.qty),
      filledQty: Number(row.qty),
      filledAvgPrice: sellPrice,
      filledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const { data } = await this.sb
      .from("simulated_positions")
      .select("ticker, qty, entry_price")
      .eq("user_id", this.userId)
      .eq("status", "open");
    return ((data ?? []) as Array<{ ticker: string; qty: number; entry_price: number }>).map(
      (r) => ({
        ticker: r.ticker,
        qty: Number(r.qty),
        avgCost: Number(r.entry_price),
        currentPrice: Number(r.entry_price), // stale — no mark-to-market in v1
        marketValue: Number(r.qty) * Number(r.entry_price),
        unrealizedPl: 0,
      }),
    );
  }

  async getAccount(): Promise<Account> {
    await this.ensurePortfolio();
    const { data: portfolio } = await this.sb
      .from("simulated_portfolios")
      .select("cash")
      .eq("user_id", this.userId)
      .maybeSingle();
    const cash = Number((portfolio as { cash: number } | null)?.cash ?? STARTING_CASH);
    const positions = await this.getPositions();
    const heldValue = positions.reduce((s, p) => s + p.marketValue, 0);
    return {
      cash,
      equity: cash + heldValue,
      buyingPower: cash,
      portfolioValue: cash + heldValue,
    };
  }

  async cancelOrder(): Promise<void> {
    // Sim fills are instant; nothing to cancel.
  }

  async listOrders(_filter?: OrderFilter): Promise<Order[]> {
    return [];
  }

  // ── Bracket-style helpers used by the scalper ──────────────────────────

  /**
   * Open a sim position with bracket exit prices stamped on it. The
   * subsequent tickBrackets() calls will close the position when a bar's
   * high crosses TP or low crosses SL.
   */
  async submitBracketOrder(input: {
    ticker: string;
    qty: number;
    take_profit_price: number;
    stop_loss_price: number;
    referencePrice: number;
    strategy?: string;
  }): Promise<Order> {
    await this.ensurePortfolio();
    if (input.qty <= 0) throw new BrokerError("submitBracketOrder requires qty > 0");
    if (input.referencePrice <= 0) throw new BrokerError("submitBracketOrder requires referencePrice > 0");

    const notional = input.qty * input.referencePrice;

    const { data: portfolio } = await this.sb
      .from("simulated_portfolios")
      .select("cash")
      .eq("user_id", this.userId)
      .maybeSingle();
    const cash = Number((portfolio as { cash: number } | null)?.cash ?? 0);
    if (cash < notional) {
      throw new BrokerError(`insufficient sim cash (have ${cash.toFixed(2)}, need ${notional.toFixed(2)})`);
    }

    const { data: positionRow, error: posErr } = await this.sb
      .from("simulated_positions")
      .insert({
        user_id: this.userId,
        ticker: input.ticker,
        qty: input.qty,
        entry_price: input.referencePrice,
        take_profit_price: input.take_profit_price,
        stop_loss_price: input.stop_loss_price,
        status: "open",
      })
      .select("id")
      .single();
    if (posErr || !positionRow) {
      throw new BrokerError(`sim bracket insert failed: ${posErr?.message ?? "no row"}`);
    }
    const positionId = (positionRow as { id: string }).id;

    await this.sb.from("simulated_trades").insert({
      user_id: this.userId,
      position_id: positionId,
      ticker: input.ticker,
      action: "BUY",
      qty: input.qty,
      price: input.referencePrice,
      strategy: input.strategy ?? "scalper",
      sim_role: "entry",
    });

    await this.sb
      .from("simulated_portfolios")
      .update({ cash: cash - notional, updated_at: new Date().toISOString() })
      .eq("user_id", this.userId);

    return {
      orderId: `sim-${positionId}`,
      ticker: input.ticker,
      action: "BUY",
      status: "filled",
      notional,
      qty: input.qty,
      filledQty: input.qty,
      filledAvgPrice: input.referencePrice,
      filledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Stamp a limit-sell TP on the open position for this ticker. Used by
   * the crypto path where the scalper issues a separate limit order
   * after the market BUY fills.
   */
  async submitLimitOrder(input: {
    ticker: string;
    action: "SELL";
    qty: number;
    limitPrice: number;
  }): Promise<Order> {
    if (input.action !== "SELL") {
      throw new BrokerError("sim limit orders only supported for SELL legs of brackets");
    }
    const { data } = await this.sb
      .from("simulated_positions")
      .select("id")
      .eq("user_id", this.userId)
      .eq("ticker", input.ticker)
      .eq("status", "open")
      .order("opened_at", { ascending: true })
      .limit(1);
    const row = ((data ?? []) as Array<{ id: string }>)[0];
    if (!row) throw new BrokerError(`no open sim position to attach TP for ${input.ticker}`);
    await this.sb
      .from("simulated_positions")
      .update({ take_profit_price: input.limitPrice })
      .eq("id", row.id);
    return {
      orderId: `sim-tp-${row.id}`,
      ticker: input.ticker,
      action: "SELL",
      status: "open",
      notional: null,
      qty: input.qty,
    };
  }

  /**
   * Stamp a stop-sell SL on the open position for this ticker.
   */
  async submitStopOrder(input: {
    ticker: string;
    action: "SELL";
    qty: number;
    stopPrice: number;
  }): Promise<Order> {
    if (input.action !== "SELL") {
      throw new BrokerError("sim stop orders only supported for SELL legs of brackets");
    }
    const { data } = await this.sb
      .from("simulated_positions")
      .select("id")
      .eq("user_id", this.userId)
      .eq("ticker", input.ticker)
      .eq("status", "open")
      .order("opened_at", { ascending: true })
      .limit(1);
    const row = ((data ?? []) as Array<{ id: string }>)[0];
    if (!row) throw new BrokerError(`no open sim position to attach SL for ${input.ticker}`);
    await this.sb
      .from("simulated_positions")
      .update({ stop_loss_price: input.stopPrice })
      .eq("id", row.id);
    return {
      orderId: `sim-sl-${row.id}`,
      ticker: input.ticker,
      action: "SELL",
      status: "open",
      notional: null,
      qty: input.qty,
    };
  }

  /**
   * Walk open positions; close any whose latest bar crossed TP or SL.
   * Called by the scalper once per tick after bars are fetched.
   *
   * TP wins ties — if a single bar's range straddled both TP and SL,
   * we credit the winner side. That's a known sim simplification (real
   * brokers would resolve based on intra-bar tick order, which we don't
   * have); a future BrokerProfile can flip this to pessimistic SL-first.
   */
  async tickBrackets(barsByTicker: Map<string, BarLike>): Promise<TickBracketsResult> {
    const { data: openRows } = await this.sb
      .from("simulated_positions")
      .select("id, ticker, qty, entry_price, take_profit_price, stop_loss_price")
      .eq("user_id", this.userId)
      .eq("status", "open");

    const result: TickBracketsResult = { filled: 0, details: [] };
    const rows = (openRows ?? []) as SimPositionRow[];
    if (rows.length === 0) return result;

    let cashDelta = 0;
    for (const pos of rows) {
      const bar = barsByTicker.get(pos.ticker);
      if (!bar) continue;
      const tp = pos.take_profit_price == null ? null : Number(pos.take_profit_price);
      const sl = pos.stop_loss_price == null ? null : Number(pos.stop_loss_price);
      if (tp == null && sl == null) continue;

      let closeAt: number | null = null;
      let reason: "tp" | "sl" | null = null;
      if (tp != null && bar.high >= tp) {
        closeAt = tp;
        reason = "tp";
      } else if (sl != null && bar.low <= sl) {
        closeAt = sl;
        reason = "sl";
      }
      if (closeAt == null || reason == null) continue;

      const qty = Number(pos.qty);
      const proceeds = qty * closeAt;
      cashDelta += proceeds;

      await this.sb
        .from("simulated_positions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          close_reason: reason,
        })
        .eq("id", pos.id);

      await this.sb.from("simulated_trades").insert({
        user_id: this.userId,
        position_id: pos.id,
        ticker: pos.ticker,
        action: "SELL",
        qty,
        price: closeAt,
        strategy: "scalper",
        sim_role: reason,
      });

      result.filled += 1;
      result.details.push({ ticker: pos.ticker, reason, price: closeAt, qty });
    }

    if (cashDelta > 0) {
      const { data: portfolio } = await this.sb
        .from("simulated_portfolios")
        .select("cash")
        .eq("user_id", this.userId)
        .maybeSingle();
      const cash = Number((portfolio as { cash: number } | null)?.cash ?? 0);
      await this.sb
        .from("simulated_portfolios")
        .update({ cash: cash + cashDelta, updated_at: new Date().toISOString() })
        .eq("user_id", this.userId);
    }

    return result;
  }
}

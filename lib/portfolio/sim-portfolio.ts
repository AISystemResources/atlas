/**
 * Sim portfolio reader — Sprint 077A.6.
 *
 * Builds the same shape the /v1/portfolio endpoint returns from Alpaca,
 * but sourced from simulated_portfolios + simulated_positions and
 * marked-to-market via Yahoo quotes.
 *
 * Returned positions carry venue='sim' so the UI can chip them.
 */

import { getServiceClient } from "@/lib/supabase-server";
import { fetchLatestPrices } from "@/lib/market/yahoo-quote";

export interface SimPositionView {
  ticker: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  pnl: number;
  trade_id: string | null;
  executed_at: string | null;
  boundary_mode: string | null;
  venue: "sim";
}

export interface SimPortfolioSummary {
  cash: number;
  equity: number;
  starting_cash: number;
  positions: SimPositionView[];
  has_simulator: boolean;
}

interface SimPositionRow {
  id: string;
  ticker: string;
  qty: string | number;
  entry_price: string | number;
  opened_at: string;
}

export async function loadSimPortfolio(userId: string): Promise<SimPortfolioSummary> {
  const sb = getServiceClient();

  const { data: portfolioRow } = await sb
    .from("simulated_portfolios")
    .select("cash, starting_cash")
    .eq("user_id", userId)
    .maybeSingle();
  const portfolio = portfolioRow as { cash: string | number; starting_cash: string | number } | null;

  if (!portfolio) {
    return {
      cash: 0,
      equity: 0,
      starting_cash: 100_000,
      positions: [],
      has_simulator: false,
    };
  }

  const cash = Number(portfolio.cash);
  const startingCash = Number(portfolio.starting_cash);

  const { data: openRows } = await sb
    .from("simulated_positions")
    .select("id, ticker, qty, entry_price, opened_at")
    .eq("user_id", userId)
    .eq("status", "open");

  const positionsRaw = (openRows ?? []) as SimPositionRow[];

  const uniqueTickers = [...new Set(positionsRaw.map((r) => r.ticker))];
  const priceByTicker = uniqueTickers.length > 0
    ? await fetchLatestPrices(uniqueTickers)
    : new Map<string, number>();

  const positions: SimPositionView[] = positionsRaw.map((r) => {
    const qty = Number(r.qty);
    const entry = Number(r.entry_price);
    const current = priceByTicker.get(r.ticker) ?? entry;
    const pnl = (current - entry) * qty;
    return {
      ticker: r.ticker,
      shares: qty,
      avg_cost: entry,
      current_price: current,
      pnl,
      trade_id: r.id,
      executed_at: r.opened_at,
      boundary_mode: null,
      venue: "sim",
    };
  });

  const heldValue = positions.reduce((s, p) => s + p.shares * p.current_price, 0);

  return {
    cash,
    equity: cash + heldValue,
    starting_cash: startingCash,
    positions,
    has_simulator: true,
  };
}

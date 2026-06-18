/**
 * Historical bar fetcher for Ticket Logic backtests — Sprint 053b.
 *
 * Uses yahoo-finance2 v3. Supports index tickers (e.g. ^DJI), individual
 * stocks (e.g. TSLA), and ETFs (e.g. DIA). Alpaca's market data is IEX-only
 * and excludes indices, so Yahoo is the right source for index backtests.
 *
 * Yahoo intraday limits (as of 2026-06):
 *   5m, 15m, 30m → 60 days
 *   1h           → 730 days
 *   1d           → effectively unlimited
 *
 * The fetcher does NOT enforce these limits — Yahoo returns empty quotes
 * past the limit. The caller surfaces "no bars returned" as a user-facing error.
 */

import YahooFinance from "yahoo-finance2";
import type { Bar } from "@/lib/strategies/indicators";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type BacktestTimeframe = "5m" | "15m" | "1h" | "1d";

interface YahooQuote {
  date: Date | string | number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export async function fetchHistoricalBars(
  ticker: string,
  startDate: Date,
  endDate: Date,
  timeframe: BacktestTimeframe,
): Promise<Bar[]> {
  // yahoo-finance2's chart() interval enum is literal-typed; cast to satisfy.
  const result = (await yf.chart(ticker, {
    period1: startDate,
    period2: endDate,
    interval: timeframe as "5m" | "15m" | "1h" | "1d",
  })) as { quotes?: YahooQuote[] };

  const quotes = result.quotes ?? [];
  if (quotes.length === 0) {
    throw new Error(
      `No bars returned for ${ticker} ${timeframe} between ${startDate.toISOString().slice(0, 10)} and ${endDate.toISOString().slice(0, 10)}. ` +
        `Check Yahoo intraday limits (5m/15m → 60 days, 1h → 730 days).`,
    );
  }

  const bars: Bar[] = [];
  for (const q of quotes) {
    if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
    const ts =
      q.date instanceof Date
        ? q.date.toISOString()
        : new Date(q.date as string | number).toISOString();
    bars.push({
      timestamp: ts,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
    });
  }
  return bars;
}

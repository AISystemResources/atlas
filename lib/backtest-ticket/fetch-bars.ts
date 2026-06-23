/**
 * Historical bar fetcher for Ticket Logic backtests — Sprint 053b.
 *
 * Uses yahoo-finance2 v3. Supports index tickers (e.g. ^DJI), individual
 * stocks (e.g. TSLA), and ETFs (e.g. DIA). Alpaca's market data is IEX-only
 * and excludes indices, so Yahoo is the right source for index backtests.
 *
 * Yahoo intraday limits (as of 2026-06):
 *   1m           → 7 days (start date auto-clamped to max 7 days ago)
 *   2m, 5m, 15m  → 60 days
 *   1h           → 730 days
 *   1d           → effectively unlimited
 *
 * The fetcher auto-clamps the 1m start date so callers never get a silent
 * empty result — for other timeframes the caller surfaces "no bars returned".
 */

import YahooFinance from "yahoo-finance2";
import type { Bar } from "@/lib/strategies/indicators";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type BacktestTimeframe = "1m" | "2m" | "5m" | "15m" | "1h" | "1d";

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
  // 1m data is only available for the last 7 days from Yahoo Finance.
  // Auto-clamp so callers always get data rather than a silent empty result.
  let effectiveStart = startDate;
  if (timeframe === "1m") {
    const sevenDaysAgo = new Date(endDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    if (startDate < sevenDaysAgo) effectiveStart = sevenDaysAgo;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (await yf.chart(ticker, {
    period1: effectiveStart,
    period2: endDate,
    interval: timeframe as "1m" | "2m" | "5m" | "15m" | "1h" | "1d",
  })) as { quotes?: YahooQuote[] };

  const quotes = result.quotes ?? [];
  if (quotes.length === 0) {
    throw new Error(
      `No bars returned for ${ticker} ${timeframe} between ${effectiveStart.toISOString().slice(0, 10)} and ${endDate.toISOString().slice(0, 10)}. ` +
        `Check Yahoo intraday limits (1m → 7 days auto-clamped, 2m/5m/15m → 60 days, 1h → 730 days).`,
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

/**
 * Yahoo intraday bar fetcher — Sprint 077A.5.
 *
 * The live scalper currently pulls intraday bars from Alpaca, which
 * requires the user to have connected Alpaca credentials. For sim-mode
 * users (no broker connected) we need a credentials-free source — Yahoo
 * Finance covers all the same tickers the Atlas Simulator supports.
 *
 * Returns the last `lookbackMinutes` of 1-minute bars in ascending
 * timestamp order. Empty array on error; the scalper treats absence as
 * "skip this ticker this tick", same as the Alpaca path.
 */

import YahooFinance from "yahoo-finance2";

interface YahooQuote {
  date: Date | string | number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface IntradayBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function yahooSymbol(ticker: string): string {
  // BTC/USD → BTC-USD; everything else passes through unchanged
  return ticker.includes("/") ? ticker.replace("/", "-") : ticker;
}

export async function fetchIntradayBarsYahoo(
  ticker: string,
  lookbackMinutes: number = 35,
): Promise<IntradayBar[]> {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackMinutes * 60 * 1000);

  try {
    const result = (await yf.chart(yahooSymbol(ticker), {
      period1: start,
      period2: end,
      interval: "1m",
    })) as { quotes?: YahooQuote[] };

    const quotes = result.quotes ?? [];
    const bars: IntradayBar[] = [];
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
        volume: q.volume ?? 0,
      });
    }
    return bars;
  } catch (err) {
    console.error(`fetchIntradayBarsYahoo failed for ${ticker}:`, err);
    return [];
  }
}

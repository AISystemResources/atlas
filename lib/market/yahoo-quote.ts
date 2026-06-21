/**
 * Yahoo quote fetcher — Sprint 077A.6.
 *
 * Cheap "what is this ticker worth right now" lookup for dashboard
 * mark-to-market on sim portfolios. Yahoo's quote() supports batched
 * lookups so N tickers cost one API call.
 *
 * Falls back to null per ticker on individual failures so a single bad
 * symbol doesn't blank the whole dashboard.
 */

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

function yahooSymbol(ticker: string): string {
  return ticker.includes("/") ? ticker.replace("/", "-") : ticker;
}

interface YfQuoteRow {
  symbol?: string;
  regularMarketPrice?: number | null;
  postMarketPrice?: number | null;
  preMarketPrice?: number | null;
}

export async function fetchLatestPrices(
  tickers: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tickers.length === 0) return out;

  const yahooTickers = tickers.map(yahooSymbol);
  try {
    const res = (await yf.quote(yahooTickers)) as YfQuoteRow | YfQuoteRow[];
    const rows = Array.isArray(res) ? res : [res];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const p =
        r.regularMarketPrice ?? r.postMarketPrice ?? r.preMarketPrice ?? null;
      if (p == null || !Number.isFinite(p)) continue;
      // Map back from Yahoo symbol to our canonical ticker
      const original = tickers[i] ?? r.symbol ?? "";
      out.set(original, Number(p));
    }
  } catch (err) {
    console.warn("[yahoo-quote] batched quote failed:", err);
  }

  return out;
}

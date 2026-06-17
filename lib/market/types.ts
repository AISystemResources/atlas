/**
 * Shared market data types — shape-compatible with Python backend.
 * Field names match `backend/agents/data/market.py` exactly.
 */

/** OHLCV row — matches Python `fetch_ohlcv` output shape. */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** News item — matches Python `fetch_news` output shape. */
export interface NewsItem {
  title: string;
  published: string;
}

/** Fundamental ticker info — covers all 18 `_INFO_KEYS` from Python market.py. */
export interface AtlasTickerInfo {
  shortName: string | null;
  sector: string | null;
  industry: string | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  profitMargins: number | null;
  debtToEquity: number | null;
  returnOnEquity: number | null;
  currentRatio: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currentPrice: number | null;
  targetMeanPrice: number | null;
  recommendationMean: number | null;
}

/** OHLCV row with full ISO timestamp — used by intraday bar fetching. */
export interface IntradayBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Options for `fetchNews`. */
export interface FetchNewsOptions {
  /** ISO date string (YYYY-MM-DD). When provided, only articles before this date are returned. */
  end?: string;
  /** Maximum number of articles to return. Defaults to 10. */
  limit?: number;
}

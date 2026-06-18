/**
 * Market data via @alpacahq/alpaca-trade-api — OHLCV bars and news.
 *
 * Credentials come from the caller (fetched per-user from broker_connections).
 * Falls back to ALPACA_API_KEY / ALPACA_SECRET_KEY env vars for local scripts only.
 */
import Alpaca from "@alpacahq/alpaca-trade-api";
import type { AlpacaCredentials } from "@/lib/broker/credentials";
import type { Bar, IntradayBar, FetchNewsOptions, NewsItem } from "./types";

function createClient(creds?: AlpacaCredentials): InstanceType<typeof Alpaca> {
  const keyId = creds?.apiKey ?? process.env.ALPACA_API_KEY;
  const secretKey = creds?.secretKey ?? process.env.ALPACA_SECRET_KEY;
  const paper = creds?.paper ?? (process.env.ALPACA_PAPER ?? "true") !== "false";
  if (!keyId || !secretKey) {
    throw new Error(
      "No Alpaca credentials available. Connect your Alpaca account in Settings."
    );
  }
  const baseUrl = paper
    ? "https://paper-api.alpaca.markets"
    : "https://api.alpaca.markets";
  return new Alpaca({ keyId, secretKey, baseUrl });
}

export async function fetchBars(
  ticker: string,
  start: string,
  end: string,
  timeframe: string = "1Day",
  creds?: AlpacaCredentials
): Promise<Bar[]> {
  const client = createClient(creds);
  const bars: Bar[] = [];

  try {
    const generator = client.getBarsV2(ticker, {
      start,
      end,
      timeframe,
      feed: "iex",
    }) as AsyncGenerator<{
      Timestamp: string;
      OpenPrice: number;
      HighPrice: number;
      LowPrice: number;
      ClosePrice: number;
      Volume: number;
    }>;

    for await (const bar of generator) {
      bars.push({
        date: bar.Timestamp.slice(0, 10),
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume,
      });
    }
  } catch (err) {
    console.error(`fetchBars failed for ${ticker}:`, err);
    return [];
  }

  return bars;
}

/**
 * Returns true for Alpaca crypto pairs (e.g. "BTC/USD", "ETH/USD").
 * Crypto symbols always contain a "/" — equity tickers never do.
 */
export function isCryptoSymbol(ticker: string): boolean {
  return ticker.includes("/");
}

export async function fetchIntradayBars(
  ticker: string,
  lookbackMinutes: number = 35,
  creds?: AlpacaCredentials
): Promise<IntradayBar[]> {
  if (isCryptoSymbol(ticker)) {
    return fetchCryptoIntradayBars(ticker, lookbackMinutes, creds);
  }

  const client = createClient(creds);
  const bars: IntradayBar[] = [];

  const end = new Date();
  const start = new Date(end.getTime() - lookbackMinutes * 60 * 1000);

  try {
    const generator = client.getBarsV2(ticker, {
      start: start.toISOString(),
      end: end.toISOString(),
      timeframe: "1Min",
      feed: "iex",
    }) as AsyncGenerator<{
      Timestamp: string;
      OpenPrice: number;
      HighPrice: number;
      LowPrice: number;
      ClosePrice: number;
      Volume: number;
    }>;

    for await (const bar of generator) {
      bars.push({
        timestamp: bar.Timestamp,
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume,
      });
    }
  } catch (err) {
    console.error(`fetchIntradayBars failed for ${ticker}:`, err);
    return [];
  }

  return bars;
}

/**
 * Fetch 1-minute bars for an Alpaca crypto pair via the v1beta3 crypto data REST API.
 * The SDK's getBarsV2 is stock-only; crypto uses a separate endpoint with different shape.
 */
export async function fetchCryptoIntradayBars(
  ticker: string,
  lookbackMinutes: number = 35,
  creds?: AlpacaCredentials,
): Promise<IntradayBar[]> {
  const apiKey = creds?.apiKey ?? process.env.ALPACA_API_KEY ?? "";
  const secretKey = creds?.secretKey ?? process.env.ALPACA_SECRET_KEY ?? "";
  if (!apiKey || !secretKey) {
    console.error("fetchCryptoIntradayBars: missing credentials");
    return [];
  }

  const end = new Date();
  const start = new Date(end.getTime() - lookbackMinutes * 60 * 1000);
  const params = new URLSearchParams({
    symbols: ticker.toUpperCase(),
    timeframe: "1Min",
    start: start.toISOString(),
    end: end.toISOString(),
    limit: "1000",
  });

  try {
    const res = await fetch(
      `https://data.alpaca.markets/v1beta3/crypto/us/bars?${params}`,
      {
        headers: {
          "APCA-API-KEY-ID": apiKey,
          "APCA-API-SECRET-KEY": secretKey,
        },
      },
    );
    if (!res.ok) {
      console.error(
        `fetchCryptoIntradayBars HTTP ${res.status} for ${ticker}: ${await res.text()}`,
      );
      return [];
    }
    const json = (await res.json()) as {
      bars?: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>>;
    };
    const symKey = ticker.toUpperCase();
    const raw = json.bars?.[symKey] ?? [];
    return raw.map((b) => ({
      timestamp: b.t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }));
  } catch (err) {
    console.error(`fetchCryptoIntradayBars failed for ${ticker}:`, err);
    return [];
  }
}

export async function fetchNews(
  ticker: string,
  opts: FetchNewsOptions = {},
  creds?: AlpacaCredentials
): Promise<NewsItem[]> {
  const client = createClient(creds);
  const limit = opts.limit ?? 10;

  const newsOptions: Record<string, unknown> = { symbols: [ticker], limit };

  if (opts.end) {
    newsOptions.end = opts.end;
  } else {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    newsOptions.start = sevenDaysAgo.toISOString();
  }

  try {
    const articles = (await client.getNews(newsOptions)) as Array<{
      Headline: string;
      CreatedAt: string;
    }>;

    return articles.map((a) => ({
      title: a.Headline,
      published: a.CreatedAt,
    }));
  } catch (err) {
    console.error(`fetchNews failed for ${ticker}:`, err);
    return [];
  }
}

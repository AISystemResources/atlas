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

export async function fetchIntradayBars(
  ticker: string,
  lookbackMinutes: number = 35,
  creds?: AlpacaCredentials
): Promise<IntradayBar[]> {
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

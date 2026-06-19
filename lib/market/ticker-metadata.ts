/**
 * Ticker metadata loader — Sprint 071.
 *
 * Different ticker kinds expose different analyses honestly. The UI and
 * the AI both lean on this to say "what's available for this ticker"
 * instead of pretending every kind admits the same analysis. The table
 * is small (single-digit hundreds of rows even at scale) so a per-call
 * DB read is fine — no caching layer needed yet.
 *
 * Missing-row semantics: return null. Callers degrade gracefully
 * (capability badges hide, the AI hedges its description).
 */

import { getServiceClient } from "@/lib/supabase-server";

export type TickerKind = "equity" | "etf" | "index" | "crypto";

export interface TickerMetadata {
  ticker: string;
  kind: TickerKind;
  display_name: string;
  has_fundamental_data: boolean;
  has_sentiment_data: boolean;
  has_technical_data: boolean;
  exchange: string | null;
  currency: string;
  description: string | null;
}

export async function getTickerMetadata(
  ticker: string,
): Promise<TickerMetadata | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("ticker_metadata")
    .select(
      "ticker, kind, display_name, has_fundamental_data, has_sentiment_data, has_technical_data, exchange, currency, description",
    )
    .eq("ticker", ticker)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as TickerMetadata;
}

export async function getTickerMetadataMany(
  tickers: string[],
): Promise<Map<string, TickerMetadata>> {
  if (tickers.length === 0) return new Map();
  const sb = getServiceClient();
  const { data } = await sb
    .from("ticker_metadata")
    .select(
      "ticker, kind, display_name, has_fundamental_data, has_sentiment_data, has_technical_data, exchange, currency, description",
    )
    .in("ticker", tickers);
  const map = new Map<string, TickerMetadata>();
  for (const row of (data ?? []) as TickerMetadata[]) {
    map.set(row.ticker, row);
  }
  return map;
}

/** Short capability summary, e.g. "Technical · Fundamentals · Sentiment". */
export function describeCapabilities(m: TickerMetadata): string[] {
  const out: string[] = [];
  if (m.has_technical_data) out.push("Technical");
  if (m.has_fundamental_data) out.push("Fundamentals");
  if (m.has_sentiment_data) out.push("Sentiment");
  return out;
}

export function kindLabel(kind: TickerKind): string {
  switch (kind) {
    case "equity":
      return "Equity";
    case "etf":
      return "ETF";
    case "index":
      return "Index";
    case "crypto":
      return "Crypto";
  }
}

/**
 * Fundamental data via yahoo-finance2 v3.
 *
 * IMPORTANT: yahoo-finance2 v3 requires constructor instantiation.
 * Do NOT use the old v2 default import pattern.
 */
import YahooFinance from "yahoo-finance2";
import type { AtlasTickerInfo } from "./types";
import { getServiceClient } from "@/lib/supabase-server";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

interface YFQuoteSummary {
  price?: {
    shortName?: string | null;
    marketCap?: number | null;
    regularMarketPrice?: number | null;
  };
  assetProfile?: { sector?: string | null; industry?: string | null };
  defaultKeyStatistics?: {
    trailingPE?: number | null;
    forwardPE?: number | null;
    priceToBook?: number | null;
    profitMargins?: number | null;
  };
  summaryDetail?: {
    trailingPE?: number | null;
    forwardPE?: number | null;
    marketCap?: number | null;
    fiftyTwoWeekHigh?: number | null;
    fiftyTwoWeekLow?: number | null;
  };
  financialData?: {
    revenueGrowth?: number | null;
    earningsGrowth?: number | null;
    profitMargins?: number | null;
    debtToEquity?: number | null;
    returnOnEquity?: number | null;
    currentRatio?: number | null;
    currentPrice?: number | null;
    targetMeanPrice?: number | null;
    recommendationMean?: number | null;
  };
}

/**
 * Module set required to cover all 18 `_INFO_KEYS`.
 * Derived from `frontend/lib/probe-yahoo.ts::FIELD_PATHS`.
 */
const REQUIRED_MODULES = [
  "assetProfile",
  "price",
  "summaryDetail",
  "financialData",
  "defaultKeyStatistics",
] as const;

/** Extract a value that may be present as null or a number. */
function toNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

/** Extract a value that may be present as null or a string. */
function toNullableString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return typeof val === "string" ? val : String(val);
}

/**
 * Fetch all 18 fundamental fields for a ticker.
 * Returns an object with `null` for any field that is unavailable —
 * never throws (sector-specific nulls like JPM debtToEquity are expected).
 */
export async function fetchTickerInfo(ticker: string): Promise<AtlasTickerInfo> {
  const empty: AtlasTickerInfo = {
    shortName: null,
    sector: null,
    industry: null,
    trailingPE: null,
    forwardPE: null,
    priceToBook: null,
    revenueGrowth: null,
    earningsGrowth: null,
    profitMargins: null,
    debtToEquity: null,
    returnOnEquity: null,
    currentRatio: null,
    marketCap: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    currentPrice: null,
    targetMeanPrice: null,
    recommendationMean: null,
  };

  try {
    const q = await (yf.quoteSummary as (t: string, opts: unknown) => Promise<YFQuoteSummary>)(ticker, {
      modules: REQUIRED_MODULES,
    });

    return {
      // assetProfile
      shortName: toNullableString(q?.price?.shortName),
      sector: toNullableString(q?.assetProfile?.sector),
      industry: toNullableString(q?.assetProfile?.industry),

      // defaultKeyStatistics (fallback summaryDetail)
      trailingPE: toNullableNumber(
        q?.defaultKeyStatistics?.trailingPE ??
        q?.summaryDetail?.trailingPE
      ),
      forwardPE: toNullableNumber(
        q?.defaultKeyStatistics?.forwardPE ??
        q?.summaryDetail?.forwardPE
      ),
      priceToBook: toNullableNumber(q?.defaultKeyStatistics?.priceToBook),

      // financialData
      revenueGrowth: toNullableNumber(q?.financialData?.revenueGrowth),
      earningsGrowth: toNullableNumber(q?.financialData?.earningsGrowth),
      profitMargins: toNullableNumber(
        q?.financialData?.profitMargins ??
        q?.defaultKeyStatistics?.profitMargins
      ),
      debtToEquity: toNullableNumber(q?.financialData?.debtToEquity),
      returnOnEquity: toNullableNumber(q?.financialData?.returnOnEquity),
      currentRatio: toNullableNumber(q?.financialData?.currentRatio),

      // price / summaryDetail
      marketCap: toNullableNumber(
        q?.price?.marketCap ??
        q?.summaryDetail?.marketCap
      ),
      fiftyTwoWeekHigh: toNullableNumber(q?.summaryDetail?.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNullableNumber(q?.summaryDetail?.fiftyTwoWeekLow),

      // financialData (fallback price.regularMarketPrice)
      currentPrice: toNullableNumber(
        q?.financialData?.currentPrice ??
        q?.price?.regularMarketPrice
      ),
      targetMeanPrice: toNullableNumber(q?.financialData?.targetMeanPrice),
      recommendationMean: toNullableNumber(q?.financialData?.recommendationMean),
    };
  } catch {
    return empty;
  }
}

/**
 * Cached wrapper around fetchTickerInfo. Checks Supabase ticker_info_cache
 * first (TTL: ttlHours). Falls back to live yahoo-finance2 on miss or DB error.
 * Never throws — same silent-fail contract as fetchTickerInfo.
 */
export async function fetchTickerInfoCached(
  ticker: string,
  ttlHours = 6
): Promise<AtlasTickerInfo> {
  try {
    const supabase = getServiceClient();
    const cutoff = new Date(Date.now() - ttlHours * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from("ticker_info_cache")
      .select("data")
      .eq("ticker", ticker)
      .gt("fetched_at", cutoff)
      .maybeSingle();

    if (!error && data) {
      return data.data as AtlasTickerInfo;
    }
  } catch {
    // DB unavailable — fall through to live call
  }

  const result = await fetchTickerInfo(ticker);

  // Best-effort upsert — never block the caller on cache write failure
  try {
    const supabase = getServiceClient();
    await supabase.from("ticker_info_cache").upsert(
      {
        ticker,
        data: result as unknown as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "ticker" }
    );
  } catch {
    // ignore
  }

  return result;
}

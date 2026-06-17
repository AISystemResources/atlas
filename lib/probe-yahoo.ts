/**
 * Shared probe logic for sprint 007-SPIKE-YAHOO-FINANCE2-PROBE.
 *
 * Fetches the 18 keys from Atlas's Python `_INFO_KEYS` via yahoo-finance2's
 * `quoteSummary` endpoint, using the modules that carry each field:
 *   - `assetProfile`        → sector, industry
 *   - `price`               → shortName
 *   - `summaryDetail`       → fiftyTwoWeekHigh, fiftyTwoWeekLow, marketCap
 *   - `financialData`       → current/target prices, growth, margins, ratios
 *   - `defaultKeyStatistics`→ trailing/forward PE, priceToBook
 *
 * This is the exact set of fields the Python fundamental analyst consumes
 * (`backend/agents/data/market.py::_INFO_KEYS`). Coverage = can we supply
 * every one of these from the TS path?
 */
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export const INFO_KEYS = [
  "shortName",
  "sector",
  "industry",
  "trailingPE",
  "forwardPE",
  "priceToBook",
  "revenueGrowth",
  "earningsGrowth",
  "profitMargins",
  "debtToEquity",
  "returnOnEquity",
  "currentRatio",
  "marketCap",
  "fiftyTwoWeekHigh",
  "fiftyTwoWeekLow",
  "currentPrice",
  "targetMeanPrice",
  "recommendationMean",
] as const;

export type InfoKey = (typeof INFO_KEYS)[number];

// Map each field to its (module, source-path) so the close-out can report
// which endpoint the value came from, and so partial-coverage can fall back.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FIELD_PATHS: Record<InfoKey, { modules: string[]; pick: (q: any) => unknown }> = {
  shortName: { modules: ["price"], pick: (q) => q?.price?.shortName },
  sector: { modules: ["assetProfile"], pick: (q) => q?.assetProfile?.sector },
  industry: { modules: ["assetProfile"], pick: (q) => q?.assetProfile?.industry },
  trailingPE: { modules: ["defaultKeyStatistics", "summaryDetail"], pick: (q) => q?.defaultKeyStatistics?.trailingPE ?? q?.summaryDetail?.trailingPE },
  forwardPE: { modules: ["defaultKeyStatistics", "summaryDetail"], pick: (q) => q?.defaultKeyStatistics?.forwardPE ?? q?.summaryDetail?.forwardPE },
  priceToBook: { modules: ["defaultKeyStatistics"], pick: (q) => q?.defaultKeyStatistics?.priceToBook },
  revenueGrowth: { modules: ["financialData"], pick: (q) => q?.financialData?.revenueGrowth },
  earningsGrowth: { modules: ["financialData"], pick: (q) => q?.financialData?.earningsGrowth },
  profitMargins: { modules: ["financialData", "defaultKeyStatistics"], pick: (q) => q?.financialData?.profitMargins ?? q?.defaultKeyStatistics?.profitMargins },
  debtToEquity: { modules: ["financialData"], pick: (q) => q?.financialData?.debtToEquity },
  returnOnEquity: { modules: ["financialData"], pick: (q) => q?.financialData?.returnOnEquity },
  currentRatio: { modules: ["financialData"], pick: (q) => q?.financialData?.currentRatio },
  marketCap: { modules: ["price", "summaryDetail"], pick: (q) => q?.price?.marketCap ?? q?.summaryDetail?.marketCap },
  fiftyTwoWeekHigh: { modules: ["summaryDetail"], pick: (q) => q?.summaryDetail?.fiftyTwoWeekHigh },
  fiftyTwoWeekLow: { modules: ["summaryDetail"], pick: (q) => q?.summaryDetail?.fiftyTwoWeekLow },
  currentPrice: { modules: ["financialData", "price"], pick: (q) => q?.financialData?.currentPrice ?? q?.price?.regularMarketPrice },
  targetMeanPrice: { modules: ["financialData"], pick: (q) => q?.financialData?.targetMeanPrice },
  recommendationMean: { modules: ["financialData"], pick: (q) => q?.financialData?.recommendationMean },
};

const REQUIRED_MODULES = Array.from(
  new Set(Object.values(FIELD_PATHS).flatMap((f) => f.modules)),
);

export interface ProbeResult {
  ticker: string;
  ok: boolean;
  latency_ms: number;
  info: Partial<Record<InfoKey, unknown>>;
  missing: InfoKey[];
  nullable: InfoKey[];
  error?: string;
}

export async function probeTicker(ticker: string): Promise<ProbeResult> {
  const start = performance.now();
  try {
    // Cast to any — yahoo-finance2's module union types are strict literals;
    // the library accepts any valid module string at runtime.
    const q = await yahooFinance.quoteSummary(ticker, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modules: REQUIRED_MODULES as any,
    });
    const info: Partial<Record<InfoKey, unknown>> = {};
    const missing: InfoKey[] = [];
    const nullable: InfoKey[] = [];
    for (const key of INFO_KEYS) {
      const val = FIELD_PATHS[key].pick(q);
      if (val === undefined) {
        missing.push(key);
      } else if (val === null) {
        nullable.push(key);
        info[key] = null;
      } else {
        info[key] = val;
      }
    }
    return {
      ticker,
      ok: missing.length === 0,
      latency_ms: Math.round(performance.now() - start),
      info,
      missing,
      nullable,
    };
  } catch (err) {
    return {
      ticker,
      ok: false,
      latency_ms: Math.round(performance.now() - start),
      info: {},
      missing: [...INFO_KEYS],
      nullable: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeMany(
  tickers: string[],
  concurrent: boolean,
): Promise<ProbeResult[]> {
  if (concurrent) {
    return Promise.all(tickers.map(probeTicker));
  }
  const out: ProbeResult[] = [];
  for (const t of tickers) out.push(await probeTicker(t));
  return out;
}

export function summarizeCoverage(results: ProbeResult[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coverage: Record<InfoKey, { ok: number; missing: number; null: number }> = {} as any;
  for (const key of INFO_KEYS) coverage[key] = { ok: 0, missing: 0, null: 0 };
  for (const r of results) {
    for (const key of INFO_KEYS) {
      if (r.missing.includes(key)) coverage[key].missing++;
      else if (r.nullable.includes(key)) coverage[key].null++;
      else coverage[key].ok++;
    }
  }
  return coverage;
}

export function latencyStats(latencies: number[]) {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return {
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

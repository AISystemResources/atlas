/**
 * Cached Yahoo bar fetcher — Sprint 072, incremental upgrade.
 *
 * Wraps fetchHistoricalBars() with a per-day Supabase cache. Once a trading
 * day is stored it is never re-fetched, so 1m data (Yahoo 7-day limit) grows
 * one day at a time as you run backtests daily.
 *
 * Three paths:
 *   A. All cacheable days stored, no live day → pure cache (zero Yahoo calls)
 *   B. All cacheable days stored, today in range → fetch today only
 *   C. Some cacheable days missing → fetch from earliest gap to endDate
 *      (fetch-bars.ts auto-clamps 1m to 7 days; older gaps get empty rows
 *       written so they are not retried on subsequent calls)
 */

import { getServiceClient } from "@/lib/supabase-server";
import type { Bar } from "@/lib/strategies/indicators";
import { fetchHistoricalBars, type BacktestTimeframe } from "./fetch-bars";
import { enumerateDays, nyDateKey, todayNyDateKey } from "./fetch-bars-cached-helpers";

interface CacheRow {
  trading_date: string; // YYYY-MM-DD
  bars: Bar[];
  bar_count: number;
}

export async function fetchHistoricalBarsCached(
  ticker: string,
  startDate: Date,
  endDate: Date,
  timeframe: BacktestTimeframe,
): Promise<Bar[]> {
  const sb = getServiceClient();
  const daysWanted = enumerateDays(startDate, endDate);
  if (daysWanted.length === 0) return [];

  const today = todayNyDateKey();
  const cacheableWanted = daysWanted.filter((d) => d < today);
  const rangeIncludesToday = daysWanted.includes(today);

  // Load whatever we already have in the cache for this range.
  let cachedRows: CacheRow[] = [];
  if (cacheableWanted.length > 0) {
    const { data } = await sb
      .from("yahoo_bars_cache")
      .select("trading_date, bars, bar_count")
      .eq("ticker", ticker)
      .eq("timeframe", timeframe)
      .in("trading_date", cacheableWanted);
    cachedRows = (data ?? []) as CacheRow[];
  }

  const cachedByDate = new Map<string, CacheRow>();
  for (const row of cachedRows) {
    cachedByDate.set(row.trading_date, row);
  }

  const missingDays = cacheableWanted.filter((d) => !cachedByDate.has(d));
  const allCacheableHit = missingDays.length === 0;

  // Assemble the final bar array from cache + a freshly-fetched day map.
  // Cache takes priority for days it already holds; the fresh map fills the rest.
  function assemble(freshByDay: Map<string, Bar[]>): Bar[] {
    const out: Bar[] = [];
    for (const d of daysWanted) {
      if (cachedByDate.has(d)) {
        out.push(...cachedByDate.get(d)!.bars);
      } else {
        out.push(...(freshByDay.get(d) ?? []));
      }
    }
    return out;
  }

  // ── Path A: pure cache ───────────────────────────────────────────────────
  if (allCacheableHit && !rangeIncludesToday) {
    return assemble(new Map());
  }

  // ── Path B: history fully cached, fetch today only ───────────────────────
  if (allCacheableHit && rangeIncludesToday) {
    const startOfToday = new Date(today); // midnight UTC — before NYSE open
    const todayBars = await fetchHistoricalBars(ticker, startOfToday, endDate, timeframe)
      .catch(() => [] as Bar[]);
    const freshByDay = bucketByDay(todayBars);
    return assemble(freshByDay);
  }

  // ── Path C: gap in history — incremental fetch from earliest missing day ─
  // fetch-bars.ts auto-clamps 1m requests that pre-date the 7-day Yahoo limit,
  // so we'll get as far back as Yahoo allows and write empty rows for the rest.
  const gapStart = new Date(missingDays[0]); // earliest missing date, midnight UTC
  const fresh = await fetchHistoricalBars(ticker, gapStart, endDate, timeframe)
    .catch(() => [] as Bar[]);
  const freshByDay = bucketByDay(fresh);

  // Upsert one row per missing cacheable day — empty row for days Yahoo couldn't
  // fill (holidays, pre-limit 1m gaps) so they are not retried next run.
  const upserts = missingDays.map((d) => ({
    ticker,
    timeframe,
    trading_date: d,
    bars: freshByDay.get(d) ?? [],
    bar_count: (freshByDay.get(d) ?? []).length,
    fetched_at: new Date().toISOString(),
  }));
  if (upserts.length > 0) {
    sb.from("yahoo_bars_cache")
      .upsert(upserts, { onConflict: "ticker,timeframe,trading_date" })
      .then(({ error }) => {
        if (error) {
          console.warn(
            `[yahoo-bars-cache] upsert failed for ${ticker} ${timeframe}: ${error.message}`,
          );
        }
      });
  }

  const result = assemble(freshByDay);
  if (result.length === 0) {
    throw new Error(
      `No bars available for ${ticker} ${timeframe} from ` +
        `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}. ` +
        `Yahoo intraday limits: 1m → 7 days, 2m/5m/15m → 60 days, 1h → 730 days.`,
    );
  }
  return result;
}

function bucketByDay(bars: Bar[]): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const bar of bars) {
    if (!bar.timestamp) continue;
    const key = nyDateKey(bar.timestamp);
    const arr = out.get(key) ?? [];
    arr.push(bar);
    out.set(key, arr);
  }
  return out;
}

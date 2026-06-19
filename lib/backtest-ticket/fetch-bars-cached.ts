/**
 * Cached Yahoo bar fetcher — Sprint 072.
 *
 * Wraps fetchHistoricalBars() with a per-day Supabase cache. Repeat
 * backtests of the same date range hit the cache instead of re-fetching
 * from Yahoo every time.
 *
 * Strategy: "all-or-fetch". For a date range:
 *   1. Enumerate calendar days in [startDate, endDate].
 *   2. SELECT cached rows for those days.
 *   3. If every day is present in the cache → return concatenated bars.
 *   4. Otherwise → fetch the full range from Yahoo, bucket bars by US/Eastern
 *      trading date, UPSERT one row per (ticker, timeframe, date) including
 *      empty rows for holidays/no-data days (so they don't get retried).
 *      Today's date is intentionally excluded from the upsert — today is
 *      still being produced and would poison the cache.
 *
 * Bucketing uses US/Eastern for equities/indices/ETFs and UTC for crypto.
 * The simplest correct rule: bucket by the calendar day in America/New_York
 * for everything. Crypto bars fall into whichever NYC day contains their
 * UTC timestamp, which is consistent across calls.
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
  const today = todayNyDateKey();

  // Today's row is never cached, so look up everything except today.
  const cacheableWanted = daysWanted.filter((d) => d < today);

  const { data: cachedRows } = await sb
    .from("yahoo_bars_cache")
    .select("trading_date, bars, bar_count")
    .eq("ticker", ticker)
    .eq("timeframe", timeframe)
    .in("trading_date", cacheableWanted);

  const cachedByDate = new Map<string, CacheRow>();
  for (const row of (cachedRows ?? []) as CacheRow[]) {
    cachedByDate.set(row.trading_date, row);
  }

  const allCacheableHit =
    cacheableWanted.length === 0 ||
    cacheableWanted.every((d) => cachedByDate.has(d));
  const rangeIncludesToday = daysWanted.includes(today);

  if (allCacheableHit && !rangeIncludesToday) {
    // Pure cache path. Concat in date order, then by timestamp inside each day.
    const out: Bar[] = [];
    for (const d of cacheableWanted) {
      const row = cachedByDate.get(d);
      if (row) out.push(...row.bars);
    }
    return out;
  }

  // Cache miss for at least one day — fetch the full range and refresh.
  const fresh = await fetchHistoricalBars(ticker, startDate, endDate, timeframe);

  // Bucket by NY trading day.
  const byDay = new Map<string, Bar[]>();
  for (const bar of fresh) {
    if (!bar.timestamp) continue;
    const key = nyDateKey(bar.timestamp);
    const arr = byDay.get(key) ?? [];
    arr.push(bar);
    byDay.set(key, arr);
  }

  // Upsert one row per cacheable day (skip today). Empty rows for days
  // with no Yahoo data so they don't get retried indefinitely.
  const upserts: Array<{
    ticker: string;
    timeframe: BacktestTimeframe;
    trading_date: string;
    bars: Bar[];
    bar_count: number;
    fetched_at: string;
  }> = [];
  for (const d of cacheableWanted) {
    const bars = byDay.get(d) ?? [];
    upserts.push({
      ticker,
      timeframe,
      trading_date: d,
      bars,
      bar_count: bars.length,
      fetched_at: new Date().toISOString(),
    });
  }
  if (upserts.length > 0) {
    // Fire-and-forget upsert — don't block the caller on cache write.
    // Errors are logged but don't fail the read.
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

  return fresh;
}

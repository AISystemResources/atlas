-- Sprint 072: per-day cache of Yahoo bars.
--
-- Repeat backtests of the same date range refetch from Yahoo every time —
-- slow and rude to Yahoo. This cache keys by (ticker, timeframe, trading_date)
-- so subsequent runs for an overlapping range hit Supabase instead.
--
-- "All-or-fetch" strategy: a range query checks the cache for every calendar
-- day in the range; if any day is missing the fetcher hits Yahoo for the full
-- range and upserts every day (including empty rows for holidays/no-data days
-- so they don't get retried forever).
--
-- Rows for "today" are intentionally not written — today's bars are still
-- being produced and would poison the cache.

CREATE TABLE IF NOT EXISTS public.yahoo_bars_cache (
  ticker text NOT NULL,
  timeframe text NOT NULL CHECK (timeframe IN ('5m', '15m', '1h', '1d')),
  trading_date date NOT NULL,
  bars jsonb NOT NULL,
  bar_count integer NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, timeframe, trading_date)
);

CREATE INDEX IF NOT EXISTS yahoo_bars_cache_fetched_idx
  ON public.yahoo_bars_cache (fetched_at);

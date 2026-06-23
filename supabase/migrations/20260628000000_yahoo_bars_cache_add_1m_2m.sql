-- Sprint 053.0: allow 1m and 2m timeframes in yahoo_bars_cache.
-- The original constraint only permitted 5m/15m/1h/1d; incremental bar
-- caching now accumulates 1m and 2m data one trading day at a time.
ALTER TABLE public.yahoo_bars_cache
  DROP CONSTRAINT IF EXISTS yahoo_bars_cache_timeframe_check;
ALTER TABLE public.yahoo_bars_cache
  ADD CONSTRAINT yahoo_bars_cache_timeframe_check
  CHECK (timeframe IN ('1m', '2m', '5m', '15m', '1h', '1d'));

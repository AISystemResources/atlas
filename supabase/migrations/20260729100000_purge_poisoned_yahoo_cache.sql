-- Purge cache-poisoning rows caused by the fetch-bars-cached bug (fixed in
-- the same PR that ships this migration).
--
-- Previously: if a Yahoo fetch failed OR returned zero quotes for the whole
-- range, the wrapper caught the error and wrote empty rows for every missing
-- weekday in the range. On the next call, Path A read those empties, saw
-- "all cacheable days hit", and returned [] with no error — silent zero-bar
-- backtests forever, per (ticker, timeframe) pair.
--
-- Cleanup criterion: delete empty rows that fall on a weekday. Weekend
-- empties are legit (Yahoo doesn't serve Sat/Sun) and can stay. Weekday
-- empties are almost all poisoning; the small tail of real US-market
-- holidays will get re-fetched (returning empty legitimately) on next call,
-- and the fixed cache logic will re-write them as legit empty rows.

delete from public.yahoo_bars_cache
where bar_count = 0
  and extract(isodow from trading_date) between 1 and 5;

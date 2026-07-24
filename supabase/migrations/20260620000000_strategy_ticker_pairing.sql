-- Sprint 068: strategies are locked to a ticker, organized by tags.
--
-- Per the post-pivot framing, "one strategy for many tickers" is rarely
-- honest — Edmund's S1 calibrated for ^DJI doesn't transfer to TSLA without
-- retuning. Locking strategy to ticker forces the artifact to be honest
-- about where it has been validated.
--
-- Tags are a cross-cutting layer for grouping similar strategies across
-- tickers (e.g. "mean-reversion", "5m") without forcing a
-- single hierarchy.
--
-- watchlist.strategy_id pairs a watchlist row (the user's intent to trade a
-- ticker) with the specific strategy to use for that ticker. The scalper
-- resolves per (user, ticker) by joining watchlist → ticket_logics.

ALTER TABLE public.ticket_logics
  ADD COLUMN IF NOT EXISTS ticker text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS ticket_logics_ticker_idx
  ON public.ticket_logics (ticker)
  WHERE ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS ticket_logics_tags_idx
  ON public.ticket_logics USING gin (tags);

ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS strategy_id uuid REFERENCES public.ticket_logics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS watchlist_strategy_idx
  ON public.watchlist (strategy_id)
  WHERE strategy_id IS NOT NULL;

-- Backfill existing strategies (edmund-s1-long was tuned for ^DJI).
UPDATE public.ticket_logics
SET ticker = '^DJI',
    tags = ARRAY['mean-reversion', '5m']
WHERE name = 'edmund-s1-long';

-- Backfill Edmund's watchlist DIA row → edmund-s1-long v2 (preserves
-- previously-configured scalper behaviour through the schema change).
-- DIA is the DJIA ETF and was Edmund's stand-in for the ^DJI index that
-- edmund-s1-long was calibrated on. Other tickers on his watchlist are
-- intentionally left strategy_id=NULL — the post-pivot framing is that
-- one strategy is rarely honest for many tickers, so the user picks
-- per-ticker assignments going forward.
UPDATE public.watchlist
SET strategy_id = (
  SELECT id FROM public.ticket_logics
  WHERE name = 'edmund-s1-long' AND version = 2
)
WHERE user_id = 'user_3B4k96FjK9wZUDi8Xs0AzeNLnvy'
  AND ticker = 'DIA';

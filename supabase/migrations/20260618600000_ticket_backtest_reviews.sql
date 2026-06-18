-- Sprint 053d + 053e: AI Trade Reviewer + Aggregate Insight.
--
-- Two new tables that close the Sprint 053 arc loop:
--
-- ticket_backtest_trade_reviews — per-trade AI analysis. The reviewer LLM
--   ingests one trade's context (entry conditions that fired, indicator
--   snapshot, bars around entry, exit) and returns structured judgment:
--   skill vs luck, what worked, what didn't, optional parameter adjustment.
--
-- ticket_backtest_insights — aggregate analysis across all trades in a
--   backtest. The aggregate reviewer reads the per-trade reviews + the
--   trade list and identifies patterns. Output includes a "recommendation"
--   (promote / keep / deprecate) and, if promote, a list of parameter_changes
--   that drive the creation of a new ticket_logics row (version N+1).

CREATE TABLE IF NOT EXISTS public.ticket_backtest_trade_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.ticket_backtest_trades(id) ON DELETE CASCADE,
  model text NOT NULL,
  prompt_version text NOT NULL,
  skill_or_luck text NOT NULL CHECK (skill_or_luck IN ('skill', 'luck', 'mixed')),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  rationale text NOT NULL,
  what_worked jsonb NOT NULL DEFAULT '[]'::jsonb,
  what_didnt jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_adjustment jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One review per trade (latest wins on re-review — we delete-then-insert).
CREATE UNIQUE INDEX IF NOT EXISTS ticket_backtest_trade_reviews_trade_idx
  ON public.ticket_backtest_trade_reviews (trade_id);

ALTER TABLE public.ticket_backtest_trade_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend service key bypasses RLS"
  ON public.ticket_backtest_trade_reviews FOR ALL USING (true);

-- ── ticket_backtest_insights ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticket_backtest_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL REFERENCES public.ticket_backtests(id) ON DELETE CASCADE,
  model text NOT NULL,
  prompt_version text NOT NULL,
  winning_pattern text NOT NULL,
  losing_pattern text NOT NULL,
  recommendation text NOT NULL CHECK (recommendation IN ('promote', 'keep', 'deprecate')),
  rationale text NOT NULL,
  proposed_changes jsonb,   -- array of { path, current, proposed, reason }
  promoted_to_version_id uuid REFERENCES public.ticket_logics(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ticket_backtest_insights_backtest_idx
  ON public.ticket_backtest_insights (backtest_id);

ALTER TABLE public.ticket_backtest_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend service key bypasses RLS"
  ON public.ticket_backtest_insights FOR ALL USING (true);

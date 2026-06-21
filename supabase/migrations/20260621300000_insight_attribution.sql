-- Sprint 053.0: forced attribution on distillation insights.
--
-- The LLM that distils a backtest now MUST cite which trade ids support
-- each pattern + each proposed_change. Stored as text[] of uuid strings
-- so we can join back to ticket_backtest_trades for the academic audit
-- trail.
--
-- proposed_changes was already JSONB; we extend each entry's shape to
-- include supporting_trade_ids — no migration needed for that field,
-- the new shape is forward-compatible with the old reader.

ALTER TABLE public.ticket_backtest_insights
  ADD COLUMN IF NOT EXISTS winning_trade_ids text[],
  ADD COLUMN IF NOT EXISTS losing_trade_ids text[];

CREATE INDEX IF NOT EXISTS ticket_backtest_insights_winning_trades_idx
  ON public.ticket_backtest_insights USING gin (winning_trade_ids);

CREATE INDEX IF NOT EXISTS ticket_backtest_insights_losing_trades_idx
  ON public.ticket_backtest_insights USING gin (losing_trade_ids);

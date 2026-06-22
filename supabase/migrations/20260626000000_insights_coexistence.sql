-- Sprint 079C.1: enable multiple distillation insights per backtest, each
-- stamped with model + prompt_version. Llama auto-distillation can coexist
-- with Claude-via-MCP submissions on the same backtest. UPSERT semantics
-- handle re-runs of the same (model, prompt_version) cleanly.

ALTER TABLE public.ticket_backtest_insights
  ADD CONSTRAINT ticket_backtest_insights_unique_per_model
  UNIQUE (backtest_id, model, prompt_version);

COMMENT ON CONSTRAINT ticket_backtest_insights_unique_per_model
  ON public.ticket_backtest_insights IS
  'Sprint 079C.1: one row per (backtest, model, prompt_version). Multiple models can review the same backtest; same model+prompt re-runs UPSERT.';

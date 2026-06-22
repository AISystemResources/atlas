-- Sprint 079C.1.1 hotfix: drop the legacy single-column unique index that
-- 079C.1 missed. The index was created back in Sprint 053b when there was
-- only ever expected to be one insight per backtest. 079C.1 added the
-- correct UNIQUE(backtest_id, model, prompt_version) for coexistence, but
-- left the older more-restrictive index in place — so Postgres still
-- enforced one-row-per-backtest and rejected the second model's insert.
--
-- Drop is safe: zero existing duplicates by backtest_id (verified before
-- 079C.1) AND the new constraint already enforces (backtest_id, model,
-- prompt_version) uniqueness, which is strictly more permissive.

DROP INDEX IF EXISTS public.ticket_backtest_insights_backtest_idx;

-- Sprint 048 Day 2 (folds Sprint 046 schema work): 4-cell asymmetric autonomy.
--
-- Replaces the single boundary_mode dimension with two orthogonal booleans:
--   ai_intervenes_open  — does AI execute BUY signals autonomously?
--   ai_intervenes_close — does AI execute SELL signals autonomously?
--
-- The four cells (a-priori risk ranking):
--   open=true,  close=true   -- full autonomy (current "autonomous"); EBC circuit breaker active
--   open=false, close=false  -- full manual / advisory (current "advisory")
--   open=true,  close=false  -- HIGH RISK (moral hazard — AI accumulates, human can't exit fast enough)
--   open=false, close=true   -- LOWEST RISK / OPTIMAL (human gates entries, AI handles exits mechanically)
--
-- boundary_mode column is preserved for backward compat and historical trades;
-- new flags are derived from current boundary_mode for existing rows.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_intervenes_open  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_intervenes_close boolean NOT NULL DEFAULT true;

-- Backfill from existing boundary_mode (one-shot; subsequent writes from Settings UI).
UPDATE public.profiles SET ai_intervenes_open  = false WHERE boundary_mode = 'advisory';
UPDATE public.profiles SET ai_intervenes_close = false WHERE boundary_mode = 'advisory';
-- 'autonomous' and 'autonomous_guardrail' map to defaults (both true).

-- Per-trade attribution: who triggered the open vs close.
-- nullable because legacy rows (pre-048) have no attribution recorded.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS opened_by text CHECK (opened_by IN ('ai', 'human')),
  ADD COLUMN IF NOT EXISTS closed_by text CHECK (closed_by IN ('ai', 'human'));

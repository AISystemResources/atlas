-- Sprint 040: intraday scalper settings
-- scalper_enabled (profiles): per-user opt-in, default false.
-- strategy (trades): distinguishes scalper vs swing executions for EOD close logic.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS scalper_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT 'swing';

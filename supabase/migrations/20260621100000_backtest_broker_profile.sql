-- Sprint 077B.1: track which BrokerProfile each backtest ran under so
-- the academic "same strategy under multiple profiles" comparison is
-- one SQL query away.
--
-- Default 'pure' (frictionless) preserves the meaning of existing rows —
-- they were always run frictionless, so labelling them 'pure' is honest.

ALTER TABLE public.ticket_backtests
  ADD COLUMN IF NOT EXISTS broker_profile_id text NOT NULL DEFAULT 'pure';

ALTER TABLE public.ticket_backtests
  ADD COLUMN IF NOT EXISTS total_friction_dollars numeric(18, 4);

CREATE INDEX IF NOT EXISTS ticket_backtests_profile_idx
  ON public.ticket_backtests (broker_profile_id);

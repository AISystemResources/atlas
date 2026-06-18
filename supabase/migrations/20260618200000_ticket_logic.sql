-- Sprint 049: Ticket Logic.
--
-- Separates the SIGNAL layer (parameters that describe a trade thesis) from
-- the EXECUTION layer (bracket orders that commit to those parameters at
-- order-submission time).
--
-- 1. signal_parameters — per-user × per-strategy × per-ticker risk parameters.
--    Designed so future "named strategies" can group parameter sets without
--    a migration rewrite (strategy column is text; a future strategies table
--    can reference it).
--
-- 2. watchlist.scalper_enabled — explicit per-ticker opt-in.
--    Replaces the DJIA-30 hardcoded broadcast that picked 13 random
--    constituent stocks last night on Edmund's account.

CREATE TABLE IF NOT EXISTS public.signal_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy text NOT NULL CHECK (strategy IN ('scalper', 'swing')),
  ticker text,  -- nullable: null = global default for the user × strategy
  parameter_key text NOT NULL,
  current_value numeric NOT NULL,
  proposed_value numeric,         -- distillation's suggestion; promotion is a separate action
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('default', 'user', 'distillation', 'claude_chat')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (user, strategy, ticker-or-global, parameter)
CREATE UNIQUE INDEX IF NOT EXISTS signal_parameters_unique_key_idx
  ON public.signal_parameters (user_id, strategy, COALESCE(ticker, ''), parameter_key);

CREATE INDEX IF NOT EXISTS signal_parameters_user_strategy_idx
  ON public.signal_parameters (user_id, strategy);

ALTER TABLE public.signal_parameters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend service key bypasses RLS"
  ON public.signal_parameters FOR ALL USING (true);

-- Per-ticker opt-in for the scalper. Replaces DJIA-30 broadcast.
ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS scalper_enabled boolean NOT NULL DEFAULT false;

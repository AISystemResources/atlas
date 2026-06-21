-- Sprint 077A: Atlas Simulator — broker-independent paper trading.
--
-- Today, paper-trading == Alpaca paper. That couples strategy testing
-- (which should be broker-independent) with execution venue (which only
-- matters when going live). This migration introduces in-process
-- simulated portfolios/positions/trades, plus the per-watchlist-row
-- execution_mode that picks which adapter runs.
--
-- New users default to execution_mode='sim'. Connecting Alpaca is a
-- conversion event, not an activation event — friends invited via the
-- founder code can paper-trade $100K virtual cash before any broker
-- account exists.
--
-- 077A is frictionless v1 — no spread, no commission, no slippage.
-- Sprint 077B will parameterize the fill engine by BrokerProfile.

CREATE TABLE IF NOT EXISTS public.simulated_portfolios (
  user_id text PRIMARY KEY,
  cash numeric(18, 2) NOT NULL DEFAULT 100000.00 CHECK (cash >= 0),
  starting_cash numeric(18, 2) NOT NULL DEFAULT 100000.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.simulated_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  ticker text NOT NULL,
  qty numeric(18, 8) NOT NULL CHECK (qty > 0),
  entry_price numeric(18, 4) NOT NULL CHECK (entry_price > 0),
  take_profit_price numeric(18, 4),
  stop_loss_price numeric(18, 4),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text CHECK (close_reason IS NULL OR close_reason IN ('tp', 'sl', 'manual', 'eod', 'crypto_polling_exit')),
  strategy_id uuid REFERENCES public.ticket_logics(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS simulated_positions_user_open_idx
  ON public.simulated_positions (user_id, ticker)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS simulated_positions_user_idx
  ON public.simulated_positions (user_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.simulated_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  position_id uuid REFERENCES public.simulated_positions(id) ON DELETE SET NULL,
  ticker text NOT NULL,
  action text NOT NULL CHECK (action IN ('BUY', 'SELL')),
  qty numeric(18, 8) NOT NULL CHECK (qty > 0),
  price numeric(18, 4) NOT NULL CHECK (price > 0),
  strategy text,
  sim_role text CHECK (sim_role IN ('entry', 'tp', 'sl', 'manual', 'eod', 'crypto_polling_exit')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS simulated_trades_user_idx
  ON public.simulated_trades (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS simulated_trades_position_idx
  ON public.simulated_trades (position_id);

-- Per-watchlist-row execution mode. 'sim' is the new default; 'alpaca'
-- requires the user to have connected Alpaca credentials.
ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'sim'
    CHECK (execution_mode IN ('sim', 'alpaca'));

-- Existing watchlist rows preserve broker behaviour — anyone already
-- live-paper-trading via Alpaca stays on alpaca mode.
UPDATE public.watchlist
SET execution_mode = 'alpaca'
WHERE strategy_id IS NOT NULL
  AND scalper_enabled = true;

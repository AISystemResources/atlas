-- Sprint 053b: ticket_backtests + ticket_backtest_trades
--
-- ticket_backtests: one row per backtest invocation. Stores the parameters
-- and aggregate summary statistics.
--
-- ticket_backtest_trades: one row per simulated trade. Includes ±50 candles
-- around the entry as jsonb so the Trade Inspector UI (053c) can render the
-- chart without re-fetching from Yahoo. Indicator snapshot at the entry bar
-- is also stored, so the AI Trade Reviewer (053d) has full per-trade context.

CREATE TABLE IF NOT EXISTS public.ticket_backtests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_logic_id uuid NOT NULL REFERENCES public.ticket_logics(id) ON DELETE CASCADE,
  user_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  ticker text NOT NULL,
  timeframe text NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '1h', '1d')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  -- Aggregate stats (computed at backtest completion)
  total_trades integer NOT NULL DEFAULT 0,
  winning_trades integer NOT NULL DEFAULT 0,
  losing_trades integer NOT NULL DEFAULT 0,
  win_rate numeric,            -- 0..1
  total_pnl_dollars numeric,   -- sum across all trades
  avg_pnl_dollars numeric,
  max_drawdown_dollars numeric,
  notional_per_trade numeric NOT NULL DEFAULT 200,
  -- Bar series totals for context
  total_bars integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_backtests_logic_idx
  ON public.ticket_backtests (ticket_logic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ticket_backtests_user_idx
  ON public.ticket_backtests (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.ticket_backtests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend service key bypasses RLS"
  ON public.ticket_backtests FOR ALL USING (true);

-- ── ticket_backtest_trades ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticket_backtest_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL REFERENCES public.ticket_backtests(id) ON DELETE CASCADE,
  -- Entry
  entry_bar_index integer NOT NULL,
  entry_ts timestamptz NOT NULL,
  entry_price numeric NOT NULL,
  take_profit_price numeric NOT NULL,
  stop_loss_price numeric NOT NULL,
  -- Exit
  exit_bar_index integer,
  exit_ts timestamptz,
  exit_price numeric,
  exit_reason text CHECK (exit_reason IN ('tp_hit', 'sl_hit', 'time_stop', 'eod', 'open_at_end')),
  -- Outcome
  pnl_dollars numeric,
  pnl_pct numeric,
  qty numeric,
  -- Per-trade context for the Inspector UI (053c) and AI Reviewer (053d)
  indicator_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  bars_around_entry jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_backtest_trades_backtest_idx
  ON public.ticket_backtest_trades (backtest_id, entry_bar_index);

ALTER TABLE public.ticket_backtest_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend service key bypasses RLS"
  ON public.ticket_backtest_trades FOR ALL USING (true);

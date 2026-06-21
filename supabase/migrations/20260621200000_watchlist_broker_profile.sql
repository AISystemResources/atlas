-- Sprint 077B.2: per-(user, ticker) BrokerProfile choice + position-level
-- profile tracking so positions close under the same physics they were
-- opened with.
--
-- 077B added BrokerProfile as a parameter on AtlasSimAdapter; 077B.1
-- threaded it through the backtest engine. This sprint surfaces the
-- choice in the watchlist row + stamps it on each simulated_position
-- at open time so tickBrackets honours the original physics.
--
-- Default 'pure' preserves frictionless behaviour for existing rows.
-- watchlist.broker_profile_id is only consulted when execution_mode='sim'
-- — alpaca-mode tickers always run against the real Alpaca API.

ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS broker_profile_id text NOT NULL DEFAULT 'pure';

ALTER TABLE public.simulated_positions
  ADD COLUMN IF NOT EXISTS broker_profile_id text NOT NULL DEFAULT 'pure';

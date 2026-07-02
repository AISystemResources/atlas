-- Sprint 124: per-user display setting for the point-to-dollar ratio.
--
-- Backtests store both total_pnl_points and total_pnl_dollars. The UI now
-- reads points-first and multiplies by profiles.point_value_dollars for
-- the secondary dollar echo. Traders think in points; the dollar figure is
-- context, not the headline.
--
-- Default 1.0 matches the current backtest engine's notional convention.
-- Range 0.01 - 100 enforced at API and client, not DB, so we can loosen
-- later without another migration.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS point_value_dollars NUMERIC(10, 4) DEFAULT 1.0 NOT NULL;

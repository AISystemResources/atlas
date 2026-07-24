-- Sprint 080A follow-up: add 'exit_condition' to the exit_reason check constraint.
-- The exit_condition exit reason was introduced in simulate-exit.ts (080A) but the
-- table constraint was never updated, causing INSERT failures when strategies use
-- exit_conditions[] (e.g. edmund-s2-long-v2, edmund-s2-short-v2).
ALTER TABLE ticket_backtest_trades
  DROP CONSTRAINT IF EXISTS ticket_backtest_trades_exit_reason_check;

ALTER TABLE ticket_backtest_trades
  ADD CONSTRAINT ticket_backtest_trades_exit_reason_check
  CHECK (exit_reason IN ('tp_hit', 'sl_hit', 'time_stop', 'eod', 'open_at_end', 'exit_condition'));

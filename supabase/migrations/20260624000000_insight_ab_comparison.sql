-- Sprint 053.2: A/B forward-test harness output.
-- Records control vs treatment performance on the forward window
-- [original_end_date + 1, original_end_date + N]. When forward data is
-- unavailable (e.g. backtest ended too recently for Yahoo's 60-day window
-- to extend), the column stores an honest { status: "insufficient_forward_data" }
-- record rather than a fabricated comparison.

ALTER TABLE public.ticket_backtest_insights
  ADD COLUMN IF NOT EXISTS ab_comparison jsonb;

COMMENT ON COLUMN public.ticket_backtest_insights.ab_comparison IS
  'Sprint 053.2: forward-test A/B between current and proposed params on out-of-sample window. NULL when distillation did not propose changes; { status: "insufficient_forward_data", ... } when forward bars unavailable; { status: "ok", control: {...}, treatment: {...}, delta: {...}, forward_window: {...} } otherwise.';

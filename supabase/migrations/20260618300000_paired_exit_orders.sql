-- Sprint 052: paired exit orders for crypto positions.
--
-- Alpaca crypto does not support order_class: "bracket". To get equivalent
-- safety, the scalper submits three independent orders at entry time:
--   1. Market BUY (entry) — the order_id goes in the existing order_id column
--   2. Limit SELL at take_profit_price — recorded in take_profit_order_id
--   3. Stop SELL at stop_loss_price — recorded in stop_loss_order_id
--
-- When either (2) or (3) fills, the order-reconciler cron cancels the survivor
-- via AlpacaAdapter.cancelOrder() to maintain OCO semantics manually.

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS take_profit_order_id text,
  ADD COLUMN IF NOT EXISTS stop_loss_order_id text;

-- Index for the reconciler's "find paired survivor" lookup on SELL fills.
CREATE INDEX IF NOT EXISTS trades_take_profit_order_id_idx
  ON public.trades (take_profit_order_id)
  WHERE take_profit_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trades_stop_loss_order_id_idx
  ON public.trades (stop_loss_order_id)
  WHERE stop_loss_order_id IS NOT NULL;

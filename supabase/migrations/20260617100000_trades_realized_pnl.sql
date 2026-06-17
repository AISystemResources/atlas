-- Sprint 042: History Agent — track realized P&L on SELL trades.
-- realized_pnl: (sell_price - buy_price) * sell_shares, computed at SELL execution time.
-- Nullable: only populated on SELL rows that have a matched prior BUY.
-- Enables the History Agent to compute win_rate without BUY/SELL pairing at query time.

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS realized_pnl numeric(15, 4);

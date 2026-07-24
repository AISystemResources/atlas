-- Sprint 059: replace edmund-s1-long v1 with canonical Edmund S1 mechanics (v2).
--
-- v1 (Sprint 053a seed) was a naive first encoding:
--   * Outer KC band touch requirement on prev bar (not in Edmund's S1)
--   * RSI(21) > 50 regime filter (that's part of S2, not S1)
--   * Multiplicative buffers (entry = sb.high * 1.0005, sl = sb.low * 0.995)
--   * Take profit = entry + 0.5 * ATR(14) (not Edmund's TP)
--
-- v2 (this row) is the canonical Edmund S1 long per strategy author:
--   * Signal bar: bullish AND close > lower KC 1.3 AND close < EMA(13)
--     (the close-below-median guard ensures TP=median is above entry, which
--      is required for a long trade to be profitable on mean-reversion)
--   * Entry: signal_bar.high + 3 points (absolute, Dow convention)
--   * Stop:  signal_bar.low  - 3 points (absolute)
--   * TP:    EMA(13) — the KC median
--   * Time stop: EOD (no overnight carry)
--
-- v1 is archived (not deleted). The evaluator parity test still references
-- it via EDMUND_S1_LONG_V1 in lib/strategies/seeds.ts to prove the evaluator
-- continues to match the legacy detectS1Signal on v1's bar fixtures.

WITH v1 AS (
  SELECT id FROM public.ticket_logics
  WHERE name = 'edmund-s1-long' AND version = 1
)
UPDATE public.ticket_logics
SET status = 'archived'
WHERE id IN (SELECT id FROM v1);

INSERT INTO public.ticket_logics (
  name, version, parent_version_id, description, body, status, created_by
)
SELECT
  'edmund-s1-long',
  2,
  (SELECT id FROM public.ticket_logics WHERE name = 'edmund-s1-long' AND version = 1),
  'Edmund Jadeja S1 KC Mean Reversion (Long), canonical. Signal bar: bullish AND close > lower KC 1.3 AND close < EMA(13) median. Entry = SB high + 3 points. SL = SB low - 3 points. TP = EMA(13) (KC median). Time stop = EOD.',
  '{
    "universe": { "asset_class": "any" },
    "timeframe": "5m",
    "direction": "long",
    "indicators": [
      { "id": "ema_13",         "type": "ema",      "params": { "period": 13 } },
      { "id": "atr_5",          "type": "atr",      "params": { "period": 5 } },
      { "id": "kc_lower_inner", "type": "kc_lower", "params": { "ema_period": 13, "atr_period": 13, "multiplier": 1.3 } }
    ],
    "entry": {
      "conditions": [
        { "op": "gt",
          "left":  { "type": "ohlc", "field": "close", "bar_offset": 0 },
          "right": { "type": "ohlc", "field": "open",  "bar_offset": 0 } },
        { "op": "gt",
          "left":  { "type": "ohlc", "field": "close", "bar_offset": 0 },
          "right": { "type": "indicator", "id": "kc_lower_inner", "bar_offset": 0 } },
        { "op": "lt",
          "left":  { "type": "ohlc", "field": "close", "bar_offset": 0 },
          "right": { "type": "indicator", "id": "ema_13", "bar_offset": 0 } },
        { "op": "lt",
          "left":  { "type": "computed", "id": "entry_price" },
          "right": { "type": "indicator", "id": "ema_13", "bar_offset": 0 } }
      ],
      "sizing": { "method": "fixed_notional", "value": 200 }
    },
    "computed": {
      "entry_price": {
        "type": "binary", "op": "+",
        "left":  { "type": "ohlc", "field": "high", "bar_offset": 0 },
        "right": { "type": "constant", "value": 3 }
      }
    },
    "exit": {
      "take_profit": { "type": "indicator", "id": "ema_13", "bar_offset": 0 },
      "stop_loss": {
        "type": "binary", "op": "-",
        "left":  { "type": "ohlc", "field": "low", "bar_offset": 0 },
        "right": { "type": "constant", "value": 3 }
      },
      "time_stop": "eod"
    }
  }'::jsonb,
  'active',
  'user';

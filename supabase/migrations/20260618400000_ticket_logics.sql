-- Sprint 053a: ticket_logics — versioned strategy definitions.
--
-- The Ticket Logic is the rule that decides whether to trade. Replaces the
-- hardcoded S1 detector with a JSON-encoded, versioned, AI-evolvable record.
--
-- Versioning model (per Sprint 053 design call):
--   - Strategies are GLOBAL, not per-user. Per-user tuning is a v2 concern.
--   - Distillation v3 (Sprint 053e) proposes a new ticket_logics row
--     (version N+1) by analyzing per-trade backtest reviews.
--   - parent_version_id links the evolution tree for academic auditability.
--
-- The body jsonb is validated at write time by lib/strategies/schema.ts (Zod).

CREATE TABLE IF NOT EXISTS public.ticket_logics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  parent_version_id uuid REFERENCES public.ticket_logics(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  body jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  created_by text NOT NULL DEFAULT 'default'
    CHECK (created_by IN ('default', 'claude_chat', 'distillation', 'user')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ticket_logics_name_version_idx
  ON public.ticket_logics (name, version);

CREATE INDEX IF NOT EXISTS ticket_logics_parent_idx
  ON public.ticket_logics (parent_version_id)
  WHERE parent_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ticket_logics_active_idx
  ON public.ticket_logics (name)
  WHERE status = 'active';

ALTER TABLE public.ticket_logics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend service key bypasses RLS"
  ON public.ticket_logics FOR ALL USING (true);

-- Seed: Edmund Jadeja S1 KC Mean Reversion (Long), version 1.
-- Encodes the exact mechanics of detectS1Signal() in lib/indicators/index.ts:157-204.
INSERT INTO public.ticket_logics (name, version, description, body, status, created_by) VALUES (
  'edmund-s1-long',
  1,
  'Edmund Jadeja S1 KC Mean Reversion (Long). RSI(21)>50 regime, previous bar low touches outer lower KC band (EMA13 - 2.0*ATR13), signal bar bullish (close > open) and closes above inner lower KC band (EMA13 - 1.3*ATR13). Entry = SB high + 0.05%, SL = SB low - 0.5%, TP = entry + 0.5*ATR14.',
  '{
    "universe": { "asset_class": "any" },
    "timeframe": "5m",
    "direction": "long",
    "indicators": [
      { "id": "rsi_21",         "type": "rsi",       "params": { "period": 21 } },
      { "id": "ema_13",         "type": "ema",       "params": { "period": 13 } },
      { "id": "atr_14",         "type": "atr",       "params": { "period": 14 } },
      { "id": "kc_lower_outer", "type": "kc_lower",  "params": { "ema_period": 13, "atr_period": 13, "multiplier": 2.0 } },
      { "id": "kc_lower_inner", "type": "kc_lower",  "params": { "ema_period": 13, "atr_period": 13, "multiplier": 1.3 } }
    ],
    "regime_filter": {
      "op": "gt",
      "left":  { "type": "indicator", "id": "rsi_21", "bar_offset": 0 },
      "right": { "type": "constant",  "value": 50 }
    },
    "entry": {
      "conditions": [
        { "op": "lte",
          "left":  { "type": "ohlc", "field": "low", "bar_offset": -1 },
          "right": { "type": "indicator", "id": "kc_lower_outer", "bar_offset": -1 } },
        { "op": "gt",
          "left":  { "type": "ohlc", "field": "close", "bar_offset": 0 },
          "right": { "type": "ohlc", "field": "open",  "bar_offset": 0 } },
        { "op": "gt",
          "left":  { "type": "ohlc", "field": "close", "bar_offset": 0 },
          "right": { "type": "indicator", "id": "kc_lower_inner", "bar_offset": 0 } }
      ],
      "sizing": { "method": "fixed_notional", "value": 200 }
    },
    "computed": {
      "entry_price": {
        "type": "binary", "op": "*",
        "left":  { "type": "ohlc", "field": "high", "bar_offset": 0 },
        "right": { "type": "constant", "value": 1.0005 }
      }
    },
    "exit": {
      "take_profit": {
        "type": "binary", "op": "+",
        "left":  { "type": "computed", "id": "entry_price" },
        "right": { "type": "binary", "op": "*",
          "left":  { "type": "constant", "value": 0.5 },
          "right": { "type": "indicator", "id": "atr_14", "bar_offset": 0 } }
      },
      "stop_loss": {
        "type": "binary", "op": "*",
        "left":  { "type": "ohlc", "field": "low", "bar_offset": 0 },
        "right": { "type": "constant", "value": 0.995 }
      },
      "time_stop": "eod"
    }
  }'::jsonb,
  'active',
  'default'
);

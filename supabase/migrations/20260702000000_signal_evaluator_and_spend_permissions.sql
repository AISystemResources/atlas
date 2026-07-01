-- Sprint 109 Phase 1: infrastructure for the live signal evaluator + auto-execute pipeline.
--
-- Four tables:
--   watched_strategies  — which strategies each user has opted-in for live evaluation
--   signal_events       — fired signals, one row per (user, strategy, bar) tuple
--   user_spender_keys   — per-user server-side signer address + encrypted private key
--   spend_permissions   — active ERC-7715 permission grants from users to their spender
--
-- Table 4 (spend_permissions) and the encrypted_private_key column on table 3 are
-- populated in Phase 2 when the Smart Wallet grant flow ships; the tables exist now
-- so subsequent phases can wire against them without another migration bump.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. watched_strategies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watched_strategies (
  user_id      text NOT NULL,
  strategy_id  uuid NOT NULL REFERENCES ticket_logics(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS watched_strategies_user_idx
  ON watched_strategies (user_id);

ALTER TABLE watched_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON watched_strategies
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. signal_events
--    Idempotent per (user, strategy, bar_ts) tuple — cron re-runs on the same
--    bar cannot produce duplicate rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signal_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  strategy_id      uuid NOT NULL REFERENCES ticket_logics(id) ON DELETE CASCADE,
  bar_ts           timestamptz NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('long', 'short')),
  entry_price      numeric,
  take_profit      numeric,
  stop_loss        numeric,
  current_price    numeric,
  ticker           text,
  timeframe        text,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  executed_at      timestamptz,
  tx_hash          text,
  spender_used     text,
  execution_error  text,
  UNIQUE (user_id, strategy_id, bar_ts)
);

CREATE INDEX IF NOT EXISTS signal_events_user_recent_idx
  ON signal_events (user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS signal_events_pending_exec_idx
  ON signal_events (user_id, executed_at)
  WHERE executed_at IS NULL;

ALTER TABLE signal_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON signal_events
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. user_spender_keys — Phase 2 payload; table created now for FK stability
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_spender_keys (
  user_id               text PRIMARY KEY,
  spender_address       text NOT NULL,
  encrypted_private_key text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_spender_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON user_spender_keys
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. spend_permissions — Phase 2 payload; each row records a granted permission
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spend_permissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  spender_address  text NOT NULL,
  token_address    text NOT NULL,               -- USDC on Base
  contract_target  text NOT NULL,               -- gTrade Diamond
  allowance_wei    text NOT NULL,               -- string preserves bigint precision
  period_seconds   integer NOT NULL,
  grant_tx_hash    text NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz
);

CREATE INDEX IF NOT EXISTS spend_permissions_user_active_idx
  ON spend_permissions (user_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE spend_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON spend_permissions
  USING (true)
  WITH CHECK (true);

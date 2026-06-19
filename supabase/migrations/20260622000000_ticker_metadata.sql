-- Sprint 071: ticker_metadata table — capabilities per instrument.
--
-- Different ticker kinds expose different analyses honestly:
--   - Index (^DJI, ^GSPC):         technical-only, no FA, no sentiment
--   - ETF (DIA, SPY, QQQ):         technical-only, partial FA via holdings
--   - Equity (TSLA, AAPL, META):   technical + FA + sentiment + news
--   - Crypto (BTC/USD, ETH/USD):   technical + on-chain, no FA
--
-- The 4-cell autonomy matrix and the strategy-ticker pairing already
-- assume ticker is a first-class artifact. This table lets the UI and
-- the AI honestly say "what's available for this ticker" instead of
-- pretending every kind admits the same analysis.

CREATE TABLE IF NOT EXISTS public.ticker_metadata (
  ticker text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('equity', 'etf', 'index', 'crypto')),
  display_name text NOT NULL,
  -- Capability flags — what kinds of analysis are honest for this ticker
  has_fundamental_data boolean NOT NULL DEFAULT false,
  has_sentiment_data boolean NOT NULL DEFAULT false,
  has_technical_data boolean NOT NULL DEFAULT true,
  -- Reference data
  exchange text,
  currency text NOT NULL DEFAULT 'USD',
  -- Free-form notes for the UI ("tracks the Dow Jones Industrial Average")
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticker_metadata_kind_idx
  ON public.ticker_metadata (kind);

-- Seed the tickers Edmund's watchlist already references + a few canonical
-- US-equity references. Future tickers fill in via Claude Chat / a future
-- admin form; the UI degrades gracefully when a ticker has no metadata row.
INSERT INTO public.ticker_metadata (ticker, kind, display_name, has_fundamental_data, has_sentiment_data, exchange, description) VALUES
  ('^DJI',    'index',  'Dow Jones Industrial Average', false, false, 'INDEX', 'Price-weighted index of 30 large US public companies.'),
  ('^GSPC',   'index',  'S&P 500',                       false, false, 'INDEX', 'Market-cap-weighted index of 500 large US public companies.'),
  ('DIA',     'etf',    'SPDR Dow Jones ETF',            false, false, 'NYSE',  'Tracks the DJIA. Trades like a stock.'),
  ('SPY',     'etf',    'SPDR S&P 500 ETF',              false, false, 'NYSE',  'Tracks the S&P 500.'),
  ('QQQ',     'etf',    'Invesco Nasdaq-100 ETF',        false, false, 'NASDAQ', 'Tracks the Nasdaq-100.'),
  ('AAPL',    'equity', 'Apple Inc.',                    true,  true,  'NASDAQ', null),
  ('TSLA',    'equity', 'Tesla, Inc.',                   true,  true,  'NASDAQ', null),
  ('AMZN',    'equity', 'Amazon.com, Inc.',              true,  true,  'NASDAQ', null),
  ('META',    'equity', 'Meta Platforms, Inc.',          true,  true,  'NASDAQ', null),
  ('MSFT',    'equity', 'Microsoft Corp.',               true,  true,  'NASDAQ', null),
  ('NVDA',    'equity', 'NVIDIA Corp.',                  true,  true,  'NASDAQ', null),
  ('GOOGL',   'equity', 'Alphabet Inc. Class A',         true,  true,  'NASDAQ', null),
  ('BTC/USD', 'crypto', 'Bitcoin',                       false, true,  'CRYPTO', 'On-chain analysis is available but is not yet wired into Atlas.'),
  ('ETH/USD', 'crypto', 'Ethereum',                      false, true,  'CRYPTO', null)
ON CONFLICT (ticker) DO NOTHING;

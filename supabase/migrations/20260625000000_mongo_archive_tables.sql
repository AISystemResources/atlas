-- Sprint 078B.5: archive the MongoDB collections to Supabase before 078C
-- drops the dependency entirely. Three tables, each with a unique mongo_id
-- so the migration script is idempotent and re-runs are safe.

CREATE TABLE IF NOT EXISTS public.archived_reasoning_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id text UNIQUE NOT NULL,
  ticker text NOT NULL,
  user_id text,
  boundary_mode text,
  created_at timestamptz NOT NULL,
  pipeline_run jsonb,
  execution jsonb,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS archived_reasoning_traces_user_created_idx
  ON public.archived_reasoning_traces(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS archived_reasoning_traces_ticker_idx
  ON public.archived_reasoning_traces(ticker);

CREATE TABLE IF NOT EXISTS public.archived_backtest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id text UNIQUE NOT NULL,
  job_id text,
  user_id text,
  tickers text[],
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL,
  doc jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS archived_backtest_results_user_idx
  ON public.archived_backtest_results(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.archived_experiment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id text UNIQUE NOT NULL,
  phase text,
  created_at timestamptz,
  doc jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.archived_reasoning_traces IS
  'Sprint 078B.5: cold archive of atlas.reasoning_traces from MongoDB v1 LangGraph pipeline. Read-only; v1 pipeline is retired.';

COMMENT ON TABLE public.archived_backtest_results IS
  'Sprint 078B.5: cold archive of atlas.backtest_results from MongoDB. v1 multi-agent backtest history. Read-only.';

COMMENT ON TABLE public.archived_experiment_results IS
  'Sprint 078B.5: cold archive of atlas.experiment_results from MongoDB. v1 philosophy/EBC tournament results. Read-only.';

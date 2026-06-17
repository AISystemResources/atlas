-- Sprint 044: Daily Distillation Agent — end-of-day AI reflection on trading activity.
-- One row per (user_id, trading_date). Source distinguishes MCP-driven (user's Claude Desktop)
-- from server-side Groq distillation (default fallback for users without Claude Desktop).
-- Read by next-day pipeline runs to inject yesterday's learnings into analyst system prompts.

CREATE TABLE IF NOT EXISTS public.daily_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trading_date date NOT NULL,
  trade_count integer NOT NULL DEFAULT 0,
  win_count integer NOT NULL DEFAULT 0,
  learnings_summary text NOT NULL,
  key_observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL CHECK (source IN ('mcp', 'groq')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trading_date)
);

ALTER TABLE public.daily_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Backend service key bypasses RLS"
  ON public.daily_learnings FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS daily_learnings_user_date_idx
  ON public.daily_learnings (user_id, trading_date DESC);

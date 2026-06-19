-- Sprint 075a: per-email strategy sharing.
--
-- A strategy is readable by user X if any of:
--   - X is the owner (created_by_user_id = X.userId)
--   - visibility = 'public' (anyone with link)
--   - visibility = 'unlisted' (anyone with the id — already in place)
--   - a strategy_shares row exists for (strategy_id, X.email)
--
-- Email-based (not user_id-based) so a founder can share to a friend
-- BEFORE the friend signs up. The friend's first login with that email
-- automatically grants them access — no migration step.

CREATE TABLE IF NOT EXISTS public.strategy_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES public.ticket_logics(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  granted_by_user_id text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, email)
);

CREATE INDEX IF NOT EXISTS strategy_shares_email_idx
  ON public.strategy_shares (email);

CREATE INDEX IF NOT EXISTS strategy_shares_strategy_idx
  ON public.strategy_shares (strategy_id);

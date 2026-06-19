-- Sprint 060A: ticket_logics becomes multi-tenant.
--
-- Before this sprint, all ticket_logics rows were implicitly global. Going
-- forward, every strategy has an owner (created_by_user_id) and a
-- visibility tier:
--   - private:  only the owner can see, backtest, or fork
--   - unlisted: anyone with the strategy id (e.g. shared link) can view and fork
--   - public:   discoverable in the library
--
-- forked_from_id traces lineage across users — when mom forks Edmund's
-- sandy-s1-long, the new row has created_by_user_id=mom and
-- forked_from_id=<Edmund's strategy id>.
--
-- Existing rows (sandy-s1-long v1 + v2) are backfilled to Edmund's user_id
-- and visibility='public' so future users can see/fork them.

ALTER TABLE public.ticket_logics
  ADD COLUMN IF NOT EXISTS created_by_user_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forked_from_id uuid REFERENCES public.ticket_logics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'unlisted', 'public'));

CREATE INDEX IF NOT EXISTS ticket_logics_owner_idx
  ON public.ticket_logics (created_by_user_id, name, version);

CREATE INDEX IF NOT EXISTS ticket_logics_public_idx
  ON public.ticket_logics (visibility, status, created_at DESC)
  WHERE visibility IN ('public', 'unlisted');

CREATE INDEX IF NOT EXISTS ticket_logics_fork_lineage_idx
  ON public.ticket_logics (forked_from_id)
  WHERE forked_from_id IS NOT NULL;

-- Backfill existing rows: assign to Edmund, mark public so others can see.
UPDATE public.ticket_logics
SET created_by_user_id = 'user_3B4k96FjK9wZUDi8Xs0AzeNLnvy',
    visibility = 'public'
WHERE name = 'sandy-s1-long';

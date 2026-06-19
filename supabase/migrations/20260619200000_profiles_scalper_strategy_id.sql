-- Sprint 060C: per-user scalper strategy choice.
--
-- Before this sprint, the live scalper called loadActiveStrategy('sandy-s1-long')
-- with a hardcoded name — fine in single-tenant land, but wrong for
-- multi-tenant. After this migration each profile carries a pointer to the
-- specific ticket_logics row their scalper executes.
--
-- If null, the scalper produces no entries for that user. New users are
-- expected to opt in via the Strategy Library (Sprint 061), so the default
-- here is conservative: NULL → no scalper firing.
--
-- Edmund's row is backfilled to sandy-s1-long v2 so his scalper keeps working
-- after this deploy.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS scalper_strategy_id uuid
    REFERENCES public.ticket_logics(id) ON DELETE SET NULL;

UPDATE public.profiles
SET scalper_strategy_id = (
  SELECT id FROM public.ticket_logics
  WHERE name = 'sandy-s1-long' AND version = 2
)
WHERE id = 'user_3B4k96FjK9wZUDi8Xs0AzeNLnvy';

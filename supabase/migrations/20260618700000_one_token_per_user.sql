-- Sprint 058: one active OAuth token per (user, client_id) pair.
--
-- Pre-058 behavior: every OAuth exchange added a new row to user_pats,
-- accumulating indefinitely. Multiple Claude.ai re-authorizations from the
-- same user produced multiple concurrent valid tokens for the same client.
--
-- Post-058 policy:
--   - For OAuth-issued tokens (/oauth/token): one row per (user_id, client_id).
--     Re-authorizing the same client invalidates the prior token for that
--     client. Different clients (Claude.ai uses client_id=atlas-mcp-client,
--     Claude Code uses its own client_id) coexist on the same user.
--   - For directly-created PATs (POST /api/v1/pats): unchanged. Developers
--     can hold multiple named PATs; the client_id column is NULL for those.
--
-- The schema change here is the addition of the `client_id` column. The
-- application layer (app/oauth/token/route.ts) does DELETE-then-INSERT under
-- the same request to enforce the per-(user, client_id) uniqueness; we don't
-- add a DB-level UNIQUE constraint because that would require partial-index
-- logic to exclude the NULL-client_id direct PATs cleanly.
--
-- This migration also wipes existing user_pats rows so the policy applies
-- with a clean slate. Authorized by the sole active user on 2026-06-18:
-- "we can expire the previous tokens now still, where users are still
-- minimal (just myself now). if expired, then they need to re-authenticate."

ALTER TABLE public.user_pats
  ADD COLUMN IF NOT EXISTS client_id text;

CREATE INDEX IF NOT EXISTS user_pats_user_client_idx
  ON public.user_pats (user_id, client_id)
  WHERE client_id IS NOT NULL;

-- One-time cleanup: wipe accumulated tokens. Users re-authorize from their
-- MCP client (Claude.ai / Claude Code) on next request.
DELETE FROM public.user_pats;

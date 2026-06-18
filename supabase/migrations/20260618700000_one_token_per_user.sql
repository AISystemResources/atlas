-- Sprint 058: one active token per user.
--
-- Policy: a user may have at most ONE row in user_pats at any time.
-- New issuance via either /oauth/token or POST /api/v1/pats now does a
-- DELETE-then-INSERT in the same request so the policy is enforced at the
-- application layer.
--
-- This migration is the one-time cleanup of accumulated OAuth tokens from
-- prior issuances (pre-Sprint 058 behavior accumulated rows without bound).
-- After this runs, every existing user must re-authenticate from their MCP
-- client (Claude.ai / Claude Code / etc.) to get a fresh token.
--
-- Authorized by user (sole active user as of 2026-06-18): wipe the table,
-- accept the brief re-auth cost, and start the one-row-per-user discipline
-- with a clean slate.

DELETE FROM public.user_pats;

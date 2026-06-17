-- DB-backed OAuth 2.1 authorization codes (sprint 038)
-- Replaces the previous stateless HMAC-signed code pattern.
-- Only the SHA-256 hash of each code is persisted; raw codes never touch the DB.
-- Service-role only — no anon/authenticated policies.
--
-- NOTE: This table was applied directly to production during sprint 038
-- (commit 58014bd). This migration retroactively captures that schema for
-- branch/reset reproducibility.

CREATE TABLE IF NOT EXISTS public.oauth_authorization_codes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash      text        NOT NULL UNIQUE,
  code_challenge text        NOT NULL,
  redirect_uri   text        NOT NULL,
  user_id        text        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id      text        NOT NULL,
  scope          text        NOT NULL DEFAULT 'read_write',
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- O(1) lookup by hash on every token exchange
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_codes_hash
  ON public.oauth_authorization_codes (code_hash);

-- Sweep index for expired/used row cleanup jobs
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at
  ON public.oauth_authorization_codes (expires_at);

-- RLS on; no policies → service-role only access
ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;

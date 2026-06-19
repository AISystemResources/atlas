-- Sprint 075c: founder invite codes + 14-day Pro trial.
--
-- Founder mints a code from the Admin → Invites page, hands the link
-- (/invite/<code>) to a friend, friend clicks → cookie marker set →
-- signs up → onboarding callback grants pro_trial_ends_at = now + N days.

CREATE TABLE IF NOT EXISTS public.referral_codes (
  code text PRIMARY KEY,
  created_by_user_id text NOT NULL,
  label text,
  trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days > 0 AND trial_days <= 365),
  max_uses integer,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_codes_creator_idx
  ON public.referral_codes (created_by_user_id);

CREATE TABLE IF NOT EXISTS public.referral_redemptions (
  code text NOT NULL REFERENCES public.referral_codes(code) ON DELETE CASCADE,
  user_id text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);

CREATE INDEX IF NOT EXISTS referral_redemptions_user_idx
  ON public.referral_redemptions (user_id);

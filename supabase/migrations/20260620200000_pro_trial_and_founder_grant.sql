-- Sprint 075b: pro_trial_ends_at on profiles + founder Pro grant.
--
-- Effective tier = 'pro' if (tier = 'pro') OR (pro_trial_ends_at > now()).
-- This lets a free user get a temporary Pro experience via an invite code
-- (Sprint 075c) without flipping their base tier — when the trial
-- expires, they revert to whatever tier they had.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_trial_ends_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_pro_trial_idx
  ON public.profiles (pro_trial_ends_at)
  WHERE pro_trial_ends_at IS NOT NULL;

-- Founder Pro grant — Edmund's account.
UPDATE public.profiles
SET tier = 'pro'
WHERE id = 'user_3B4k96FjK9wZUDi8Xs0AzeNLnvy';

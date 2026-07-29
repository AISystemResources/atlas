-- SUS evaluation window: every new signup should land as Pro so testers
-- exercise the full feature surface. The Clerk webhook already sets
-- tier='pro' explicitly on insert; this migration makes the DB default
-- match so any code path that bypasses the webhook (seed rows, direct
-- inserts, admin actions) inherits the same intent. Revert to 'free'
-- when the evaluation closes and free-vs-pro gating resumes.

alter table public.profiles
  alter column tier set default 'pro';

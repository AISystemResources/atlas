-- Enable RLS on ticker_info_cache (was the only RLS-disabled table flagged by Supabase advisor).
-- All reads and writes go through getServiceClient() in lib/market/fundamentals.ts and
-- app/api/v1/admin/cache/ticker-info/route.ts — service role bypasses RLS automatically.
-- No policies needed; this denies all anon/authenticated direct access (which never existed).

ALTER TABLE public.ticker_info_cache ENABLE ROW LEVEL SECURITY;

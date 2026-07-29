-- Sprint (paper-fulltext-storage): cache arXiv PDFs in Supabase Storage so
-- MCP-connected LLMs can read the full paper (not just the abstract) via
-- get_paper. Previously signal_papers.full_text was always NULL — the
-- ingest pipeline only pulled the arXiv Atom feed metadata, and WebFetch
-- against the arXiv PDF URL returns undecoded binary from Vercel's edge
-- fetch. Storing the extracted text server-side eliminates the round-trip.
--
-- This migration is filesystem-only; apply via Supabase dashboard SQL editor
-- (the Supabase MCP available in this workspace can't reach Atlas's project).

-- 1. Private storage bucket for cached PDFs.
insert into storage.buckets (id, name, public)
values ('papers', 'papers', false)
on conflict (id) do nothing;

-- 2. Service-role-only RLS on the objects. No public reads — the extracted
--    text lives in signal_papers.full_text; the PDF blob is a byproduct only
--    the ingest job needs. If we later want signed URLs for consumers, add
--    a targeted read policy.
alter table storage.objects enable row level security;

drop policy if exists "papers bucket: service role writes" on storage.objects;
create policy "papers bucket: service role writes"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'papers')
  with check (bucket_id = 'papers');

-- 3. Track the bucket path per paper so re-hydration is idempotent and we
--    can delete the blob when a paper is removed. Nullable — legacy rows
--    with abstract-only content stay valid.
alter table public.signal_papers
  add column if not exists pdf_storage_path text;

comment on column public.signal_papers.pdf_storage_path is
  'Supabase Storage path (bucket=papers, e.g. "<paper_id>.pdf") when the PDF has been hydrated. NULL means only the abstract is available.';

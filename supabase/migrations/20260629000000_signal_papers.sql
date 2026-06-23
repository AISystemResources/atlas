-- Sprint 081A: signal_papers table for the autonomous paper-ingestion pipeline.
-- Papers fetched daily from arXiv / SSRN land here before extraction (081B).

CREATE TABLE IF NOT EXISTS signal_papers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  source           text NOT NULL,          -- 'arxiv' | 'ssrn'
  source_url       text NOT NULL UNIQUE,
  abstract         text,
  full_text        text,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  extractable      boolean,
  extraction_notes text
);

ALTER TABLE signal_papers ENABLE ROW LEVEL SECURITY;

-- Service role has full access; authenticated reads are open (papers are public).
CREATE POLICY "service role full access" ON signal_papers
  USING (true)
  WITH CHECK (true);

-- FK from ticket_logics: which paper originated this strategy (081B+).
ALTER TABLE ticket_logics
  ADD COLUMN IF NOT EXISTS parent_paper_id uuid REFERENCES signal_papers(id) ON DELETE SET NULL;

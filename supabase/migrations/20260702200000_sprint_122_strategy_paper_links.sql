-- Sprint 122: N:N paper ↔ strategy links.
--
-- Prior state: ticket_logics.parent_paper_id is a singular pointer to the
-- paper that inspired the strategy. Real world: multiple papers may converge
-- on the same trading thesis (Sandy Jadeja + a Turtle-style breakout paper
-- both suggesting time-of-day trend fade). Convergence is a validation
-- signal, not a duplicate. This migration adds the many-to-many surface.
--
-- Design:
--   * strategy_paper_links carries the M:N join
--   * parent_paper_id is preserved as the immutable ORIGIN pointer (auto-
--     mirrored into strategy_paper_links with inspiration_note='origin')
--   * Additional links get a free-form inspiration_note describing why the
--     LLM (or user) recognised the convergence
--   * added_by_model stamps which LLM (if any) authored the link, for the
--     "which AI made this call" audit trail

CREATE TABLE IF NOT EXISTS strategy_paper_links (
  strategy_id      uuid NOT NULL REFERENCES ticket_logics(id) ON DELETE CASCADE,
  paper_id         uuid NOT NULL REFERENCES signal_papers(id) ON DELETE CASCADE,
  inspiration_note text,
  added_at         timestamptz NOT NULL DEFAULT now(),
  added_by_model   text,
  PRIMARY KEY (strategy_id, paper_id)
);

CREATE INDEX IF NOT EXISTS strategy_paper_links_paper_id_idx
  ON strategy_paper_links (paper_id);

ALTER TABLE strategy_paper_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON strategy_paper_links
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Backfill: for every ticket_logic that has a parent_paper_id today, create
-- a corresponding link row marked as origin. Idempotent via ON CONFLICT.
INSERT INTO strategy_paper_links (strategy_id, paper_id, inspiration_note, added_by_model)
SELECT
  id AS strategy_id,
  parent_paper_id AS paper_id,
  'origin' AS inspiration_note,
  NULL AS added_by_model
FROM ticket_logics
WHERE parent_paper_id IS NOT NULL
ON CONFLICT (strategy_id, paper_id) DO NOTHING;

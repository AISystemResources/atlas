-- Sprint 136: origin inheritance backfill.
--
-- Two visible problems with the Origin column on the Strategy listing:
--   1. Some post-Sprint-132 promotions (e.g. sign-persistence-momentum-long v2)
--      were created BEFORE the promote_ticket_logic_version fix that inherits
--      parent_paper_id. They show "Tune" instead of "arXiv" even though their
--      lineage-root is a paper-extracted v1.
--   2. The whole sandy-* family originated from Edmund's post-seminar Claude
--      chat discussions, but v1 was created before the created_by='claude_chat'
--      convention landed, so it defaulted to 'default'. Subsequent v2+ were
--      distillations, all mis-labelled.
--
-- Fixes applied here match the retroactive live-DB edits so the migration
-- table records what was done.

-- (1) Recursive lineage inheritance for parent_paper_id — same shape as the
-- Sprint 132 backfill, re-run to catch rows created between then and now.
WITH RECURSIVE paper_lineage AS (
  SELECT id, parent_paper_id
  FROM ticket_logics
  WHERE parent_paper_id IS NOT NULL

  UNION

  SELECT t.id, pl.parent_paper_id
  FROM ticket_logics t
  JOIN paper_lineage pl ON t.parent_version_id = pl.id
  WHERE t.parent_paper_id IS NULL
)
UPDATE ticket_logics t
SET parent_paper_id = pl.parent_paper_id
FROM paper_lineage pl
WHERE t.id = pl.id
  AND t.parent_paper_id IS NULL
  AND pl.parent_paper_id IS NOT NULL;

-- (2) Force the whole sandy-* family to claude_chat authorship. The family
-- came from Edmund's post-seminar discussions with Claude, not from any
-- paper or hand-authoring.
UPDATE ticket_logics SET created_by = 'claude_chat'
WHERE name LIKE 'sandy-%';

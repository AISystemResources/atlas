-- Sprint 132: paper attribution backfill.
--
-- Prior state had two attribution gaps:
--   1. promote_ticket_logic_version didn't copy parent_paper_id from parent,
--      so v2+ of paper-extracted strategies silently lost their arXiv
--      attribution (Origin column reads "Tune" instead of "arXiv").
--   2. Two early Claude-authored strategies (bounce-fade-close v1,
--      bounce-fade-long v1) were created before parent_paper_id was
--      threaded through create_ticket_logic, so they never got the paper
--      pointer at all even though both derive from "The Bounce Has No
--      Direction" (arXiv 2606.29591).
--
-- The code fix (write.ts) prevents new occurrences of (1). This migration
-- backfills the accumulated data.

-- (1) Manual pin: bounce-fade-close + bounce-fade-long → Bounce paper.
UPDATE ticket_logics
SET parent_paper_id = '37176391-027b-4f1d-84c5-65d1d57b588e'
WHERE name IN ('bounce-fade-close', 'bounce-fade-long')
  AND version = 1
  AND parent_paper_id IS NULL;

-- (2) Recursive lineage inheritance: any row whose parent_version_id points
-- to a row with parent_paper_id set should inherit that paper. Recursive
-- CTE catches chains of any depth.
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

-- (3) Mirror the newly-set parent_paper_id values into strategy_paper_links
-- so the N:N surface (Sprint 122) stays consistent. Idempotent via ON
-- CONFLICT — existing origin links are preserved.
INSERT INTO strategy_paper_links (strategy_id, paper_id, inspiration_note, added_by_model)
SELECT id, parent_paper_id, 'origin (inherited)', NULL
FROM ticket_logics
WHERE parent_paper_id IS NOT NULL
ON CONFLICT (strategy_id, paper_id) DO NOTHING;

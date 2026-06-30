-- Sprint 099b: backfill ticker + tags on ticket_logics rows orphaned by
-- the pre-Sprint-099 MCP promote / fork write path bug. The MCP write
-- handlers (lib/mcp-atlas/tools/write.ts) used to omit `ticker` and `tags`
-- from the INSERT payload, so every MCP-driven promote or fork between
-- 2026-06-23 and 2026-06-30 produced a row with ticker=null + tags=[].
-- The REST endpoints already did this correctly; PR #119 brought MCP into
-- alignment. This migration fixes the historical residue.
--
-- Idempotent: WHERE ticker IS NULL filters to the orphans only. Re-running
-- on a clean DB is a no-op.
--
-- Two passes handle transitive chains where a v4 inherits from a v3 that
-- is also orphaned (the v3 gets patched in pass 1, then v4 in pass 2).
-- The actual production backfill ran via
--   scripts/backfill-099b-orphaned-tickers.ts
-- on 2026-06-30 against project qbbbuebbxueqclkrvoos, patching 12 rows
-- across two passes. This file is the canonical record.

BEGIN;

-- Pass 1: inherit from parent_version_id (covers promoted rows)
UPDATE ticket_logics AS child
SET
  ticker = parent.ticker,
  tags = COALESCE(parent.tags, ARRAY[]::text[])
FROM ticket_logics AS parent
WHERE child.ticker IS NULL
  AND parent.id = child.parent_version_id
  AND parent.ticker IS NOT NULL;

-- Pass 1: inherit from forked_from_id (covers forked rows)
UPDATE ticket_logics AS child
SET
  ticker = source.ticker,
  tags = COALESCE(source.tags, ARRAY[]::text[])
FROM ticket_logics AS source
WHERE child.ticker IS NULL
  AND source.id = child.forked_from_id
  AND source.ticker IS NOT NULL;

-- Pass 2: re-walk parent_version_id for rows whose parent was itself
-- just patched in pass 1 (handles transitive chains like v4 → v3 → v2).
UPDATE ticket_logics AS child
SET
  ticker = parent.ticker,
  tags = COALESCE(parent.tags, ARRAY[]::text[])
FROM ticket_logics AS parent
WHERE child.ticker IS NULL
  AND parent.id = child.parent_version_id
  AND parent.ticker IS NOT NULL;

COMMIT;

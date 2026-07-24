-- Remove the 'sandy-jadeja' tag from every ticket_logics.tags array (22 rows).
-- The tags column was missed by the earlier text-scan rename because it is a
-- text[] and was not covered by the name/description/body::text pass.

UPDATE public.ticket_logics
SET tags = array_remove(tags, 'sandy-jadeja')
WHERE 'sandy-jadeja' = ANY(tags);

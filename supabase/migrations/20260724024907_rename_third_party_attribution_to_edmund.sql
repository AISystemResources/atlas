-- Remove third-party attribution from all strategy identifiers, descriptions,
-- and JSON body content in ticket_logics. Rewrites 31 rows in place.
--
-- Motivation: avoid conflict of interest — the strategies are Edmund's own
-- adaptations and should be attributed as such, not to the original educator.

UPDATE public.ticket_logics
SET
  name = REPLACE(name, 'sandy', 'edmund'),
  description = REPLACE(REPLACE(REPLACE(description, 'Sandy', 'Edmund'), 'sandy', 'edmund'), 'SANDY', 'EDMUND'),
  body = REPLACE(REPLACE(REPLACE(body::text, 'Sandy', 'Edmund'), 'sandy', 'edmund'), 'SANDY', 'EDMUND')::jsonb
WHERE
  name ILIKE '%sandy%'
  OR description ILIKE '%sandy%'
  OR body::text ILIKE '%sandy%';

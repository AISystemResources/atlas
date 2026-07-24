-- Sprint 069: backfill edmund-s1-long v2 with the session window + weekday
-- filter the strategy was originally calibrated for. Edmund's S1 is a
-- US-equity-morning mean-reversion play — 09:31–11:00 ET, Mon–Fri.
--
-- The TicketLogicBody schema now carries session_window + valid_weekdays
-- (Sprint 069). Existing rows without these fields fire on every bar
-- (backwards-compatible), so this backfill is opt-in per strategy.

UPDATE public.ticket_logics
SET body = body
  || jsonb_build_object(
       'session_window', jsonb_build_object(
         'start', '09:31',
         'end',   '11:00',
         'timezone', 'America/New_York'
       ),
       'valid_weekdays', jsonb_build_array(1, 2, 3, 4, 5)
     )
WHERE name = 'edmund-s1-long' AND version = 2;

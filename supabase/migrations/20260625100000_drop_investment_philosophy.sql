-- Sprint 079B: retire the investment_philosophy column.
-- The concept was tied to the deleted v1 LangGraph multi-agent pipeline
-- (5 agents weighted by buffett/soros/lynch/balanced overlay). Ticket Logic
-- strategies (current v2 architecture) are self-describing and don't need
-- a philosophy overlay.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS investment_philosophy;

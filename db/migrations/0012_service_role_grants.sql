-- Phase 11 (production fix): give the backend's database role its privileges explicitly.
-- Run once, after 0001-0011. Safe to run again (every statement is idempotent).
--
-- Why: the backend connects with Supabase's `service_role`. That role bypasses Row Level Security, but it
-- still needs ordinary table privileges. Older Supabase projects granted them automatically through default
-- privileges; newer projects may not, and the API then fails with "permission denied for table ...".
-- Migrations 0001-0011 relied on those defaults. This migration states the grants explicitly so a brand-new
-- project works without any manual SQL. It touches only service_role: `anon` and `authenticated` keep NO
-- access (migration 0011), and no row or table changes.
begin;

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Objects created by later migrations (run by the same owner role) get the same grants automatically.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

commit;

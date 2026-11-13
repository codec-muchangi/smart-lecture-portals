-- Weekly clean-up of old READ notifications, run by the database itself (SRS 15 retention, Phase 9).
-- It uses the pg_cron extension, so no secret key ever has to be stored outside Supabase.
--
-- ONE-TIME SETUP in the Supabase dashboard: Database -> Extensions -> enable "pg_cron". Then run this file
-- in the SQL Editor. Check it with:   select jobname, schedule, active from cron.job;
-- See what ran:                       select * from cron.job_run_details order by start_time desc limit 10;

create extension if not exists pg_cron;

-- Sundays 03:00 UTC. Deletes read notifications older than 90 days; unread ones are never touched.
select cron.schedule(
  'purge-read-notifications',
  '0 3 * * 0',
  $$select public.purge_read_notifications(90)$$
);

-- To stop it later, run:
--   select cron.unschedule('purge-read-notifications');

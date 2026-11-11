-- Problem reports (run once in Supabase › SQL Editor, only after baz has
-- read it and said to apply it).
--
-- Menu › Report a problem, and the "SAYON closed unexpectedly" notice after
-- a crash, send a row here (js/crash-guard.js): what the inspector wrote,
-- and unless they untick it, the technical details (app version, phone and
-- browser, where they were in the app, the last few steps, and the errors
-- the phone kept, already scrubbed of emails, numbers and quoted text).
-- Never report text, client details or photos.
--
-- Read them in Supabase › Table Editor › problem_reports, newest first.
-- Until this runs, the app opens an email to sayon.application@gmail.com
-- with the same details instead.
--
-- status and team_reply are for the SAYON team: mark a report seen or
-- fixed, and write back. The inspector can read their own business's
-- reports, so the app can later show "what you told us and what we did".

create table if not exists public.problem_reports (
  id           uuid primary key,             -- made on the phone, so a resend can't double up
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  business_id  uuid,
  kind         text not null default 'problem' check (kind in ('problem', 'crash', 'idea')),
  message      text not null default '' check (length(message) <= 5000),
  details      jsonb not null default '{}'::jsonb,
  report_id    text,                         -- the job they had open, to look it up with them
  app_version  text,
  status       text not null default 'new' check (status in ('new', 'seen', 'fixing', 'fixed', 'wont_fix')),
  team_reply   text,
  created_at   timestamptz not null default now()
);

create index if not exists problem_reports_new_idx on public.problem_reports (status, created_at desc);
create index if not exists problem_reports_user_idx on public.problem_reports (user_id, created_at desc);

alter table public.problem_reports enable row level security;

-- An inspector sends reports as themselves, as new, with no reply.
drop policy if exists problem_reports_insert_own on public.problem_reports;
create policy problem_reports_insert_own on public.problem_reports
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'new' and team_reply is null
    and length(details::text) <= 50000);

-- And can read back their own. Nobody but the SAYON team (the dashboard and
-- the service role, which skip these rules) can change or delete one.
drop policy if exists problem_reports_select_own on public.problem_reports;
create policy problem_reports_select_own on public.problem_reports
  for select to authenticated using (user_id = auth.uid());

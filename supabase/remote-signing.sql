-- Remote signing of the pre-inspection agreement (run once in Supabase ›
-- SQL Editor, only after baz has read it and said to apply it).
--
-- The inspector taps "Send a link to sign" in the agreement sheet. The app
-- saves the exact agreement wording here and shares a link to sign.html with
-- the row's id. The id is a random UUID, so the link is the only key: the
-- client opens it with no account, reads the agreement and signs. The app
-- then reads the signed row back into the report.
--
-- The client's page can't read or write the table directly. It only calls
-- two functions: one returns a single request by id, the other signs a
-- request once, while it is still pending and not expired.

create table if not exists public.sign_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  report_id   text not null,
  doc         jsonb not null,           -- what the client sees: company, client, address, text, ...
  status      text not null default 'pending' check (status in ('pending', 'signed', 'cancelled')),
  signer_name text,
  signature   text,                     -- PNG data URL
  signer_meta jsonb,                    -- the signing device's browser, for the record
  signed_at   timestamptz,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days'
);

create index if not exists sign_requests_user_idx on public.sign_requests (user_id, report_id);

alter table public.sign_requests enable row level security;

-- The inspector who sent it can see, create and cancel their own requests.
drop policy if exists sign_requests_select_own on public.sign_requests;
create policy sign_requests_select_own on public.sign_requests
  for select to authenticated using (user_id = auth.uid());

drop policy if exists sign_requests_insert_own on public.sign_requests;
create policy sign_requests_insert_own on public.sign_requests
  for insert to authenticated with check (user_id = auth.uid() and status = 'pending' and signature is null);

drop policy if exists sign_requests_update_own on public.sign_requests;
create policy sign_requests_update_own on public.sign_requests
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and status in ('pending', 'cancelled'));

-- The client's page: read one request by its id.
create or replace function public.get_sign_request(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'doc', r.doc,
    'status', case when r.status = 'pending' and r.expires_at < now() then 'expired' else r.status end,
    'signer_name', r.signer_name,
    'signed_at', r.signed_at
  )
  from public.sign_requests r
  where r.id = p_id;
$$;

-- The client's page: sign it. Returns 'signed', or why not.
create or replace function public.submit_sign_request(p_id uuid, p_name text, p_signature text, p_meta jsonb default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.sign_requests;
begin
  select * into r from public.sign_requests where id = p_id for update;
  if not found then return 'not_found'; end if;
  if r.status = 'signed' then return 'already_signed'; end if;
  if r.status <> 'pending' then return 'cancelled'; end if;
  if r.expires_at < now() then return 'expired'; end if;
  if coalesce(length(trim(p_name)), 0) = 0 or length(p_name) > 120 then return 'bad_name'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 400000 then
    return 'bad_signature';
  end if;
  update public.sign_requests
     set status = 'signed', signer_name = trim(p_name), signature = p_signature,
         signer_meta = case when p_meta is null or length(p_meta::text) > 2000 then null else p_meta end,
         signed_at = now()
   where id = p_id;
  return 'signed';
end;
$$;

revoke all on function public.get_sign_request(uuid) from public;
revoke all on function public.submit_sign_request(uuid, text, text, jsonb) from public;
grant execute on function public.get_sign_request(uuid) to anon, authenticated;
grant execute on function public.submit_sign_request(uuid, text, text, jsonb) to anon, authenticated;

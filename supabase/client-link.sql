-- The client link for quotes (run once in Supabase › SQL Editor, only after
-- baz has read it and said to apply it). Needs remote-signing.sql first.
--
-- The inspector sends the quote with a link. The client opens sign.html
-- with the row's id, reads the quote, and taps Accept (with a signature) or
-- Decline (with an optional note). The app reads the answer back into the
-- quote. The same table and functions as the agreement link are used: the
-- row's doc carries kind: 'quote' and the quote itself, and Accept is the
-- existing submit_sign_request. This file adds the Decline side and the
-- place the PDFs are kept for the page.

-- 1. A declined quote is a third ending for a request.
alter table public.sign_requests drop constraint if exists sign_requests_status_check;
alter table public.sign_requests
  add constraint sign_requests_status_check check (status in ('pending', 'signed', 'declined', 'cancelled'));
alter table public.sign_requests add column if not exists note text;   -- why the client declined, in their words

-- 2. The client's page: decline it. Returns 'declined', or why not.
create or replace function public.decline_sign_request(p_id uuid, p_name text, p_note text default null, p_meta jsonb default null)
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
  if r.status = 'declined' then return 'declined'; end if;
  if r.status <> 'pending' then return 'cancelled'; end if;
  if r.expires_at < now() then return 'expired'; end if;
  if coalesce(length(trim(p_name)), 0) = 0 or length(p_name) > 120 then return 'bad_name'; end if;
  update public.sign_requests
     set status = 'declined', signer_name = trim(p_name),
         note = case when p_note is null then null else left(trim(p_note), 1000) end,
         signer_meta = case when p_meta is null or length(p_meta::text) > 2000 then null else p_meta end,
         signed_at = now()
   where id = p_id;
  return 'declined';
end;
$$;

revoke all on function public.decline_sign_request(uuid, text, text, jsonb) from public;
grant execute on function public.decline_sign_request(uuid, text, text, jsonb) to anon, authenticated;

-- 3. The page tells a declined request apart from a signed one, and shows
--    the client their own note when they open the link again.
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
    'signed_at', r.signed_at,
    'note', r.note
  )
  from public.sign_requests r
  where r.id = p_id;
$$;

-- 4. The PDFs the page offers to download: the report and the quote, as
--    the client was sent them. The bucket is public, but every path holds
--    the request's random id, so a file can only be reached from its
--    link, the same way the request itself can. Nobody can list the bucket.
--    PDFs only, 25 MB each. Only the inspector who owns the folder can
--    put files in it or remove them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-docs', 'client-docs', true, 26214400, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];

drop policy if exists client_docs_insert_own on storage.objects;
create policy client_docs_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists client_docs_update_own on storage.objects;
create policy client_docs_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'client-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists client_docs_select_own on storage.objects;
create policy client_docs_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'client-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists client_docs_delete_own on storage.objects;
create policy client_docs_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-docs' and (storage.foldername(name))[1] = auth.uid()::text);

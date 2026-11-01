-- Team and Business seats (run once in Supabase › SQL Editor, only after
-- baz has read it and said to apply it). Safe to run more than once.
-- Apply this before Worker v9.7.
--
-- Team ($79 per inspector a month, 2 to 9) and Business ($69 per inspector
-- a month billed yearly, 10 or more) are charged per inspector. The Worker
-- writes how many inspectors the business pays for into subscriptions.seats
-- from Stripe, and gives the business 800 AI fills a month per seat, shared.
--
-- The owner invites an inspector by email from "Your team" in the app and
-- sends them the sign-up link it makes. The link carries a secret token
-- (only its hash is stored). When that person signs in with the invited
-- email and the token, accept_invite() puts them on the business instead
-- of giving them one of their own. Email confirmation is off on this
-- project, so the token, not the email, is what proves the invite is theirs.
-- Everyone on the business, the owner included, takes a seat, and so does
-- an invite that is still waiting.
--
-- How many people a business can have:
--   trial     3   (enough to try it as a team)
--   starter   1   (Solo)
--   pro       seats   (Team)
--   business  seats
-- A plan that has ended keeps whoever is already on it, but takes no one new.

-- 1. How many inspectors the business pays for. Solo and the trial stay at 1.
alter table public.subscriptions
  add column if not exists seats int not null default 1;

-- 2. The invite's secret: a hash of the token in the link, and when the
-- link was made. A link works for 14 days; "Send link" makes a new one.
alter table public.invites
  add column if not exists token_hash text,
  add column if not exists link_sent_at timestamptz;

-- Invites left from the old Team feature have no token and can't be
-- accepted, so they stop holding seats.
update public.invites set status = 'expired' where status = 'pending' and token_hash is null;

-- 3. One business per person: the Worker reads a person's business from
-- this table, so two rows would make it pick one at random.
create unique index if not exists team_members_user_id_key on public.team_members (user_id);

-- Dropped first so this file can change what they return.
drop function if exists public.accept_invite();
drop function if exists public.invite_member(text);

-- 4. The most people the business can have on its team right now. Only
-- used inside the functions below.
create or replace function public.business_seat_cap(p_business_id uuid)
returns int
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when s.status = 'canceled' then 0
    when s.plan = 'trial' then 3
    when s.plan = 'starter' then 1
    else greatest(1, s.seats)
  end
  from public.subscriptions s
  where s.business_id = p_business_id;
$$;

create or replace function public.invite_token_hash(p_token text)
returns text
language sql
immutable
set search_path to ''
as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- A fresh 64-character token for a link.
create or replace function public.new_invite_token()
returns text
language sql
volatile
set search_path to ''
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- 5. The owner invites someone by email. Returns
--   {"status": "invited", "token": "..."}  (the token goes in the sign-up link)
-- or {"status": one of already_invited, already_member, no_seats, bad_email, not_owner}.
create or replace function public.invite_member(p_email text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  biz uuid;
  em text := lower(trim(coalesce(p_email, '')));
  cap int;
  taken int;
  tok text;
begin
  if uid is null then return jsonb_build_object('status', 'not_owner'); end if;
  select b.id into biz from public.businesses b where b.owner_id = uid limit 1;
  if biz is null then return jsonb_build_object('status', 'not_owner'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 254 then
    return jsonb_build_object('status', 'bad_email');
  end if;

  -- One invite or join at a time per business, so two quick taps can't
  -- both take the last seat.
  perform 1 from public.businesses where id = biz for update;

  if exists (select 1 from public.team_members where business_id = biz and lower(email) = em) then
    return jsonb_build_object('status', 'already_member');
  end if;
  if exists (select 1 from public.invites where business_id = biz and lower(email) = em and status = 'pending') then
    return jsonb_build_object('status', 'already_invited');
  end if;

  cap := coalesce(public.business_seat_cap(biz), 1);
  select (select count(*) from public.team_members where business_id = biz)
       + (select count(*) from public.invites where business_id = biz and status = 'pending')
    into taken;
  if taken >= cap then return jsonb_build_object('status', 'no_seats'); end if;

  tok := public.new_invite_token();
  insert into public.invites (business_id, email, role, invited_by, status, token_hash, link_sent_at)
  values (biz, em, 'technician', uid, 'pending', public.invite_token_hash(tok), now());
  return jsonb_build_object('status', 'invited', 'token', tok);
end;
$$;

-- 6. "Send link" on a pending invite: a new token (the old link stops
-- working) and 14 more days. Returns the token, or null if it isn't the
-- caller's business or the invite isn't pending.
create or replace function public.invite_link(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  tok text := public.new_invite_token();
begin
  if uid is null then return null; end if;
  update public.invites i
     set token_hash = public.invite_token_hash(tok), link_sent_at = now()
   where i.id = p_invite_id
     and i.status = 'pending'
     and i.business_id in (select b.id from public.businesses b where b.owner_id = uid);
  if not found then return null; end if;
  return tok;
end;
$$;

-- 7. What the sign-up card shows for an invite link: the business's name
-- and the invited email, or null if the link has expired, been replaced,
-- been used or been cancelled. Callable before signing in.
create or replace function public.get_invite(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'business', coalesce(nullif(trim(b.settings->'company'->>'name'), ''), b.name),
    'email', i.email
  )
  from public.invites i
  join public.businesses b on b.id = i.business_id
  where i.token_hash = public.invite_token_hash(p_token)
    and i.status = 'pending'
    and i.link_sent_at > now() - interval '14 days'
  limit 1;
$$;

-- 8. Called by the app at sign-in with the token from the link. If it
-- matches a live invite for this person's email, they join that business
-- as a technician and its id comes back. Otherwise null, and the app
-- carries on as before. Raises NO_SEATS when the business has no place
-- left (its plan ended or changed since the invite).
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  em text;
  display_name text;
  inv public.invites;
  cap int;
  members int;
begin
  if uid is null or coalesce(p_token, '') = '' then return null; end if;
  -- Two sign-ins at once (two phones) are taken one after the other.
  perform pg_advisory_xact_lock(hashtext('accept_invite:' || uid::text));

  select lower(u.email), nullif(trim(u.raw_user_meta_data->>'name'), '')
    into em, display_name
    from auth.users u where u.id = uid;
  if em is null then return null; end if;

  -- Someone already on a business, or owning one, isn't moved.
  if exists (select 1 from public.team_members where user_id = uid) then return null; end if;
  if exists (select 1 from public.businesses where owner_id = uid) then return null; end if;

  select * into inv
    from public.invites
   where token_hash = public.invite_token_hash(p_token)
     and status = 'pending'
     and lower(email) = em
     and link_sent_at > now() - interval '14 days'
   limit 1
   for update;
  if not found then return null; end if;

  perform 1 from public.businesses where id = inv.business_id for update;
  cap := coalesce(public.business_seat_cap(inv.business_id), 1);
  -- The invite being accepted already holds its seat, so only people who
  -- have joined count here.
  select count(*) into members from public.team_members where business_id = inv.business_id;
  if members >= cap then raise exception 'NO_SEATS'; end if;

  insert into public.team_members (business_id, user_id, role, name, email)
  values (inv.business_id, uid, 'technician', coalesce(display_name, em), em);
  update public.invites set status = 'accepted', token_hash = null where id = inv.id;
  return inv.business_id;
end;
$$;

revoke all on function public.business_seat_cap(uuid) from public, anon, authenticated;
revoke all on function public.invite_token_hash(text) from public, anon, authenticated;
revoke all on function public.new_invite_token() from public, anon, authenticated;
revoke all on function public.invite_member(text) from public, anon;
revoke all on function public.invite_link(uuid) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.get_invite(text) from public;
grant execute on function public.invite_member(text) to authenticated;
grant execute on function public.invite_link(uuid) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;

-- 9. Policies. Invites now go through the functions above, and only the
-- owner sees the list (it holds the emails of people not yet on the team).
drop policy if exists "owners can send invites" on public.invites;
drop policy if exists "invited user can accept" on public.invites;
drop policy if exists "members can view invites" on public.invites;
drop policy if exists "owners can view invites" on public.invites;
create policy "owners can view invites" on public.invites
  for select to authenticated
  using (business_id in (select b.id from public.businesses b where b.owner_id = (select auth.uid())));
-- Kept: owners can cancel invites.

-- team_members: a person can only add themselves, as the owner of their
-- own business (what the app does at sign-up). Technicians join through
-- accept_invite(), so an owner can no longer add rows past their seats.
drop policy if exists "members can add team" on public.team_members;
create policy "members can add team" on public.team_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and exists (select 1 from public.businesses b where b.id = team_members.business_id and b.owner_id = (select auth.uid()))
  );
-- Kept: members can view team, owners can remove team members.

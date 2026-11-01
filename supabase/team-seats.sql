-- Team and Business seats (run once in Supabase › SQL Editor, only after
-- baz has read it and said to apply it). Safe to run more than once.
--
-- Team ($79 per inspector a month, 2 to 9) and Business ($69 per inspector
-- a month billed yearly, 10 or more) are charged per inspector. The Worker
-- writes how many inspectors the business pays for into subscriptions.seats
-- from Stripe, and gives the business 800 AI fills a month per seat, shared.
--
-- The owner invites an inspector by email from "Your team" in the app. When
-- that person signs up with the same email, the app calls accept_invite()
-- and they join the business instead of getting a business of their own.
-- Everyone on the business, the owner included, takes a seat.
--
-- How many people a business can have:
--   trial     3   (enough to try it as a team)
--   starter   1   (Solo)
--   pro       seats   (Team)
--   business  seats
-- Plans that have ended keep whoever is already on them, but take no one new.

-- 1. How many inspectors the business pays for. Solo and the trial stay at 1.
alter table public.subscriptions
  add column if not exists seats int not null default 1;

-- 2. The most people the business can have on its team right now.
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

-- 3. The owner invites someone by email. Returns one word:
--   invited, already_invited, already_member, no_seats, bad_email, not_owner
-- A pending invite holds a seat, so a business can't invite past its cap.
create or replace function public.invite_member(p_email text)
returns text
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
begin
  if uid is null then return 'not_owner'; end if;
  select tm.business_id into biz
    from public.team_members tm
   where tm.user_id = uid and tm.role = 'owner'
   limit 1;
  if biz is null then return 'not_owner'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 254 then return 'bad_email'; end if;

  -- One business at a time is locked, so two quick taps can't both take
  -- the last seat.
  perform 1 from public.businesses where id = biz for update;

  if exists (select 1 from public.team_members where business_id = biz and lower(email) = em) then
    return 'already_member';
  end if;
  if exists (select 1 from public.invites where business_id = biz and lower(email) = em and status = 'pending') then
    return 'already_invited';
  end if;

  cap := coalesce(public.business_seat_cap(biz), 1);
  select (select count(*) from public.team_members where business_id = biz)
       + (select count(*) from public.invites where business_id = biz and status = 'pending')
    into taken;
  if taken >= cap then return 'no_seats'; end if;

  insert into public.invites (business_id, email, role, invited_by, status)
  values (biz, em, 'technician', uid, 'pending');
  return 'invited';
end;
$$;

-- 4. Called by the app at sign-in for someone with no business yet. If a
-- pending invite matches their confirmed email, they join that business as
-- a technician and the business id comes back. Otherwise it returns null
-- and the app sets up a business of their own as before.
-- Raises NO_SEATS when the business has filled its seats since inviting.
create or replace function public.accept_invite()
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  em text;
  confirmed timestamptz;
  display_name text;
  inv public.invites;
  cap int;
  members int;
begin
  if uid is null then return null; end if;
  select lower(u.email), u.email_confirmed_at, nullif(trim(u.raw_user_meta_data->>'name'), '')
    into em, confirmed, display_name
    from auth.users u where u.id = uid;
  -- Only an email the person has proved is theirs can claim an invite.
  if em is null or confirmed is null then return null; end if;

  -- Someone already on a business, or owning one, isn't moved.
  if exists (select 1 from public.team_members where user_id = uid) then return null; end if;
  if exists (select 1 from public.businesses where owner_id = uid) then return null; end if;

  select * into inv
    from public.invites
   where lower(email) = em and status = 'pending'
   order by created_at desc
   limit 1
   for update;
  if not found then return null; end if;

  perform 1 from public.businesses where id = inv.business_id for update;
  cap := coalesce(public.business_seat_cap(inv.business_id), 1);
  -- The invite being accepted already held its seat, so only people who
  -- have joined count here.
  select count(*) into members from public.team_members where business_id = inv.business_id;
  if members >= cap then raise exception 'NO_SEATS'; end if;

  insert into public.team_members (business_id, user_id, role, name, email)
  values (inv.business_id, uid, 'technician', coalesce(display_name, em), em);
  update public.invites set status = 'accepted' where id = inv.id;
  return inv.business_id;
end;
$$;

revoke all on function public.business_seat_cap(uuid) from public, anon;
revoke all on function public.invite_member(text) from public, anon;
revoke all on function public.accept_invite() from public, anon;
grant execute on function public.business_seat_cap(uuid) to authenticated;
grant execute on function public.invite_member(text) to authenticated;
grant execute on function public.accept_invite() to authenticated;

-- 5. Invites now go through invite_member() and accept_invite(). The old
-- policies let an owner add an invite without the seat check, and let the
-- invited person edit their invite row (any column, the business included).
drop policy if exists "owners can send invites" on public.invites;
drop policy if exists "invited user can accept" on public.invites;
-- Kept: members can view invites, owners can cancel invites, owners can
-- remove team members.

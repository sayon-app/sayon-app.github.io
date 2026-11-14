-- Card payments on invoices (Worker v11, Stripe Connect).
-- A business that takes card payments has its own Stripe account; this is
-- its id, written by the Worker when the owner sets card payments up and
-- read by the Worker each time it makes a Pay by card link.
--
-- It sits on subscriptions on purpose: that table has row level security on
-- and no policies, so only the Worker (service role) can read or write it,
-- and a signed-in user can't point their business at another Stripe account.
--
-- Safe to run more than once. Until it runs, card payments can't be set up
-- (the Worker's write fails and the app says so) and nothing else changes.
alter table public.subscriptions
  add column if not exists stripe_connect_account_id text;

-- Private per-account storage for NOIR chats, usage totals, and app credits.
-- Run this in the SQL editor of the Supabase project used by this deployment.
create table if not exists public.noir_user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.noir_user_data enable row level security;
revoke all on public.noir_user_data from anon, authenticated;
grant select, insert, update, delete on public.noir_user_data to service_role;

-- Stripe subscription state is server-owned; never grant browser roles access.
create table if not exists public.noir_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  current_period_start timestamptz,
  current_period_end timestamptz,
  renewal_date timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  last_stripe_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint noir_subscriptions_status_check check (status in ('inactive', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'))
);

create table if not exists public.noir_stripe_events (
  event_id text primary key,
  event_type text not null,
  stripe_created bigint not null,
  processed_at timestamptz not null default now()
);

alter table public.noir_subscriptions enable row level security;
alter table public.noir_stripe_events enable row level security;
revoke all on public.noir_subscriptions from anon, authenticated;
revoke all on public.noir_stripe_events from anon, authenticated;
grant select, insert, update, delete on public.noir_subscriptions to service_role;
grant select, insert, update, delete on public.noir_stripe_events to service_role;

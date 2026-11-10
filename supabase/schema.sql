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

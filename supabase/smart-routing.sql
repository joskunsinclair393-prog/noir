-- Run as the database owner. Only the server service role can reserve usage.
begin;
create table if not exists public.noir_routing_usage (
  month date not null,
  scope text not null,
  reserved_micros bigint not null,
  attempts bigint not null,
  primary key (month, scope)
);
alter table public.noir_routing_usage enable row level security;
revoke all on public.noir_routing_usage from public, anon, authenticated;
grant select, insert, update on public.noir_routing_usage to service_role;

create table if not exists public.noir_routing_rate (
  user_id uuid primary key references auth.users (id) on delete cascade,
  minute timestamptz not null,
  attempts bigint not null
);
alter table public.noir_routing_rate enable row level security;
revoke all on public.noir_routing_rate from public, anon, authenticated;
grant select, insert, update on public.noir_routing_rate to service_role;

create or replace function public.noir_reserve_routing(
  p_user uuid, p_provider text, p_cost bigint,
  p_user_cap bigint, p_user_attempts bigint,
  p_provider_cap bigint, p_provider_attempts bigint, p_minute_attempts bigint
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  billing_month date;
  minute_start timestamptz;
  account_scope text := 'user:' || p_user::text;
  provider_scope text := 'provider:' || p_provider;
begin
  if p_user is null or p_provider not in ('openai','deepseek','anthropic','gemini','mistral','xai')
    or p_cost is null or p_cost <= 0 then return false; end if;
  perform pg_advisory_xact_lock(97294111);
  minute_start := date_trunc('minute', clock_timestamp());
  billing_month := date_trunc('month', minute_start at time zone 'UTC')::date;
  if exists (select 1 from public.noir_routing_usage where month = billing_month and
    ((scope = account_scope and (reserved_micros + p_cost > p_user_cap or attempts >= p_user_attempts)) or
     (scope = provider_scope and (reserved_micros + p_cost > p_provider_cap or attempts >= p_provider_attempts))))
    or p_cost > least(p_user_cap, p_provider_cap) then return false; end if;
  insert into public.noir_routing_rate as rate(user_id, minute, attempts)
    values (p_user, minute_start, 1)
    on conflict (user_id) do update
    set minute = excluded.minute, attempts = case when rate.minute = excluded.minute then rate.attempts + 1 else 1 end
    where rate.minute <> excluded.minute or rate.attempts < p_minute_attempts;
  if not found then return false; end if;
  insert into public.noir_routing_usage as usage(month, scope, reserved_micros, attempts)
    values (billing_month, account_scope, p_cost, 1), (billing_month, provider_scope, p_cost, 1)
    on conflict (month, scope) do update
    set reserved_micros = usage.reserved_micros + excluded.reserved_micros, attempts = usage.attempts + 1;
  return true;
end;
$$;
revoke all on function public.noir_reserve_routing(uuid,text,bigint,bigint,bigint,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.noir_reserve_routing(uuid,text,bigint,bigint,bigint,bigint,bigint,bigint) to service_role;
commit;

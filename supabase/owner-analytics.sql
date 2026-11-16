begin;
create table if not exists public.noir_ai_daily (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('chat','smart-route','challenge','verify')),
  model text not null check (char_length(model) <= 128),
  succeeded boolean not null,
  requests bigint not null default 1,
  tokens bigint not null default 0,
  primary key (day, user_id, feature, model, succeeded)
);
alter table public.noir_ai_daily enable row level security;
revoke all on public.noir_ai_daily from public, anon, authenticated;
grant select, insert, update, delete on public.noir_ai_daily to service_role;

create or replace function public.noir_record_ai_usage(
  p_user uuid, p_feature text, p_model text, p_succeeded boolean, p_tokens integer
) returns void language sql security invoker set search_path = '' as $$
  delete from public.noir_ai_daily where day < (now() at time zone 'UTC')::date - 89;
  insert into public.noir_ai_daily as daily(day,user_id,feature,model,succeeded,tokens)
  values ((now() at time zone 'UTC')::date,p_user,p_feature,p_model,p_succeeded,greatest(0,p_tokens))
  on conflict (day,user_id,feature,model,succeeded) do update
  set requests = daily.requests + 1, tokens = daily.tokens + excluded.tokens;
$$;
revoke all on function public.noir_record_ai_usage(uuid,text,text,boolean,integer) from public, anon, authenticated;
grant execute on function public.noir_record_ai_usage(uuid,text,text,boolean,integer) to service_role;

create or replace function public.noir_owner_analytics()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with recent as (
    select * from public.noir_ai_daily where day >= (now() at time zone 'UTC')::date - 89
  ), totals as (
    select min(day) as since,
      count(distinct user_id) filter (where day = (now() at time zone 'UTC')::date) as daily,
      count(distinct user_id) filter (where day >= (now() at time zone 'UTC')::date - 6) as weekly,
      count(distinct user_id) filter (where day >= (now() at time zone 'UTC')::date - 29) as monthly,
      sum(requests) as ai_requests,
      sum(requests) filter (where succeeded and feature in ('chat','smart-route')) as ai_messages,
      sum(requests) filter (where not succeeded) as failed_requests,
      sum(requests) filter (where feature = 'challenge') as challenge,
      sum(requests) filter (where feature = 'smart-route') as smart_route,
      sum(tokens) as tokens
    from recent
  ), first_seen as (
    select user_id, min(day) as first_day from recent group by user_id
  ), retention as (
    select count(*) as eligible, count(*) filter (where exists (
      select 1 from recent r where r.user_id = f.user_id and r.day = f.first_day + 7
    )) as returned
    from first_seen f where f.first_day <= (now() at time zone 'UTC')::date - 7
  ), models as (
    select model, sum(requests) as requests from recent where model <> '' group by model
  )
  select to_jsonb(totals) || jsonb_build_object(
    'models', coalesce((select jsonb_agg(to_jsonb(models) order by requests desc) from models), '[]'::jsonb),
    'retention', (select to_jsonb(retention) from retention)
  ) from totals;
$$;
revoke all on function public.noir_owner_analytics() from public, anon, authenticated;
grant execute on function public.noir_owner_analytics() to service_role;

create or replace function public.noir_owner_analytics(p_days integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with recent as (
    select * from public.noir_ai_daily where day >= (now() at time zone 'UTC')::date - 89
  ), selected as (
    select * from recent where day >= (now() at time zone 'UTC')::date
      - (case when p_days in (7, 30, 90) then p_days else 90 end - 1)
  ), first_seen as (
    select user_id, min(day) as first_day from recent group by user_id
  ), totals as (
    select (select min(day) from recent) as since,
      (select count(distinct user_id) from selected) as active,
      (select count(distinct s.user_id) from selected s join first_seen f on f.user_id = s.user_id where s.day > f.first_day) as returning,
      sum(requests) filter (where succeeded) as successful_requests,
      (select count(distinct user_id) from recent where day = (now() at time zone 'UTC')::date) as daily,
      (select count(distinct user_id) from recent where day >= (now() at time zone 'UTC')::date - 6) as weekly,
      (select count(distinct user_id) from recent where day >= (now() at time zone 'UTC')::date - 29) as monthly,
      sum(requests) as ai_requests,
      sum(requests) filter (where succeeded and feature in ('chat','smart-route')) as ai_messages,
      sum(requests) filter (where not succeeded) as failed_requests,
      sum(requests) filter (where feature = 'challenge') as challenge,
      sum(requests) filter (where feature = 'smart-route') as smart_route,
      sum(tokens) as tokens
    from selected
  ), retention as (
    select count(*) as eligible, count(*) filter (where exists (
      select 1 from recent r where r.user_id = f.user_id and r.day = f.first_day + 7
    )) as returned
    from first_seen f where f.first_day <= (now() at time zone 'UTC')::date - 7
  ), models as (
    select model, sum(requests) as requests from selected where model <> '' group by model
  ), days as (
    select s.day, sum(s.requests) as requests, count(distinct s.user_id) as active,
      count(distinct s.user_id) filter (where s.day = f.first_day) as first_active,
      count(distinct s.user_id) filter (where s.day > f.first_day) as returning,
      sum(s.requests) filter (where not s.succeeded) as failed
    from selected s join first_seen f using (user_id) group by s.day
  ), retention_30 as (
    select count(*) as eligible, count(*) filter (where exists (
      select 1 from recent r where r.user_id = f.user_id and r.day = f.first_day + 30
    )) as returned
    from first_seen f where f.first_day <= (now() at time zone 'UTC')::date - 30
  )
  select to_jsonb(totals) || jsonb_build_object(
    'models', coalesce((select jsonb_agg(to_jsonb(models) order by requests desc) from models), '[]'::jsonb),
    'retention', (select to_jsonb(retention) from retention),
    'retention_30', (select to_jsonb(retention_30) from retention_30),
    'days', coalesce((select jsonb_agg(to_jsonb(days) order by day) from days), '[]'::jsonb)
  ) from totals;
$$;
revoke all on function public.noir_owner_analytics(integer) from public, anon, authenticated;
grant execute on function public.noir_owner_analytics(integer) to service_role;
commit;

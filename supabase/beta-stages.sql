begin;
create table if not exists public.noir_beta_settings(id boolean primary key default true check(id),tester_limit integer not null default 5 check(tester_limit in(5,25,100)));
insert into public.noir_beta_settings(id) values(true) on conflict do nothing;
alter table public.noir_beta_settings enable row level security;
revoke all on public.noir_beta_settings from public,anon,authenticated;
grant select,update on public.noir_beta_settings to service_role;
create or replace function public.noir_beta_limit() returns integer language sql security invoker set search_path='' as $$select tester_limit from public.noir_beta_settings where id=true$$;
revoke all on function public.noir_beta_limit() from public,anon,authenticated;grant execute on function public.noir_beta_limit() to service_role;
create or replace function public.noir_set_beta_limit(p_limit integer) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_limit not in(5,25,100) then raise exception 'Invalid beta stage'; end if;
 lock table public.noir_beta_applications in exclusive mode;
 if exists(select 1 from public.noir_beta_applications where pilot_slot>p_limit) then return false; end if;
 update public.noir_beta_settings set tester_limit=p_limit where id=true;return true;
end;$$;
revoke all on function public.noir_set_beta_limit(integer) from public,anon,authenticated;grant execute on function public.noir_set_beta_limit(integer) to service_role;
create or replace function public.noir_enforce_beta_slot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.pilot_slot is not null and new.pilot_slot>(select tester_limit from public.noir_beta_settings where id=true) then raise exception 'Beta stage limit exceeded';end if;return new;
end;$$;
revoke all on function public.noir_enforce_beta_slot() from public,anon,authenticated;
create trigger noir_beta_slot_guard before insert or update on public.noir_beta_applications for each row execute function public.noir_enforce_beta_slot();
alter table public.noir_beta_applications drop constraint noir_beta_applications_pilot_slot_check;
alter table public.noir_beta_applications add constraint noir_beta_applications_pilot_slot_check check(pilot_slot between 1 and 100);
create or replace function public.noir_set_beta_access(p_email text,p_grant boolean) returns boolean language plpgsql security invoker set search_path='' as $$
declare chosen smallint; cap integer;
begin
 lock table public.noir_beta_applications in exclusive mode;
 if not p_grant then update public.noir_beta_applications set status='rejected',pilot_slot=null,invited=false where email=p_email;return true;end if;
 if exists(select 1 from public.noir_beta_applications where email=p_email and status='approved' and pilot_slot is not null) then return true;end if;
 select tester_limit into cap from public.noir_beta_settings where id=true;
 select slot::smallint into chosen from generate_series(1,cap) slot where not exists(select 1 from public.noir_beta_applications where pilot_slot=slot) order by slot limit 1;
 if chosen is null then return false;end if;
 insert into public.noir_beta_applications(email,intended_use,consent_version,status,pilot_slot,invited) values(p_email,'Owner-approved beta access','beta-v1','approved',chosen,true)
 on conflict(email) do update set status='approved',pilot_slot=chosen,invited=true;return true;
end;$$;
create table if not exists public.noir_beta_feedback(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),category text not null check(category in('bug','feedback')),message text not null check(char_length(message) between 1 and 2000),created_at timestamptz not null default now());
alter table public.noir_beta_feedback enable row level security;revoke all on public.noir_beta_feedback from public,anon,authenticated;grant select,insert on public.noir_beta_feedback to service_role;
commit;

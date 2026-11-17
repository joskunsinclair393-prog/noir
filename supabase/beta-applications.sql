begin;
create table if not exists public.noir_beta_applications (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and char_length(email) between 3 and 254),
  intended_use text not null check (char_length(intended_use) between 1 and 1500),
  experience text check (char_length(experience) <= 1000),
  consent_version text not null check (consent_version = 'beta-v1'),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  pilot_slot smallint unique check (pilot_slot between 1 and 5),
  invited boolean not null default false,
  check (status = 'approved' or (pilot_slot is null and not invited))
);
alter table public.noir_beta_applications enable row level security;
revoke all on public.noir_beta_applications from public, anon, authenticated;
grant select, insert, update, delete on public.noir_beta_applications to service_role;

create or replace function public.noir_review_beta_application(
  p_id uuid, p_delete boolean default false, p_status text default 'pending',
  p_slot smallint default null, p_invited boolean default false
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_delete then
    delete from public.noir_beta_applications where id = p_id;
  else
    update public.noir_beta_applications
    set status = p_status, pilot_slot = p_slot, invited = p_invited where id = p_id;
  end if;
  return found;
end;
$$;
revoke all on function public.noir_review_beta_application(uuid,boolean,text,smallint,boolean) from public, anon, authenticated;
grant execute on function public.noir_review_beta_application(uuid,boolean,text,smallint,boolean) to service_role;
commit;

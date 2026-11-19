begin;
create table if not exists public.noir_studio_projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), name text not null check(char_length(name) between 1 and 100),
 data jsonb not null default '{"files":[]}', revision integer not null default 1, archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists noir_studio_owner on public.noir_studio_projects(owner_id);
create table if not exists public.noir_studio_members (
 project_id uuid references public.noir_studio_projects(id), user_id uuid references auth.users(id), email text not null, role text not null check(role in ('editor','viewer')), primary key(project_id,user_id)
);
create index if not exists noir_studio_member_user on public.noir_studio_members(user_id);
create table if not exists public.noir_studio_versions (
 project_id uuid references public.noir_studio_projects(id), revision integer, data jsonb not null, actor_id uuid not null,
 created_at timestamptz not null default now(), primary key(project_id,revision)
);
create table if not exists public.noir_studio_invites (
 id uuid primary key default gen_random_uuid(), project_id uuid references public.noir_studio_projects(id), email text not null,
 role text not null check(role in ('editor','viewer')), token_hash text not null unique,
 expires_at timestamptz not null default(now()+interval '7 days'), revoked boolean not null default false, accepted_by uuid
);
create table if not exists public.noir_studio_activity (
 id bigint generated always as identity primary key, project_id uuid references public.noir_studio_projects(id),
 actor_id uuid not null, action text not null, created_at timestamptz not null default now()
);
create index if not exists noir_studio_activity_project on public.noir_studio_activity(project_id,created_at);
alter table public.noir_studio_projects enable row level security;
alter table public.noir_studio_members enable row level security;
alter table public.noir_studio_versions enable row level security;
alter table public.noir_studio_invites enable row level security;
alter table public.noir_studio_activity enable row level security;
revoke all on public.noir_studio_projects,public.noir_studio_members,public.noir_studio_versions,public.noir_studio_invites,public.noir_studio_activity from public,anon,authenticated;
grant all on public.noir_studio_projects,public.noir_studio_members,public.noir_studio_versions,public.noir_studio_invites,public.noir_studio_activity to service_role;
grant usage,select on sequence public.noir_studio_activity_id_seq to service_role;
create or replace function public.noir_studio_action(p_actor uuid,p_email text,p_action text,p_id uuid default null,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.noir_studio_projects; access_role text; invitation public.noir_studio_invites; result jsonb;
begin
 if p_action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'revision',s.revision,'updatedAt',s.updated_at,'role',case when s.owner_id=p_actor then 'owner' else m.role end) order by s.updated_at desc)
    from public.noir_studio_projects s left join public.noir_studio_members m on m.project_id=s.id and m.user_id=p_actor where not s.archived and (s.owner_id=p_actor or m.user_id=p_actor)),'[]');
 end if;
 if p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
  if (select count(*) from public.noir_studio_projects where owner_id=p_actor and not archived)>=20 then raise exception 'Maximum 20 projects'; end if;
  insert into public.noir_studio_projects(owner_id,name) values(p_actor,left(trim(p_payload->>'name'),100)) returning * into p;
  insert into public.noir_studio_activity(project_id,actor_id,action) values(p.id,p_actor,'created');
  return jsonb_build_object('id',p.id,'name',p.name,'revision',p.revision,'data',p.data,'role','owner');
 end if;
 if p_action='accept' then
  select * into invitation from public.noir_studio_invites where token_hash=p_payload->>'tokenHash' for update;
  if not found or invitation.revoked or invitation.accepted_by is not null or invitation.expires_at<=now() or invitation.email<>lower(p_email) then raise exception 'Invitation unavailable'; end if;
  if not exists(select 1 from public.noir_studio_projects where id=invitation.project_id and not archived) then raise exception 'Project unavailable'; end if;
  insert into public.noir_studio_members(project_id,user_id,email,role) values(invitation.project_id,p_actor,lower(p_email),invitation.role) on conflict(project_id,user_id) do update set role=excluded.role;
  update public.noir_studio_invites set accepted_by=p_actor where id=invitation.id;
  insert into public.noir_studio_activity(project_id,actor_id,action) values(invitation.project_id,p_actor,'joined');
  return jsonb_build_object('id',invitation.project_id);
 end if;
 select * into p from public.noir_studio_projects where id=p_id and not archived for update;
 if not found then raise exception 'Project unavailable'; end if;
 if p.owner_id=p_actor then access_role='owner'; else select role into access_role from public.noir_studio_members where project_id=p_id and user_id=p_actor; end if;
 if access_role is null then raise exception 'Project unavailable'; end if;
 if p_action='read' then
  result=jsonb_build_object('id',p.id,'name',p.name,'revision',p.revision,'data',p.data,'role',access_role,
   'versions',coalesce((select jsonb_agg(jsonb_build_object('revision',v.revision,'createdAt',v.created_at) order by v.revision desc) from public.noir_studio_versions v where v.project_id=p_id),'[]'),
   'activity',coalesce((select jsonb_agg(to_jsonb(a)) from (select action,created_at from public.noir_studio_activity where project_id=p_id order by created_at desc limit 40) a),'[]'));
  if access_role='owner' then result=result||jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'email',m.email,'role',m.role)) from public.noir_studio_members m where m.project_id=p_id),'[]'),
   'invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'expiresAt',i.expires_at,'revoked',i.revoked,'accepted',i.accepted_by is not null)) from public.noir_studio_invites i where project_id=p_id),'[]')); end if;
  return result;
 end if;
 if p_action='version' then return coalesce((select jsonb_build_object('data',v.data) from public.noir_studio_versions v where v.project_id=p_id and v.revision=(p_payload->>'revision')::integer),'{}'); end if;
 if p_action='save' then
  if access_role='viewer' then raise exception 'Read-only project'; end if;
  if p.revision<>(p_payload->>'revision')::integer then return jsonb_build_object('conflict',true,'revision',p.revision); end if;
  if not (p_payload ? 'revision') or jsonb_typeof(p_payload->'data'->'files')<>'array' or char_length((p_payload->'data')::text)>400000 or jsonb_array_length(p_payload->'data'->'files')>30 then raise exception 'Invalid project data'; end if;
  insert into public.noir_studio_versions(project_id,revision,data,actor_id) values(p.id,p.revision,p.data,p_actor);
  update public.noir_studio_projects set data=p_payload->'data',name=left(coalesce(nullif(trim(p_payload->>'name'),''),p.name),100),revision=revision+1,updated_at=now() where id=p_id returning * into p;
  delete from public.noir_studio_versions where project_id=p_id and revision<p.revision-20;
  insert into public.noir_studio_activity(project_id,actor_id,action) values(p.id,p_actor,'saved');
  delete from public.noir_studio_activity where project_id=p_id and id not in(select id from public.noir_studio_activity where project_id=p_id order by id desc limit 100);
  return jsonb_build_object('revision',p.revision);
 end if;
 if access_role<>'owner' then raise exception 'Owner permission required'; end if;
 if p_action='invite' then
  if (select count(*) from public.noir_studio_invites where project_id=p_id and not revoked and accepted_by is null and expires_at>now())>=20 then raise exception 'Maximum 20 pending invitations'; end if;
  insert into public.noir_studio_invites(project_id,email,role,token_hash) values(p_id,lower(p_payload->>'email'),p_payload->>'role',p_payload->>'tokenHash');
 elsif p_action='revoke' then update public.noir_studio_invites set revoked=true where project_id=p_id and id=(p_payload->>'inviteId')::uuid;
 elsif p_action='member' then
  if p_payload->>'role'='remove' then delete from public.noir_studio_members where project_id=p_id and user_id=(p_payload->>'userId')::uuid;
  else update public.noir_studio_members set role=p_payload->>'role' where project_id=p_id and user_id=(p_payload->>'userId')::uuid; end if;
 else raise exception 'Unsupported Studio action'; end if;
 insert into public.noir_studio_activity(project_id,actor_id,action) values(p_id,p_actor,p_action);
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.noir_studio_action(uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.noir_studio_action(uuid,text,text,uuid,jsonb) to service_role;
commit;

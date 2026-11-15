-- Apply alongside schema.sql. Only the trusted NOIR server may use this table.
create table if not exists public.noir_connector_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  connector text not null check (connector in ('Google Drive', 'Google Calendar', 'Gmail')),
  refresh_ciphertext text not null,
  primary key (user_id, connector)
);
alter table public.noir_connector_grants enable row level security;
revoke all on public.noir_connector_grants from public, anon, authenticated;
grant select, insert, update, delete on public.noir_connector_grants to service_role;

begin;
alter table public.noir_connector_grants
  drop constraint noir_connector_grants_connector_check,
  add constraint noir_connector_grants_connector_check
    check (connector in ('Google Drive', 'Google Calendar', 'Gmail', 'GitHub'));
commit;

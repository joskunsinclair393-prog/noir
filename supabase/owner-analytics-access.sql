begin;
alter function public.noir_owner_analytics() security definer;
alter function public.noir_owner_analytics(integer) security definer;
revoke all on function public.noir_owner_analytics(), public.noir_owner_analytics(integer) from public,anon,authenticated;
grant execute on function public.noir_owner_analytics(), public.noir_owner_analytics(integer) to service_role;
commit;

begin;
revoke execute on function public.search_chunks(uuid,text,extensions.vector,boolean) from anon, authenticated;
grant execute on function public.search_chunks(uuid,text,extensions.vector,boolean) to service_role;
commit;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare t record;
begin
  for t in
    select c.relname as tablename from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)',
      t.tablename || '_authenticated_all', t.tablename
    );
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy "public read snapshots and branding"
  on storage.objects for select
  using (bucket_id in ('camera-snapshots','branding'));

create policy "authenticated write snapshots and branding"
  on storage.objects for all to authenticated
  using (bucket_id in ('camera-snapshots','branding') and auth.uid() is not null)
  with check (bucket_id in ('camera-snapshots','branding') and auth.uid() is not null);

create or replace function public.can_read_org(_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$ select auth.uid() is not null $$;

create or replace function public.can_admin_org(_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$ select auth.uid() is not null $$;

create or replace function public.is_org_admin(_user_id uuid, _org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$ select _user_id is not null $$;

create or replace function public.is_org_member(_user_id uuid, _org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$ select _user_id is not null $$;

create or replace function public.user_has_instance(_user_id uuid, _instance_id uuid)
returns boolean language sql stable security definer set search_path = public as $$ select _user_id is not null $$;

create or replace function public.user_has_camera(_user_id uuid, _instance_id uuid, _camera text)
returns boolean language sql stable security definer set search_path = public as $$ select _user_id is not null $$;

drop function if exists public.auto_add_to_abc() cascade;
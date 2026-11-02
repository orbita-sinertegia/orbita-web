-- Añade permisos configurables para administradores y restringe su edición al superadmin.

alter table public.role_permissions
  drop constraint if exists role_permissions_role_check;

alter table public.role_permissions
  add constraint role_permissions_role_check
  check (role in ('admin', 'team', 'client'));

insert into public.role_permissions (role, section_key, allowed) values
  ('admin', 'overview', true),
  ('admin', 'team', true),
  ('admin', 'calendar', true),
  ('admin', 'performance', true),
  ('admin', 'mytasks', true),
  ('admin', 'roadmap', true),
  ('admin', 'clientes', true),
  ('admin', 'requests', true),
  ('admin', 'chat_team', true),
  ('admin', 'chat_clients', true),
  ('admin', 'entregables', true)
on conflict (role, section_key) do nothing;

delete from public.role_permissions
where role = 'admin' and section_key = 'spelling';

drop policy if exists "Cualquier usuario autenticado puede modificar permisos" on public.role_permissions;
drop policy if exists "Solo superadmin puede modificar permisos" on public.role_permissions;

create policy "Solo superadmin puede modificar permisos"
  on public.role_permissions for all
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.is_super_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.is_super_admin = true
    )
  );

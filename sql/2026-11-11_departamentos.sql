-- Departamentos (roles operativos) del equipo. Correr completo en el SQL Editor de Supabase.
-- Se puede correr más de una vez.
--
-- La tabla no llegó a la base de Órbita al copiar la estructura, y "Crear nuevo departamento" fallaba.
-- Además, users.department y tasks.department tenían una lista fija: un departamento nuevo no se podía
-- asignar. Ahora la lista vive en team_departments y la administran los admins activos.
begin;

create table if not exists public.team_departments (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null unique check (length(trim(name)) between 2 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.team_departments (id, name) values
  ('edicion', 'Edición'),
  ('grabacion', 'Grabación'),
  ('diseno', 'Diseño'),
  ('copy', 'Copy'),
  ('webmaster', 'Webmaster'),
  ('trafficker', 'Trafficker'),
  ('lider', 'Líder'),
  ('project_manager', 'Project manager')
on conflict (id) do nothing;

alter table public.team_departments enable row level security;
revoke all on public.team_departments from anon, public;
grant select, insert, update on public.team_departments to authenticated;

drop policy if exists "Usuarios autenticados leen departamentos" on public.team_departments;
drop policy if exists "Superadmin administra departamentos" on public.team_departments;
drop policy if exists "departamentos_ver" on public.team_departments;
drop policy if exists "departamentos_admin" on public.team_departments;
create policy "departamentos_ver" on public.team_departments for select to authenticated
  using (active or public.is_active_admin());
create policy "departamentos_admin" on public.team_departments for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

-- La lista fija ya no aplica: cualquier departamento del catálogo se puede asignar.
alter table public.users drop constraint if exists users_department_check;
alter table public.tasks drop constraint if exists tasks_department_check;

-- Pruebas.
do $$
declare
  admin_id uuid;
begin
  if (select count(*) from public.team_departments where active) < 8 then
    raise exception 'PRUEBA FALLIDA: faltan departamentos base';
  end if;
  if exists (select 1 from pg_constraint where conname = 'users_department_check') then
    raise exception 'PRUEBA FALLIDA: sigue la lista fija de departamentos';
  end if;
  select id into admin_id from public.users where (role = 'admin' or is_super_admin) and coalesce(active, true) limit 1;
  if admin_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.team_departments (id, name) values ('prueba_temporal', 'Prueba temporal');
    delete from public.team_departments where id = 'prueba_temporal';
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;

commit;

select 'Listo: departamentos' as resultado;

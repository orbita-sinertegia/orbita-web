-- Catálogo editable para ordenar e invitar integrantes por departamento.
create table if not exists public.team_departments (
  id text primary key,
  name text not null unique,
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
  ('lider', 'Líder')
on conflict (id) do update set name = excluded.name;

alter table public.team_departments enable row level security;

drop policy if exists "Usuarios autenticados leen departamentos" on public.team_departments;
create policy "Usuarios autenticados leen departamentos"
  on public.team_departments for select to authenticated
  using (active = true);

drop policy if exists "Superadmin administra departamentos" on public.team_departments;
create policy "Superadmin administra departamentos"
  on public.team_departments for all to authenticated
  using (
    exists (select 1 from public.users where users.id = auth.uid() and users.is_super_admin = true)
  )
  with check (
    exists (select 1 from public.users where users.id = auth.uid() and users.is_super_admin = true)
  );

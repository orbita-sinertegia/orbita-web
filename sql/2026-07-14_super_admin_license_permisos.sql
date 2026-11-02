-- 1. Marca de super admin: un admin especial que puede activar/suspender la app completa.
alter table users add column if not exists is_super_admin boolean not null default false;

-- 2. Estado de la licencia de esta instancia (una sola fila).
create table if not exists app_license (
  id int primary key default 1,
  status text not null default 'active' check (status in ('active', 'suspended')),
  plan_name text,
  expires_at date,
  notes text,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into app_license (id, status) values (1, 'active') on conflict (id) do nothing;

alter table app_license enable row level security;

create policy "Cualquier usuario autenticado puede leer el estado de licencia"
  on app_license for select
  to authenticated
  using (true);

create policy "Cualquier usuario autenticado puede actualizar la licencia"
  on app_license for update
  to authenticated
  using (true);

-- 3. Permisos por rol: qué secciones puede ver "team" y qué puede ver "client".
create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('team', 'client')),
  section_key text not null,
  allowed boolean not null default true,
  unique (role, section_key)
);

alter table role_permissions enable row level security;

create policy "Cualquier usuario autenticado puede leer permisos"
  on role_permissions for select
  to authenticated
  using (true);

create policy "Cualquier usuario autenticado puede modificar permisos"
  on role_permissions for all
  to authenticated
  using (true)
  with check (true);

-- Semillas: todas las secciones existentes, permitidas por default (nada se oculta hasta que el admin decida).
insert into role_permissions (role, section_key, allowed) values
  ('team', 'tasks', true),
  ('team', 'calendar', true),
  ('team', 'roadmap', true),
  ('team', 'chat_team', true),
  ('team', 'chat_clients', true),
  ('team', 'entregables', true),
  ('client', 'mistareas', true),
  ('client', 'progreso', true),
  ('client', 'area', true),
  ('client', 'calendario', true),
  ('client', 'roadmap', true),
  ('client', 'chat', true),
  ('client', 'entregables', true)
on conflict (role, section_key) do nothing;

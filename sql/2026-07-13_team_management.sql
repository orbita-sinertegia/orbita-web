-- Cuentas desactivadas: en vez de borrarlas (rompería tareas/comentarios/chats viejos),
-- se les quita el acceso pero se conserva su nombre en el historial.
alter table users add column if not exists active boolean not null default true;

-- Invitaciones para que el equipo se una solo con un link (mismo patrón que client_invitations).
create table if not exists team_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  role text not null check (role in ('team','admin')),
  department text,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

alter table team_invitations enable row level security;

create policy "Cualquiera puede leer una invitacion por su id"
  on team_invitations for select
  using (true);

create policy "Cualquiera puede marcar una invitacion como usada"
  on team_invitations for update
  using (true);

create policy "Solo usuarios autenticados pueden crear invitaciones"
  on team_invitations for insert
  to authenticated
  with check (true);

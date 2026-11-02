-- Permite retirar personas del directorio sin destruir tareas, proyectos,
-- comentarios, entregables ni reportes históricos relacionados.

alter table public.users
  add column if not exists directory_hidden boolean not null default false;

alter table public.clients
  add column if not exists directory_hidden boolean not null default false;

create index if not exists users_directory_visible_idx
  on public.users (role, directory_hidden);

create index if not exists clients_directory_visible_idx
  on public.clients (directory_hidden);

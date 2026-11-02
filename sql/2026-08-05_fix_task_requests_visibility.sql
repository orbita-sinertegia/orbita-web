-- Garantiza que las solicitudes enviadas por clientes sean visibles para administradores.

create table if not exists public.task_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requester_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  department text not null,
  assigned_to uuid references public.users(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.task_requests enable row level security;

drop policy if exists "Clientes crean sus solicitudes" on public.task_requests;
create policy "Clientes crean sus solicitudes"
  on public.task_requests for insert
  to authenticated
  with check (
    requester_id = auth.uid()
    and exists (
      select 1 from public.clients
      where clients.id = task_requests.client_id
        and clients.user_id = auth.uid()
    )
  );

drop policy if exists "Clientes ven sus solicitudes" on public.task_requests;
create policy "Clientes ven sus solicitudes"
  on public.task_requests for select
  to authenticated
  using (
    requester_id = auth.uid()
    or exists (
      select 1 from public.clients
      where clients.id = task_requests.client_id
        and clients.user_id = auth.uid()
    )
  );

drop policy if exists "Administradores gestionan solicitudes" on public.task_requests;
create policy "Administradores gestionan solicitudes"
  on public.task_requests for all
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );

create index if not exists task_requests_status_created_idx
  on public.task_requests(status, created_at desc);

alter table public.task_requests replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.task_requests;
exception
  when duplicate_object then null;
end $$;

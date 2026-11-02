-- Responsable de revisión/autorización para tareas creadas internamente.
-- Las solicitudes de clientes permanecen sin approver_id y conservan el
-- circuito exclusivo de autorización administrativa.

alter table public.tasks
  add column if not exists approver_id uuid references public.users(id) on delete set null;

create index if not exists tasks_approver_review_idx
  on public.tasks(approver_id, review_status);

alter table public.tasks enable row level security;

drop policy if exists "Responsables de autorizacion ven sus tareas" on public.tasks;
create policy "Responsables de autorizacion ven sus tareas"
  on public.tasks
  for select
  to authenticated
  using (approver_id = auth.uid());

drop policy if exists "Responsables de autorizacion ven entregables" on public.task_links;
create policy "Responsables de autorizacion ven entregables"
  on public.task_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks
      where tasks.id = task_links.task_id
        and tasks.approver_id = auth.uid()
    )
  );

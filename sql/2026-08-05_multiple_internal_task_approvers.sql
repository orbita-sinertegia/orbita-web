-- Permite asignar varios revisores/autorizadores a una tarea interna.
-- Las solicitudes de clientes no llenan esta columna y siguen dependiendo
-- de la autorización administrativa habitual.

alter table public.tasks
  add column if not exists approver_ids uuid[] not null default '{}'::uuid[];

update public.tasks
set approver_ids = array[approver_id]
where approver_id is not null
  and cardinality(approver_ids) = 0;

create index if not exists tasks_approver_ids_gin_idx
  on public.tasks using gin(approver_ids);

drop policy if exists "Responsables multiples ven sus tareas" on public.tasks;
create policy "Responsables multiples ven sus tareas"
  on public.tasks
  for select
  to authenticated
  using (auth.uid() = any(approver_ids));

drop policy if exists "Responsables multiples ven entregables" on public.task_links;
create policy "Responsables multiples ven entregables"
  on public.task_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks
      where tasks.id = task_links.task_id
        and auth.uid() = any(tasks.approver_ids)
    )
  );

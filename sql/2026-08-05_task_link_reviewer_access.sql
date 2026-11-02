-- Permite que cualquier integrante asignado como revisor consulte los
-- enlaces y archivos de la tarea que debe revisar.

alter table public.task_links enable row level security;

drop policy if exists "Revisores ven entregables asignados" on public.task_links;
create policy "Revisores ven entregables asignados"
  on public.task_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks
      where tasks.id = task_links.task_id
        and tasks.reviewer_id = auth.uid()
    )
  );

-- Mantiene acceso al responsable y creador de la tarea incluso después de
-- enviarla a revisión. Las políticas son permisivas y se suman a las actuales.
drop policy if exists "Responsables ven entregables de sus tareas" on public.task_links;
create policy "Responsables ven entregables de sus tareas"
  on public.task_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks
      where tasks.id = task_links.task_id
        and (tasks.assigned_to = auth.uid() or tasks.created_by = auth.uid())
    )
  );

-- ============================================================================
-- NO EJECUTAR TODAVÍA — requiere aprobación de Tony y probar la app (equipo,
-- cliente y admin) antes. No está conectado a ningún flujo ni migración.
-- ============================================================================
--
-- Problema: la política "allow all" de public.tasks deja leer, crear, editar y
-- borrar cualquier tarea (incluso sin iniciar sesión). Mientras exista, las demás
-- políticas no sirven de nada, porque en RLS basta con que UNA política permita.
--
-- Qué hace este archivo:
--   1. Quita "allow all".
--   2. Recrea "team_update_tasks" (UPDATE) para que solo puedan editar quienes la app
--      necesita que editen hoy:
--        - administradores activos y departamento Líder (has_full_task_access()),
--        - el responsable (assigned_to) y quien la creó (created_by),
--        - los revisores/autorizadores (reviewer_id y approver_ids), porque
--          TaskDetailModal actualiza review_status desde su cuenta,
--        - el usuario cliente del proyecto (ClientPortal guarda client_approval).
--   No toca ninguna otra política.
--
-- ANTES de correrlo, con sql/2026-10-23_admin_tareas_00_revision.sql (sección "e"),
-- confirma que existan políticas propias para:
--   - SELECT del equipo/admin, del cliente (sus proyectos) y de revisores
--     ("Responsables multiples ven sus tareas", 2026-08-05_...);
--   - INSERT (CreateTaskModal, CreateProjectModal, retrabajo en TaskDetailModal);
--   - DELETE: no hace falta para la app (el borrado definitivo va por la función
--     admin_delete_team_task, que es security definer).
-- Si falta alguna de SELECT o INSERT, hay que crearla ANTES o la app dejará de
-- mostrar o crear tareas. Después de correrlo, probar: equipo (cambiar estatus, poner
-- fecha, enviar a revisión), revisor (aprobar/pedir cambios), cliente (aprobar
-- entregable, marcar su tarea), admin (editar, archivar, crear tareas y proyectos).

begin;

drop policy if exists "allow all" on public.tasks;

drop policy if exists "team_update_tasks" on public.tasks;
create policy "team_update_tasks"
  on public.tasks for update
  to authenticated
  using (
    public.has_full_task_access()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or reviewer_id = auth.uid()
    or auth.uid() = any(coalesce(approver_ids, '{}'::uuid[]))
    or exists (
      select 1 from public.projects p
      join public.clients c on c.id = p.client_id
      where p.id = tasks.project_id and c.user_id = auth.uid()
    )
  )
  with check (
    public.has_full_task_access()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or reviewer_id = auth.uid()
    or auth.uid() = any(coalesce(approver_ids, '{}'::uuid[]))
    or exists (
      select 1 from public.projects p
      join public.clients c on c.id = p.client_id
      where p.id = tasks.project_id and c.user_id = auth.uid()
    )
  );

commit;

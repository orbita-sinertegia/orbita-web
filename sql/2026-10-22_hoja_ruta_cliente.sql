-- NO EJECUTAR sin revisión de Tony.
-- Agrega la columna de fase a las tareas para la hoja de ruta por fases (FASE 2).
-- Los proyectos existentes quedan con phase = NULL; la vista infiere la fase con
-- inferPhase() (src/data/projectTemplates.ts) sin necesidad de este backfill para
-- funcionar. El backfill real (para que quede guardada en la base) está en
-- sql/2026-10-22_backfill_fase_tareas.sql, aparte, para que Tony lo revise primero.
begin;

alter table public.tasks
  add column if not exists phase text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_phase_check'
  ) then
    alter table public.tasks
      add constraint tasks_phase_check check (
        phase is null or phase in (
          'entrada', 'estrategia', 'guiones', 'produccion_video', 'produccion_paginas',
          'revision', 'lanzamiento', 'optimizacion'
        )
      );
  end if;
end $$;

create index if not exists tasks_project_phase_idx
  on public.tasks(project_id, phase);

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- OPCIONAL — revisar antes de aplicar. NO forma parte del commit anterior.
-- ─────────────────────────────────────────────────────────────────────────
-- La vista "Hoja de ruta de clientes" para el Equipo filtra en el código (igual que
-- ClientChatsHub) a solo los clientes de client_team_members o los proyectos donde
-- tiene tareas asignadas. Esa validación es solo de UI/consulta: si las políticas RLS
-- actuales de "projects"/"tasks" ya permiten que cualquier integrante del equipo lea
-- TODOS los proyectos/tareas (como parece ser hoy, a juzgar por CreateTaskModal y
-- TeamDashboard.fetchProjects, que listan todos los proyectos activos sin filtrar por
-- asignación), alguien del equipo podría seguir leyendo clientes ajenos consultando la
-- API directo, sin pasar por esta pantalla.
--
-- Esta política de ejemplo RESTRINGE esa lectura a admins/superadmin + al equipo
-- asignado (client_team_members) o con tareas en el proyecto + al propio cliente.
-- NO la apliques sin medir el impacto: hoy varias pantallas (TeamDashboard,
-- CreateTaskModal, TeamCalendar, etc.) dependen de que el equipo pueda leer todos los
-- proyectos/tareas activos para asignar y filtrar trabajo. Si la aplicas, revisa esas
-- pantallas antes — probablemente necesiten su propia excepción o deban moverse a una
-- función con security definer.
--
-- begin;
-- drop policy if exists "Equipo ve solo sus proyectos asignados" on public.projects;
-- create policy "Equipo ve solo sus proyectos asignados"
--   on public.projects for select
--   to authenticated
--   using (
--     exists (select 1 from public.users where id = auth.uid() and role in ('admin') and coalesce(active, true))
--     or exists (select 1 from public.users where id = auth.uid() and is_super_admin)
--     or exists (select 1 from public.client_team_members where client_id = projects.client_id and user_id = auth.uid())
--     or exists (select 1 from public.tasks where project_id = projects.id and assigned_to = auth.uid())
--     or exists (select 1 from public.clients c where c.id = projects.client_id and c.user_id = auth.uid())
--   );
-- commit;

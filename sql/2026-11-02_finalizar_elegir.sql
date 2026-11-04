-- Finalizar un proyecto eligiendo qué pasa con sus tareas pendientes: ARCHIVAR (se pueden
-- recuperar) o ELIMINAR PARA SIEMPRE. Lo elige el super admin cada vez.
-- Ejecutar DESPUÉS de revisar sql/2026-11-02_finalizar_elegir_00_revision.sql.
-- Idempotente. No elimina ni archiva nada al correrlo; no tiene sentencias destructivas.
--
--   1. Se apaga el borrado automático: trg_projects_finalize_delete() ahora no hace nada
--      (el trigger projects_finalize_delete se queda, vacío, para no quitar objetos).
--   2. tasks.archived_via = 'proyecto_finalizado' marca lo archivado al finalizar. El trigger
--      tasks_clear_archived_via borra la marca en cualquier archivado/restauración manual,
--      así reactivar nunca restaura algo que se archivó a mano.
--   3. finalize_project(p_project_id, p_mode) — RPC solo para el super admin:
--        · pone el proyecto en 'completado' (Finalizado);
--        · 'archivar': archiva las pendientes no entregadas sin archivar (auditoría 'archive');
--        · 'borrar':   llama a purge_finalized_project_tasks (la eliminación definitiva ya
--                      instalada, con foto en task_audit_log, archivadas incluidas).
--        Devuelve cuántas tareas archivó o eliminó.
--      Se conservan siempre: realizadas y entregadas (is_task_delivered).
--   4. Trigger projects_reactivate_restore (AFTER UPDATE OF status): al salir de 'completado'
--      (a Activo o Pausado) restaura solo las tareas con la marca (auditoría 'restore').
--      Va en trigger para que funcione desde el selector de estado normal de la app.
begin;

-- 1. Sin borrado automático al cambiar el estado.
create or replace function public.trg_projects_finalize_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Desactivado (2026-11-02): ahora se elige al finalizar con finalize_project().
  return new;
end;
$$;

-- 2. Marca de "archivada al finalizar".
alter table public.tasks add column if not exists archived_via text;

create index if not exists tasks_archived_via_project_idx
  on public.tasks(project_id) where archived_via is not null;

create or replace function public.trg_tasks_clear_archived_via()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.archived_at is distinct from old.archived_at
     and coalesce(current_setting('app.project_finalize', true), '') <> 'on' then
    new.archived_via := null;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_tasks_clear_archived_via() from public, anon;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tasks_clear_archived_via' and tgrelid = 'public.tasks'::regclass) then
    create trigger tasks_clear_archived_via
      before update of archived_at on public.tasks
      for each row execute function public.trg_tasks_clear_archived_via();
  end if;
end;
$$;

-- 3. Finalizar eligiendo archivar o eliminar.
create or replace function public.finalize_project(p_project_id uuid, p_mode text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_new public.projects%rowtype;
  v_count integer := 0;
begin
  if not public.is_active_super_admin() then
    raise exception 'Solo el super admin puede finalizar proyectos';
  end if;
  if p_mode is null or p_mode not in ('archivar', 'borrar') then
    raise exception 'Modo no válido: % (usa archivar o borrar)', coalesce(p_mode, '(vacío)');
  end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if v_project.id is null then
    raise exception 'El proyecto no existe';
  end if;

  if v_project.status::text is distinct from 'completado' then
    -- jsonb_populate_record convierte al tipo real de la columna (text o enum).
    v_new := jsonb_populate_record(v_project, jsonb_build_object('status', 'completado'));
    update public.projects set status = v_new.status where id = p_project_id;
  end if;

  if p_mode = 'archivar' then
    perform set_config('app.project_finalize', 'on', true);
    with pending as (
      select t.* from public.tasks t
      where t.project_id = p_project_id
        and t.archived_at is null
        and not public.is_task_delivered(t.status::text, t.review_status::text)
      for update
    ), changed as (
      update public.tasks t
      set archived_at = now(),
          archived_by = auth.uid(),
          archive_reason = 'Proyecto finalizado',
          archived_via = 'proyecto_finalizado'
      from pending p
      where t.id = p.id
      returning t.id, to_jsonb(p) as before, to_jsonb(t) as after
    )
    insert into public.task_audit_log (task_id, actor_id, action, before, after)
    select id, auth.uid(), 'archive', before, after from changed;
    get diagnostics v_count = row_count;
    perform set_config('app.project_finalize', 'off', true);
  else
    v_count := public.purge_finalized_project_tasks(p_project_id);
  end if;

  return v_count;
end;
$$;

revoke all on function public.finalize_project(uuid, text) from public, anon;
grant execute on function public.finalize_project(uuid, text) to authenticated;

-- 4. Reactivar (salir de Finalizado) restaura lo archivado al finalizar.
create or replace function public.trg_projects_reactivate_restore()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status::text = 'completado' and new.status::text is distinct from 'completado' then
    perform set_config('app.project_finalize', 'on', true);
    with archived as (
      select t.* from public.tasks t
      where t.project_id = new.id and t.archived_at is not null and t.archived_via = 'proyecto_finalizado'
      for update
    ), changed as (
      update public.tasks t
      set archived_at = null,
          archived_by = null,
          archive_reason = null,
          archived_via = null
      from archived a
      where t.id = a.id
      returning t.id, to_jsonb(a) as before, to_jsonb(t) as after
    )
    insert into public.task_audit_log (task_id, actor_id, action, before, after)
    select id, auth.uid(), 'restore', before, after from changed;
    perform set_config('app.project_finalize', 'off', true);
  end if;
  return new;
end;
$$;

revoke all on function public.trg_projects_reactivate_restore() from public, anon;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_reactivate_restore' and tgrelid = 'public.projects'::regclass) then
    create trigger projects_reactivate_restore
      after update of status on public.projects
      for each row execute function public.trg_projects_reactivate_restore();
  end if;
end;
$$;

commit;

-- Verificación (una sola consulta). Esperado: todo true y borrado_automatico_apagado = true.
select 'fn_finalize_project' as objeto, exists (select 1 from pg_proc where proname = 'finalize_project' and pronamespace = 'public'::regnamespace)::text as ok
union all select 'columna_archived_via', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'archived_via')::text
union all select 'trigger_tasks_clear_archived_via', exists (select 1 from pg_trigger where tgname = 'tasks_clear_archived_via')::text
union all select 'trigger_projects_reactivate_restore', exists (select 1 from pg_trigger where tgname = 'projects_reactivate_restore')::text
union all select 'borrado_automatico_apagado', (position('purge_finalized_project_tasks' in pg_get_functiondef('public.trg_projects_finalize_delete()'::regprocedure)) = 0)::text;

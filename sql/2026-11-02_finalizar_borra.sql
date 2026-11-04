-- Finalizar un proyecto ELIMINA PARA SIEMPRE sus tareas pendientes.
-- Ejecutar DESPUÉS de revisar sql/2026-11-02_finalizar_borra_00_revision.sql.
-- ⚠ Contiene DELETE: Supabase mostrará su aviso de operación destructiva. Es lo esperado.
--
-- Se conservan: tareas realizadas (status 'completada') y entregadas (review_status
-- 'pendiente_revision', 'pendiente_trafficker', 'en_revision' o 'aprobada' — el mismo criterio
-- de Entregables del cliente). Se eliminan todas las demás del proyecto, archivadas incluidas
-- ('cambios_solicitados' es retrabajo pendiente: se elimina).
--
-- Borrado igual que admin_delete_team_task (la eliminación definitiva de la app):
--   · foto completa (tarea + comentarios, enlaces, subtareas, tiempos, calificaciones) en
--     task_audit_log, acción 'delete';
--   · depends_on_task_id de otras tareas → null; notifications / chat_messages → task_id null;
--   · se borran task_comments, task_links, task_subtasks, task_time_entries, task_ratings y la tarea.
--   project_delay_events.task_id queda en null por su propia llave (on delete set null).
--   Si existiera otra llave hacia tasks sin cascade, el borrado falla y TODO se revierte
--   (incluido el cambio de estado): no queda nada a medias.
--
-- Partes:
--   1. is_task_delivered(): criterio de qué se conserva.
--   2. delete_task_permanently_internal() y purge_finalized_project_tasks(): solo uso interno
--      (sin permiso para usuarios de la app).
--   3. Trigger projects_finalize_delete (AFTER UPDATE OF status): al pasar a 'completado'.
--      Quién puede cambiar el estado lo decide projects_status_super_admin_only (BEFORE).
--   NO es retroactivo: los proyectos que YA están finalizados (p. ej. Mel — PRODUCTO PDF)
--   no se tocan; solo actúa en cambios de estado que ocurran DESPUÉS de correr este archivo.
-- Reactivar un proyecto NO recupera lo eliminado (queda solo la foto en task_audit_log).
begin;

-- 1. Criterio: ¿la tarea se conserva al finalizar?
create or replace function public.is_task_delivered(p_status text, p_review_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, '') = 'completada'
      or coalesce(p_review_status, '') in ('pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada');
$$;

grant execute on function public.is_task_delivered(text, text) to authenticated;

-- 2a. Eliminación definitiva de UNA tarea (copia de admin_delete_team_task sin sus candados
--     de admin/archivada, porque la llama el trigger también desde el editor SQL).
create or replace function public.delete_task_permanently_internal(p_task_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_snapshot jsonb;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    return;
  end if;

  select to_jsonb(v_task) || jsonb_build_object(
    'deleted_reason', p_reason,
    'comments', (select coalesce(jsonb_agg(c), '[]'::jsonb) from public.task_comments c where c.task_id = p_task_id),
    'links', (select coalesce(jsonb_agg(l), '[]'::jsonb) from public.task_links l where l.task_id = p_task_id),
    'subtasks', (select coalesce(jsonb_agg(s), '[]'::jsonb) from public.task_subtasks s where s.task_id = p_task_id),
    'time_entries', (select coalesce(jsonb_agg(te), '[]'::jsonb) from public.task_time_entries te where te.task_id = p_task_id),
    'ratings', (select coalesce(jsonb_agg(r), '[]'::jsonb) from public.task_ratings r where r.task_id = p_task_id)
  ) into v_snapshot;

  insert into public.task_audit_log (task_id, actor_id, action, before, after)
  values (p_task_id, auth.uid(), 'delete', v_snapshot, null);

  update public.tasks set depends_on_task_id = null where depends_on_task_id = p_task_id;
  update public.notifications set task_id = null where task_id = p_task_id;
  update public.chat_messages set task_id = null where task_id = p_task_id;

  delete from public.task_comments where task_id = p_task_id;
  delete from public.task_links where task_id = p_task_id;
  delete from public.task_subtasks where task_id = p_task_id;
  delete from public.task_time_entries where task_id = p_task_id;
  delete from public.task_ratings where task_id = p_task_id;
  delete from public.tasks where id = p_task_id;
end;
$$;

revoke all on function public.delete_task_permanently_internal(uuid, text) from public, anon, authenticated;

-- 2b. Todas las pendientes (no entregadas) de un proyecto. Devuelve cuántas eliminó.
create or replace function public.purge_finalized_project_tasks(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select t.id from public.tasks t
    where t.project_id = p_project_id
      and not public.is_task_delivered(t.status::text, t.review_status::text)
    order by t.id
    for update
  loop
    perform public.delete_task_permanently_internal(v_id, 'proyecto_finalizado');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.purge_finalized_project_tasks(uuid) from public, anon, authenticated;

-- 3. Trigger: al pasar a Finalizado ('completado').
create or replace function public.trg_projects_finalize_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo la transición hacia Finalizado (de aquí en adelante).
  if old.status::text is distinct from 'completado' and new.status::text = 'completado' then
    perform public.purge_finalized_project_tasks(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.trg_projects_finalize_delete() from public, anon;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_finalize_delete' and tgrelid = 'public.projects'::regclass) then
    create trigger projects_finalize_delete
      after update of status on public.projects
      for each row execute function public.trg_projects_finalize_delete();
  end if;
end;
$$;

commit;

-- Verificación (una sola consulta). Esperado: trigger y funciones = true; borradas_por_finalizar = 0
-- (nada se borra al correr este archivo; solo en futuros cambios a Finalizado).
select 'trigger_projects_finalize_delete' as objeto, exists (select 1 from pg_trigger where tgname = 'projects_finalize_delete')::text as ok
union all select 'fn_purge_finalized_project_tasks', exists (select 1 from pg_proc where proname = 'purge_finalized_project_tasks' and pronamespace = 'public'::regnamespace)::text
union all select 'fn_delete_task_permanently_internal', exists (select 1 from pg_proc where proname = 'delete_task_permanently_internal' and pronamespace = 'public'::regnamespace)::text
union all select 'borradas_por_finalizar_en_auditoria', (
  select count(*) from public.task_audit_log where action = 'delete' and before->>'deleted_reason' = 'proyecto_finalizado')::text;

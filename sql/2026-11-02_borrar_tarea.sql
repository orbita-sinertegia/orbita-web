-- Eliminar una tarea para siempre desde la tabla de tareas (botón de bote de basura).
-- Solo el super admin. Funciona con tareas archivadas o no.
-- Ejecutar DESPUÉS de revisar sql/2026-11-02_borrar_tarea_00_revision.sql. Idempotente.
-- No elimina nada al correrlo: solo crea la función. No contiene sentencias destructivas; el
-- borrado real lo hace delete_task_permanently_internal (ya instalada con finalizar_borra):
-- foto completa de la tarea (comentarios, enlaces, subtareas, tiempos, calificaciones) en
-- task_audit_log, dependencias / notificaciones / mensajes a null, y luego la tarea.
begin;

create or replace function public.super_admin_delete_task(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_super_admin() then
    raise exception 'Solo el super admin puede eliminar tareas para siempre';
  end if;
  if not exists (select 1 from public.tasks where id = p_task_id) then
    raise exception 'La tarea no existe';
  end if;

  perform public.delete_task_permanently_internal(p_task_id, 'eliminada_por_super_admin');

  if exists (select 1 from public.tasks where id = p_task_id) then
    raise exception 'No se pudo eliminar la tarea';
  end if;
  return p_task_id;
end;
$$;

revoke all on function public.super_admin_delete_task(uuid) from public, anon;
grant execute on function public.super_admin_delete_task(uuid) to authenticated;

commit;

-- Verificación (una sola consulta). Esperado: true en ambas.
select 'fn_super_admin_delete_task' as objeto, exists (select 1 from pg_proc where proname = 'super_admin_delete_task' and pronamespace = 'public'::regnamespace)::text as ok
union all select 'fn_delete_task_permanently_internal', exists (select 1 from pg_proc where proname = 'delete_task_permanently_internal' and pronamespace = 'public'::regnamespace)::text;

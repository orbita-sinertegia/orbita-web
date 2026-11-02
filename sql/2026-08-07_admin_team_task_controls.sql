-- Controles directos de tareas para administradores.
-- Ejecutar este archivo en el SQL Editor de Supabase.

create or replace function public.admin_complete_team_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and coalesce(active, true)
  ) then
    raise exception 'Solo los administradores pueden completar tareas del equipo';
  end if;

  update public.tasks
  set status = 'completada', completion_date = current_date, updated_at = now()
  where id = p_task_id;

  if not found then raise exception 'La tarea no existe'; end if;
end;
$$;

create or replace function public.admin_delete_team_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and coalesce(active, true)
  ) then
    raise exception 'Solo los administradores pueden eliminar tareas del equipo';
  end if;

  -- Evita que una tarea dependiente bloquee la eliminación.
  update public.tasks set depends_on_task_id = null where depends_on_task_id = p_task_id;

  -- Conserva notificaciones y mensajes histÃ³ricos, pero quita su vÃ­nculo a la tarea.
  update public.notifications set task_id = null where task_id = p_task_id;
  update public.chat_messages set task_id = null where task_id = p_task_id;

  -- El contenido propio de la tarea sÃ­ se elimina junto con ella.
  delete from public.task_comments where task_id = p_task_id;
  delete from public.task_links where task_id = p_task_id;
  delete from public.task_subtasks where task_id = p_task_id;
  delete from public.task_time_entries where task_id = p_task_id;
  delete from public.task_ratings where task_id = p_task_id;
  delete from public.tasks where id = p_task_id;

  if not found then raise exception 'La tarea no existe'; end if;
end;
$$;

revoke all on function public.admin_complete_team_task(uuid) from public;
revoke all on function public.admin_delete_team_task(uuid) from public;
grant execute on function public.admin_complete_team_task(uuid) to authenticated;
grant execute on function public.admin_delete_team_task(uuid) to authenticated;

-- Run after 2026-08-07_admin_team_task_controls.sql.
-- Defines the operation; this migration does NOT delete any existing project.
begin;

create or replace function public.admin_delete_project(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_to_delete uuid;
begin
  if not exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and coalesce(active, true)
  ) then
    raise exception 'Solo los administradores activos pueden eliminar proyectos';
  end if;

  -- Lock the parent so concurrent task inserts cannot escape the deletion.
  perform id from public.projects where id = p_project_id for update;
  if not found then raise exception 'El proyecto no existe'; end if;

  -- All operations run in the same transaction. Any failure rolls everything back.
  for task_to_delete in
    select id from public.tasks where project_id = p_project_id order by id for update
  loop
    perform public.admin_delete_team_task(task_to_delete);
  end loop;

  -- Preserve request history and the client, without a dangling project link.
  update public.task_requests set project_id = null where project_id = p_project_id;
  delete from public.projects where id = p_project_id;
  return p_project_id;
end;
$$;

revoke all on function public.admin_delete_project(uuid) from public;
grant execute on function public.admin_delete_project(uuid) to authenticated;

commit;

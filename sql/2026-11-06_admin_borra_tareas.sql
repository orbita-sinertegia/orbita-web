-- Borrar una tarea definitivamente: cualquier administrador activo, incluido el super admin.
-- El equipo y los clientes no pueden. Correr completo en el SQL Editor de Supabase.
-- No borra nada al correrlo. Si una prueba falla, no se aplica ningún cambio.
begin;

create or replace function public.super_admin_delete_task(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Solo un administrador puede borrar tareas definitivamente';
  end if;
  if not exists (select 1 from public.tasks where id = p_task_id) then
    raise exception 'La tarea no existe';
  end if;

  perform public.delete_task_permanently_internal(p_task_id, 'eliminada_por_admin');

  if exists (select 1 from public.tasks where id = p_task_id) then
    raise exception 'No se pudo eliminar la tarea';
  end if;
  return p_task_id;
end;
$$;

revoke all on function public.super_admin_delete_task(uuid) from public, anon;
grant execute on function public.super_admin_delete_task(uuid) to authenticated;

-- Pruebas con una tarea inexistente: el admin pasa el permiso; quien no es admin, no.
do $$
declare
  admin_id uuid;
  no_admin_id uuid;
  mensaje text;
begin
  select id into admin_id from public.users
  where (role = 'admin' or is_super_admin = true) and coalesce(active, true) limit 1;
  if admin_id is null then raise exception 'PRUEBA FALLIDA: no hay administrador activo'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  begin
    perform public.super_admin_delete_task('00000000-0000-0000-0000-000000000000');
    raise exception 'PRUEBA FALLIDA: se aceptó una tarea inexistente';
  exception when raise_exception then
    get stacked diagnostics mensaje = message_text;
    if mensaje <> 'La tarea no existe' then raise exception 'PRUEBA FALLIDA: el admin recibió "%"', mensaje; end if;
  end;

  select id into no_admin_id from public.users
  where role <> 'admin' and coalesce(is_super_admin, false) = false limit 1;
  if no_admin_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', no_admin_id, 'role', 'authenticated')::text, true);
    begin
      perform public.super_admin_delete_task('00000000-0000-0000-0000-000000000000');
      raise exception 'PRUEBA FALLIDA: alguien sin permiso pasó';
    exception when raise_exception then
      get stacked diagnostics mensaje = message_text;
      if mensaje <> 'Solo un administrador puede borrar tareas definitivamente' then raise exception 'PRUEBA FALLIDA: sin permiso recibió "%"', mensaje; end if;
    end;
  end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

commit;

select 'Listo: los administradores ya pueden borrar tareas' as resultado;

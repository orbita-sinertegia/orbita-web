-- Embudos: permite eliminar un embudo y retirar las tareas que creó en los proyectos.
-- Correr completo en el SQL Editor de Supabase. Se puede correr más de una vez.
--
-- Al copiar la estructura no llegaron las columnas que ligan proyectos y tareas con su embudo,
-- ni la función admin_remove_template_tasks; por eso "Eliminar embudo" fallaba.
begin;

alter table public.projects add column if not exists source_template_id text;
alter table public.tasks
  add column if not exists source_template_id text,
  add column if not exists source_template_key text;

create index if not exists projects_source_template_idx on public.projects (source_template_id);
create index if not exists tasks_source_template_idx on public.tasks (source_template_id, source_template_key);

-- Borra de los proyectos las tareas que un embudo creó (por clave departamento:título).
create or replace function public.admin_remove_template_tasks(p_template_id text, p_task_keys text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  tarea uuid;
  borradas integer := 0;
begin
  if not public.is_active_admin() then
    raise exception 'Solo los administradores pueden actualizar tareas de plantilla';
  end if;
  if coalesce(array_length(p_task_keys, 1), 0) = 0 then return 0; end if;

  for tarea in
    select id from public.tasks
    where source_template_id = p_template_id and source_template_key = any(p_task_keys)
  loop
    perform public.delete_task_permanently_internal(tarea, 'embudo_eliminado');
    borradas := borradas + 1;
  end loop;
  return borradas;
end;
$$;

revoke all on function public.admin_remove_template_tasks(text, text[]) from public, anon;
grant execute on function public.admin_remove_template_tasks(text, text[]) to authenticated;

-- Prueba: sin tareas que coincidan no borra nada.
do $$
declare
  admin_id uuid;
begin
  select id into admin_id from public.users where (role = 'admin' or is_super_admin) and coalesce(active, true) limit 1;
  if admin_id is null then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if public.admin_remove_template_tasks('embudo-que-no-existe', array['x:y']) <> 0 then
    raise exception 'PRUEBA FALLIDA: borró tareas que no eran del embudo';
  end if;
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

select 'Listo: embudos' as resultado;

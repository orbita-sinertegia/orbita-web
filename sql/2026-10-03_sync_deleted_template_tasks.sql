-- Vincula cada proyecto y tarea con la plantilla que los originó y permite
-- retirar de los proyectos las tareas eliminadas de un embudo.

alter table public.projects
  add column if not exists source_template_id text;

alter table public.tasks
  add column if not exists source_template_id text,
  add column if not exists source_template_key text;

create index if not exists projects_source_template_idx
  on public.projects (source_template_id);

create index if not exists tasks_source_template_idx
  on public.tasks (source_template_id, source_template_key);

-- Reconoce proyectos anteriores por la plantilla con mayor número de tareas
-- coincidentes. Solo etiqueta proyectos con al menos una coincidencia.
with candidates as (
  select
    p.id as project_id,
    tt.template_id,
    count(*) as matches,
    row_number() over (
      partition by p.id
      order by count(*) desc, tt.template_id
    ) as position
  from public.projects p
  join public.tasks t on t.project_id = p.id
  join public.template_tasks tt
    on lower(trim(tt.title)) = lower(trim(t.title))
   and tt.department = t.department
  where p.source_template_id is null
  group by p.id, tt.template_id
)
update public.projects p
set source_template_id = candidates.template_id
from candidates
where candidates.project_id = p.id
  and candidates.position = 1;

update public.tasks t
set
  source_template_id = p.source_template_id,
  source_template_key = lower(trim(t.department::text)) || ':' || lower(trim(t.title))
from public.projects p
where p.id = t.project_id
  and p.source_template_id is not null
  and t.source_template_id is null
  and exists (
    select 1
    from public.template_tasks tt
    where tt.template_id = p.source_template_id
      and lower(trim(tt.title)) = lower(trim(t.title))
      and tt.department = t.department
  );

create or replace function public.admin_remove_template_tasks(
  p_template_id text,
  p_task_keys text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  task_to_delete uuid;
  deleted_count integer := 0;
begin
  if not exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and coalesce(active, true)
  ) then
    raise exception 'Solo los administradores pueden actualizar tareas de plantilla';
  end if;

  if coalesce(array_length(p_task_keys, 1), 0) = 0 then
    return 0;
  end if;

  for task_to_delete in
    select id from public.tasks
    where source_template_id = p_template_id
      and source_template_key = any(p_task_keys)
  loop
    perform public.admin_delete_team_task(task_to_delete);
    deleted_count := deleted_count + 1;
  end loop;

  return deleted_count;
end;
$$;

revoke all on function public.admin_remove_template_tasks(text, text[]) from public;
grant execute on function public.admin_remove_template_tasks(text, text[]) to authenticated;

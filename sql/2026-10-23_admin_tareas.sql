-- Editar y archivar tareas (administradores). Ejecutar DESPUÉS de revisar
-- sql/2026-10-23_admin_tareas_00_revision.sql. Idempotente: se puede correr más de una
-- vez sin error. No borra datos existentes. ORDEN DE DESPLIEGUE: primero este archivo,
-- después el merge del PR (el front ya asume que archived_at existe).
begin;

-- 1. Columnas de archivado en tasks + índices para las listas que ya filtran por
-- responsable/proyecto (la mayoría de las pantallas activas excluyen archivadas).
alter table public.tasks
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists tasks_assigned_to_active_idx
  on public.tasks(assigned_to) where archived_at is null;

create index if not exists tasks_project_id_active_idx
  on public.tasks(project_id) where archived_at is null;

-- 2. Historial de auditoría de tareas. task_id SIN foreign key a propósito: debe
-- sobrevivir al borrado definitivo (admin_delete_team_task) para conservar el rastro de
-- qué se eliminó. Solo lo escriben las funciones security definer de abajo; nadie
-- inserta/edita/borra directo desde la API.
create table if not exists public.task_audit_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  actor_id uuid,
  at timestamptz not null default now(),
  action text not null check (action in ('update', 'archive', 'restore', 'delete')),
  before jsonb,
  after jsonb
);

create index if not exists task_audit_log_task_id_at_idx
  on public.task_audit_log(task_id, at desc);

alter table public.task_audit_log enable row level security;

drop policy if exists "Admins ven la auditoría de tareas" on public.task_audit_log;
create policy "Admins ven la auditoría de tareas"
  on public.task_audit_log for select
  to authenticated
  using (public.is_active_admin());

revoke all on public.task_audit_log from anon;
revoke insert, update, delete on public.task_audit_log from authenticated;
grant select on public.task_audit_log to authenticated;

-- 3. Editar una tarea: lista blanca de campos, auditoría y avisos al responsable.
create or replace function public.admin_update_task(p_task_id uuid, p_changes jsonb)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.tasks%rowtype;
  v_row public.tasks%rowtype;
  v_new public.tasks%rowtype;
  v_key text;
  v_allowed text[] := array[
    'title', 'description', 'assigned_to', 'department', 'priority', 'phase',
    'start_date', 'needed_date', 'commitment_date', 'approver_ids',
    'depends_on_task_id', 'project_id'
  ];
  v_new_assignee_name text;
  v_old_assignee_name text;
  v_other_fields_changed boolean;
begin
  if not public.is_active_admin() then
    raise exception 'Solo los administradores pueden editar tareas';
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'Campo no permitido: %', v_key;
    end if;
  end loop;

  select * into v_old from public.tasks where id = p_task_id for update;
  if v_old.id is null then
    raise exception 'La tarea no existe';
  end if;
  if v_old.archived_at is not null then
    raise exception 'No se puede editar una tarea archivada; restáurala primero';
  end if;

  if p_changes ? 'title' and coalesce(trim(p_changes->>'title'), '') = '' then
    raise exception 'El título no puede estar vacío';
  end if;

  if p_changes ? 'depends_on_task_id' and (p_changes->>'depends_on_task_id') is not null then
    if (p_changes->>'depends_on_task_id')::uuid = p_task_id then
      raise exception 'Una tarea no puede depender de sí misma';
    end if;
    if exists (
      select 1 from public.tasks d
      where d.id = (p_changes->>'depends_on_task_id')::uuid
        and d.depends_on_task_id = p_task_id
    ) then
      raise exception 'Dependencia circular: esa tarea ya depende de esta';
    end if;
  end if;

  -- jsonb_populate_record aplica SOLO las llaves presentes (una llave con null sí
  -- limpia el campo) y convierte cada valor al tipo real de la columna (text, enum,
  -- date, uuid, uuid[]), sin depender de cómo se crearon las columnas en Supabase.
  v_new := jsonb_populate_record(v_old, coalesce(p_changes, '{}'::jsonb));

  update public.tasks set
    title = trim(v_new.title),
    description = v_new.description,
    assigned_to = v_new.assigned_to,
    department = v_new.department,
    priority = v_new.priority,
    phase = v_new.phase,
    start_date = v_new.start_date,
    needed_date = v_new.needed_date,
    commitment_date = v_new.commitment_date,
    approver_ids = coalesce(v_new.approver_ids, '{}'::uuid[]),
    -- approver_id (columna vieja, de un solo revisor) se mantiene igual al primero.
    approver_id = case when p_changes ? 'approver_ids' then (coalesce(v_new.approver_ids, '{}'::uuid[]))[1] else approver_id end,
    depends_on_task_id = v_new.depends_on_task_id,
    project_id = v_new.project_id,
    updated_at = now()
  where id = p_task_id
  returning * into v_row;

  insert into public.task_audit_log (task_id, actor_id, action, before, after)
  values (p_task_id, auth.uid(), 'update', to_jsonb(v_old), to_jsonb(v_row));

  v_other_fields_changed := (to_jsonb(v_old) - 'assigned_to' - 'updated_at')
    is distinct from (to_jsonb(v_row) - 'assigned_to' - 'updated_at');

  if v_row.assigned_to is distinct from v_old.assigned_to then
    if v_row.assigned_to is not null then
      select full_name into v_new_assignee_name from public.users where id = v_row.assigned_to;
      if v_row.assigned_to <> auth.uid() then
        insert into public.notifications (user_id, title, message, type, task_id)
        values (v_row.assigned_to, '📋 Nueva misión asignada', 'Se te asignó la misión "' || v_row.title || '".', 'task', v_row.id);
      end if;
    end if;
    if v_old.assigned_to is not null and v_old.assigned_to <> auth.uid() then
      insert into public.notifications (user_id, title, message, type, task_id)
      values (v_old.assigned_to, 'Misión reasignada', 'La misión "' || v_row.title || '" se reasignó a ' || coalesce(v_new_assignee_name, 'otra persona') || '.', 'task', v_row.id);
    end if;
  elsif v_other_fields_changed and v_row.assigned_to is not null and v_row.assigned_to <> auth.uid() then
    insert into public.notifications (user_id, title, message, type, task_id)
    values (v_row.assigned_to, '✏️ Misión actualizada', 'Un administrador actualizó la misión "' || v_row.title || '".', 'task', v_row.id);
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_update_task(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_task(uuid, jsonb) to authenticated;

-- 4. Archivar / restaurar ("eliminar" recuperable). El borrado definitivo sigue siendo
-- admin_delete_team_task, pero ahora solo opera sobre tareas ya archivadas.
create or replace function public.admin_archive_task(p_task_id uuid, p_reason text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.tasks%rowtype;
  v_row public.tasks%rowtype;
begin
  if not public.is_active_admin() then
    raise exception 'Solo los administradores pueden archivar tareas';
  end if;

  select * into v_old from public.tasks where id = p_task_id for update;
  if v_old.id is null then
    raise exception 'La tarea no existe';
  end if;
  if v_old.archived_at is not null then
    raise exception 'La tarea ya está archivada';
  end if;

  update public.tasks
  set archived_at = now(), archived_by = auth.uid(), archive_reason = nullif(trim(p_reason), '')
  where id = p_task_id
  returning * into v_row;

  insert into public.task_audit_log (task_id, actor_id, action, before, after)
  values (p_task_id, auth.uid(), 'archive', to_jsonb(v_old), to_jsonb(v_row));

  if v_row.assigned_to is not null and v_row.assigned_to <> auth.uid() then
    insert into public.notifications (user_id, title, message, type, task_id)
    values (v_row.assigned_to, '🗄️ Misión archivada', 'La misión "' || v_row.title || '" fue archivada por un administrador.', 'task', v_row.id);
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_archive_task(uuid, text) from public, anon;
grant execute on function public.admin_archive_task(uuid, text) to authenticated;

create or replace function public.admin_restore_task(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.tasks%rowtype;
  v_row public.tasks%rowtype;
begin
  if not public.is_active_admin() then
    raise exception 'Solo los administradores pueden restaurar tareas';
  end if;

  select * into v_old from public.tasks where id = p_task_id for update;
  if v_old.id is null then
    raise exception 'La tarea no existe';
  end if;
  if v_old.archived_at is null then
    raise exception 'La tarea no está archivada';
  end if;

  update public.tasks
  set archived_at = null, archived_by = null, archive_reason = null
  where id = p_task_id
  returning * into v_row;

  insert into public.task_audit_log (task_id, actor_id, action, before, after)
  values (p_task_id, auth.uid(), 'restore', to_jsonb(v_old), to_jsonb(v_row));

  if v_row.assigned_to is not null and v_row.assigned_to <> auth.uid() then
    insert into public.notifications (user_id, title, message, type, task_id)
    values (v_row.assigned_to, '✅ Misión restaurada', 'La misión "' || v_row.title || '" fue restaurada y vuelve a estar activa.', 'task', v_row.id);
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_restore_task(uuid) from public, anon;
grant execute on function public.admin_restore_task(uuid) to authenticated;

-- 5. Borrado definitivo: reescribe admin_delete_team_task (sql/2026-08-07_...) para usar
-- is_active_admin() (antes solo miraba role='admin', dejando fuera a is_super_admin) y
-- exigir que la tarea esté archivada primero. Guarda una foto completa (tarea + sus
-- comentarios, links, subtareas, tiempos y calificaciones) en task_audit_log ANTES de
-- borrar, para que el rastro sobreviva aunque el contenido desaparezca.
create or replace function public.admin_delete_team_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_snapshot jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Solo los administradores pueden eliminar tareas del equipo';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'La tarea no existe';
  end if;
  if v_task.archived_at is null then
    raise exception 'Solo se pueden eliminar definitivamente tareas archivadas';
  end if;

  select to_jsonb(v_task) || jsonb_build_object(
    'comments', (select coalesce(jsonb_agg(c), '[]'::jsonb) from public.task_comments c where c.task_id = p_task_id),
    'links', (select coalesce(jsonb_agg(l), '[]'::jsonb) from public.task_links l where l.task_id = p_task_id),
    'subtasks', (select coalesce(jsonb_agg(s), '[]'::jsonb) from public.task_subtasks s where s.task_id = p_task_id),
    'time_entries', (select coalesce(jsonb_agg(te), '[]'::jsonb) from public.task_time_entries te where te.task_id = p_task_id),
    'ratings', (select coalesce(jsonb_agg(r), '[]'::jsonb) from public.task_ratings r where r.task_id = p_task_id)
  ) into v_snapshot;

  insert into public.task_audit_log (task_id, actor_id, action, before, after)
  values (p_task_id, auth.uid(), 'delete', v_snapshot, null);

  -- Evita que una tarea dependiente bloquee la eliminación.
  update public.tasks set depends_on_task_id = null where depends_on_task_id = p_task_id;

  -- Conserva notificaciones y mensajes históricos, pero quita su vínculo a la tarea.
  update public.notifications set task_id = null where task_id = p_task_id;
  update public.chat_messages set task_id = null where task_id = p_task_id;

  -- El contenido propio de la tarea sí se elimina junto con ella.
  delete from public.task_comments where task_id = p_task_id;
  delete from public.task_links where task_id = p_task_id;
  delete from public.task_subtasks where task_id = p_task_id;
  delete from public.task_time_entries where task_id = p_task_id;
  delete from public.task_ratings where task_id = p_task_id;
  delete from public.tasks where id = p_task_id;
end;
$$;

revoke all on function public.admin_delete_team_task(uuid) from public, anon;
grant execute on function public.admin_delete_team_task(uuid) to authenticated;

-- 6. Funciones existentes que leen tasks directamente (jobs de pg_cron, sin UI de por
-- medio) y deben dejar de considerar tareas archivadas. Se copian íntegras desde su
-- archivo original, agregando solo "and t.archived_at is null" (y en client_complete_task,
-- un candado explícito).

-- Copiado de sql/2026-07-15_subtareas_tiempo_dependencias_recordatorios.sql.
create or replace function public.notify_upcoming_deadlines()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, title, message, type, task_id)
  select
    t.assigned_to,
    '⏰ Fecha de entrega próxima',
    'La tarea "' || t.title || '" vence el ' || to_char(t.commitment_date, 'DD/MM/YYYY') || '.',
    'deadline',
    t.id
  from tasks t
  where t.status <> 'completada'
    and t.archived_at is null
    and t.commitment_date is not null
    and t.commitment_date between current_date and current_date + interval '2 days'
    and t.assigned_to is not null
    and not exists (
      select 1 from notifications n
      where n.task_id = t.id
        and n.type = 'deadline'
        and n.created_at > now() - interval '20 hours'
    );
end;
$$;

-- Copiado de sql/2026-10-22_modalidad_y_retrasos_cliente.sql (sección 6).
create or replace function public.mark_client_delays()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with marked as (
    update public.tasks t
    set delay_responsible = 'cliente',
        delay_days = current_date - t.commitment_date,
        delay_marked_at = now()
    where t.department = 'cliente'
      and t.status <> 'completada'
      and t.archived_at is null
      and t.commitment_date < current_date
      and t.delay_responsible is null
    returning t.id, t.project_id, t.delay_days
  )
  insert into public.project_delay_events (project_id, task_id, responsible, days, reason)
  select project_id, id, 'cliente', delay_days, 'Tarea del cliente vencida' from marked;

  with marked as (
    update public.tasks t
    set delay_responsible = 'agencia',
        delay_days = current_date - t.commitment_date,
        delay_marked_at = now()
    where t.department = 'grabacion'
      and t.status <> 'completada'
      and t.archived_at is null
      and t.commitment_date < current_date
      and t.delay_responsible is null
    returning t.id, t.project_id, t.delay_days
  )
  insert into public.project_delay_events (project_id, task_id, responsible, days, reason)
  select project_id, id, 'agencia', delay_days, 'Tarea de Grabación vencida sin marca de inasistencia' from marked;

  with marked as (
    update public.tasks t
    set delay_responsible = 'cliente',
        delay_days = current_date - t.commitment_date,
        delay_marked_at = now()
    from public.tasks dep
    where t.depends_on_task_id = dep.id
      and dep.delay_responsible = 'cliente'
      and t.status <> 'completada'
      and t.archived_at is null
      and t.commitment_date < current_date
      and t.delay_responsible is null
    returning t.id, t.project_id, t.delay_days
  )
  insert into public.project_delay_events (project_id, task_id, responsible, days, reason)
  select project_id, id, 'cliente', delay_days, 'Hereda el retraso de la tarea de la que depende' from marked;
end;
$$;

-- Copiado de sql/2026-10-22_modalidad_y_retrasos_cliente.sql (sección 8).
create or replace function public.notify_overdue_client_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, message, type, task_id)
  select
    t.assigned_to,
    '⚠️ Tarea vencida',
    'La tarea "' || t.title || '" venció el ' || to_char(t.commitment_date, 'DD/MM/YYYY') || ' y sigue sin completarse.',
    'client_delay',
    t.id
  from public.tasks t
  where t.department = 'cliente'
    and t.status <> 'completada'
    and t.archived_at is null
    and t.commitment_date < current_date
    and not exists (
      select 1 from public.notifications n
      where n.task_id = t.id and n.type = 'client_delay' and n.created_at > now() - interval '20 hours'
    );
end;
$$;

-- Copiado de sql/2026-10-22_modalidad_y_retrasos_cliente.sql (sección 5): una tarea
-- archivada ya no es "activa" para nadie, así que el cliente tampoco debe poder marcarla
-- como entregada.
create or replace function public.client_complete_task(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.tasks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into task_row from public.tasks where id = p_task_id for update;
  if task_row.id is null then
    raise exception 'La tarea no existe';
  end if;
  if task_row.archived_at is not null then
    raise exception 'Esta tarea fue archivada y ya no se puede modificar';
  end if;
  if task_row.department <> 'cliente' or task_row.assigned_to is distinct from auth.uid() then
    raise exception 'Solo puedes completar tus propias tareas';
  end if;

  update public.tasks
  set status = 'completada', completion_date = current_date
  where id = p_task_id;

  if task_row.created_by is not null and task_row.created_by <> auth.uid() then
    insert into public.notifications (user_id, title, message, type, task_id)
    values (
      task_row.created_by,
      '✅ El cliente entregó su tarea',
      '"' || task_row.title || '" fue marcada como entregada por el cliente.',
      'client_delay',
      task_row.id
    );
  end if;

  return p_task_id;
end;
$$;

revoke all on function public.client_complete_task(uuid) from public, anon;
grant execute on function public.client_complete_task(uuid) to authenticated;

commit;

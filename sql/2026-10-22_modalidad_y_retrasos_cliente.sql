-- NO EJECUTAR sin revisión de Tony.
-- Requiere correr PRIMERO (y revisar) sql/2026-10-22_reasignar_tareas_cliente.sql,
-- porque el trigger de la sección 4 rechaza cualquier escritura de una tarea de depto
-- "cliente" que no quede asignada al usuario cliente del proyecto — si queda una tarea
-- vieja mal asignada, cualquier UPDATE posterior sobre ella (incluso de otro campo)
-- fallaría hasta corregirla.
begin;

-- 1. Modalidad de grabación y fechas de lanzamiento por proyecto.
-- Los proyectos existentes quedan en 'oficina' (default) y sin tocar sus tareas.
alter table public.projects
  add column if not exists recording_mode text not null default 'oficina',
  add column if not exists launch_date date,
  add column if not exists launch_date_original date;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_recording_mode_check'
  ) then
    alter table public.projects
      add constraint projects_recording_mode_check check (recording_mode in ('oficina', 'remota'));
  end if;
end $$;

-- 2. Retraso atribuible a una tarea: quién es responsable, cuántos días, por qué y quién lo marcó.
alter table public.tasks
  add column if not exists delay_responsible text,
  add column if not exists delay_days int,
  add column if not exists delay_reason text,
  add column if not exists delay_marked_at timestamptz,
  add column if not exists delay_marked_by uuid references public.users(id);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_delay_responsible_check'
  ) then
    alter table public.tasks
      add constraint tasks_delay_responsible_check check (delay_responsible in ('cliente', 'agencia'));
  end if;
end $$;

-- 3. Historial de eventos de retraso — tabla de solo inserción (append-only).
-- No se agregan políticas de update/delete: nadie puede editarla desde la app
-- (ni siquiera el superadmin), que es la forma más conservadora de cumplir
-- "el superadmin es el único que edita" sin abrir un canal de edición nuevo.
create table if not exists public.project_delay_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  responsible text not null check (responsible in ('cliente', 'agencia')),
  days int,
  reason text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.project_delay_events enable row level security;

drop policy if exists "Equipo ve los retrasos de sus proyectos" on public.project_delay_events;
create policy "Equipo ve los retrasos de sus proyectos"
  on public.project_delay_events for select
  to authenticated
  using (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin', 'team'))
    or exists (
      select 1 from public.projects p
      join public.clients c on c.id = p.client_id
      where p.id = project_delay_events.project_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Admins registran eventos de retraso" on public.project_delay_events;
create policy "Admins registran eventos de retraso"
  on public.project_delay_events for insert
  to authenticated
  with check (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin' and coalesce(active, true))
  );

-- 4. Las tareas del departamento "cliente" siempre son del usuario cliente del proyecto.
-- Se activa después de corregir los datos viejos con el script de reasignación.
create or replace function public.enforce_client_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_user uuid;
begin
  if new.department <> 'cliente' then
    return new;
  end if;

  select c.user_id into expected_user
  from public.projects p
  join public.clients c on c.id = p.client_id
  where p.id = new.project_id;

  if expected_user is null then
    raise exception 'El cliente de este proyecto todavía no tiene usuario; invítalo antes de crear o mover tareas de su departamento.';
  end if;

  if new.assigned_to is distinct from expected_user then
    raise exception 'Las tareas del departamento cliente solo pueden asignarse al usuario cliente del proyecto.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_client_task_assignment on public.tasks;
create trigger enforce_client_task_assignment
  before insert or update of department, assigned_to, project_id on public.tasks
  for each row execute function public.enforce_client_task_assignment();

-- 5. El cliente marca sus propias tareas como entregadas (no puede tocar las de nadie más).
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

revoke all on function public.client_complete_task(uuid) from public;
grant execute on function public.client_complete_task(uuid) to authenticated;

-- 6. Marcado diario de retrasos atribuibles al cliente (pg_cron).
-- Deja explícito 'agencia' en Grabación vencida sin marca previa, para que quede en el
-- historial — el scorecard del equipo ya trata "sin marca" como agencia por default.
create or replace function public.mark_client_delays()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- a) Tareas del cliente vencidas sin marca → responsabilidad del cliente.
  with marked as (
    update public.tasks t
    set delay_responsible = 'cliente',
        delay_days = current_date - t.commitment_date,
        delay_marked_at = now()
    where t.department = 'cliente'
      and t.status <> 'completada'
      and t.commitment_date < current_date
      and t.delay_responsible is null
    returning t.id, t.project_id, t.delay_days
  )
  insert into public.project_delay_events (project_id, task_id, responsible, days, reason)
  select project_id, id, 'cliente', delay_days, 'Tarea del cliente vencida' from marked;

  -- b) Tareas de Grabación vencidas sin marca → responsabilidad explícita de la agencia.
  with marked as (
    update public.tasks t
    set delay_responsible = 'agencia',
        delay_days = current_date - t.commitment_date,
        delay_marked_at = now()
    where t.department = 'grabacion'
      and t.status <> 'completada'
      and t.commitment_date < current_date
      and t.delay_responsible is null
    returning t.id, t.project_id, t.delay_days
  )
  insert into public.project_delay_events (project_id, task_id, responsible, days, reason)
  select project_id, id, 'agencia', delay_days, 'Tarea de Grabación vencida sin marca de inasistencia' from marked;

  -- c) Tareas del equipo vencidas que dependen de una tarea del cliente ya marcada 'cliente'.
  with marked as (
    update public.tasks t
    set delay_responsible = 'cliente',
        delay_days = current_date - t.commitment_date,
        delay_marked_at = now()
    from public.tasks dep
    where t.depends_on_task_id = dep.id
      and dep.delay_responsible = 'cliente'
      and t.status <> 'completada'
      and t.commitment_date < current_date
      and t.delay_responsible is null
    returning t.id, t.project_id, t.delay_days
  )
  insert into public.project_delay_events (project_id, task_id, responsible, days, reason)
  select project_id, id, 'cliente', delay_days, 'Hereda el retraso de la tarea de la que depende' from marked;
end;
$$;

select cron.schedule(
  'mark-client-delays-daily',
  '10 14 * * *', -- ~8:10am Ciudad de México (UTC-6)
  $$select mark_client_delays()$$
);

-- 7. Nuevo tipo de notificación para los avisos de retraso/entrega del cliente.
-- No encontramos la definición original de "notifications_type_check" en sql/*.sql
-- (se creó directo en Supabase); esta lista es la unión de los tipos detectados por
-- grep en el código + 'client_delay'. Si la base real tiene más valores, revisa antes
-- de correr esto.
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'notifications_type_check') then
    alter table public.notifications drop constraint notifications_type_check;
  end if;
  alter table public.notifications add constraint notifications_type_check
    check (type in ('task', 'review', 'approval', 'change_request', 'comment', 'deadline', 'task_request', 'client_delay'));
end $$;

-- 8. Aviso de tarea del cliente ya vencida (diario, mientras siga abierta).
-- notify_upcoming_deadlines() (sql/2026-07-15_...) ya cubre el aviso previo; esto cubre
-- el aviso de vencida que pedía la instrucción, sin duplicar al cliente cada hora.
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
    and t.commitment_date < current_date
    and not exists (
      select 1 from public.notifications n
      where n.task_id = t.id and n.type = 'client_delay' and n.created_at > now() - interval '20 hours'
    );
end;
$$;

select cron.schedule(
  'notify-overdue-client-tasks-daily',
  '15 14 * * *', -- ~8:15am Ciudad de México (UTC-6)
  $$select notify_overdue_client_tasks()$$
);

commit;

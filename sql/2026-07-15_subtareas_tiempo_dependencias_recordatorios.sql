-- 1. Subtareas / checklist dentro de una tarea
create table if not exists task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table task_subtasks enable row level security;
drop policy if exists "Usuarios autenticados pueden ver subtareas" on task_subtasks;
drop policy if exists "Usuarios autenticados pueden crear subtareas" on task_subtasks;
drop policy if exists "Usuarios autenticados pueden editar subtareas" on task_subtasks;
drop policy if exists "Usuarios autenticados pueden borrar subtareas" on task_subtasks;
create policy "Usuarios autenticados pueden ver subtareas" on task_subtasks for select to authenticated using (true);
create policy "Usuarios autenticados pueden crear subtareas" on task_subtasks for insert to authenticated with check (true);
create policy "Usuarios autenticados pueden editar subtareas" on task_subtasks for update to authenticated using (true);
create policy "Usuarios autenticados pueden borrar subtareas" on task_subtasks for delete to authenticated using (true);

-- 2. Tiempo trabajado por tarea (registros de inicio/fin, tipo cronómetro)
create table if not exists task_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes int,
  note text,
  created_at timestamptz not null default now()
);
alter table task_time_entries enable row level security;
drop policy if exists "Usuarios autenticados pueden ver tiempo registrado" on task_time_entries;
drop policy if exists "Usuarios autenticados pueden registrar tiempo" on task_time_entries;
drop policy if exists "Usuarios autenticados pueden actualizar su tiempo" on task_time_entries;
drop policy if exists "Usuarios autenticados pueden borrar tiempo" on task_time_entries;
create policy "Usuarios autenticados pueden ver tiempo registrado" on task_time_entries for select to authenticated using (true);
create policy "Usuarios autenticados pueden registrar tiempo" on task_time_entries for insert to authenticated with check (true);
create policy "Usuarios autenticados pueden actualizar su tiempo" on task_time_entries for update to authenticated using (true);
create policy "Usuarios autenticados pueden borrar tiempo" on task_time_entries for delete to authenticated using (true);

-- 3. Dependencias entre tareas (una tarea puede depender de otra del mismo proyecto)
alter table tasks add column if not exists depends_on_task_id uuid references tasks(id) on delete set null;

-- 4. Recordatorios automáticos de fecha de entrega próxima a vencer
create or replace function notify_upcoming_deadlines()
returns void
language plpgsql
security definer
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

-- Requiere la extensión "pg_cron" activada (Supabase → Database → Extensions).
-- cron.schedule() actualiza el job si ya existe uno con el mismo nombre, así que es seguro correr esto varias veces.
select cron.schedule(
  'notify-upcoming-deadlines-daily',
  '0 14 * * *', -- 8:00am hora Ciudad de México aprox. (UTC-6) — ajusta la hora si quieres
  $$select notify_upcoming_deadlines()$$
);

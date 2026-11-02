-- Checador v2 — paso 1 de 4 del despliegue (ver DOCUMENTACION.md → "Checador v2").
-- Solo lectura. Correr ANTES de 2026-10-23_checador_servidor.sql y revisar el resultado:
-- la migración asume ciertas columnas, políticas y el tipo de notificaciones existentes.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'work_sessions'
order by ordinal_position;

select relrowsecurity as rls_activo from pg_class where oid = 'public.work_sessions'::regclass;

select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'work_sessions';

select conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.work_sessions'::regclass;

-- Lista real de tipos de notificación: la migración debe conservarlos TODOS y agregar 'attendance'.
select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check';

select jobname, schedule, command from cron.job order by jobname;

select count(*) as total,
       count(*) filter (where ended_at is null) as abiertas,
       min(date) as desde, max(date) as hasta
from public.work_sessions;

-- Tablas que alimentan "primera actividad" (confirmar que existen).
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('tasks', 'task_comments', 'task_time_entries', 'task_subtasks');

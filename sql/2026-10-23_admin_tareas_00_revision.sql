-- SOLO LECTURA. Córrelo antes de 2026-10-23_admin_tareas.sql para confirmar el estado
-- real de la base (funciones, columnas, FKs y políticas de public.tasks) antes de tocar
-- nada. No tiene ningún DDL/DML. El editor de Supabase solo muestra el último resultado
-- de la pestaña, así que todo va en una sola consulta con UNION ALL.

-- (a) Funciones existentes y su firma.
select 'a) funciones' as seccion, p.proname::text as nombre,
       format('(%s) devuelve %s', pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)) as detalle
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_delete_team_task', 'admin_complete_team_task', 'is_active_admin')

union all

-- (b) Foreign keys que apuntan a public.tasks: tabla hija, nombre de la FK y qué pasa al borrar.
select 'b) fks hacia tasks' as seccion,
       format('%s.%s', cn.relnamespace::regnamespace, cn.relname)::text as nombre,
       format('%s → %s (on delete %s)', con.conname, con.confrelid::regclass,
         case con.confdeltype
           when 'a' then 'no action'
           when 'r' then 'restrict'
           when 'c' then 'cascade'
           when 'n' then 'set null'
           when 'd' then 'set default'
           else con.confdeltype::text
         end) as detalle
from pg_constraint con
join pg_class cn on cn.oid = con.conrelid
where con.contype = 'f'
  and con.confrelid = 'public.tasks'::regclass

union all

-- (c) Columnas actuales de public.tasks.
select 'c) columnas de tasks' as seccion, column_name::text as nombre,
       format('%s · nullable=%s · default=%s', data_type, is_nullable, coalesce(column_default, '—')) as detalle
from information_schema.columns
where table_schema = 'public' and table_name = 'tasks'

union all

-- (d) ¿Ya existen las columnas/tabla que va a crear la migración?
select 'd) ya existe' as seccion, 'tasks.archived_at'::text as nombre,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'tasks' and column_name = 'archived_at'
       )::text as detalle

union all

select 'd) ya existe' as seccion, 'tasks.archived_by'::text as nombre,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'tasks' and column_name = 'archived_by'
       )::text as detalle

union all

select 'd) ya existe' as seccion, 'tasks.archive_reason'::text as nombre,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'tasks' and column_name = 'archive_reason'
       )::text as detalle

union all

select 'd) ya existe' as seccion, 'public.task_audit_log'::text as nombre,
       exists (
         select 1 from pg_class where relname = 'task_audit_log'
           and relnamespace = 'public'::regnamespace
       )::text as detalle

union all

-- (e) Políticas vigentes de public.tasks.
select 'e) políticas de tasks' as seccion, policyname::text as nombre,
       format('%s · roles=%s · using=%s · with_check=%s', cmd, roles, coalesce(qual, '—'), coalesce(with_check, '—')) as detalle
from pg_policies
where schemaname = 'public' and tablename = 'tasks'

union all

-- (e) Triggers de public.tasks (se excluyen los internos de Postgres).
select 'e) triggers de tasks' as seccion, tgname::text as nombre,
       pg_get_triggerdef(oid) as detalle
from pg_trigger
where tgrelid = 'public.tasks'::regclass and not tgisinternal

order by 1, 2;

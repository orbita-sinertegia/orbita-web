-- Tablero semanal — REVISIÓN PREVIA (solo lectura). No modifica nada.
-- Correr ANTES de 2026-11-02_tablero_semanal.sql. Una sola consulta (el editor de Supabase
-- muestra solo el último resultado).
select 'tabla team_goals existe' as revision, (to_regclass('public.team_goals') is not null)::text as valor
union all select 'tabla work_type_weights existe', (to_regclass('public.work_type_weights') is not null)::text
union all select 'columna tasks.work_type existe', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'work_type')::text
union all select 'columna tasks.work_units existe', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'work_units')::text
union all select 'función is_active_admin existe', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_active_admin')::text
union all select 'triggers actuales en tasks', coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.tasks'::regclass and not tgisinternal), '(ninguno)')
union all select 'tareas completadas (no archivadas)', (select count(*) from public.tasks where status = 'completada' and archived_at is null)::text
union all select 'completadas SIN completion_date', (select count(*) from public.tasks where status = 'completada' and completion_date is null and archived_at is null)::text
union all select 'tareas de retrabajo (🔄 Retrabajo:)', (select count(*) from public.tasks where title like '🔄 Retrabajo:%')::text
union all select 'tareas con change_count > 0', (select count(*) from public.tasks where coalesce(change_count, 0) > 0)::text
union all select 'usuarios equipo activos por depto', coalesce((select string_agg(department || ': ' || n, ', ' order by department) from (select coalesce(department, 'sin depto') as department, count(*) as n from public.users where role = 'team' and coalesce(active, true) group by 1) d), '(ninguno)')
union all select 'títulos distintos de edición', (select count(distinct title) from public.tasks where department = 'edicion')::text;

-- SOLO LECTURA. Revisión previa a sql/2026-11-02_control_super_admin.sql.
-- Un solo resultado (el editor de Supabase muestra solo el último). No modifica nada.
-- Esperado:
--   super_admins_activos = 1 y tony_es_super_admin = true
--   fn_is_active_super_admin / fn_super_admin_set_task_status / trigger_projects_status /
--   trigger_projects_delete = false (aún no existen)
--   tipo_projects_status y tipo_tasks_status: el tipo real de las columnas (text o enum)
--   restriccion_projects_status: la regla actual de valores permitidos (si existe)
--   proyectos_<estado>: cuántos hay en cada estado, y la lista de pausados / finalizados / Glish
select 'super_admins_activos' as revision,
       (select count(*) from public.users where is_super_admin = true and coalesce(active, true))::text as valor
union all
select 'tony_es_super_admin',
       coalesce((select (is_super_admin and coalesce(active, true))::text from public.users where id = '35ce6105-1918-4922-b261-34b676b7b735'), '(no encontrado)')
union all
select 'fn_is_active_super_admin', exists (select 1 from pg_proc where proname = 'is_active_super_admin' and pronamespace = 'public'::regnamespace)::text
union all
select 'fn_super_admin_set_task_status', exists (select 1 from pg_proc where proname = 'super_admin_set_task_status' and pronamespace = 'public'::regnamespace)::text
union all
select 'trigger_projects_status', exists (select 1 from pg_trigger where tgname = 'projects_status_super_admin_only')::text
union all
select 'trigger_projects_delete', exists (select 1 from pg_trigger where tgname = 'projects_delete_super_admin_only')::text
union all
select 'triggers_actuales_projects', coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.projects'::regclass and not tgisinternal), '(ninguno)')
union all
select 'tipo_projects_status', (select data_type || ' / ' || udt_name from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'status')
union all
select 'tipo_tasks_status', (select data_type || ' / ' || udt_name from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'status')
union all
select 'restriccion_projects_status', coalesce((select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = 'public.projects'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'), '(ninguna)')
union all
select 'trigger_completion_date_tasks', exists (select 1 from pg_trigger where tgname = 'tasks_completion_date')::text
union all
select 'columna_review_status', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'review_status')::text
union all
select 'proyectos_' || coalesce(status::text, '(sin estado)'), count(*)::text from public.projects group by status
union all
select 'pausados', coalesce((select string_agg(coalesce(c.name, '?') || ' — ' || p.name, '; ' order by c.name) from public.projects p left join public.clients c on c.id = p.client_id where p.status::text = 'pausado'), '(ninguno)')
union all
select 'finalizados', coalesce((select string_agg(coalesce(c.name, '?') || ' — ' || p.name, '; ' order by c.name) from public.projects p left join public.clients c on c.id = p.client_id where p.status::text = 'completado'), '(ninguno)')
union all
select 'glish', coalesce((select string_agg(p.id::text || ' | ' || coalesce(c.name, '?') || ' — ' || p.name || ' | ' || p.status::text, '; ') from public.projects p left join public.clients c on c.id = p.client_id where c.name ilike '%glish%' or p.name ilike '%glish%'), '(no encontrado)');

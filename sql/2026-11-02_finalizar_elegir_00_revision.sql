-- SOLO LECTURA. Revisión previa a sql/2026-11-02_finalizar_elegir.sql. No modifica nada.
-- Un solo resultado (el editor de Supabase muestra solo el último).
-- Esperado:
--   ya_existe (de finalizar_borra / control_super_admin): todo true
--   nuevo: todo false (aún no existe)
--   borrado_automatico_activo = true (hoy, finalizar desde el selector BORRA las pendientes;
--   después de correr el SQL será false)
--   regla de task_audit_log incluye 'archive' y 'restore'
--   proyectos finalizados con cuántas pendientes tienen hoy (sin y con archivar)
select 'ya_existe' as tipo, 'fn_is_active_super_admin' as nombre, exists (select 1 from pg_proc where proname = 'is_active_super_admin' and pronamespace = 'public'::regnamespace)::text as valor
union all select 'ya_existe', 'fn_is_task_delivered', exists (select 1 from pg_proc where proname = 'is_task_delivered' and pronamespace = 'public'::regnamespace)::text
union all select 'ya_existe', 'fn_purge_finalized_project_tasks', exists (select 1 from pg_proc where proname = 'purge_finalized_project_tasks' and pronamespace = 'public'::regnamespace)::text
union all select 'ya_existe', 'trigger_projects_finalize_delete', exists (select 1 from pg_trigger where tgname = 'projects_finalize_delete')::text
union all select 'ya_existe', 'trigger_projects_status_super_admin_only', exists (select 1 from pg_trigger where tgname = 'projects_status_super_admin_only')::text
union all select 'ya_existe', 'task_audit_log', (to_regclass('public.task_audit_log') is not null)::text
union all select 'ya_existe', 'columnas_archivado (3)', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name in ('archived_at', 'archived_by', 'archive_reason'))::text
union all select 'nuevo', 'fn_finalize_project', exists (select 1 from pg_proc where proname = 'finalize_project' and pronamespace = 'public'::regnamespace)::text
union all select 'nuevo', 'columna_archived_via', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'archived_via')::text
union all select 'nuevo', 'trigger_tasks_clear_archived_via', exists (select 1 from pg_trigger where tgname = 'tasks_clear_archived_via')::text
union all select 'nuevo', 'trigger_projects_reactivate_restore', exists (select 1 from pg_trigger where tgname = 'projects_reactivate_restore')::text
union all select 'estado', 'borrado_automatico_activo', coalesce((
  select (position('purge_finalized_project_tasks' in pg_get_functiondef(p.oid)) > 0)::text
  from pg_proc p where p.proname = 'trg_projects_finalize_delete' and p.pronamespace = 'public'::regnamespace), '(no existe)')
union all select 'estado', 'regla_acciones_task_audit_log', coalesce((select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = to_regclass('public.task_audit_log') and contype = 'c'), '(ninguna)')
union all select 'estado', 'triggers_projects', coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.projects'::regclass and not tgisinternal), '(ninguno)')
union all select 'estado', 'triggers_tasks', coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.tasks'::regclass and not tgisinternal), '(ninguno)')
union all select 'finalizado', coalesce(c.name, '?') || ' — ' || p.name,
       'pendientes sin archivar: ' || count(t.id) filter (where t.archived_at is null and not (coalesce(t.status::text, '') = 'completada' or coalesce(t.review_status::text, '') in ('pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada')))
       || ' · pendientes archivadas: ' || count(t.id) filter (where t.archived_at is not null and not (coalesce(t.status::text, '') = 'completada' or coalesce(t.review_status::text, '') in ('pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada')))
       || ' · realizadas/entregadas: ' || count(t.id) filter (where coalesce(t.status::text, '') = 'completada' or coalesce(t.review_status::text, '') in ('pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada'))
  from public.projects p
  left join public.clients c on c.id = p.client_id
  left join public.tasks t on t.project_id = p.id
  where p.status::text = 'completado'
  group by c.name, p.name, p.id;

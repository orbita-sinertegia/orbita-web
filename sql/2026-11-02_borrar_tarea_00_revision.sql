-- SOLO LECTURA. Revisión previa a sql/2026-11-02_borrar_tarea.sql. No modifica nada.
-- Un solo resultado. Esperado:
--   fn_is_active_super_admin = true, fn_delete_task_permanently_internal = true (ya instaladas)
--   fn_super_admin_delete_task = false (aún no existe)
--   super_admins_activos = 1
--   internal_sin_permiso_app = true (la función interna no la puede llamar la app directo)
select 'fn_is_active_super_admin' as revision, exists (select 1 from pg_proc where proname = 'is_active_super_admin' and pronamespace = 'public'::regnamespace)::text as valor
union all select 'fn_delete_task_permanently_internal', exists (select 1 from pg_proc where proname = 'delete_task_permanently_internal' and pronamespace = 'public'::regnamespace)::text
union all select 'fn_super_admin_delete_task', exists (select 1 from pg_proc where proname = 'super_admin_delete_task' and pronamespace = 'public'::regnamespace)::text
union all select 'super_admins_activos', (select count(*) from public.users where is_super_admin = true and coalesce(active, true))::text
union all select 'internal_sin_permiso_app', coalesce((
  select (not has_function_privilege('authenticated', p.oid, 'execute'))::text
  from pg_proc p where p.proname = 'delete_task_permanently_internal' and p.pronamespace = 'public'::regnamespace limit 1), '(no existe)');

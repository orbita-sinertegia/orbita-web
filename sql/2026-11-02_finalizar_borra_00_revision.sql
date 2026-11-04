-- SOLO LECTURA. Revisión previa a sql/2026-11-02_finalizar_borra.sql. No modifica nada.
-- Un solo resultado (el editor de Supabase muestra solo el último).
-- Revisa:
--   · objetos nuevos aún no existen (false);
--   · tablas que usa el borrado existen (true) y task_audit_log acepta la acción de borrado;
--   · TODAS las llaves foráneas que apuntan a tasks y qué hacen al borrar
--     (a = no action, r = restrict, c = cascade, n = set null, d = set default).
--     Una llave a/r desde una tabla que el borrado no limpia haría fallar (y revertir) todo;
--     las que limpia: task_comments, task_links, task_subtasks, task_time_entries,
--     task_ratings, notifications, chat_messages, tasks.depends_on_task_id;
--   · por cada proyecto YA finalizado: cuántas tareas SERÍAN eliminables y cuántas se
--     conservan. Solo informativo: el SQL principal NO es retroactivo, no les borra nada;
--   · todos los proyectos de Mel (cliente ILIKE '%mel%') con estado, etapa y pendientes, para
--     decidir si 'PRODUCTO PDF' es un producto terminado aparte o hay que reactivarlo.
-- Se conserva: status 'completada' o review_status en
-- ('pendiente_revision','pendiente_trafficker','en_revision','aprobada').
with keep as (
  select t.project_id, t.archived_at,
         (coalesce(t.status::text, '') = 'completada'
          or coalesce(t.review_status::text, '') in ('pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada')) as kept
  from public.tasks t
)
select '1_objeto' as tipo, 'fn_purge_finalized_project_tasks' as nombre,
       exists (select 1 from pg_proc where proname = 'purge_finalized_project_tasks' and pronamespace = 'public'::regnamespace)::text as valor
union all select '1_objeto', 'trigger_projects_finalize_delete', exists (select 1 from pg_trigger where tgname = 'projects_finalize_delete')::text
union all select '1_objeto', 'trigger_projects_status (debe ser true)', exists (select 1 from pg_trigger where tgname = 'projects_status_super_admin_only')::text
union all select '1_objeto', 'triggers_actuales_projects', coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.projects'::regclass and not tgisinternal), '(ninguno)')
union all select '2_tabla', x.t, (to_regclass('public.' || x.t) is not null)::text
  from (values ('task_audit_log'), ('task_comments'), ('task_links'), ('task_subtasks'), ('task_time_entries'), ('task_ratings'), ('notifications'), ('chat_messages')) as x(t)
union all select '2_tabla', 'regla_acciones_task_audit_log', coalesce((select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = to_regclass('public.task_audit_log') and contype = 'c'), '(ninguna)')
union all select '3_llave_a_tasks', conrelid::regclass::text || ' (' || conname || ')',
       'al borrar: ' || confdeltype::text || ' · ' || pg_get_constraintdef(oid)
  from pg_constraint where contype = 'f' and confrelid = 'public.tasks'::regclass
union all select '4_finalizado', coalesce(c.name, '?') || ' — ' || p.name || ' (' || p.id::text || ')',
       'eliminables (no se borran ahora): ' || count(k.project_id) filter (where k.kept is false)
       || ' (archivadas: ' || count(k.project_id) filter (where k.kept is false and k.archived_at is not null) || ')'
       || ' · se conservan: ' || count(k.project_id) filter (where k.kept)
  from public.projects p
  left join public.clients c on c.id = p.client_id
  left join keep k on k.project_id = p.id
  where p.status::text = 'completado'
  group by c.name, p.name, p.id
union all select '4_finalizado', 'proyectos_finalizados_total', (select count(*) from public.projects where status::text = 'completado')::text
union all select '5_mel', coalesce(c.name, '?') || ' — ' || p.name || ' (' || p.id::text || ')',
       'estado: ' || coalesce(p.status::text, '?')
       || ' · etapa: ' || coalesce((select to_jsonb(pp)->>'stage' from public.projects pp where pp.id = p.id), '(sin etapa)')
       || ' · embudo: ' || coalesce((select to_jsonb(pp)->>'funnel_type' from public.projects pp where pp.id = p.id), '(sin tipo)')
       || ' · pendientes: ' || count(k.project_id) filter (where k.kept is false and k.archived_at is null)
       || ' · entregadas/realizadas: ' || count(k.project_id) filter (where k.kept and k.archived_at is null)
       || ' · archivadas: ' || count(k.project_id) filter (where k.archived_at is not null)
       || ' · creado: ' || coalesce(to_char(p.created_at, 'YYYY-MM-DD'), '?')
  from public.projects p
  join public.clients c on c.id = p.client_id
  left join keep k on k.project_id = p.id
  where c.name ilike '%mel%'
  group by c.name, p.name, p.id, p.status, p.created_at;

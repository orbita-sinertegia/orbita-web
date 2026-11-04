-- SOLO LECTURA. Revisión previa a sql/2026-11-02_etapa_proyecto.sql.
-- Un solo resultado (el editor de Supabase muestra solo el último).
-- Esperado: columnas_stage_funnel = 0 (aún no existen), restricciones = 0,
-- y el conteo de proyectos por estado para saber a cuántos se les pondrá etapa.
select 'columnas_stage_funnel' as revision, count(*)::text as valor
from information_schema.columns
where table_schema = 'public' and table_name = 'projects' and column_name in ('stage', 'funnel_type')
union all
select 'restricciones_existentes', count(*)::text
from pg_constraint
where conname in ('projects_stage_check', 'projects_funnel_type_check')
union all
select 'proyectos_' || coalesce(status, '(sin estado)'), count(*)::text
from public.projects
group by status
union all
select 'proyectos_total', count(*)::text from public.projects;

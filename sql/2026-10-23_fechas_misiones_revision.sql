-- Misiones sin fecha (ventana después del check-in) — ver DOCUMENTACION.md.
-- Solo lectura. El equipo YA actualiza commitment_date desde TaskDetailModal.saveCommitDate
-- con un update directo a `tasks`, así que esta ventana reutiliza el mismo patrón sin pedir
-- cambios de esquema. Este archivo es para CONFIRMAR en Supabase que las políticas actuales
-- de `tasks` en efecto permiten ese update a un integrante del equipo sobre su propia tarea.
-- No ejecuta ningún cambio.

-- RLS activo en tasks.
select relrowsecurity as rls_activo from pg_class where oid = 'public.tasks'::regclass;

-- Políticas vigentes de tasks: confirmar que exista un UPDATE que permita a 'team'
-- tocar filas donde assigned_to = auth.uid() (o equivalente).
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'tasks';

-- Triggers de tasks (se excluyen los internos de Postgres) — por si alguno bloquea
-- o reescribe commitment_date al hacer update.
select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.tasks'::regclass and not tgisinternal;

-- Conteo de misiones sin fecha por persona, para comparar contra el panel de admin
-- (Operación → Tareas del equipo). Mismo criterio que countUndatedByAssignee en
-- src/lib/missingDates.ts: rol 'team', no completada o completada-sin-aprobar,
-- sin commitment_date, departamento distinto de 'cliente', proyecto no 'completado'.
select u.id as user_id, u.full_name, count(t.id) as misiones_sin_fecha
from public.users u
join public.tasks t on t.assigned_to = u.id
left join public.projects p on p.id = t.project_id
where u.role = 'team'
  and t.commitment_date is null
  and t.department <> 'cliente'
  and (p.status is null or p.status <> 'completado')
  and (t.status <> 'completada' or (t.review_status is not null and t.review_status <> 'aprobada'))
group by u.id, u.full_name
order by misiones_sin_fecha desc;

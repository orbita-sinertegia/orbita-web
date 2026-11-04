-- Tablero semanal del equipo (metas, pesos por tipo de trabajo y fecha de completado).
-- Idempotente: se puede correr más de una vez. Correr primero 2026-11-02_tablero_semanal_00_revision.sql.
-- Requiere public.is_active_admin() (sql/2026-10-22_seguridad.sql).

-- 1. Metas semanales: por persona (user_id) o por departamento (department), por tipo de trabajo.
--    work_type = 'puntos' es la meta de puntos totales; si no, un tipo (vsl, anuncio, video, pagina,
--    imagen, guion, campana, grabacion, otro). La meta de la persona manda sobre la de su departamento.
create table if not exists public.team_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  department text,
  work_type text not null,
  weekly_target numeric not null check (weekly_target >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint team_goals_scope check ((user_id is not null) <> (department is not null))
);

create unique index if not exists team_goals_scope_type_uidx
  on public.team_goals (coalesce(user_id::text, ''), coalesce(department, ''), work_type);

alter table public.team_goals enable row level security;

drop policy if exists "Admins administran metas" on public.team_goals;
create policy "Admins administran metas"
  on public.team_goals for all
  to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

drop policy if exists "Equipo ve sus metas" on public.team_goals;
create policy "Equipo ve sus metas"
  on public.team_goals for select
  to authenticated
  using (
    user_id = auth.uid()
    or department = (select u.department from public.users u where u.id = auth.uid())
  );

revoke all on public.team_goals from anon;
grant select, insert, update, delete on public.team_goals to authenticated;

-- 2. Puntos por tipo de trabajo (para comparar roles distintos de forma justa).
create table if not exists public.work_type_weights (
  work_type text primary key,
  label text not null,
  points numeric not null check (points >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.work_type_weights enable row level security;

drop policy if exists "Todos ven los pesos" on public.work_type_weights;
create policy "Todos ven los pesos"
  on public.work_type_weights for select
  to authenticated
  using (true);

drop policy if exists "Admins editan los pesos" on public.work_type_weights;
create policy "Admins editan los pesos"
  on public.work_type_weights for all
  to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

revoke all on public.work_type_weights from anon;
grant select, insert, update, delete on public.work_type_weights to authenticated;

insert into public.work_type_weights (work_type, label, points) values
  ('vsl', 'VSL', 3),
  ('anuncio', 'Anuncio', 1),
  ('video', 'Video (gracias, edificación)', 2),
  ('pagina', 'Página / embudo', 2),
  ('imagen', 'Imagen / pieza de diseño', 0.5),
  ('guion', 'Guion / copy / prompt', 1),
  ('campana', 'Campaña', 2),
  ('grabacion', 'Sesión de grabación', 2),
  ('otro', 'Otra tarea', 1)
on conflict (work_type) do nothing;

-- 3. Clasificación explícita opcional de una tarea (si es null, la app usa la heurística por título).
alter table public.tasks add column if not exists work_type text;
alter table public.tasks add column if not exists work_units numeric check (work_units is null or work_units > 0);

-- 4. completion_date automático (día CDMX) al pasar a 'completada'; se limpia si se reactiva.
--    Hoy el flujo del equipo marca 'completada' sin llenar completion_date.
create or replace function public.trg_tasks_completion_date() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completada' and new.completion_date is null
     and (tg_op = 'INSERT' or old.status is distinct from 'completada') then
    new.completion_date := (now() at time zone 'America/Mexico_City')::date;
  elsif tg_op = 'UPDATE' and old.status = 'completada' and new.status <> 'completada'
     and new.completion_date is not distinct from old.completion_date then
    new.completion_date := null;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_tasks_completion_date() from public;
revoke all on function public.trg_tasks_completion_date() from anon;

drop trigger if exists tasks_completion_date on public.tasks;
create trigger tasks_completion_date before insert or update of status on public.tasks
  for each row execute function public.trg_tasks_completion_date();

-- Verificación (una sola consulta)
select 'team_goals' as objeto, (to_regclass('public.team_goals') is not null)::text as ok
union all select 'work_type_weights', (select count(*) from public.work_type_weights)::text
union all select 'tasks.work_type', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'work_type')::text
union all select 'trigger tasks_completion_date', exists (select 1 from pg_trigger where tgname = 'tasks_completion_date')::text
union all select 'anon sin acceso a team_goals', (not has_table_privilege('anon', 'public.team_goals', 'select'))::text;

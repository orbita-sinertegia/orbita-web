-- Checador v2 — paso 3 de 4 del despliegue (ver DOCUMENTACION.md → "Checador v2").
-- Correr DESPUÉS de revisar 2026-10-23_checador_00_revision.sql y de ajustar la lista de
-- notifications_type_check (paso 11) con los tipos reales que haya mostrado esa revisión.
-- Se puede correr más de una vez sin error: solo usa "if not exists" / "create or replace" /
-- "drop ... if exists". No borra datos.
--
-- 0. Zona horaria única para todo el checador: America/Mexico_City. México no tiene horario
--    de verano desde 2022, así que la conversión a UTC-6 es constante, pero usamos el nombre
--    de zona de todas formas para que Postgres haga la conversión por nosotros.

begin;

-- 1. Columnas nuevas en work_sessions.
alter table public.work_sessions alter column started_at set default now();
alter table public.work_sessions
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists scheduled_start_min int,          -- inicio programado, en minutos desde la medianoche (hora CDMX)
  add column if not exists late_minutes int not null default 0,
  add column if not exists is_first_of_day boolean not null default true,
  add column if not exists auto_closed boolean not null default false,
  add column if not exists close_source text;                 -- 'usuario' | 'auto_actividad' | 'admin'

-- 2. Horario de una persona en una fecha (igual que src/lib/workSchedule.ts).
create or replace function public.work_day_schedule(p_user uuid, p_date date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    u.work_schedule -> (extract(dow from p_date)::int)::text,
    case extract(dow from p_date)::int
      when 0 then jsonb_build_object('enabled', false, 'start', 9, 'end', 18)
      when 6 then jsonb_build_object('enabled', true, 'start', 9, 'end', 14)
      else jsonb_build_object('enabled', true, 'start', coalesce(u.work_start, 9), 'end', coalesce(u.work_end, 18))
    end)
  from public.users u where u.id = p_user;
$$;

revoke all on function public.work_day_schedule(uuid, date) from public;
grant execute on function public.work_day_schedule(uuid, date) to authenticated;

-- 3. Minutos regulares y extra (misma regla que calcMinutes del frontend, ahora en el servidor).
create or replace function public.work_session_minutes(
  p_user uuid, p_start timestamptz, p_end timestamptz,
  out regular_minutes int, out overtime_minutes int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := (p_start at time zone 'America/Mexico_City')::date;
  v_day jsonb := public.work_day_schedule(p_user, v_date);
  v_s timestamptz; v_e timestamptz;
begin
  if p_end <= p_start then regular_minutes := 0; overtime_minutes := 0; return; end if;
  if v_day is null or not coalesce((v_day->>'enabled')::boolean, false) then
    regular_minutes := 0;
    overtime_minutes := round(extract(epoch from p_end - p_start) / 60);
    return;
  end if;
  v_s := (v_date + make_interval(mins => round((v_day->>'start')::numeric * 60)::int)) at time zone 'America/Mexico_City';
  v_e := (v_date + make_interval(mins => round((v_day->>'end')::numeric * 60)::int)) at time zone 'America/Mexico_City';
  regular_minutes := greatest(0, round(extract(epoch from least(p_end, v_e) - greatest(p_start, v_s)) / 60));
  overtime_minutes := greatest(0, round(extract(epoch from p_end - greatest(p_start, v_e)) / 60));
end;
$$;

revoke all on function public.work_session_minutes(uuid, timestamptz, timestamptz) from public;
grant execute on function public.work_session_minutes(uuid, timestamptz, timestamptz) to authenticated;

-- 4. Primera y última actividad real del día (la escriben triggers, no el cliente).
create table if not exists public.user_daily_activity (
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  first_activity_at timestamptz not null,
  first_activity_kind text,
  last_activity_at timestamptz not null,
  events int not null default 1,
  primary key (user_id, date)
);
alter table public.user_daily_activity enable row level security;
drop policy if exists "Ver actividad propia o admin" on public.user_daily_activity;
create policy "Ver actividad propia o admin" on public.user_daily_activity
  for select to authenticated using (user_id = auth.uid() or public.is_active_admin());

create or replace function public.record_user_activity(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  -- Los jobs de pg_cron no tienen auth.uid(): no cuentan como actividad de nadie.
  if v_uid is null then return; end if;
  if not exists (select 1 from public.users where id = v_uid and role in ('team', 'admin')) then return; end if;
  insert into public.user_daily_activity (user_id, date, first_activity_at, first_activity_kind, last_activity_at)
  values (v_uid, (now() at time zone 'America/Mexico_City')::date, now(), p_kind, now())
  on conflict (user_id, date) do update
    set last_activity_at = now(), events = public.user_daily_activity.events + 1;
end;
$$;
revoke all on function public.record_user_activity(text) from public;

create or replace function public.trg_activity_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     or new.review_status is distinct from old.review_status
     or new.completion_date is distinct from old.completion_date then
    perform public.record_user_activity('tarea');
  end if;
  return new;
end; $$;
drop trigger if exists activity_task_update on public.tasks;
create trigger activity_task_update after update on public.tasks
  for each row execute function public.trg_activity_task_update();

create or replace function public.trg_activity_generic() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.record_user_activity(tg_argv[0]); return new; end; $$;

drop trigger if exists activity_task_comment on public.task_comments;
create trigger activity_task_comment after insert on public.task_comments
  for each row execute function public.trg_activity_generic('comentario');
drop trigger if exists activity_time_entry on public.task_time_entries;
create trigger activity_time_entry after insert on public.task_time_entries
  for each row execute function public.trg_activity_generic('cronometro');
drop trigger if exists activity_subtask on public.task_subtasks;
create trigger activity_subtask after insert or update on public.task_subtasks
  for each row execute function public.trg_activity_generic('subtarea');

-- 5. RPC de entrada: hora, fecha y retardo los pone el servidor.
create or replace function public.registrar_entrada(p_location text)
returns public.work_sessions language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_local timestamp := now() at time zone 'America/Mexico_City';
  v_date date := (now() at time zone 'America/Mexico_City')::date;
  v_day jsonb; v_start int; v_first boolean; v_late int := 0;
  v_row public.work_sessions;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_location not in ('oficina', 'home_office') then raise exception 'Ubicación inválida'; end if;
  if not exists (select 1 from public.users where id = v_uid and role in ('team', 'admin') and coalesce(active, true)) then
    raise exception 'Sin permiso';
  end if;

  select * into v_row from public.work_sessions
   where user_id = v_uid and ended_at is null and date = v_date
   order by started_at limit 1;
  if found then return v_row; end if;

  v_first := not exists (select 1 from public.work_sessions where user_id = v_uid and date = v_date);
  v_day := public.work_day_schedule(v_uid, v_date);
  if coalesce((v_day->>'enabled')::boolean, false) then
    v_start := round((v_day->>'start')::numeric * 60)::int;
    if v_first then
      v_late := greatest(0, (extract(hour from v_local) * 60 + extract(minute from v_local))::int - v_start);
    end if;
  end if;

  insert into public.work_sessions (user_id, location, date, started_at, scheduled_start_min, late_minutes, is_first_of_day)
  values (v_uid, p_location, v_date, now(), v_start, v_late, v_first)
  returning * into v_row;
  return v_row;
end;
$$;

-- 6. RPC de salida: cierra las sesiones abiertas de HOY (hora CDMX) de la persona, con hora
--    del servidor. Si hay más de una (por ejemplo, salió y volvió a entrar), cierra todas:
--    así una segunda entrada el mismo día no deja una sesión abierta colgada.
create or replace function public.registrar_salida()
returns int language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_count int := 0; r record; m record;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  for r in
    select id, started_at from public.work_sessions
     where user_id = v_uid and ended_at is null
       and date = (now() at time zone 'America/Mexico_City')::date
  loop
    select * into m from public.work_session_minutes(v_uid, r.started_at, now());
    update public.work_sessions
       set ended_at = now(), regular_minutes = m.regular_minutes, overtime_minutes = m.overtime_minutes,
           close_source = 'usuario', auto_closed = false
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 7. Sesión abierta de hoy (fecha CDMX, no la del dispositivo).
create or replace function public.mi_sesion_hoy()
returns setof public.work_sessions language sql stable security definer set search_path = public as $$
  select * from public.work_sessions
   where user_id = auth.uid() and ended_at is null
     and date = (now() at time zone 'America/Mexico_City')::date
   order by started_at limit 1;
$$;

-- 8. Cierre automático de salidas olvidadas: a la ÚLTIMA ACTIVIDAD registrada, no a la hora de
--    salida programada. Queda marcado como auto_closed para que el admin lo revise o corrija.
create or replace function public.cerrar_sesiones_olvidadas()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_end timestamptz; m record;
begin
  for r in
    select s.id, s.user_id, s.started_at, a.last_activity_at
      from public.work_sessions s
      left join public.user_daily_activity a on a.user_id = s.user_id and a.date = s.date
     where s.ended_at is null and s.date < (now() at time zone 'America/Mexico_City')::date
  loop
    v_end := greatest(r.started_at, coalesce(r.last_activity_at, r.started_at));
    select * into m from public.work_session_minutes(r.user_id, r.started_at, v_end);
    update public.work_sessions
       set ended_at = v_end, regular_minutes = m.regular_minutes, overtime_minutes = m.overtime_minutes,
           auto_closed = true, close_source = 'auto_actividad'
     where id = r.id;
  end loop;
end;
$$;

-- 9. Corrección manual del admin, con bitácora.
create table if not exists public.work_session_corrections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.work_sessions(id) on delete cascade,
  admin_id uuid not null references public.users(id),
  old_started_at timestamptz, old_ended_at timestamptz,
  new_started_at timestamptz, new_ended_at timestamptz,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.work_session_corrections enable row level security;
drop policy if exists "Admins ven correcciones" on public.work_session_corrections;
create policy "Admins ven correcciones" on public.work_session_corrections
  for select to authenticated using (public.is_active_admin());

create or replace function public.admin_corregir_sesion(p_session_id uuid, p_started_at timestamptz, p_ended_at timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.work_sessions; m record;
begin
  if not public.is_active_admin() then raise exception 'Solo administradores'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  if p_ended_at is not null and p_ended_at <= p_started_at then raise exception 'La salida debe ser posterior a la entrada'; end if;
  select * into s from public.work_sessions where id = p_session_id for update;
  if not found then raise exception 'Sesión no encontrada'; end if;
  insert into public.work_session_corrections (session_id, admin_id, old_started_at, old_ended_at, new_started_at, new_ended_at, reason)
  values (s.id, auth.uid(), s.started_at, s.ended_at, p_started_at, p_ended_at, p_reason);
  if p_ended_at is not null then
    select * into m from public.work_session_minutes(s.user_id, p_started_at, p_ended_at);
  end if;
  update public.work_sessions
     set started_at = p_started_at, ended_at = p_ended_at,
         regular_minutes = coalesce(m.regular_minutes, 0), overtime_minutes = coalesce(m.overtime_minutes, 0),
         late_minutes = case when s.is_first_of_day and s.scheduled_start_min is not null
           then greatest(0, (extract(hour from p_started_at at time zone 'America/Mexico_City') * 60
                + extract(minute from p_started_at at time zone 'America/Mexico_City'))::int - s.scheduled_start_min)
           else 0 end,
         close_source = case when p_ended_at is not null then 'admin' else close_source end,
         auto_closed = false
   where id = s.id;
end;
$$;

-- 10. Reporte de asistencia por persona y día (incluye días SIN registro).
--     asistencia_rango_interno() calcula UN día para TODO el equipo, sin filtrar por quién
--     pregunta: la usan tanto asistencia_rango() (con el filtro de permisos) como los jobs de
--     pg_cron (revisar_asistencia, resumen_asistencia_diario), que no tienen auth.uid().
create or replace function public.asistencia_rango_interno(p_date date, p_tolerancia int default 5)
returns table (
  user_id uuid, full_name text, department text, date date,
  laborable boolean, inicio_programado_min int, fin_programado_min int,
  entrada timestamptz, ubicacion text, retardo_min int,
  primera_actividad timestamptz, primera_actividad_tipo text, ultima_actividad timestamptz,
  salida timestamptz, salida_automatica boolean, minutos_regulares int, minutos_extra int,
  estado text)
language sql stable security definer set search_path = public as $$
  with gente as (
    select u.id, u.full_name, u.department::text as department from public.users u
     where u.role = 'team' and coalesce(u.active, true)
  ),
  base as (
    select g.*, p_date as date, public.work_day_schedule(g.id, p_date) as sch from gente g
  ),
  ses as (
    select s.user_id,
           min(s.started_at) as entrada,
           (array_agg(s.location order by s.started_at))[1] as ubicacion,
           max(s.late_minutes) filter (where s.is_first_of_day) as retardo_min,
           case when bool_or(s.ended_at is null) then null else max(s.ended_at) end as salida,
           bool_or(s.auto_closed) as salida_automatica,
           sum(coalesce(s.regular_minutes, 0))::int as minutos_regulares,
           sum(coalesce(s.overtime_minutes, 0))::int as minutos_extra
      from public.work_sessions s where s.date = p_date group by s.user_id
  )
  select b.id, b.full_name, b.department, b.date,
         coalesce((b.sch->>'enabled')::boolean, false),
         case when coalesce((b.sch->>'enabled')::boolean, false) then round((b.sch->>'start')::numeric * 60)::int end,
         case when coalesce((b.sch->>'enabled')::boolean, false) then round((b.sch->>'end')::numeric * 60)::int end,
         s.entrada, s.ubicacion, s.retardo_min,
         a.first_activity_at, a.first_activity_kind, a.last_activity_at,
         s.salida, coalesce(s.salida_automatica, false), coalesce(s.minutos_regulares, 0), coalesce(s.minutos_extra, 0),
         case
           when s.entrada is null and not coalesce((b.sch->>'enabled')::boolean, false) then 'descanso'
           when s.entrada is null and b.date > (now() at time zone 'America/Mexico_City')::date then 'pendiente'
           when s.entrada is null and b.date = (now() at time zone 'America/Mexico_City')::date
                and (now() at time zone 'America/Mexico_City')::time
                    < make_time(0, 0, 0) + make_interval(mins => round((b.sch->>'start')::numeric * 60)::int + 30)
                then 'pendiente'
           when s.entrada is null then 'sin_registro'
           when not coalesce((b.sch->>'enabled')::boolean, false) then 'dia_extra'
           when coalesce(s.retardo_min, 0) <= p_tolerancia then 'a_tiempo'
           else 'retardo'
         end
    from base b
    left join ses s on s.user_id = b.id
    left join public.user_daily_activity a on a.user_id = b.id and a.date = b.date
$$;

revoke all on function public.asistencia_rango_interno(date, int) from public, authenticated;

create or replace function public.asistencia_rango(p_from date, p_to date, p_tolerancia int default 5)
returns table (
  user_id uuid, full_name text, department text, date date,
  laborable boolean, inicio_programado_min int, fin_programado_min int,
  entrada timestamptz, ubicacion text, retardo_min int,
  primera_actividad timestamptz, primera_actividad_tipo text, ultima_actividad timestamptz,
  salida timestamptz, salida_automatica boolean, minutos_regulares int, minutos_extra int,
  estado text)
language sql stable security definer set search_path = public as $$
  select a.*
    from generate_series(p_from, p_to, interval '1 day') d
    cross join lateral public.asistencia_rango_interno(d::date, p_tolerancia) a
   where public.is_active_admin() or a.user_id = auth.uid()
   order by a.date, a.full_name;
$$;

-- 11. Alertas a administradores (tipo de notificación nuevo: 'attendance').
--     IMPORTANTE: reemplaza la lista con la que salga en la consulta de revisión + 'attendance'.
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'notifications_type_check') then
    alter table public.notifications drop constraint notifications_type_check;
  end if;
  alter table public.notifications add constraint notifications_type_check
    check (type in ('task', 'review', 'approval', 'change_request', 'comment', 'deadline', 'task_request', 'client_delay', 'attendance'));
end $$;

create table if not exists public.attendance_alerts (
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  kind text not null,                       -- 'sin_registro' | 'resumen'
  created_at timestamptz not null default now(),
  primary key (user_id, date, kind)
);
alter table public.attendance_alerts enable row level security;  -- sin políticas: solo funciones security definer

-- Cada 15 min: avisa a los admins si alguien con jornada hoy no ha checado 30 min después de su hora de entrada.
create or replace function public.revisar_asistencia()
returns void language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Mexico_City')::date; r record;
begin
  for r in
    select x.user_id, x.full_name, x.inicio_programado_min
      from public.asistencia_rango_interno(v_today) x
     where x.estado = 'sin_registro'
       and not exists (select 1 from public.attendance_alerts aa where aa.user_id = x.user_id and aa.date = v_today and aa.kind = 'sin_registro')
  loop
    insert into public.attendance_alerts (user_id, date, kind) values (r.user_id, v_today, 'sin_registro');
    insert into public.notifications (user_id, title, message, type)
    select u.id, '⏰ Sin registro de entrada',
           r.full_name || ' no ha registrado su entrada (horario ' ||
           lpad((r.inicio_programado_min / 60)::text, 2, '0') || ':' || lpad((r.inicio_programado_min % 60)::text, 2, '0') || ').',
           'attendance'
      from public.users u
     where (u.role = 'admin' or u.is_super_admin) and coalesce(u.active, true);
  end loop;
end;
$$;

-- Resumen diario a las 9:30 CDMX para los admins: a tiempo, retardos (con minutos) y sin registro.
-- Una sola vez por día (attendance_alerts con kind = 'resumen' y user_id del admin).
create or replace function public.resumen_asistencia_diario()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/Mexico_City')::date;
  r record;
  v_a_tiempo int := 0;
  v_retardo_count int := 0;
  v_sin_registro_count int := 0;
  v_pendiente int := 0;
  v_retardos text := '';
  v_sin_registro_nombres text := '';
  v_message text;
begin
  for r in select * from public.asistencia_rango_interno(v_today) where laborable loop
    if r.estado = 'a_tiempo' then
      v_a_tiempo := v_a_tiempo + 1;
    elsif r.estado = 'retardo' then
      v_retardo_count := v_retardo_count + 1;
      v_retardos := v_retardos || case when v_retardos = '' then '' else ', ' end
        || r.full_name || ' +' || coalesce(r.retardo_min, 0) || ' min';
    elsif r.estado = 'sin_registro' then
      v_sin_registro_count := v_sin_registro_count + 1;
      v_sin_registro_nombres := v_sin_registro_nombres || case when v_sin_registro_nombres = '' then '' else ', ' end || r.full_name;
    elsif r.estado = 'pendiente' then
      v_pendiente := v_pendiente + 1;
    end if;
  end loop;

  v_message := 'Asistencia ' || to_char(v_today, 'DD/MM') || ' · ' || v_a_tiempo || ' a tiempo';
  if v_retardo_count > 0 then
    v_message := v_message || ' · ' || v_retardo_count || ' retardo' || (case when v_retardo_count = 1 then '' else 's' end) || ' (' || v_retardos || ')';
  end if;
  if v_sin_registro_count > 0 then
    v_message := v_message || ' · ' || v_sin_registro_count || ' sin registro (' || v_sin_registro_nombres || ')';
  end if;
  if v_pendiente > 0 then
    v_message := v_message || ' · ' || v_pendiente || ' pendiente' || (case when v_pendiente = 1 then '' else 's' end);
  end if;

  insert into public.notifications (user_id, title, message, type)
  select u.id, '📋 Resumen de asistencia', v_message, 'attendance'
    from public.users u
   where (u.role = 'admin' or u.is_super_admin) and coalesce(u.active, true)
     and not exists (
       select 1 from public.attendance_alerts aa
        where aa.user_id = u.id and aa.date = v_today and aa.kind = 'resumen'
     );

  insert into public.attendance_alerts (user_id, date, kind)
  select u.id, v_today, 'resumen'
    from public.users u
   where (u.role = 'admin' or u.is_super_admin) and coalesce(u.active, true)
     and not exists (
       select 1 from public.attendance_alerts aa
        where aa.user_id = u.id and aa.date = v_today and aa.kind = 'resumen'
     );
end;
$$;

-- 12. Permisos: escrituras solo vía RPC.
alter table public.work_sessions enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'work_sessions' loop
    execute format('drop policy %I on public.work_sessions', p.policyname);
  end loop;
end $$;
create policy "Ver sesiones propias o admin" on public.work_sessions
  for select to authenticated using (user_id = auth.uid() or public.is_active_admin());

-- En Supabase, las funciones nuevas reciben EXECUTE directo para anon y authenticated
-- (default privileges), así que "revoke ... from public" no basta: se revoca también a esos roles.
-- Funciones internas (solo triggers, otras funciones security definer y pg_cron): nadie desde la API.
revoke all on function public.work_day_schedule(uuid, date) from public, anon, authenticated;
revoke all on function public.work_session_minutes(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.record_user_activity(text) from public, anon, authenticated;
revoke all on function public.trg_activity_task_update() from anon;
revoke all on function public.trg_activity_generic() from anon;
revoke all on function public.asistencia_rango_interno(date, int) from public, anon, authenticated;
revoke all on function public.cerrar_sesiones_olvidadas() from public, anon, authenticated;
revoke all on function public.revisar_asistencia() from public, anon, authenticated;
revoke all on function public.resumen_asistencia_diario() from public, anon, authenticated;
-- Funciones que usa la app: solo usuarios con sesión iniciada (nunca anon).
revoke all on function public.registrar_entrada(text) from public, anon;
revoke all on function public.registrar_salida() from public, anon;
revoke all on function public.mi_sesion_hoy() from public, anon;
revoke all on function public.admin_corregir_sesion(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.asistencia_rango(date, date, int) from public, anon;
grant execute on function public.registrar_entrada(text) to authenticated;
grant execute on function public.registrar_salida() to authenticated;
grant execute on function public.mi_sesion_hoy() to authenticated;
grant execute on function public.admin_corregir_sesion(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.asistencia_rango(date, date, int) to authenticated;
-- Tablas nuevas: sin escritura desde la API (RLS ya lo bloquea; esto es una segunda capa).
revoke insert, update, delete, truncate on public.user_daily_activity from anon, authenticated;
revoke insert, update, delete, truncate on public.attendance_alerts from anon, authenticated;
revoke insert, update, delete, truncate on public.work_session_corrections from anon, authenticated;
revoke all on public.user_daily_activity, public.attendance_alerts, public.work_session_corrections from anon;

-- 13. Jobs (pg_cron trabaja en UTC; CDMX = UTC-6).
select cron.unschedule(jobid) from cron.job where jobname in
  ('checador-cerrar-olvidadas', 'checador-revisar-asistencia', 'checador-resumen-diario');
select cron.schedule('checador-cerrar-olvidadas', '15 6 * * *', $$select public.cerrar_sesiones_olvidadas()$$);   -- 00:15 CDMX
select cron.schedule('checador-revisar-asistencia', '*/15 13-20 * * 1-6', $$select public.revisar_asistencia()$$); -- 7:00–14:45 CDMX, L-S
select cron.schedule('checador-resumen-diario', '30 15 * * 1-6', $$select public.resumen_asistencia_diario()$$);    -- 9:30 CDMX, L-S

commit;

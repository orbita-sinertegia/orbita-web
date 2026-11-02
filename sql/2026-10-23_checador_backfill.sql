-- Checador v2 — backfill opcional, paso 3b del despliegue (ver DOCUMENTACION.md → "Checador v2").
-- Correr DESPUÉS de 2026-10-23_checador_servidor.sql. No es obligatorio para que el checador
-- funcione (las sesiones viejas simplemente aparecerán con scheduled_start_min = null y
-- late_minutes = 0, es decir "a tiempo" en los reportes), pero sin esto el historial no
-- reflejará los retardos reales de antes de hoy.
-- Idempotente: se puede correr más de una vez, siempre recalcula a partir de started_at.

begin;

-- 1. Solo la primera sesión de cada persona/día cuenta como "primera entrada" (is_first_of_day).
--    Las migraciones anteriores a este archivo insertaron todas las filas con el valor por
--    defecto (true); aquí se corrige para los días con más de una sesión.
with primeras as (
  select distinct on (user_id, date) id
  from public.work_sessions
  order by user_id, date, started_at
)
update public.work_sessions s
   set is_first_of_day = (s.id in (select id from primeras))
 where s.is_first_of_day is distinct from (s.id in (select id from primeras));

-- 2. Retardo histórico: a partir de started_at (hora CDMX) y el horario de esa persona en esa
--    fecha. Las sesiones que no son la primera del día quedan en 0 (no se usan para puntualidad).
update public.work_sessions s
   set scheduled_start_min = round((sch.sch->>'start')::numeric * 60)::int,
       late_minutes = greatest(0,
         (extract(hour from s.started_at at time zone 'America/Mexico_City') * 60
          + extract(minute from s.started_at at time zone 'America/Mexico_City'))::int
         - round((sch.sch->>'start')::numeric * 60)::int)
  from (
    select s2.id, public.work_day_schedule(s2.user_id, s2.date) as sch
    from public.work_sessions s2
    where s2.is_first_of_day
  ) sch
 where s.id = sch.id
   and coalesce((sch.sch->>'enabled')::boolean, false);

commit;

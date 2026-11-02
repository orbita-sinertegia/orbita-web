-- Jornada semanal configurable por persona. Las claves 0..6 siguen getDay(): domingo..sábado.
alter table public.users
  add column if not exists work_schedule jsonb;

update public.users
set work_schedule = jsonb_build_object(
  '0', jsonb_build_object('enabled', false, 'start', 9, 'end', 18),
  '1', jsonb_build_object('enabled', true, 'start', coalesce(work_start, 9), 'end', coalesce(work_end, 18)),
  '2', jsonb_build_object('enabled', true, 'start', coalesce(work_start, 9), 'end', coalesce(work_end, 18)),
  '3', jsonb_build_object('enabled', true, 'start', coalesce(work_start, 9), 'end', coalesce(work_end, 18)),
  '4', jsonb_build_object('enabled', true, 'start', coalesce(work_start, 9), 'end', coalesce(work_end, 18)),
  '5', jsonb_build_object('enabled', true, 'start', coalesce(work_start, 9), 'end', coalesce(work_end, 18)),
  '6', jsonb_build_object('enabled', true, 'start', 9, 'end', 14)
)
where work_schedule is null;

alter table public.users
  alter column work_schedule set default jsonb_build_object(
    '0', jsonb_build_object('enabled', false, 'start', 9, 'end', 18),
    '1', jsonb_build_object('enabled', true, 'start', 9, 'end', 18),
    '2', jsonb_build_object('enabled', true, 'start', 9, 'end', 18),
    '3', jsonb_build_object('enabled', true, 'start', 9, 'end', 18),
    '4', jsonb_build_object('enabled', true, 'start', 9, 'end', 18),
    '5', jsonb_build_object('enabled', true, 'start', 9, 'end', 18),
    '6', jsonb_build_object('enabled', true, 'start', 9, 'end', 14)
  );

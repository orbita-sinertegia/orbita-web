-- Citas de Órbita: solicitudes, programación, respuestas, asistencia, acuerdos e historial.
-- Correr completo en el SQL Editor de Supabase. Si una prueba falla, no se aplica nada.
-- Se puede correr más de una vez.
--
-- Reglas:
-- * Cualquier usuario activo solicita una cita (un cliente, solo de sus proyectos).
-- * Solo los administradores activos coordinan: programan, cancelan, inician y cierran.
-- * Cada quien ve solo las citas donde participa o que pidió; los admins ven todas.
-- * Un participante obligatorio no puede tener dos citas empalmadas. Con opcionales solo se avisa.
-- * Las tablas solo se leen; todo cambio pasa por las funciones de abajo.
begin;

create extension if not exists btree_gist with schema extensions;

-- 1. Tablas -----------------------------------------------------------------------------

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  kind text not null check (kind in ('grabacion', 'reunion', 'entrevista', 'accesos')),
  title text not null check (length(trim(title)) between 3 and 140),
  reason text check (reason is null or length(reason) <= 2000),
  status text not null default 'solicitada'
    check (status in ('solicitada', 'programada', 'en_curso', 'realizada', 'incompleta', 'cancelada')),
  modality text check (modality in ('presencial', 'virtual')),
  location text check (location is null or length(location) <= 200),
  meeting_url text check (meeting_url is null or meeting_url ~ '^https://'),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/Mexico_City',
  proposed_slots jsonb not null default '[]'::jsonb,
  related_task_id uuid references public.tasks(id) on delete set null,
  related_task_title text,
  requested_by uuid references public.users(id) on delete set null,
  coordinator_id uuid references public.users(id) on delete set null,
  cancel_reason text,
  close_note text,
  started_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_horario check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint appointments_programada_completa check (
    status in ('solicitada', 'cancelada') or (starts_at is not null and ends_at is not null and modality is not null)
  )
);

create index if not exists appointments_project_idx on public.appointments(project_id);
create index if not exists appointments_starts_idx on public.appointments(starts_at);
create index if not exists appointments_status_idx on public.appointments(status);

create table if not exists public.appointment_participants (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_label text,
  required boolean not null default true,
  response text not null default 'pendiente'
    check (response in ('pendiente', 'aceptada', 'rechazada', 'cambio_solicitado')),
  response_note text check (response_note is null or length(response_note) <= 1000),
  proposed_slots jsonb not null default '[]'::jsonb,
  responded_at timestamptz,
  attendance text check (attendance in ('presente', 'ausente')),
  -- Horario que ocupa esta persona. Lo llena app_sync_appointment_slots; vacío si no aplica.
  slot tstzrange,
  primary key (appointment_id, user_id)
);

create index if not exists appointment_participants_user_idx on public.appointment_participants(user_id);

-- Respaldo contra empalmes entre obligatorios, aunque dos admins publiquen a la vez.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'appointment_participants_sin_empalmes') then
    alter table public.appointment_participants add constraint appointment_participants_sin_empalmes
      exclude using gist (user_id with =, slot with &&) where (required and slot is not null);
  end if;
end $$;

create table if not exists public.appointment_agreements (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  body text not null check (length(trim(body)) between 2 and 1000),
  visible_to_client boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists appointment_agreements_appointment_idx on public.appointment_agreements(appointment_id);

create table if not exists public.appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists appointment_events_appointment_idx on public.appointment_events(appointment_id, created_at);

-- Avisos de citas en la campana.
alter table public.notifications add column if not exists appointment_id uuid
  references public.appointments(id) on delete cascade;

do $$
declare
  definicion text;
  tipos text[];
begin
  select pg_get_constraintdef(oid) into definicion from pg_constraint where conname = 'notifications_type_check';
  if definicion is null then return; end if;
  if definicion like '%''appointment''%' then return; end if;
  select array_agg(distinct r.m[1]) into tipos from regexp_matches(definicion, '''([a-z_]+)''', 'g') as r(m);
  tipos := array_append(tipos, 'appointment');
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', tipos);
end $$;

-- 2. Funciones de apoyo ------------------------------------------------------------------

create or replace function public.app_is_appointment_member(p_appointment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.appointment_participants where appointment_id = p_appointment_id and user_id = auth.uid())
      or exists (select 1 from public.appointments where id = p_appointment_id and requested_by = auth.uid());
$$;

create or replace function public.app_appointment_kind_label(p_kind text)
returns text language sql immutable as $$
  select case p_kind
    when 'grabacion' then 'Grabación'
    when 'reunion' then 'Reunión'
    when 'entrevista' then 'Entrevista'
    when 'accesos' then 'Accesos a cuentas'
    else p_kind end;
$$;

-- Grabación es presencial (estudio); entrevistas, reuniones y accesos a cuentas, virtuales.
create or replace function public.app_appointment_suggested_modality(p_kind text)
returns text language sql immutable as $$
  select case when p_kind = 'grabacion' then 'presencial' else 'virtual' end;
$$;

-- Valida 1 a 3 horarios propuestos: [{"starts_at": "...", "ends_at": "..."}].
create or replace function public.app_validate_slots(p_slots jsonb, p_min int)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  item jsonb;
  inicio timestamptz;
  fin timestamptz;
  limpio jsonb := '[]'::jsonb;
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then p_slots := '[]'::jsonb; end if;
  if jsonb_array_length(p_slots) < p_min or jsonb_array_length(p_slots) > 3 then
    raise exception 'Propón de % a 3 horarios', p_min;
  end if;
  for item in select * from jsonb_array_elements(p_slots) loop
    begin
      inicio := (item->>'starts_at')::timestamptz;
      fin := (item->>'ends_at')::timestamptz;
    exception when others then
      raise exception 'Horario propuesto no válido';
    end;
    if inicio is null or fin is null or fin <= inicio then raise exception 'Cada horario debe terminar después de empezar'; end if;
    if inicio < now() then raise exception 'Los horarios propuestos deben ser futuros'; end if;
    if fin - inicio > interval '12 hours' then raise exception 'Un horario no puede durar más de 12 horas'; end if;
    limpio := limpio || jsonb_build_array(jsonb_build_object('starts_at', inicio, 'ends_at', fin));
  end loop;
  return limpio;
end;
$$;

-- Recalcula el horario que ocupa cada participante según el estado de la cita.
create or replace function public.app_sync_appointment_slots(p_appointment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cita public.appointments;
begin
  select * into cita from public.appointments where id = p_appointment_id;
  update public.appointment_participants p
  set slot = case
    when cita.status in ('programada', 'en_curso') and p.response <> 'rechazada'
      then tstzrange(cita.starts_at, cita.ends_at, '[)')
    else null end
  where p.appointment_id = p_appointment_id;
exception when exclusion_violation then
  raise exception 'CONFLICTO: un participante obligatorio ya tiene otra cita en ese horario';
end;
$$;

create or replace function public.app_appointment_log(p_appointment_id uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.appointment_events (appointment_id, actor_id, action, detail)
  values (p_appointment_id, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function public.app_appointment_notify(p_appointment_id uuid, p_user_ids uuid[], p_title text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, message, type, appointment_id, read)
  select distinct u, p_title, p_message, 'appointment', p_appointment_id, false
  from unnest(p_user_ids) as u
  where u is not null and u <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
$$;

create or replace function public.app_active_admin_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.users
  where (role = 'admin' or is_super_admin = true) and coalesce(active, true);
$$;

create or replace function public.app_appointment_when(p_starts timestamptz, p_tz text)
returns text language sql stable as $$
  select to_char(p_starts at time zone coalesce(p_tz, 'America/Mexico_City'), 'DD/MM/YYYY HH24:MI');
$$;

-- 3. Funciones de la app -----------------------------------------------------------------

-- Ocupados en un horario: lo usa "Programar cita" para mostrar Libre / Ocupado.
create or replace function public.check_appointment_conflicts(
  p_starts timestamptz, p_ends timestamptz, p_user_ids uuid[], p_exclude_appointment uuid default null
) returns table (user_id uuid, full_name text, appointment_id uuid, appointment_title text, required_there boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador puede coordinar citas'; end if;
  return query
  select p.user_id, u.full_name, a.id, a.title, p.required
  from public.appointment_participants p
  join public.appointments a on a.id = p.appointment_id
  join public.users u on u.id = p.user_id
  where p.user_id = any(p_user_ids)
    and p.slot is not null
    and p.slot && tstzrange(p_starts, p_ends, '[)')
    and a.id is distinct from p_exclude_appointment;
end;
$$;

-- Solicitar una cita (cliente o equipo). No reserva horario: un admin la programa.
create or replace function public.request_appointment(
  p_project_id uuid, p_kind text, p_reason text, p_slots jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  yo public.users;
  proyecto public.projects;
  horarios jsonb;
  nueva uuid;
begin
  select * into yo from public.users where id = auth.uid();
  if yo.id is null or not coalesce(yo.active, true) then raise exception 'Tu cuenta no está activa'; end if;
  if p_kind not in ('grabacion', 'reunion', 'entrevista', 'accesos') then raise exception 'Tipo de cita no válido'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo de la cita'; end if;

  if p_project_id is not null then
    select * into proyecto from public.projects where id = p_project_id;
    if proyecto.id is null then raise exception 'El proyecto no existe'; end if;
  end if;
  if yo.role = 'client' and (p_project_id is null or not public.app_client_owns_project(p_project_id)) then
    raise exception 'Elige uno de tus proyectos';
  end if;

  horarios := public.app_validate_slots(p_slots, 1);

  insert into public.appointments (project_id, kind, title, reason, status, modality, proposed_slots, requested_by)
  values (
    p_project_id, p_kind,
    public.app_appointment_kind_label(p_kind) || coalesce(' · ' || proyecto.name, ''),
    trim(p_reason), 'solicitada', public.app_appointment_suggested_modality(p_kind), horarios, yo.id
  ) returning id into nueva;

  perform public.app_appointment_log(nueva, 'solicitada', jsonb_build_object('slots', horarios));
  perform public.app_appointment_notify(nueva, public.app_active_admin_ids(),
    '📅 Nueva solicitud de cita',
    yo.full_name || ' solicitó ' || lower(public.app_appointment_kind_label(p_kind)) || coalesce(' para ' || proyecto.name, '') || '.');
  return nueva;
end;
$$;

-- Programar (o reprogramar) una cita. Solo admins. Si p_appointment_id es null, crea una nueva.
-- p_participants: [{"user_id": "...", "required": true, "role_label": "Cliente"}]
create or replace function public.schedule_appointment(
  p_appointment_id uuid,
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_modality text,
  p_location text,
  p_meeting_url text,
  p_participants jsonb,
  p_related_task_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cita public.appointments;
  tarea public.tasks;
  id_cita uuid := p_appointment_id;
  reprogramada boolean := false;
  item jsonb;
  ocupados text;
  invitados uuid[];
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador puede programar citas'; end if;
  if p_kind not in ('grabacion', 'reunion', 'entrevista', 'accesos') then raise exception 'Tipo de cita no válido'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Escribe el título de la cita'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'La cita debe terminar después de empezar'; end if;
  if p_starts < now() - interval '5 minutes' then raise exception 'La cita debe ser en el futuro'; end if;
  if p_ends - p_starts > interval '12 hours' then raise exception 'Una cita no puede durar más de 12 horas'; end if;
  if p_modality not in ('presencial', 'virtual') then raise exception 'Elige presencial o virtual'; end if;
  if p_modality = 'presencial' and length(trim(coalesce(p_location, ''))) < 2 then raise exception 'Escribe el lugar de la cita'; end if;
  if p_modality = 'virtual' and coalesce(p_meeting_url, '') !~ '^https://' then raise exception 'Pega el enlace de Meet o Zoom (debe empezar con https://)'; end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then raise exception 'El proyecto no existe'; end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' or jsonb_array_length(p_participants) = 0 then
    raise exception 'Agrega al menos un invitado';
  end if;

  if p_related_task_id is not null then
    select * into tarea from public.tasks where id = p_related_task_id;
    if tarea.id is null then raise exception 'La tarea de referencia no existe'; end if;
  end if;

  if id_cita is not null then
    select * into cita from public.appointments where id = id_cita for update;
    if cita.id is null then raise exception 'La cita no existe'; end if;
    if cita.status not in ('solicitada', 'programada') then raise exception 'Esta cita ya no se puede programar'; end if;
    reprogramada := cita.status = 'programada';
  end if;

  select array_agg(distinct (x->>'user_id')::uuid) into invitados from jsonb_array_elements(p_participants) x;
  if exists (
    select 1 from unnest(invitados) u
    left join public.users us on us.id = u
    where us.id is null or not coalesce(us.active, true)
  ) then raise exception 'Hay invitados que no existen o están desactivados'; end if;

  -- Bloqueo: invitados obligatorios ocupados (en cualquier otra cita).
  select string_agg(distinct u.full_name, ', ') into ocupados
  from jsonb_array_elements(p_participants) x
  join public.appointment_participants p on p.user_id = (x->>'user_id')::uuid
  join public.users u on u.id = p.user_id
  where coalesce((x->>'required')::boolean, true)
    and p.slot is not null
    and p.slot && tstzrange(p_starts, p_ends, '[)')
    and p.appointment_id is distinct from id_cita;
  if ocupados is not null then raise exception 'CONFLICTO: % ya tiene otra cita en ese horario', ocupados; end if;

  if id_cita is null then
    insert into public.appointments (project_id, kind, title, status, modality, location, meeting_url, starts_at, ends_at,
      related_task_id, related_task_title, requested_by, coordinator_id)
    values (p_project_id, p_kind, trim(p_title), 'programada', p_modality,
      case when p_modality = 'presencial' then trim(p_location) end,
      case when p_modality = 'virtual' then trim(p_meeting_url) end,
      p_starts, p_ends, tarea.id, tarea.title, auth.uid(), auth.uid())
    returning id into id_cita;
  else
    update public.appointments set
      project_id = p_project_id, kind = p_kind, title = trim(p_title), status = 'programada', modality = p_modality,
      location = case when p_modality = 'presencial' then trim(p_location) end,
      meeting_url = case when p_modality = 'virtual' then trim(p_meeting_url) end,
      starts_at = p_starts, ends_at = p_ends, related_task_id = tarea.id, related_task_title = tarea.title,
      coordinator_id = auth.uid(), updated_at = now()
    where id = id_cita;
  end if;

  -- Invitados: se quitan los que ya no van y se reinician las respuestas.
  delete from public.appointment_participants where appointment_id = id_cita and user_id <> all(invitados) and user_id <> auth.uid();
  for item in select * from jsonb_array_elements(p_participants) loop
    insert into public.appointment_participants (appointment_id, user_id, required, role_label)
    values (id_cita, (item->>'user_id')::uuid, coalesce((item->>'required')::boolean, true), nullif(trim(item->>'role_label'), ''))
    on conflict (appointment_id, user_id) do update set
      required = excluded.required, role_label = excluded.role_label,
      response = 'pendiente', response_note = null, proposed_slots = '[]'::jsonb, responded_at = null, slot = null;
  end loop;
  insert into public.appointment_participants (appointment_id, user_id, required, role_label, response, responded_at)
  values (id_cita, auth.uid(), true, 'Coordinador', 'aceptada', now())
  on conflict (appointment_id, user_id) do update set
    role_label = 'Coordinador', required = true, response = 'aceptada', responded_at = now(), response_note = null;

  perform public.app_sync_appointment_slots(id_cita);
  perform public.app_appointment_log(id_cita, case when reprogramada then 'reprogramada' else 'programada' end,
    jsonb_build_object('starts_at', p_starts, 'ends_at', p_ends, 'modality', p_modality));
  perform public.app_appointment_notify(id_cita, invitados,
    case when reprogramada then '🔁 Cita reprogramada' else '📅 Nueva cita' end,
    trim(p_title) || ' · ' || public.app_appointment_when(p_starts, 'America/Mexico_City') || ' · ' ||
    case when p_modality = 'presencial' then 'Presencial' else 'Virtual' end || '. Confirma si asistirás.');
  return id_cita;
end;
$$;

-- Responder como participante: aceptar, rechazar (con motivo) o proponer otro horario.
create or replace function public.respond_appointment(
  p_appointment_id uuid, p_response text, p_note text default null, p_slots jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  cita public.appointments;
  yo public.users;
  horarios jsonb := '[]'::jsonb;
begin
  select * into yo from public.users where id = auth.uid();
  if yo.id is null or not coalesce(yo.active, true) then raise exception 'Tu cuenta no está activa'; end if;
  select * into cita from public.appointments where id = p_appointment_id;
  if cita.id is null then raise exception 'La cita no existe'; end if;
  if not exists (select 1 from public.appointment_participants where appointment_id = cita.id and user_id = yo.id) then
    raise exception 'No estás invitado a esta cita';
  end if;
  if cita.status <> 'programada' then raise exception 'Esta cita ya no admite respuestas'; end if;
  if p_response not in ('aceptada', 'rechazada', 'cambio_solicitado') then raise exception 'Respuesta no válida'; end if;
  if p_response = 'rechazada' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe el motivo del rechazo'; end if;
  if p_response = 'cambio_solicitado' then horarios := public.app_validate_slots(p_slots, 1); end if;

  update public.appointment_participants set
    response = p_response, response_note = nullif(trim(coalesce(p_note, '')), ''),
    proposed_slots = horarios, responded_at = now()
  where appointment_id = cita.id and user_id = yo.id;

  perform public.app_sync_appointment_slots(cita.id);
  perform public.app_appointment_log(cita.id, 'respuesta_' || p_response,
    jsonb_build_object('note', p_note, 'slots', horarios));
  perform public.app_appointment_notify(cita.id, array[cita.coordinator_id],
    case p_response when 'aceptada' then '✅ Cita aceptada' when 'rechazada' then '❌ Cita rechazada' else '🔁 Piden otro horario' end,
    yo.full_name || case p_response
      when 'aceptada' then ' asistirá a "' || cita.title || '".'
      when 'rechazada' then ' no asistirá a "' || cita.title || '": ' || trim(p_note)
      else ' propone otro horario para "' || cita.title || '".' end);
end;
$$;

-- Cancelar: un admin, o quien la pidió mientras sigue solicitada.
create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cita public.appointments;
  avisar uuid[];
begin
  select * into cita from public.appointments where id = p_appointment_id for update;
  if cita.id is null then raise exception 'La cita no existe'; end if;
  if not (public.is_active_admin() or (cita.requested_by = auth.uid() and cita.status = 'solicitada')) then
    raise exception 'No puedes cancelar esta cita';
  end if;
  if cita.status not in ('solicitada', 'programada') then raise exception 'Esta cita ya no se puede cancelar'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo de la cancelación'; end if;

  update public.appointments set status = 'cancelada', cancel_reason = trim(p_reason), updated_at = now() where id = cita.id;
  perform public.app_sync_appointment_slots(cita.id);
  perform public.app_appointment_log(cita.id, 'cancelada', jsonb_build_object('reason', p_reason));

  select coalesce(array_agg(user_id), '{}') into avisar from public.appointment_participants where appointment_id = cita.id;
  avisar := avisar || cita.requested_by;
  if not public.is_active_admin() then avisar := avisar || public.app_active_admin_ids(); end if;
  perform public.app_appointment_notify(cita.id, avisar, '🚫 Cita cancelada', '"' || cita.title || '": ' || trim(p_reason));
end;
$$;

-- Iniciar la cita (pasa a "en curso").
create or replace function public.start_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cita public.appointments;
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador puede iniciar citas'; end if;
  select * into cita from public.appointments where id = p_appointment_id for update;
  if cita.id is null then raise exception 'La cita no existe'; end if;
  if cita.status <> 'programada' then raise exception 'Solo se inicia una cita programada'; end if;
  if now() < cita.starts_at - interval '1 hour' then raise exception 'La cita solo se puede iniciar desde una hora antes'; end if;
  update public.appointments set status = 'en_curso', started_at = now(), updated_at = now() where id = cita.id;
  perform public.app_appointment_log(cita.id, 'iniciada');
end;
$$;

create or replace function public.set_appointment_attendance(p_appointment_id uuid, p_user_id uuid, p_attendance text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador registra la asistencia'; end if;
  if p_attendance not in ('presente', 'ausente') then raise exception 'Asistencia no válida'; end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and status = 'en_curso') then
    raise exception 'La asistencia solo se registra con la cita en curso';
  end if;
  update public.appointment_participants set attendance = p_attendance
  where appointment_id = p_appointment_id and user_id = p_user_id;
  if not found then raise exception 'Esa persona no está invitada'; end if;
  perform public.app_appointment_log(p_appointment_id, 'asistencia', jsonb_build_object('user_id', p_user_id, 'attendance', p_attendance));
end;
$$;

create or replace function public.add_appointment_agreement(p_appointment_id uuid, p_body text, p_visible_to_client boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nuevo uuid;
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador registra acuerdos'; end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and status in ('en_curso', 'realizada', 'incompleta')) then
    raise exception 'Los acuerdos se registran durante o después de la cita';
  end if;
  if length(trim(coalesce(p_body, ''))) < 2 then raise exception 'Escribe el acuerdo'; end if;
  insert into public.appointment_agreements (appointment_id, body, visible_to_client, created_by)
  values (p_appointment_id, trim(p_body), coalesce(p_visible_to_client, false), auth.uid())
  returning id into nuevo;
  perform public.app_appointment_log(p_appointment_id, 'acuerdo', jsonb_build_object('agreement_id', nuevo));
  return nuevo;
end;
$$;

create or replace function public.delete_appointment_agreement(p_agreement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cita uuid;
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador borra acuerdos'; end if;
  delete from public.appointment_agreements where id = p_agreement_id returning appointment_id into cita;
  if cita is null then raise exception 'El acuerdo no existe'; end if;
  perform public.app_appointment_log(cita, 'acuerdo_borrado', jsonb_build_object('agreement_id', p_agreement_id));
end;
$$;

-- Cerrar la cita: realizada o incompleta. Libera los horarios.
create or replace function public.close_appointment(p_appointment_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cita public.appointments;
  avisar uuid[];
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador cierra citas'; end if;
  if p_status not in ('realizada', 'incompleta') then raise exception 'Cierre no válido'; end if;
  select * into cita from public.appointments where id = p_appointment_id for update;
  if cita.id is null then raise exception 'La cita no existe'; end if;
  if cita.status <> 'en_curso' then raise exception 'Solo se cierra una cita en curso'; end if;
  if p_status = 'incompleta' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Explica por qué quedó incompleta'; end if;

  update public.appointments set status = p_status, close_note = nullif(trim(coalesce(p_note, '')), ''),
    closed_at = now(), updated_at = now() where id = cita.id;
  perform public.app_sync_appointment_slots(cita.id);
  perform public.app_appointment_log(cita.id, p_status, jsonb_build_object('note', p_note));

  select coalesce(array_agg(user_id), '{}') into avisar from public.appointment_participants where appointment_id = cita.id;
  perform public.app_appointment_notify(cita.id, avisar,
    case when p_status = 'realizada' then '✅ Cita realizada' else '⚠️ Cita incompleta' end,
    '"' || cita.title || '" se cerró. Revisa los acuerdos en el detalle.');
end;
$$;

-- 4. Permisos ---------------------------------------------------------------------------

alter table public.appointments enable row level security;
alter table public.appointment_participants enable row level security;
alter table public.appointment_agreements enable row level security;
alter table public.appointment_events enable row level security;

revoke all on public.appointments, public.appointment_participants, public.appointment_agreements, public.appointment_events from anon, authenticated, public;
grant select on public.appointments, public.appointment_participants, public.appointment_agreements, public.appointment_events to authenticated;

drop policy if exists "citas_ver" on public.appointments;
create policy "citas_ver" on public.appointments for select to authenticated
  using (public.is_active_admin() or public.app_is_appointment_member(id));

drop policy if exists "participantes_ver" on public.appointment_participants;
create policy "participantes_ver" on public.appointment_participants for select to authenticated
  using (public.is_active_admin() or public.app_is_appointment_member(appointment_id));

-- Los clientes solo ven los acuerdos marcados como visibles para ellos.
drop policy if exists "acuerdos_ver" on public.appointment_agreements;
create policy "acuerdos_ver" on public.appointment_agreements for select to authenticated
  using (
    public.is_active_admin()
    or (public.app_is_appointment_member(appointment_id) and (visible_to_client or public.app_is_staff()))
  );

drop policy if exists "historial_ver" on public.appointment_events;
create policy "historial_ver" on public.appointment_events for select to authenticated
  using (public.is_active_admin() or (public.app_is_staff() and public.app_is_appointment_member(appointment_id)));

do $$
declare
  f text;
begin
  foreach f in array array[
    'app_is_appointment_member(uuid)', 'app_validate_slots(jsonb, integer)', 'app_sync_appointment_slots(uuid)',
    'app_appointment_log(uuid, text, jsonb)', 'app_appointment_notify(uuid, uuid[], text, text)', 'app_active_admin_ids()',
    'check_appointment_conflicts(timestamptz, timestamptz, uuid[], uuid)',
    'request_appointment(uuid, text, text, jsonb)',
    'schedule_appointment(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, jsonb, uuid)',
    'respond_appointment(uuid, text, text, jsonb)', 'cancel_appointment(uuid, text)', 'start_appointment(uuid)',
    'set_appointment_attendance(uuid, uuid, text)', 'add_appointment_agreement(uuid, text, boolean)',
    'delete_appointment_agreement(uuid)', 'close_appointment(uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  -- Las internas no se llaman desde la app.
  foreach f in array array[
    'app_validate_slots(jsonb, integer)', 'app_sync_appointment_slots(uuid)', 'app_appointment_log(uuid, text, jsonb)',
    'app_appointment_notify(uuid, uuid[], text, text)', 'app_active_admin_ids()'
  ] loop
    execute format('revoke all on function public.%s from authenticated', f);
  end loop;
  foreach f in array array[
    'app_is_appointment_member(uuid)',
    'check_appointment_conflicts(timestamptz, timestamptz, uuid[], uuid)',
    'request_appointment(uuid, text, text, jsonb)',
    'schedule_appointment(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, jsonb, uuid)',
    'respond_appointment(uuid, text, text, jsonb)', 'cancel_appointment(uuid, text)', 'start_appointment(uuid)',
    'set_appointment_attendance(uuid, uuid, text)', 'add_appointment_agreement(uuid, text, boolean)',
    'delete_appointment_agreement(uuid)', 'close_appointment(uuid, text, text)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Actualizaciones en vivo para la app.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'appointments') then
    alter publication supabase_realtime add table public.appointments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'appointment_participants') then
    alter publication supabase_realtime add table public.appointment_participants;
  end if;
end $$;

-- 5. Pruebas (todo lo que crean se deshace) ----------------------------------------------

do $$
declare
  admin_id uuid;
  otro_id uuid;
  cita1 uuid;
  cita2 uuid;
  mensaje text;
  inicio timestamptz := date_trunc('hour', now()) + interval '30 days';
begin
  select id into admin_id from public.users where (role = 'admin' or is_super_admin = true) and coalesce(active, true) limit 1;
  if admin_id is null then raise exception 'PRUEBA FALLIDA: no hay administrador activo'; end if;
  select id into otro_id from public.users where id <> admin_id and coalesce(active, true) limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  begin
    perform public.request_appointment(null, 'reunion', 'Prueba', '[]'::jsonb);
    raise exception 'PRUEBA FALLIDA: se aceptó una solicitud sin horarios';
  exception when raise_exception then
    get stacked diagnostics mensaje = message_text;
    if mensaje like 'PRUEBA FALLIDA%' then raise; end if;
  end;

  begin
    perform public.schedule_appointment(null, null, 'entrevista', 'Prueba virtual', inicio, inicio + interval '1 hour',
      'virtual', null, 'http://inseguro', jsonb_build_array(jsonb_build_object('user_id', admin_id)));
    raise exception 'PRUEBA FALLIDA: se aceptó un enlace sin https';
  exception when raise_exception then
    get stacked diagnostics mensaje = message_text;
    if mensaje like 'PRUEBA FALLIDA%' then raise; end if;
  end;

  if otro_id is not null then
    begin
      cita1 := public.schedule_appointment(null, null, 'reunion', 'Prueba A', inicio, inicio + interval '1 hour',
        'virtual', null, 'https://meet.google.com/prueba',
        jsonb_build_array(jsonb_build_object('user_id', otro_id, 'required', true)));
      if (select count(*) from public.appointment_participants where appointment_id = cita1 and slot is not null) <> 2 then
        raise exception 'PRUEBA FALLIDA: la cita no reservó los horarios';
      end if;
      begin
        cita2 := public.schedule_appointment(null, null, 'reunion', 'Prueba B', inicio + interval '30 minutes', inicio + interval '90 minutes',
          'presencial', 'Sala', null, jsonb_build_array(jsonb_build_object('user_id', otro_id, 'required', true)));
        raise exception 'PRUEBA FALLIDA: se permitió un empalme con un obligatorio';
      exception when raise_exception then
        get stacked diagnostics mensaje = message_text;
        if mensaje not like 'CONFLICTO:%' then raise exception 'PRUEBA FALLIDA: el empalme dio "%"', mensaje; end if;
      end;
      perform public.cancel_appointment(cita1, 'Prueba terminada');
      if exists (select 1 from public.appointment_participants where appointment_id = cita1 and slot is not null) then
        raise exception 'PRUEBA FALLIDA: cancelar no liberó los horarios';
      end if;
      raise exception 'DESHACER_PRUEBA';
    exception when raise_exception then
      get stacked diagnostics mensaje = message_text;
      if mensaje <> 'DESHACER_PRUEBA' then raise; end if;
    end;

    if not exists (select 1 from public.users where id = otro_id and (role = 'admin' or is_super_admin = true)) then
      perform set_config('request.jwt.claims', json_build_object('sub', otro_id, 'role', 'authenticated')::text, true);
      begin
        perform public.start_appointment('00000000-0000-0000-0000-000000000000');
        raise exception 'PRUEBA FALLIDA: alguien sin permiso inició una cita';
      exception when raise_exception then
        get stacked diagnostics mensaje = message_text;
        if mensaje <> 'Solo un administrador puede iniciar citas' then raise exception 'PRUEBA FALLIDA: sin permiso recibió "%"', mensaje; end if;
      end;
    end if;
  end if;

  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

select 'Listo: citas creadas' as resultado;

-- Citas v2 y asistencia en vivo. Correr completo en el SQL Editor de Supabase, DESPUÉS de 2026-11-09_citas.sql.
-- Se puede correr más de una vez. Si una prueba falla, no se aplica nada.
--
-- 1. Tipos de cita editables: los 4 de siempre más los que agreguen los administradores.
-- 2. Responder un cambio de horario: aceptar el horario propuesto o rechazar el cambio.
-- 3. Recordatorios 24 h y 1 h antes de cada cita (tarea programada cada 10 min).
-- 4. Aviso a los administradores cada vez que alguien registra su primera entrada del día:
--    verde si llegó a tiempo (hasta 5 min de tolerancia), naranja si llegó tarde.
begin;

-- 1. Tipos de cita ------------------------------------------------------------------------

create table if not exists public.appointment_kinds (
  slug text primary key check (slug ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(trim(label)) between 2 and 40),
  default_modality text not null check (default_modality in ('presencial', 'virtual')),
  active boolean not null default true,
  sort_order int not null default 100,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.appointment_kinds (slug, label, default_modality, sort_order) values
  ('reunion', 'Reunión', 'virtual', 1),
  ('grabacion', 'Grabación', 'presencial', 2),
  ('entrevista', 'Entrevista', 'virtual', 3),
  ('accesos', 'Accesos a cuentas', 'virtual', 4)
on conflict (slug) do nothing;

create unique index if not exists appointment_kinds_label_unico on public.appointment_kinds (lower(trim(label)));

alter table public.appointments drop constraint if exists appointments_kind_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_kind_fkey') then
    alter table public.appointments add constraint appointments_kind_fkey
      foreign key (kind) references public.appointment_kinds(slug) on update cascade;
  end if;
end $$;

alter table public.appointment_kinds enable row level security;
revoke all on public.appointment_kinds from anon, authenticated, public;
grant select on public.appointment_kinds to authenticated;
drop policy if exists "tipos_ver" on public.appointment_kinds;
create policy "tipos_ver" on public.appointment_kinds for select to authenticated
  using (active or public.is_active_admin());

create or replace function public.app_appointment_kind_label(p_kind text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select label from public.appointment_kinds where slug = p_kind), p_kind);
$$;

create or replace function public.app_appointment_suggested_modality(p_kind text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select default_modality from public.appointment_kinds where slug = p_kind), 'virtual');
$$;

-- Agregar un tipo nuevo (solo admins). Devuelve su clave.
create or replace function public.add_appointment_kind(p_label text, p_default_modality text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  nombre text := regexp_replace(trim(coalesce(p_label, '')), '\s+', ' ', 'g');
  clave text;
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador puede agregar tipos de cita'; end if;
  if length(nombre) < 2 or length(nombre) > 40 then raise exception 'El nombre del tipo debe tener de 2 a 40 letras'; end if;
  if p_default_modality not in ('presencial', 'virtual') then raise exception 'Elige presencial o virtual'; end if;
  select slug into clave from public.appointment_kinds where lower(trim(label)) = lower(nombre);
  if clave is not null then
    update public.appointment_kinds set active = true, default_modality = p_default_modality where slug = clave;
    return clave;
  end if;
  clave := 't_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.appointment_kinds (slug, label, default_modality, created_by, sort_order)
  values (clave, nombre, p_default_modality, auth.uid(), 100 + (select count(*) from public.appointment_kinds));
  return clave;
end;
$$;

-- Ocultar o volver a mostrar un tipo (las citas que ya lo usan no cambian).
create or replace function public.set_appointment_kind_active(p_slug text, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador puede cambiar los tipos de cita'; end if;
  update public.appointment_kinds set active = p_active where slug = p_slug;
  if not found then raise exception 'El tipo no existe'; end if;
end;
$$;

-- Solicitar y programar ahora validan contra la tabla de tipos.
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
  if not exists (select 1 from public.appointment_kinds where slug = p_kind and active) then raise exception 'Tipo de cita no válido'; end if;
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
  if not exists (select 1 from public.appointment_kinds where slug = p_kind and active) then raise exception 'Tipo de cita no válido'; end if;
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

-- 2. Responder un cambio de horario -----------------------------------------------------
-- p_accept = true: la cita pasa al horario propuesto número p_slot_index (0, 1 o 2).
--   Quien lo propuso queda como "aceptada"; los demás vuelven a confirmar.
-- p_accept = false: el cambio se rechaza y la persona vuelve a "pendiente" con la nota del admin.
create or replace function public.resolve_change_request(
  p_appointment_id uuid, p_user_id uuid, p_accept boolean, p_slot_index int default 0, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  cita public.appointments;
  part public.appointment_participants;
  inicio timestamptz;
  fin timestamptz;
  ocupados text;
  avisar uuid[];
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador responde cambios de horario'; end if;
  select * into cita from public.appointments where id = p_appointment_id for update;
  if cita.id is null then raise exception 'La cita no existe'; end if;
  if cita.status <> 'programada' then raise exception 'Esta cita ya no se puede cambiar'; end if;
  select * into part from public.appointment_participants where appointment_id = cita.id and user_id = p_user_id;
  if part.user_id is null or part.response <> 'cambio_solicitado' then raise exception 'Esa persona no pidió un cambio'; end if;

  if not p_accept then
    update public.appointment_participants
    set response = 'pendiente', proposed_slots = '[]'::jsonb, response_note = null, responded_at = null
    where appointment_id = cita.id and user_id = p_user_id;
    perform public.app_sync_appointment_slots(cita.id);
    perform public.app_appointment_log(cita.id, 'cambio_rechazado', jsonb_build_object('user_id', p_user_id, 'note', p_note));
    perform public.app_appointment_notify(cita.id, array[p_user_id], '🔁 Cambio no aceptado',
      'Se mantiene "' || cita.title || '" el ' || public.app_appointment_when(cita.starts_at, cita.timezone) ||
      coalesce('. ' || nullif(trim(p_note), ''), '') || '. Confirma si asistirás.');
    return;
  end if;

  if p_slot_index is null or p_slot_index < 0 or p_slot_index >= jsonb_array_length(part.proposed_slots) then
    raise exception 'Elige uno de los horarios propuestos';
  end if;
  inicio := (part.proposed_slots -> p_slot_index ->> 'starts_at')::timestamptz;
  fin := (part.proposed_slots -> p_slot_index ->> 'ends_at')::timestamptz;
  if inicio < now() then raise exception 'Ese horario ya pasó'; end if;

  select string_agg(distinct u.full_name, ', ') into ocupados
  from public.appointment_participants p
  join public.appointment_participants otra on otra.user_id = p.user_id and otra.appointment_id <> cita.id
  join public.users u on u.id = p.user_id
  where p.appointment_id = cita.id and p.required and p.response <> 'rechazada'
    and otra.slot is not null and otra.slot && tstzrange(inicio, fin, '[)');
  if ocupados is not null then raise exception 'CONFLICTO: % ya tiene otra cita en ese horario', ocupados; end if;

  update public.appointments set starts_at = inicio, ends_at = fin, updated_at = now() where id = cita.id;
  update public.appointment_participants set
    response = case when user_id in (p_user_id, cita.coordinator_id) then 'aceptada' else 'pendiente' end,
    responded_at = case when user_id in (p_user_id, cita.coordinator_id) then now() end,
    response_note = null,
    proposed_slots = '[]'::jsonb
  where appointment_id = cita.id;
  perform public.app_sync_appointment_slots(cita.id);
  perform public.app_appointment_log(cita.id, 'reprogramada', jsonb_build_object('starts_at', inicio, 'ends_at', fin, 'por_cambio_de', p_user_id));

  select coalesce(array_agg(user_id), '{}') into avisar from public.appointment_participants where appointment_id = cita.id;
  perform public.app_appointment_notify(cita.id, avisar, '🔁 Cita reprogramada',
    '"' || cita.title || '" ahora es el ' || public.app_appointment_when(inicio, cita.timezone) || '. Confirma si asistirás.');
end;
$$;

-- 3. Recordatorios ------------------------------------------------------------------------
-- 24 h antes (solo si la cita se programó con más de 2 h de anticipación) y 1 h antes.
-- No se repiten: se anota cada recordatorio en el historial con la hora de la cita.
create or replace function public.app_appointment_reminders()
returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select a.id, a.title, a.starts_at, a.timezone,
      case when a.starts_at - now() <= interval '1 hour' then '1h' else '24h' end as cual
    from public.appointments a
    where a.status = 'programada'
      and a.starts_at > now()
      and (
        a.starts_at - now() <= interval '1 hour'
        or (a.starts_at - now() <= interval '24 hours' and a.starts_at - now() > interval '2 hours')
      )
  loop
    if exists (
      select 1 from public.appointment_events e
      where e.appointment_id = r.id and e.action = 'recordatorio_' || r.cual
        and (e.detail->>'starts_at')::timestamptz = r.starts_at
    ) then continue; end if;

    insert into public.appointment_events (appointment_id, action, detail)
    values (r.id, 'recordatorio_' || r.cual, jsonb_build_object('starts_at', r.starts_at));

    insert into public.notifications (user_id, title, message, type, appointment_id, read)
    select p.user_id, '⏰ Recordatorio',
      '"' || r.title || '" empieza ' ||
      case when r.cual = '1h' then 'en menos de una hora' else 'mañana' end ||
      ' (' || to_char(r.starts_at at time zone r.timezone, 'HH24:MI') || ').',
      'appointment', r.id, false
    from public.appointment_participants p
    where p.appointment_id = r.id and p.response <> 'rechazada';
  end loop;
end;
$$;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'citas-recordatorios';
  perform cron.schedule('citas-recordatorios', '*/10 * * * *', 'select public.app_appointment_reminders()');
end $$;

-- 4. Aviso de entrada (asistencia en vivo) --------------------------------------------------
create or replace function public.trg_aviso_entrada()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nombre text;
  hora text := to_char(new.started_at at time zone 'America/Mexico_City', 'HH24:MI');
  lugar text := case new.location when 'oficina' then 'Oficina' when 'home_office' then 'Home office' else coalesce(new.location, '') end;
  titulo text;
  mensaje text;
begin
  if not coalesce(new.is_first_of_day, false) then return new; end if;
  select coalesce(nullif(trim(full_name), ''), email) into nombre from public.users where id = new.user_id;

  if new.scheduled_start_min is null then
    titulo := '🔵 Entrada en día de descanso';
    mensaje := nombre || ' registró entrada · ' || hora || ' · ' || lugar || '.';
  elsif coalesce(new.late_minutes, 0) <= 5 then
    titulo := '🟢 Entrada a tiempo';
    mensaje := nombre || ' entró a tiempo · ' || hora || ' · ' || lugar || '.';
  else
    titulo := '🟠 Entrada con retardo';
    mensaje := nombre || ' entró ' || new.late_minutes || ' min tarde · ' || hora || ' · ' || lugar || '.';
  end if;

  insert into public.notifications (user_id, title, message, type, read)
  select u.id, titulo, mensaje, 'attendance', false
  from public.users u
  where (u.role = 'admin' or u.is_super_admin) and coalesce(u.active, true) and u.id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists aviso_entrada on public.work_sessions;
create trigger aviso_entrada after insert on public.work_sessions
  for each row execute function public.trg_aviso_entrada();

-- El panel "Hoy en vivo" se actualiza al instante cuando alguien registra entrada o salida.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'work_sessions') then
    alter publication supabase_realtime add table public.work_sessions;
  end if;
end $$;

-- Permisos -----------------------------------------------------------------------------------
revoke all on function public.add_appointment_kind(text, text) from public, anon;
revoke all on function public.set_appointment_kind_active(text, boolean) from public, anon;
revoke all on function public.resolve_change_request(uuid, uuid, boolean, int, text) from public, anon;
revoke all on function public.app_appointment_reminders() from public, anon, authenticated;
revoke all on function public.trg_aviso_entrada() from public, anon, authenticated;
revoke all on function public.app_appointment_kind_label(text) from public, anon;
revoke all on function public.app_appointment_suggested_modality(text) from public, anon;
grant execute on function public.add_appointment_kind(text, text) to authenticated;
grant execute on function public.set_appointment_kind_active(text, boolean) to authenticated;
grant execute on function public.resolve_change_request(uuid, uuid, boolean, int, text) to authenticated;
revoke all on function public.request_appointment(uuid, text, text, jsonb) from public, anon;
revoke all on function public.schedule_appointment(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.request_appointment(uuid, text, text, jsonb) to authenticated;
grant execute on function public.schedule_appointment(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, jsonb, uuid) to authenticated;

-- 5. Pruebas (todo lo que crean se deshace) -------------------------------------------------
do $$
declare
  admin_id uuid;
  otro_id uuid;
  cita uuid;
  clave text;
  mensaje text;
  inicio timestamptz := date_trunc('hour', now()) + interval '40 days';
begin
  select id into admin_id from public.users where (role = 'admin' or is_super_admin = true) and coalesce(active, true) limit 1;
  if admin_id is null then raise exception 'PRUEBA FALLIDA: no hay administrador activo'; end if;
  select id into otro_id from public.users where id <> admin_id and coalesce(active, true)
    and role <> 'admin' and coalesce(is_super_admin, false) = false limit 1;

  if (select count(*) from public.appointment_kinds where slug in ('reunion', 'grabacion', 'entrevista', 'accesos')) <> 4 then
    raise exception 'PRUEBA FALLIDA: faltan los tipos base';
  end if;
  if public.app_appointment_suggested_modality('grabacion') <> 'presencial' then
    raise exception 'PRUEBA FALLIDA: la grabación debe ser presencial';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  begin
    clave := public.add_appointment_kind('Prueba de tipo temporal', 'virtual');
    if not exists (select 1 from public.appointment_kinds where slug = clave and label = 'Prueba de tipo temporal') then
      raise exception 'PRUEBA FALLIDA: no se creó el tipo';
    end if;

    if otro_id is not null then
      cita := public.schedule_appointment(null, null, clave, 'Prueba de cambio', inicio, inicio + interval '1 hour',
        'virtual', null, 'https://meet.google.com/prueba',
        jsonb_build_array(jsonb_build_object('user_id', otro_id, 'required', true)));
      update public.appointment_participants
        set response = 'cambio_solicitado',
            proposed_slots = jsonb_build_array(jsonb_build_object('starts_at', inicio + interval '1 day', 'ends_at', inicio + interval '1 day 1 hour'))
        where appointment_id = cita and user_id = otro_id;
      perform public.resolve_change_request(cita, otro_id, true, 0, null);
      if (select starts_at from public.appointments where id = cita) <> inicio + interval '1 day' then
        raise exception 'PRUEBA FALLIDA: no se movió la cita al horario propuesto';
      end if;
      if (select response from public.appointment_participants where appointment_id = cita and user_id = otro_id) <> 'aceptada' then
        raise exception 'PRUEBA FALLIDA: quien propuso el cambio debe quedar como aceptada';
      end if;
    end if;
    raise exception 'DESHACER_PRUEBA';
  exception when raise_exception then
    get stacked diagnostics mensaje = message_text;
    if mensaje <> 'DESHACER_PRUEBA' then raise; end if;
  end;

  if otro_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', otro_id, 'role', 'authenticated')::text, true);
    begin
      perform public.add_appointment_kind('No debería', 'virtual');
      raise exception 'PRUEBA FALLIDA: alguien sin permiso agregó un tipo';
    exception when raise_exception then
      get stacked diagnostics mensaje = message_text;
      if mensaje <> 'Solo un administrador puede agregar tipos de cita' then raise exception 'PRUEBA FALLIDA: sin permiso recibió "%"', mensaje; end if;
    end;
  end if;

  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

select 'Listo: citas v2 y asistencia en vivo' as resultado;

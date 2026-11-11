-- Ubicación de las citas presenciales. Correr completo en el SQL Editor de Supabase,
-- después de 2026-11-10_evidencia_citas.sql. Se puede correr más de una vez.
--
-- * Lugares de la agencia (estudio, bunker...) con dirección y punto en el mapa; los dan de alta los admins.
-- * Al solicitar una grabación (presencial), el cliente indica si es en el estudio o en su domicilio
--   (con dirección o su ubicación actual).
-- * Al programar, el admin confirma: un lugar de la agencia, el domicilio del cliente u otro lugar.
begin;

create table if not exists public.appointment_places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  address text check (address is null or length(address) <= 300),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists appointment_places_nombre_unico on public.appointment_places (lower(trim(name)));

alter table public.appointment_places enable row level security;
revoke all on public.appointment_places from anon, authenticated, public;
grant select on public.appointment_places to authenticated;
drop policy if exists "lugares_ver" on public.appointment_places;
create policy "lugares_ver" on public.appointment_places for select to authenticated
  using (active or public.is_active_admin());

alter table public.appointments
  add column if not exists location_kind text check (location_kind in ('estudio', 'cliente', 'otro')),
  add column if not exists place_id uuid references public.appointment_places(id) on delete set null,
  add column if not exists address text check (address is null or length(address) <= 300),
  add column if not exists latitude double precision check (latitude is null or latitude between -90 and 90),
  add column if not exists longitude double precision check (longitude is null or longitude between -180 and 180);

-- Agregar un lugar de la agencia (solo admins).
create or replace function public.add_appointment_place(p_name text, p_address text, p_lat double precision default null, p_lng double precision default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nuevo uuid;
  nombre text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador agrega lugares'; end if;
  if length(nombre) < 2 then raise exception 'Escribe el nombre del lugar'; end if;
  if length(trim(coalesce(p_address, ''))) < 5 and (p_lat is null or p_lng is null) then
    raise exception 'Escribe la dirección o usa la ubicación actual';
  end if;
  select id into nuevo from public.appointment_places where lower(trim(name)) = lower(nombre);
  if nuevo is not null then
    update public.appointment_places set address = nullif(trim(p_address), ''), latitude = p_lat, longitude = p_lng, active = true
    where id = nuevo;
    return nuevo;
  end if;
  insert into public.appointment_places (name, address, latitude, longitude, created_by)
  values (nombre, nullif(trim(p_address), ''), p_lat, p_lng, auth.uid())
  returning id into nuevo;
  return nuevo;
end;
$$;

create or replace function public.set_appointment_place_active(p_place_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador cambia los lugares'; end if;
  update public.appointment_places set active = p_active where id = p_place_id;
  if not found then raise exception 'El lugar no existe'; end if;
end;
$$;

-- Valida y arma el lugar de una cita presencial.
-- p_estricto = true (al programar): con "estudio" hay que elegir uno de los lugares.
create or replace function public.app_resolve_place(
  p_kind text, p_place_id uuid, p_location text, p_address text,
  p_lat double precision, p_lng double precision, p_estricto boolean
) returns table (lugar text, direccion text, lat double precision, lng double precision, tipo text, place_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  sitio public.appointment_places;
begin
  if (p_lat is null) <> (p_lng is null) or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'Ubicación no válida';
  end if;
  if p_place_id is not null then
    select * into sitio from public.appointment_places where id = p_place_id and active;
    if sitio.id is null then raise exception 'Ese lugar ya no está disponible'; end if;
    return query select sitio.name, sitio.address, sitio.latitude, sitio.longitude, 'estudio'::text, sitio.id;
  elsif p_kind = 'estudio' then
    if p_estricto then raise exception 'Elige el estudio o lugar de la agencia'; end if;
    return query select 'En el estudio (por confirmar)'::text, null::text, null::double precision, null::double precision, 'estudio'::text, null::uuid;
  elsif p_kind = 'cliente' then
    if length(trim(coalesce(p_address, ''))) < 5 and p_lat is null then
      raise exception 'Escribe la dirección o usa la ubicación actual';
    end if;
    return query select coalesce(nullif(trim(p_location), ''), 'Domicilio del cliente'), nullif(trim(p_address), ''), p_lat, p_lng, 'cliente'::text, null::uuid;
  else
    if length(trim(coalesce(p_location, ''))) < 2 then raise exception 'Escribe el lugar de la cita'; end if;
    return query select trim(p_location), nullif(trim(coalesce(p_address, '')), ''), p_lat, p_lng, 'otro'::text, null::uuid;
  end if;
end;
$$;

-- Las funciones cambian de forma: se quitan las versiones anteriores para que no haya dos.
drop function if exists public.request_appointment(uuid, text, text, jsonb);
drop function if exists public.schedule_appointment(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, jsonb, uuid);

create or replace function public.request_appointment(
  p_project_id uuid, p_kind text, p_reason text, p_slots jsonb,
  p_location_kind text default null, p_place_id uuid default null, p_address text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  yo public.users;
  proyecto public.projects;
  horarios jsonb;
  nueva uuid;
  lugar record;
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
  select null::text as lugar, null::text as direccion, null::double precision as lat, null::double precision as lng, null::text as tipo, null::uuid as place_id into lugar;

  -- Presencial: en el estudio (la agencia elige cuál si no se indica) o en la dirección del cliente.
  if public.app_appointment_suggested_modality(p_kind) = 'presencial' then
    if coalesce(p_location_kind, '') not in ('estudio', 'cliente') then
      raise exception 'Indica si la cita es en el estudio o en tu domicilio';
    end if;
    select * into lugar from public.app_resolve_place(p_location_kind, p_place_id, null, p_address, p_lat, p_lng, false);
  end if;

  insert into public.appointments (project_id, kind, title, reason, status, modality, proposed_slots, requested_by,
    location, location_kind, place_id, address, latitude, longitude)
  values (
    p_project_id, p_kind,
    public.app_appointment_kind_label(p_kind) || coalesce(' · ' || proyecto.name, ''),
    trim(p_reason), 'solicitada', public.app_appointment_suggested_modality(p_kind), horarios, yo.id,
    lugar.lugar, lugar.tipo, lugar.place_id, lugar.direccion, lugar.lat, lugar.lng
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
  p_related_task_id uuid default null,
  p_location_kind text default null,
  p_place_id uuid default null,
  p_address text default null,
  p_lat double precision default null,
  p_lng double precision default null
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
  lugar record;
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador puede programar citas'; end if;
  if not exists (select 1 from public.appointment_kinds where slug = p_kind and active) then raise exception 'Tipo de cita no válido'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Escribe el título de la cita'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'La cita debe terminar después de empezar'; end if;
  if p_starts < now() - interval '5 minutes' then raise exception 'La cita debe ser en el futuro'; end if;
  if p_ends - p_starts > interval '12 hours' then raise exception 'Una cita no puede durar más de 12 horas'; end if;
  if p_modality not in ('presencial', 'virtual') then raise exception 'Elige presencial o virtual'; end if;
  select null::text as lugar, null::text as direccion, null::double precision as lat, null::double precision as lng, null::text as tipo, null::uuid as place_id into lugar;
  if p_modality = 'presencial' then
    select * into lugar from public.app_resolve_place(coalesce(p_location_kind, 'otro'), p_place_id, p_location, p_address, p_lat, p_lng, true);
  end if;
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
      related_task_id, related_task_title, requested_by, coordinator_id,
      location_kind, place_id, address, latitude, longitude)
    values (p_project_id, p_kind, trim(p_title), 'programada', p_modality,
      lugar.lugar,
      case when p_modality = 'virtual' then trim(p_meeting_url) end,
      p_starts, p_ends, tarea.id, tarea.title, auth.uid(), auth.uid(),
      lugar.tipo, lugar.place_id, lugar.direccion, lugar.lat, lugar.lng)
    returning id into id_cita;
  else
    update public.appointments set
      project_id = p_project_id, kind = p_kind, title = trim(p_title), status = 'programada', modality = p_modality,
      location = lugar.lugar, location_kind = lugar.tipo, place_id = lugar.place_id,
      address = lugar.direccion, latitude = lugar.lat, longitude = lugar.lng,
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

revoke all on function public.app_resolve_place(text, uuid, text, text, double precision, double precision, boolean) from public, anon, authenticated;
revoke all on function public.add_appointment_place(text, text, double precision, double precision) from public, anon;
revoke all on function public.set_appointment_place_active(uuid, boolean) from public, anon;
revoke all on function public.request_appointment(uuid, text, text, jsonb, text, uuid, text, double precision, double precision) from public, anon;
revoke all on function public.schedule_appointment(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, jsonb, uuid, text, uuid, text, double precision, double precision) from public, anon;
grant execute on function public.add_appointment_place(text, text, double precision, double precision) to authenticated;
grant execute on function public.set_appointment_place_active(uuid, boolean) to authenticated;
grant execute on function public.request_appointment(uuid, text, text, jsonb, text, uuid, text, double precision, double precision) to authenticated;
grant execute on function public.schedule_appointment(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, jsonb, uuid, text, uuid, text, double precision, double precision) to authenticated;

-- Pruebas (todo lo que crean se deshace).
do $$
declare
  admin_id uuid;
  otro_id uuid;
  sitio uuid;
  cita uuid;
  mensaje text;
  inicio timestamptz := date_trunc('hour', now()) + interval '45 days';
begin
  select id into admin_id from public.users where (role = 'admin' or is_super_admin = true) and coalesce(active, true) limit 1;
  if admin_id is null then raise exception 'PRUEBA FALLIDA: no hay administrador activo'; end if;
  select id into otro_id from public.users where id <> admin_id and coalesce(active, true) limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  begin
    sitio := public.add_appointment_place('Lugar de prueba temporal', 'Calle de prueba 123, Guadalajara', 20.67, -103.35);
    if otro_id is not null then
      cita := public.schedule_appointment(null, null, 'grabacion', 'Prueba de lugar', inicio, inicio + interval '1 hour',
        'presencial', null, null, jsonb_build_array(jsonb_build_object('user_id', otro_id)), null, 'estudio', sitio, null, null, null);
      if (select address from public.appointments where id = cita) <> 'Calle de prueba 123, Guadalajara' then
        raise exception 'PRUEBA FALLIDA: la cita no tomó la dirección del estudio';
      end if;
      begin
        perform public.schedule_appointment(null, null, 'grabacion', 'Prueba sin dirección', inicio + interval '2 days', inicio + interval '2 days 1 hour',
          'presencial', null, null, jsonb_build_array(jsonb_build_object('user_id', otro_id)), null, 'cliente', null, null, null, null);
        raise exception 'PRUEBA FALLIDA: se aceptó domicilio del cliente sin dirección';
      exception when raise_exception then
        get stacked diagnostics mensaje = message_text;
        if mensaje <> 'Escribe la dirección o usa la ubicación actual' then raise exception 'PRUEBA FALLIDA: sin dirección recibió "%"', mensaje; end if;
      end;
    end if;
    raise exception 'DESHACER_PRUEBA';
  exception when raise_exception then
    get stacked diagnostics mensaje = message_text;
    if mensaje <> 'DESHACER_PRUEBA' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

select 'Listo: ubicación de las citas' as resultado;

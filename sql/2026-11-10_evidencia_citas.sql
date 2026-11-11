-- Evidencia de citas: fotos y PDF en un bucket PRIVADO. Correr completo en el SQL Editor de Supabase,
-- después de 2026-11-10_citas_v2_y_asistencia.sql. Se puede correr más de una vez.
--
-- * Solo los administradores suben y borran evidencia, con la cita en curso o ya cerrada.
-- * Cada archivo es "Interna" (solo admins y equipo invitado) o "Cliente" (también la ven los clientes invitados).
-- * Nadie sin sesión puede abrir los archivos: la app pide enlaces temporales firmados.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('appointment-evidence', 'appointment-evidence', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.appointment_files (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  visible_to_client boolean not null default false,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists appointment_files_appointment_idx on public.appointment_files(appointment_id, created_at);

alter table public.appointment_files enable row level security;
revoke all on public.appointment_files from anon, authenticated, public;
grant select on public.appointment_files to authenticated;
drop policy if exists "evidencia_filas_ver" on public.appointment_files;
create policy "evidencia_filas_ver" on public.appointment_files for select to authenticated
  using (
    public.is_active_admin()
    or (public.app_is_appointment_member(appointment_id) and (visible_to_client or public.app_is_staff()))
  );

-- Archivos en Storage. La ruta es <id de la cita>/<nombre único>.
drop policy if exists "evidencia_subir" on storage.objects;
create policy "evidencia_subir" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'appointment-evidence'
    and public.is_active_admin()
    and exists (
      select 1 from public.appointments a
      where a.id::text = (storage.foldername(name))[1] and a.status in ('en_curso', 'realizada', 'incompleta')
    )
  );

drop policy if exists "evidencia_ver" on storage.objects;
create policy "evidencia_ver" on storage.objects for select to authenticated
  using (
    bucket_id = 'appointment-evidence'
    and (
      public.is_active_admin()
      or exists (
        select 1 from public.appointment_files f
        where f.path = name
          and public.app_is_appointment_member(f.appointment_id)
          and (f.visible_to_client or public.app_is_staff())
      )
    )
  );

drop policy if exists "evidencia_borrar" on storage.objects;
create policy "evidencia_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'appointment-evidence' and public.is_active_admin());

-- Registrar un archivo ya subido.
create or replace function public.register_appointment_file(
  p_appointment_id uuid, p_path text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_visible_to_client boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nuevo uuid;
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador sube evidencia'; end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and status in ('en_curso', 'realizada', 'incompleta')) then
    raise exception 'La evidencia se sube durante o después de la cita';
  end if;
  if split_part(p_path, '/', 1) <> p_appointment_id::text then raise exception 'Ruta de archivo no válida'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'appointment-evidence' and name = p_path) then
    raise exception 'El archivo no se subió';
  end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') then
    raise exception 'Solo se aceptan fotos o PDF';
  end if;
  insert into public.appointment_files (appointment_id, path, file_name, mime_type, size_bytes, visible_to_client, uploaded_by)
  values (p_appointment_id, p_path, left(trim(p_file_name), 200), p_mime_type, p_size_bytes, coalesce(p_visible_to_client, false), auth.uid())
  returning id into nuevo;
  perform public.app_appointment_log(p_appointment_id, 'evidencia', jsonb_build_object('file_id', nuevo, 'visible_to_client', p_visible_to_client));
  return nuevo;
end;
$$;

-- Quitar el registro (la app borra también el archivo de Storage).
create or replace function public.delete_appointment_file(p_file_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ruta text;
  cita uuid;
begin
  if not public.is_active_admin() then raise exception 'Solo un administrador borra evidencia'; end if;
  delete from public.appointment_files where id = p_file_id returning path, appointment_id into ruta, cita;
  if ruta is null then raise exception 'El archivo no existe'; end if;
  perform public.app_appointment_log(cita, 'evidencia_borrada', jsonb_build_object('file_id', p_file_id));
  return ruta;
end;
$$;

revoke all on function public.register_appointment_file(uuid, text, text, text, bigint, boolean) from public, anon;
revoke all on function public.delete_appointment_file(uuid) from public, anon;
grant execute on function public.register_appointment_file(uuid, text, text, text, bigint, boolean) to authenticated;
grant execute on function public.delete_appointment_file(uuid) to authenticated;

-- Pruebas.
do $$
declare
  otro_id uuid;
  mensaje text;
begin
  if (select public from storage.buckets where id = 'appointment-evidence') then
    raise exception 'PRUEBA FALLIDA: el bucket de evidencia quedó público';
  end if;
  select id into otro_id from public.users where role <> 'admin' and coalesce(is_super_admin, false) = false and coalesce(active, true) limit 1;
  if otro_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', otro_id, 'role', 'authenticated')::text, true);
    begin
      perform public.register_appointment_file('00000000-0000-0000-0000-000000000000', 'x/y.jpg', 'y.jpg', 'image/jpeg', 10, false);
      raise exception 'PRUEBA FALLIDA: alguien sin permiso registró evidencia';
    exception when raise_exception then
      get stacked diagnostics mensaje = message_text;
      if mensaje <> 'Solo un administrador sube evidencia' then raise exception 'PRUEBA FALLIDA: sin permiso recibió "%"', mensaje; end if;
    end;
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;

commit;

select 'Listo: evidencia de citas' as resultado;

-- Solo cuentas registradas: aunque alguien logre una sesión (correo o Google), sin perfil activo en Órbita
-- no puede leer ni escribir nada. Correr completo en el SQL Editor de Supabase. Se puede correr más de una vez.
-- Si una prueba falla, no se aplica nada.
--
-- Cómo funciona: se agrega una política RESTRICTIVA en cada tabla de public y en storage.objects.
-- Las políticas restrictivas se suman (AND) a las que ya existen, así que no abren nada: solo exigen además
-- que la persona tenga perfil en public.users y que esté activa. Su propio perfil sí lo puede leer
-- (para que la app le muestre "cuenta desactivada" o "sin invitación").
-- Las funciones SECURITY DEFINER (aceptar invitación, citas, asistencia) y las Edge Functions no se ven afectadas.
begin;

create or replace function public.app_is_registered_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and coalesce(active, true));
$$;
revoke all on function public.app_is_registered_user() from public, anon;
grant execute on function public.app_is_registered_user() to authenticated;

-- Política restrictiva en todas las tablas con RLS de public.
do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists "solo_cuentas_registradas" on public.%I', t.relname);
    if t.relname = 'users' then
      -- Su propio perfil siempre lo puede leer; lo demás exige perfil activo.
      execute 'create policy "solo_cuentas_registradas" on public.users as restrictive for all to authenticated
               using (id = auth.uid() or public.app_is_registered_user())
               with check (public.app_is_registered_user())';
    else
      execute format('create policy "solo_cuentas_registradas" on public.%I as restrictive for all to authenticated
                      using (public.app_is_registered_user()) with check (public.app_is_registered_user())', t.relname);
    end if;
  end loop;
end $$;

-- Archivos: subir, ver, cambiar o borrar exige perfil activo.
drop policy if exists "solo_cuentas_registradas" on storage.objects;
create policy "solo_cuentas_registradas" on storage.objects as restrictive for all to authenticated
  using (public.app_is_registered_user()) with check (public.app_is_registered_user());

-- Pruebas: una sesión sin perfil no ve nada; un admin sigue viendo todo.
do $$
declare
  admin_id uuid;
  n int;
  intruso text := json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text;
begin
  select id into admin_id from public.users where (role = 'admin' or is_super_admin) and coalesce(active, true) limit 1;
  if admin_id is null then raise exception 'PRUEBA FALLIDA: no hay administrador activo'; end if;

  -- Sesión sin perfil.
  perform set_config('request.jwt.claims', intruso, true);
  set local role authenticated;
  select count(*) into n from public.users;
  if n <> 0 then raise exception 'PRUEBA FALLIDA: una cuenta sin perfil ve % perfiles', n; end if;
  select count(*) into n from public.app_license;
  if n <> 0 then raise exception 'PRUEBA FALLIDA: una cuenta sin perfil ve la licencia'; end if;
  select count(*) into n from public.role_permissions;
  if n <> 0 then raise exception 'PRUEBA FALLIDA: una cuenta sin perfil ve los permisos'; end if;
  select count(*) into n from storage.objects;
  if n <> 0 then raise exception 'PRUEBA FALLIDA: una cuenta sin perfil ve archivos'; end if;
  reset role;

  -- Administrador registrado.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.users;
  if n = 0 then raise exception 'PRUEBA FALLIDA: el administrador ya no ve perfiles'; end if;
  select count(*) into n from public.app_license;
  if n = 0 then raise exception 'PRUEBA FALLIDA: el administrador ya no ve la licencia'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

select 'Listo: solo cuentas registradas' as resultado;

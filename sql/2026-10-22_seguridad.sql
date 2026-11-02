-- Cierra huecos de seguridad en invitaciones, licencia, roles, subtareas y tiempo.
-- Ejecutar este archivo en el SQL Editor de Supabase JUSTO ANTES de publicar la
-- rama fix/seguridad: las pantallas de registro nuevas usan las funciones de abajo
-- y las anteriores dejan de funcionar con estas políticas.
-- No borra datos: solo reemplaza políticas y agrega funciones y un trigger.

-- 0. Ayudantes. Son security definer para consultar users/tasks sin depender de sus políticas.
create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and (role = 'admin' or is_super_admin = true)
      and coalesce(active, true)
  );
$$;

revoke all on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated;

-- Acceso total a subtareas y tiempo: administradores y departamento Líder.
create or replace function public.has_full_task_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_admin() or exists (
    select 1 from public.users
    where id = auth.uid() and department = 'lider' and coalesce(active, true)
  );
$$;

revoke all on function public.has_full_task_access() from public;
grant execute on function public.has_full_task_access() to authenticated;

-- Acceso total, o el responsable/creador de la tarea.
create or replace function public.can_edit_task_items(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_full_task_access() or exists (
    select 1 from public.tasks
    where id = p_task_id
      and (assigned_to = auth.uid() or created_by = auth.uid())
  );
$$;

revoke all on function public.can_edit_task_items(uuid) from public;
grant execute on function public.can_edit_task_items(uuid) to authenticated;

-- 1. Invitaciones de equipo: solo administradores las leen, crean, editan o borran.
drop policy if exists "Cualquiera puede leer una invitacion por su id" on public.team_invitations;
drop policy if exists "Cualquiera puede marcar una invitacion como usada" on public.team_invitations;
drop policy if exists "Solo usuarios autenticados pueden crear invitaciones" on public.team_invitations;
drop policy if exists "Administradores gestionan invitaciones de equipo" on public.team_invitations;

create policy "Administradores gestionan invitaciones de equipo"
  on public.team_invitations for all
  to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

-- La persona invitada todavía no tiene cuenta: solo puede consultar la invitación
-- cuyo id viene en su link, sin poder listar las demás.
create or replace function public.get_team_invitation(p_invitation_id uuid)
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  department text,
  used boolean,
  permissions jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.full_name, i.role, i.department, i.used, i.permissions
  from public.team_invitations i
  where i.id = p_invitation_id;
$$;

revoke all on function public.get_team_invitation(uuid) from public;
grant execute on function public.get_team_invitation(uuid) to anon, authenticated;

-- Crea el perfil con el rol y departamento de la invitación validada (nunca del navegador),
-- aplica sus permisos y la marca como usada, todo en una sola transacción.
create or replace function public.accept_team_invitation(p_invitation_id uuid, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.team_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into invitation from public.team_invitations
  where id = p_invitation_id and used = false
  for update;
  if invitation.id is null then
    raise exception 'Invalid or used invitation';
  end if;

  if lower(invitation.email) is distinct from lower(auth.jwt() ->> 'email') then
    raise exception 'La invitación pertenece a otro correo';
  end if;

  perform set_config('app.profile_from_invitation', 'on', true);
  insert into public.users (id, email, full_name, role, department, must_change_password, active)
  values (auth.uid(), invitation.email, trim(p_full_name), invitation.role, invitation.department, false, true)
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      role = excluded.role,
      department = excluded.department,
      must_change_password = false,
      active = true;

  insert into public.user_permissions (user_id, section_key, allowed)
  select auth.uid(), entry.key, (entry.value)::text::boolean
  from jsonb_each(coalesce(invitation.permissions, '{}'::jsonb)) as entry
  on conflict (user_id, section_key)
  do update set allowed = excluded.allowed, updated_at = now();

  update public.team_invitations set used = true where id = invitation.id;
  return auth.uid();
end;
$$;

revoke all on function public.accept_team_invitation(uuid, text) from public;
grant execute on function public.accept_team_invitation(uuid, text) to authenticated;

-- Mismo flujo para clientes: el rol siempre es 'client' y el vínculo con el cliente
-- sale de la invitación.
create or replace function public.accept_client_invitation(p_invitation_id uuid, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.client_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into invitation from public.client_invitations
  where id = p_invitation_id and used = false
  for update;
  if invitation.id is null then
    raise exception 'Invalid or used invitation';
  end if;

  if nullif(trim(invitation.email), '') is not null
     and lower(trim(invitation.email)) is distinct from lower(auth.jwt() ->> 'email') then
    raise exception 'La invitación pertenece a otro correo';
  end if;

  perform set_config('app.profile_from_invitation', 'on', true);
  insert into public.users (id, email, full_name, role, must_change_password)
  values (auth.uid(), auth.jwt() ->> 'email', trim(p_full_name), 'client', false)
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      role = 'client',
      must_change_password = false;

  update public.clients set user_id = auth.uid() where id = invitation.client_id;

  insert into public.user_permissions (user_id, section_key, allowed)
  select auth.uid(), entry.key, (entry.value)::text::boolean
  from jsonb_each(coalesce(invitation.permissions, '{}'::jsonb)) as entry
  on conflict (user_id, section_key)
  do update set allowed = excluded.allowed, updated_at = now();

  update public.client_invitations set used = true where id = invitation.id;
  return auth.uid();
end;
$$;

revoke all on function public.accept_client_invitation(uuid, text) from public;
grant execute on function public.accept_client_invitation(uuid, text) to authenticated;

-- 2. Licencia: todos la leen, solo el superadmin la edita (igual que en la interfaz).
drop policy if exists "Cualquier usuario autenticado puede actualizar la licencia" on public.app_license;
drop policy if exists "Solo superadmin puede actualizar la licencia" on public.app_license;

create policy "Solo superadmin puede actualizar la licencia"
  on public.app_license for update
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.is_super_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.is_super_admin = true
    )
  );

-- 3. Perfiles: desde la app nadie cambia directamente su rol, su marca de superadmin
-- ni crea perfiles por su cuenta. Las funciones security definer (set_user_access_role,
-- accept_*_invitation) corren como su dueño y sí pueden. Reactivar una cuenta
-- desactivada queda solo para administradores.
-- Cualquier perfil creado fuera de accept_*_invitation (por ejemplo, el trigger de alta
-- de Supabase Auth, sin importar su nombre ni si lee raw_user_meta_data) nace como
-- 'client', sin superadmin ni departamento. Con el registro abierto y sin confirmación
-- de correo, una cuenta nueva no obtiene acceso de equipo hasta aceptar una invitación.
create or replace function public.protect_user_access_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and current_setting('app.profile_from_invitation', true) is distinct from 'on' then
    new.role := 'client';
    new.is_super_admin := false;
    new.department := null;
  end if;

  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Los perfiles solo se crean desde una invitación';
  end if;

  if new.role is distinct from old.role
     or new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'No se puede cambiar el rol desde la aplicación';
  end if;

  if new.active is distinct from old.active and not public.is_active_admin() then
    raise exception 'Solo los administradores pueden activar o desactivar cuentas';
  end if;

  -- El departamento 'lider' da acceso total a subtareas y tiempo.
  if new.department is distinct from old.department and not public.is_active_admin() then
    raise exception 'Solo los administradores pueden cambiar el departamento';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_user_access_fields on public.users;
create trigger protect_user_access_fields
  before insert or update on public.users
  for each row execute function public.protect_user_access_fields();

-- 4. Subtareas: las editan administradores, Líder y el responsable/creador de la tarea.
drop policy if exists "Usuarios autenticados pueden crear subtareas" on public.task_subtasks;
drop policy if exists "Usuarios autenticados pueden editar subtareas" on public.task_subtasks;
drop policy if exists "Usuarios autenticados pueden borrar subtareas" on public.task_subtasks;
drop policy if exists "Responsables crean subtareas" on public.task_subtasks;
drop policy if exists "Responsables editan subtareas" on public.task_subtasks;
drop policy if exists "Responsables borran subtareas" on public.task_subtasks;

create policy "Responsables crean subtareas" on public.task_subtasks for insert to authenticated
  with check (public.can_edit_task_items(task_id));
create policy "Responsables editan subtareas" on public.task_subtasks for update to authenticated
  using (public.can_edit_task_items(task_id))
  with check (public.can_edit_task_items(task_id));
create policy "Responsables borran subtareas" on public.task_subtasks for delete to authenticated
  using (public.can_edit_task_items(task_id));

-- Tiempo: cada quien registra el suyo; edita/borra el suyo o el de tareas a su cargo.
-- Administradores y Líder pueden todo.
drop policy if exists "Usuarios autenticados pueden registrar tiempo" on public.task_time_entries;
drop policy if exists "Usuarios autenticados pueden actualizar su tiempo" on public.task_time_entries;
drop policy if exists "Usuarios autenticados pueden borrar tiempo" on public.task_time_entries;
drop policy if exists "Cada quien registra su tiempo" on public.task_time_entries;
drop policy if exists "Cada quien edita su tiempo" on public.task_time_entries;
drop policy if exists "Cada quien borra su tiempo" on public.task_time_entries;

create policy "Cada quien registra su tiempo" on public.task_time_entries for insert to authenticated
  with check (user_id = auth.uid() or public.has_full_task_access());
create policy "Cada quien edita su tiempo" on public.task_time_entries for update to authenticated
  using (user_id = auth.uid() or public.can_edit_task_items(task_id))
  with check (user_id = auth.uid() or public.can_edit_task_items(task_id));
create policy "Cada quien borra su tiempo" on public.task_time_entries for delete to authenticated
  using (user_id = auth.uid() or public.can_edit_task_items(task_id));

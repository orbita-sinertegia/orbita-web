-- Permite al superadministrador asignar cualquier cantidad de administradores
-- y regresar administradores normales al Equipo sin desactivar sus cuentas.
create or replace function public.set_user_access_role(p_user_id uuid, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.users%rowtype;
  target public.users%rowtype;
begin
  select * into actor from public.users where id = auth.uid();
  if actor.id is null or actor.is_super_admin is not true then
    raise exception 'Solo el superadministrador puede cambiar roles';
  end if;

  if p_role not in ('admin', 'team') then
    raise exception 'Rol no permitido';
  end if;

  select * into target from public.users where id = p_user_id for update;
  if target.id is null then
    raise exception 'La persona no existe';
  end if;
  if target.is_super_admin is true then
    raise exception 'No se puede modificar el rol del superadministrador';
  end if;

  update public.users
  set role = p_role,
      active = true,
      department = case when p_role = 'admin' then null else department end
  where id = p_user_id;

  delete from public.user_permissions where user_id = p_user_id;
  return p_user_id;
end;
$$;

revoke all on function public.set_user_access_role(uuid, text) from public;
grant execute on function public.set_user_access_role(uuid, text) to authenticated;

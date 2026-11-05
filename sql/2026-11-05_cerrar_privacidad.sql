-- Cierra el acceso a datos sin sesión y el registro sin invitación.
-- Correr completo en el SQL Editor de Supabase. Es una sola transacción: si una de las
-- pruebas del final falla, no se aplica nada.
--
-- Modelo de acceso:
--   - Sin sesión: nada, salvo consultar una invitación por su id.
--   - Equipo y admin activos: lo mismo que usa la app hoy.
--   - Cliente: su perfil, su cliente, sus proyectos y tareas, y los perfiles del equipo.
--   - Correo sin invitación pendiente: Supabase no crea la cuenta.

begin;

-- 1. Ayudantes. Son security definer para no depender de las políticas que consultan.
create or replace function public.app_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and (role in ('admin', 'team') or is_super_admin = true)
      and coalesce(active, true)
  );
$$;

create or replace function public.app_client_owns_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    join public.clients c on c.id = p.client_id
    where p.id = p_project_id and c.user_id = auth.uid()
  );
$$;

create or replace function public.app_client_owns_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    join public.projects p on p.id = t.project_id
    join public.clients c on c.id = p.client_id
    where t.id = p_task_id and c.user_id = auth.uid()
  );
$$;

-- 2. Registro: solo correos con una invitación pendiente. Ya no se crea un perfil
-- automático; el perfil solo nace al aceptar la invitación.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.client_invitations
    where not used and lower(trim(email)) = lower(trim(new.email))
  ) and not exists (
    select 1 from public.team_invitations
    where not used and lower(trim(email)) = lower(trim(new.email))
  ) then
    raise exception 'Este correo no tiene una invitación pendiente';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  before insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Invitaciones de cliente: siempre con correo y sin lectura pública.
alter table public.client_invitations
  drop constraint if exists client_invitations_email_required,
  add constraint client_invitations_email_required
    check (nullif(trim(email), '') is not null) not valid;

drop policy if exists "public_read" on public.client_invitations;

create or replace function public.get_client_invitation(p_invitation_id uuid)
returns table (id uuid, email text, used boolean, client_name text, client_company text)
language sql stable security definer set search_path = public as $$
  select i.id, i.email, i.used, c.name, c.company
  from public.client_invitations i
  join public.clients c on c.id = i.client_id
  where i.id = p_invitation_id;
$$;

-- 4. Perfiles.
drop policy if exists "allow all" on public.users;
drop policy if exists "users_select_visible" on public.users;
drop policy if exists "users_admin_update" on public.users;
create policy "users_select_visible" on public.users for select to authenticated
  using (id = auth.uid() or public.app_is_staff() or role in ('admin', 'team') or is_super_admin = true);
create policy "users_admin_update" on public.users for update to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

-- 5. Clientes.
drop policy if exists "allow all" on public.clients;
drop policy if exists "clients_staff_all" on public.clients;
drop policy if exists "clients_own_select" on public.clients;
drop policy if exists "clients_own_update" on public.clients;
create policy "clients_staff_all" on public.clients for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
create policy "clients_own_select" on public.clients for select to authenticated
  using (user_id = auth.uid());
create policy "clients_own_update" on public.clients for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 6. Proyectos.
drop policy if exists "allow all" on public.projects;
drop policy if exists "team_read_projects" on public.projects;
drop policy if exists "projects_staff_all" on public.projects;
drop policy if exists "projects_own_select" on public.projects;
create policy "projects_staff_all" on public.projects for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
create policy "projects_own_select" on public.projects for select to authenticated
  using (public.app_client_owns_project(id));

-- 7. Tareas.
drop policy if exists "allow all" on public.tasks;
drop policy if exists "authenticated_insert_tasks" on public.tasks;
drop policy if exists "team_can_update_assigned_tasks" on public.tasks;
drop policy if exists "team_read_assigned_tasks" on public.tasks;
drop policy if exists "team_update_tasks" on public.tasks;
drop policy if exists "tasks_staff_all" on public.tasks;
drop policy if exists "tasks_own_select" on public.tasks;
drop policy if exists "tasks_own_update" on public.tasks;
create policy "tasks_staff_all" on public.tasks for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
create policy "tasks_own_select" on public.tasks for select to authenticated
  using (public.app_client_owns_project(project_id));
create policy "tasks_own_update" on public.tasks for update to authenticated
  using (public.app_client_owns_project(project_id))
  with check (public.app_client_owns_project(project_id));

-- 8. Comentarios y entregables.
drop policy if exists "allow all" on public.task_comments;
drop policy if exists "authenticated_read_comments" on public.task_comments;
drop policy if exists "team_insert_comments" on public.task_comments;
drop policy if exists "comments_staff_all" on public.task_comments;
drop policy if exists "comments_own_select" on public.task_comments;
drop policy if exists "comments_own_insert" on public.task_comments;
create policy "comments_staff_all" on public.task_comments for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
create policy "comments_own_select" on public.task_comments for select to authenticated
  using (public.app_client_owns_task(task_id));
create policy "comments_own_insert" on public.task_comments for insert to authenticated
  with check (user_id = auth.uid() and public.app_client_owns_task(task_id));

drop policy if exists "allow all" on public.task_links;
drop policy if exists "links_staff_all" on public.task_links;
drop policy if exists "links_own_select" on public.task_links;
drop policy if exists "links_own_insert" on public.task_links;
create policy "links_staff_all" on public.task_links for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
create policy "links_own_select" on public.task_links for select to authenticated
  using (public.app_client_owns_task(task_id));
create policy "links_own_insert" on public.task_links for insert to authenticated
  with check (public.app_client_owns_task(task_id));

-- 9. Notificaciones: cada quien ve las suyas; cualquier miembro puede avisar a otro.
drop policy if exists "allow all" on public.notifications;
drop policy if exists "Authenticated users can insert notifications" on public.notifications;
drop policy if exists "notifications_own_select" on public.notifications;
drop policy if exists "notifications_own_update" on public.notifications;
drop policy if exists "notifications_own_delete" on public.notifications;
drop policy if exists "notifications_member_insert" on public.notifications;
create policy "notifications_own_select" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications_own_update" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications_own_delete" on public.notifications for delete to authenticated
  using (user_id = auth.uid());
create policy "notifications_member_insert" on public.notifications for insert to authenticated
  with check (exists (select 1 from public.users u where u.id = auth.uid() and coalesce(u.active, true)));

-- 10. Plantillas: solo equipo y admin.
drop policy if exists "Enable all access" on public.template_tasks;
drop policy if exists "template_tasks_staff_all" on public.template_tasks;
create policy "template_tasks_staff_all" on public.template_tasks for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());

alter table public.project_templates enable row level security;
drop policy if exists "project_templates_staff_all" on public.project_templates;
create policy "project_templates_staff_all" on public.project_templates for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());

-- 11. Chats: quedan solo las políticas por equipo y por sala del cliente.
drop policy if exists "allow_insert_chat_messages" on public.chat_messages;
drop policy if exists "allow_select_chat_messages" on public.chat_messages;
drop policy if exists "allow_update_chat_messages" on public.chat_messages;
drop policy if exists "allow_insert_chat_rooms" on public.chat_rooms;
drop policy if exists "allow_select_chat_rooms" on public.chat_rooms;

-- 12. Equipo asignado a clientes.
drop policy if exists "allow_delete_ctm" on public.client_team_members;
drop policy if exists "allow_insert_ctm" on public.client_team_members;
drop policy if exists "allow_select_ctm" on public.client_team_members;
drop policy if exists "ctm_staff_all" on public.client_team_members;
drop policy if exists "ctm_own_select" on public.client_team_members;
create policy "ctm_staff_all" on public.client_team_members for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
create policy "ctm_own_select" on public.client_team_members for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));

-- 13. Permisos por rol: todos los leen, solo admin los cambia.
drop policy if exists "Cualquier usuario autenticado puede modificar permisos" on public.role_permissions;
drop policy if exists "role_permissions_admin_write" on public.role_permissions;
create policy "role_permissions_admin_write" on public.role_permissions for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

-- 14. Calificaciones, subtareas y tiempo: equipo y dueño de la tarea.
drop policy if exists "All can read ratings" on public.task_ratings;
drop policy if exists "Clients can rate tasks" on public.task_ratings;
drop policy if exists "Clients can update ratings" on public.task_ratings;
drop policy if exists "ratings_select" on public.task_ratings;
drop policy if exists "ratings_insert" on public.task_ratings;
drop policy if exists "ratings_update" on public.task_ratings;
create policy "ratings_select" on public.task_ratings for select to authenticated
  using (public.app_is_staff() or public.app_client_owns_task(task_id));
create policy "ratings_insert" on public.task_ratings for insert to authenticated
  with check (public.app_is_staff() or public.app_client_owns_task(task_id));
create policy "ratings_update" on public.task_ratings for update to authenticated
  using (public.app_is_staff() or public.app_client_owns_task(task_id))
  with check (public.app_is_staff() or public.app_client_owns_task(task_id));

drop policy if exists "Usuarios autenticados pueden ver subtareas" on public.task_subtasks;
drop policy if exists "subtasks_select" on public.task_subtasks;
create policy "subtasks_select" on public.task_subtasks for select to authenticated
  using (public.app_is_staff() or public.app_client_owns_task(task_id));

drop policy if exists "Usuarios autenticados pueden ver tiempo registrado" on public.task_time_entries;
drop policy if exists "time_entries_select" on public.task_time_entries;
create policy "time_entries_select" on public.task_time_entries for select to authenticated
  using (public.app_is_staff() or public.app_client_owns_task(task_id));

-- 15. Archivos: se deja de poder listarlos sin sesión. Los enlaces públicos siguen abriendo.
drop policy if exists "Public read chat files" on storage.objects;
drop policy if exists "chat_files_staff_list" on storage.objects;
create policy "chat_files_staff_list" on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and public.app_is_staff());

drop policy if exists "Allow public read client-covers" on storage.objects;
drop policy if exists "client_covers_member_list" on storage.objects;
create policy "client_covers_member_list" on storage.objects for select to authenticated
  using (bucket_id = 'client-covers');

drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

-- 16. Funciones: sin sesión solo se pueden consultar invitaciones.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma,
           has_function_privilege('authenticated', p.oid, 'execute') as para_autenticados
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if f.para_autenticados then
      execute format('grant execute on function %s to authenticated', f.firma);
    end if;
    execute format('revoke execute on function %s from public, anon', f.firma);
  end loop;
end;
$$;

grant execute on function public.get_team_invitation(uuid) to anon, authenticated;
grant execute on function public.get_client_invitation(uuid) to anon, authenticated;
grant execute on function public.app_is_staff() to authenticated;
grant execute on function public.app_client_owns_project(uuid) to authenticated;
grant execute on function public.app_client_owns_task(uuid) to authenticated;

-- Las que solo usan los triggers y las tareas programadas no se llaman desde la app.
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.enforce_client_task_assignment() from authenticated;
revoke execute on function public.trg_activity_generic() from authenticated;
revoke execute on function public.trg_activity_task_update() from authenticated;
revoke execute on function public.mark_client_delays() from authenticated;
revoke execute on function public.notify_overdue_client_tasks() from authenticated;
revoke execute on function public.notify_upcoming_deadlines() from authenticated;

-- 17. Pruebas. Si una falla, toda la transacción se revierte.
do $$
declare
  t text;
  n bigint;
  admin_id uuid;
  admin_email text;
  cliente_id uuid;
  cliente_email text;
  cliente_row uuid;
  otro_cliente uuid;
  prueba uuid;
  rechazado boolean := false;
begin
  -- Sin sesión no se lee ninguna fila.
  set local role anon;
  foreach t in array array['users','clients','projects','tasks','notifications','client_invitations',
    'team_invitations','project_templates','template_tasks','task_comments','task_links',
    'chat_messages','chat_rooms','client_team_members','task_ratings'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then
        raise exception 'PRUEBA FALLIDA: sin sesión se leen % filas de %', n, t;
      end if;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  reset role;

  -- La invitación se consulta por id, sin listar las demás.
  select i.id into prueba from public.client_invitations i limit 1;
  if prueba is not null then
    set local role anon;
    select count(*) into n from public.get_client_invitation(prueba);
    reset role;
    if n <> 1 then raise exception 'PRUEBA FALLIDA: no se puede consultar la invitación'; end if;
  end if;

  -- El superadmin sigue viendo todo.
  select id, email into admin_id, admin_email from public.users where is_super_admin = true limit 1;
  if admin_id is null then raise exception 'PRUEBA FALLIDA: no hay superadmin'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'email', admin_email, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.users where id = admin_id;
  if n <> 1 then raise exception 'PRUEBA FALLIDA: el admin no lee su perfil'; end if;
  select count(*) into n from public.clients;
  reset role;
  if n <> (select count(*) from public.clients) then raise exception 'PRUEBA FALLIDA: el admin no ve todos los clientes'; end if;

  -- Un cliente solo ve lo suyo.
  select u.id, u.email, c.id into cliente_id, cliente_email, cliente_row
  from public.users u join public.clients c on c.user_id = u.id where u.role = 'client' limit 1;
  if cliente_id is not null then
    insert into public.clients (name, company) values ('Prueba ajena', 'Prueba ajena') returning id into otro_cliente;
    perform set_config('request.jwt.claims', json_build_object('sub', cliente_id, 'email', cliente_email, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.clients where id = cliente_row;
    if n <> 1 then raise exception 'PRUEBA FALLIDA: el cliente no ve su registro'; end if;
    select count(*) into n from public.clients where id = otro_cliente;
    if n <> 0 then raise exception 'PRUEBA FALLIDA: el cliente ve otro cliente'; end if;
    select count(*) into n from public.users where id = admin_id;
    if n <> 1 then raise exception 'PRUEBA FALLIDA: el cliente no ve al equipo'; end if;
    reset role;
    delete from public.clients where id = otro_cliente;
  end if;
  perform set_config('request.jwt.claims', '', true);

  -- Un correo sin invitación no puede crear cuenta.
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'sin-invitacion@example.com');
  exception when raise_exception then
    rechazado := true;
  end;
  if not rechazado then raise exception 'PRUEBA FALLIDA: se creó una cuenta sin invitación'; end if;
end;
$$;

commit;

select 'Listo: privacidad aplicada y pruebas superadas' as resultado;

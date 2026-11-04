-- Control total del super admin. Ejecutar DESPUÉS de revisar
-- sql/2026-11-02_control_super_admin_00_revision.sql. Idempotente (se puede correr más de una vez).
-- No borra ni cambia datos existentes: solo agrega 4 funciones y 2 triggers.
--   1. is_active_super_admin(): ¿el usuario actual es super admin activo?
--   2. super_admin_set_task_status(): el super admin cambia estatus y fecha de realización de
--      cualquier tarea (también reabrir una ya realizada), con registro en task_audit_log.
--   3. Trigger en projects: solo el super admin puede cambiar projects.status
--      (Activo / Pausado / Finalizado = 'completado'). Las demás ediciones del proyecto no cambian.
--   4. Trigger en projects: solo el super admin puede eliminar proyectos (también vía
--      admin_delete_project; si lo intenta otro admin, se revierte todo, tareas incluidas).
-- ORDEN: este archivo puede correrse antes o después del merge; sin él, el botón de estatus
-- de tareas muestra "necesita actualizar la base de datos" y el estado del proyecto lo
-- seguiría pudiendo cambiar cualquier admin (solo bloqueado en pantalla).
begin;

-- 1. Ayudante (security definer para no depender de las políticas de users).
create or replace function public.is_active_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and is_super_admin = true
      and coalesce(active, true)
  );
$$;

revoke all on function public.is_active_super_admin() from public, anon;
grant execute on function public.is_active_super_admin() to authenticated;

-- 2. Estatus y fecha de realización de una tarea (solo super admin).
--    Completada sin fecha → hoy (CDMX). Reabrir → se quita la fecha y, si estaba "aprobada",
--    se limpia la revisión para que vuelva al flujo normal (el antes queda en la auditoría).
create or replace function public.super_admin_set_task_status(p_task_id uuid, p_status text, p_completion_date date default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.tasks%rowtype;
  v_new public.tasks%rowtype;
  v_row public.tasks%rowtype;
  v_date date;
begin
  if not public.is_active_super_admin() then
    raise exception 'Solo el super admin puede cambiar el estatus desde aquí';
  end if;
  if p_status is null or p_status not in ('pendiente', 'en_progreso', 'bloqueada', 'completada') then
    raise exception 'Estatus no válido: %', coalesce(p_status, '(vacío)');
  end if;

  select * into v_old from public.tasks where id = p_task_id for update;
  if v_old.id is null then
    raise exception 'La tarea no existe';
  end if;
  if v_old.archived_at is not null then
    raise exception 'No se puede editar una tarea archivada; restáurala primero';
  end if;

  if p_status = 'completada' then
    v_date := coalesce(p_completion_date, v_old.completion_date, (now() at time zone 'America/Mexico_City')::date);
  else
    v_date := null;
  end if;

  -- jsonb_populate_record convierte al tipo real de la columna (text o enum).
  v_new := jsonb_populate_record(v_old, jsonb_build_object('status', p_status, 'completion_date', v_date));

  update public.tasks set
    status = v_new.status,
    completion_date = v_new.completion_date,
    review_status = case
      when v_old.status::text = 'completada' and p_status <> 'completada' and v_old.review_status::text = 'aprobada' then null
      else review_status
    end,
    updated_at = now()
  where id = p_task_id
  returning * into v_row;

  insert into public.task_audit_log (task_id, actor_id, action, before, after)
  values (p_task_id, auth.uid(), 'update', to_jsonb(v_old), to_jsonb(v_row));

  return v_row;
end;
$$;

revoke all on function public.super_admin_set_task_status(uuid, text, date) from public, anon;
grant execute on function public.super_admin_set_task_status(uuid, text, date) to authenticated;

-- 3. Solo el super admin cambia el estado del proyecto. Las funciones internas / el editor SQL
--    (current_user distinto de authenticated/anon) no se bloquean.
create or replace function public.trg_projects_status_super_admin_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and not public.is_active_super_admin() then
    raise exception 'Solo el super admin puede cambiar el estado del proyecto';
  end if;
  if tg_op = 'INSERT' and new.status::text <> 'activo' and not public.is_active_super_admin() then
    raise exception 'Solo el super admin puede crear proyectos pausados o finalizados';
  end if;
  return new;
end;
$$;

revoke all on function public.trg_projects_status_super_admin_only() from public, anon;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_status_super_admin_only' and tgrelid = 'public.projects'::regclass) then
    create trigger projects_status_super_admin_only
      before insert or update of status on public.projects
      for each row execute function public.trg_projects_status_super_admin_only();
  end if;
end;
$$;

-- 4. Solo el super admin elimina proyectos. Se revisa auth.uid() (no current_user) porque
--    admin_delete_project es security definer y borra como dueño de la función. Sin usuario
--    en la petición (editor SQL, service role, tareas programadas) no se bloquea.
create or replace function public.trg_projects_delete_super_admin_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_active_super_admin() then
    raise exception 'Solo el super admin puede eliminar proyectos';
  end if;
  return old;
end;
$$;

revoke all on function public.trg_projects_delete_super_admin_only() from public, anon;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_delete_super_admin_only' and tgrelid = 'public.projects'::regclass) then
    create trigger projects_delete_super_admin_only
      before delete on public.projects
      for each row execute function public.trg_projects_delete_super_admin_only();
  end if;
end;
$$;

commit;

-- Verificación (una sola consulta)
select 'fn_is_active_super_admin' as objeto, exists (select 1 from pg_proc where proname = 'is_active_super_admin' and pronamespace = 'public'::regnamespace)::text as ok
union all select 'fn_super_admin_set_task_status', exists (select 1 from pg_proc where proname = 'super_admin_set_task_status' and pronamespace = 'public'::regnamespace)::text
union all select 'trigger_projects_status', exists (select 1 from pg_trigger where tgname = 'projects_status_super_admin_only')::text
union all select 'trigger_projects_delete', exists (select 1 from pg_trigger where tgname = 'projects_delete_super_admin_only')::text;

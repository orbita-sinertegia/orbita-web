-- Permisos individuales administrados exclusivamente por el superadmin.
-- Si una persona no tiene una fila individual, se usa el permiso base de su rol.

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  section_key text not null,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, section_key)
);

alter table public.user_permissions enable row level security;

drop policy if exists "Usuarios leen sus permisos individuales" on public.user_permissions;
create policy "Usuarios leen sus permisos individuales"
  on public.user_permissions for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.users
      where users.id = auth.uid() and users.is_super_admin = true
    )
  );

drop policy if exists "Superadmin administra permisos individuales" on public.user_permissions;
create policy "Superadmin administra permisos individuales"
  on public.user_permissions for all to authenticated
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

create index if not exists user_permissions_user_idx
  on public.user_permissions(user_id);

-- Los clientes se desactivan sin borrar proyectos, tareas o historial.
alter table public.clients add column if not exists active boolean not null default true;

-- Correo opcional para invitaciones de clientes antes de crear su cuenta.
alter table public.client_invitations add column if not exists email text;

-- Los permisos elegidos al invitar se aplican cuando la persona crea su cuenta.
alter table public.client_invitations
  add column if not exists permissions jsonb not null default '{}'::jsonb;

alter table public.team_invitations
  add column if not exists permissions jsonb not null default '{}'::jsonb;

-- Aplica únicamente el preset contenido en una invitación válida al usuario autenticado.
create or replace function public.apply_invitation_permissions(
  invitation_id uuid,
  invitation_kind text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_permissions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if invitation_kind = 'team' then
    select permissions into invitation_permissions
    from public.team_invitations
    where id = invitation_id and used = false;
  elsif invitation_kind = 'client' then
    select permissions into invitation_permissions
    from public.client_invitations
    where id = invitation_id and used = false;
  else
    raise exception 'Invalid invitation kind';
  end if;

  if invitation_permissions is null then
    raise exception 'Invalid or used invitation';
  end if;

  insert into public.user_permissions (user_id, section_key, allowed)
  select auth.uid(), entry.key, (entry.value)::text::boolean
  from jsonb_each(invitation_permissions) as entry
  on conflict (user_id, section_key)
  do update set allowed = excluded.allowed, updated_at = now();
end;
$$;

revoke all on function public.apply_invitation_permissions(uuid, text) from public;
grant execute on function public.apply_invitation_permissions(uuid, text) to authenticated;

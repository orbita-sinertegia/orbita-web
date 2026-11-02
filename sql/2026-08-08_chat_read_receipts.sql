-- Confirmaciones de lectura para chat con clientes y chat general del equipo.
alter table public.chat_messages
  add column if not exists read_by uuid[] not null default '{}'::uuid[];

create index if not exists chat_messages_read_by_gin_idx
  on public.chat_messages using gin (read_by);

create or replace function public.mark_chat_room_read(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.chat_rooms room
    left join public.clients client on client.id = room.client_id
    where room.id = p_room_id
      and (
        (room.type = 'team' and exists (
          select 1 from public.users app_user
          where app_user.id = current_user_id and app_user.role in ('admin', 'team')
        ))
        or
        (room.type = 'client' and (
          client.user_id = current_user_id
          or exists (
            select 1 from public.users app_user
            where app_user.id = current_user_id and app_user.role = 'admin'
          )
          or exists (
            select 1 from public.client_team_members member
            where member.client_id = room.client_id and member.user_id = current_user_id
          )
          or exists (
            select 1
            from public.tasks task
            join public.projects project on project.id = task.project_id
            where project.client_id = room.client_id and task.assigned_to = current_user_id
          )
        ))
      )
  ) then
    raise exception 'Chat room access denied';
  end if;

  update public.chat_messages
  set read_by = array_append(coalesce(read_by, '{}'::uuid[]), current_user_id)
  where room_id = p_room_id
    and sender_id <> current_user_id
    and not (current_user_id = any(coalesce(read_by, '{}'::uuid[])));
end;
$$;

revoke all on function public.mark_chat_room_read(uuid) from public;
grant execute on function public.mark_chat_room_read(uuid) to authenticated;

alter table public.chat_messages replica identity full;

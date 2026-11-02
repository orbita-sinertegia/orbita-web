-- Mensajería privada entre integrantes del equipo.
create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users(id) on delete cascade,
  user_b uuid not null references public.users(id) on delete cascade,
  pair_key text not null unique,
  created_at timestamptz not null default now(),
  constraint direct_conversations_different_users check (user_a <> user_b)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  content text not null default '',
  file_url text,
  file_type text,
  file_name text,
  created_at timestamptz not null default now(),
  deleted_for uuid[] not null default '{}'
);

create index if not exists direct_messages_conversation_created_idx on public.direct_messages(conversation_id, created_at);
alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "Participantes pueden ver conversaciones directas" on public.direct_conversations;
create policy "Participantes pueden ver conversaciones directas" on public.direct_conversations for select to authenticated using (auth.uid() = user_a or auth.uid() = user_b);
drop policy if exists "Equipo puede crear conversaciones directas" on public.direct_conversations;
create policy "Equipo puede crear conversaciones directas" on public.direct_conversations for insert to authenticated with check (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "Participantes pueden ver mensajes directos" on public.direct_messages;
create policy "Participantes pueden ver mensajes directos" on public.direct_messages for select to authenticated using (exists (select 1 from public.direct_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())));
drop policy if exists "Participantes pueden enviar mensajes directos" on public.direct_messages;
create policy "Participantes pueden enviar mensajes directos" on public.direct_messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.direct_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())));
drop policy if exists "Autores pueden actualizar mensajes directos" on public.direct_messages;
create policy "Autores pueden actualizar mensajes directos" on public.direct_messages for update to authenticated using (sender_id = auth.uid());
drop policy if exists "Autores pueden borrar mensajes directos" on public.direct_messages;
create policy "Autores pueden borrar mensajes directos" on public.direct_messages for delete to authenticated using (sender_id = auth.uid());

alter table public.direct_messages replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null;
end $$;

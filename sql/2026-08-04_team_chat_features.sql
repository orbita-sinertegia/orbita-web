-- Funciones avanzadas del chat del equipo: respuestas, fijados y reacciones.
alter table public.chat_messages
  add column if not exists reply_to_id uuid references public.chat_messages(id) on delete set null,
  add column if not exists is_pinned boolean not null default false,
  add column if not exists reactions jsonb not null default '{}'::jsonb;

create index if not exists chat_messages_reply_to_id_idx on public.chat_messages(reply_to_id);
create index if not exists chat_messages_room_pinned_idx on public.chat_messages(room_id, is_pinned) where is_pinned = true;

alter table public.chat_messages replica identity full;

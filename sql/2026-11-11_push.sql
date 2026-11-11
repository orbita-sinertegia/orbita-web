-- Notificaciones push al instante (Firebase Cloud Messaging). Correr completo en el SQL Editor de Supabase.
-- Se puede correr más de una vez. Si una prueba falla, no se aplica nada.
--
-- * Cada teléfono registra su token de Firebase (solo el suyo, con su sesión).
-- * Al crearse un aviso para alguien con teléfono registrado, la base llama a la función
--   "enviar-push", que lo manda por Firebase. Si algo falla, el aviso se guarda igual.
-- * La función marca cada aviso como enviado (pushed_at): nunca se manda dos veces.
begin;

create extension if not exists pg_net with schema extensions;

create table if not exists public.device_tokens (
  token text primary key check (length(token) between 20 and 4096),
  user_id uuid not null references public.users(id) on delete cascade,
  platform text not null default 'android' check (platform in ('android')),
  updated_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens(user_id);

-- Nadie lee ni escribe la tabla directo: solo las funciones de abajo y la función "enviar-push".
alter table public.device_tokens enable row level security;
revoke all on public.device_tokens from anon, authenticated, public;

alter table public.notifications add column if not exists pushed_at timestamptz;

-- Registrar el teléfono de la sesión actual. Si el token era de otra cuenta (otra persona
-- usó ese teléfono), pasa a la cuenta actual.
create or replace function public.register_device_token(p_token text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if length(coalesce(p_token, '')) < 20 then raise exception 'Token no válido'; end if;
  insert into public.device_tokens (token, user_id, updated_at) values (p_token, auth.uid(), now())
  on conflict (token) do update set user_id = auth.uid(), updated_at = now();
end;
$$;

-- Al cerrar sesión el teléfono deja de recibir los avisos de esa cuenta.
create or replace function public.unregister_device_token(p_token text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.device_tokens where token = p_token and user_id = auth.uid();
end;
$$;

-- Llama a la función de envío. Nunca bloquea ni hace fallar el aviso.
create or replace function public.trg_enviar_push()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.device_tokens where user_id = new.user_id) then
    begin
      perform net.http_post(
        url := 'https://yuytimnolzdhlamylddl.supabase.co/functions/v1/enviar-push',
        body := jsonb_build_object('notification_id', new.id),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    exception when others then
      raise warning 'enviar-push: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists enviar_push on public.notifications;
create trigger enviar_push after insert on public.notifications
  for each row execute function public.trg_enviar_push();

revoke all on function public.register_device_token(text) from public, anon;
revoke all on function public.unregister_device_token(text) from public, anon;
revoke all on function public.trg_enviar_push() from public, anon, authenticated;
grant execute on function public.register_device_token(text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;

-- Pruebas (todo lo que crean se deshace).
do $$
declare
  alguien uuid;
  mensaje text;
begin
  select id into alguien from public.users where coalesce(active, true) limit 1;
  if alguien is null then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', alguien, 'role', 'authenticated')::text, true);
  begin
    perform public.register_device_token('token-de-prueba-que-no-existe-0000000000');
    if not exists (select 1 from public.device_tokens where token = 'token-de-prueba-que-no-existe-0000000000' and user_id = alguien) then
      raise exception 'PRUEBA FALLIDA: no se registró el teléfono';
    end if;
    perform public.unregister_device_token('token-de-prueba-que-no-existe-0000000000');
    if exists (select 1 from public.device_tokens where token = 'token-de-prueba-que-no-existe-0000000000') then
      raise exception 'PRUEBA FALLIDA: no se quitó el teléfono';
    end if;
    raise exception 'DESHACER_PRUEBA';
  exception when raise_exception then
    get stacked diagnostics mensaje = message_text;
    if mensaje <> 'DESHACER_PRUEBA' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

select 'Listo: notificaciones push' as resultado;

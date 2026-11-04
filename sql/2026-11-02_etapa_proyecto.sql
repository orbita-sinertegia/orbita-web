-- NO EJECUTAR sin revisión de Tony. Correr antes sql/2026-11-02_etapa_proyecto_00_revision.sql.
-- Agrega a projects:
--   stage       'en_proceso' | 'corriendo' (NULL = sin definir; se estima igual que en proceso)
--   funnel_type 'low2funnel' | 'vsl_high_ticket' | 'high_ticket' | 'restaurante' | 'webinar' | 'otro'
-- Idempotente: se puede correr varias veces. No borra datos, no toca tareas ni otras columnas,
-- y no usa sentencias de borrado (para que Supabase no muestre el aviso de operaciones destructivas).
-- La app ya funciona sin estas columnas; al existir, los admins pueden fijarlas en el proyecto
-- y los proyectos "corriendo" dejan de mostrar fechas estimadas.
begin;

alter table public.projects
  add column if not exists stage text,
  add column if not exists funnel_type text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_stage_check') then
    alter table public.projects
      add constraint projects_stage_check check (stage is null or stage in ('en_proceso', 'corriendo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_funnel_type_check') then
    alter table public.projects
      add constraint projects_funnel_type_check check (
        funnel_type is null or funnel_type in ('low2funnel', 'vsl_high_ticket', 'high_ticket', 'restaurante', 'webinar', 'otro')
      );
  end if;
end $$;

comment on column public.projects.stage is 'Etapa: en_proceso (construyendo) o corriendo (ya corre campañas). NULL = sin definir.';
comment on column public.projects.funnel_type is 'Tipo de embudo; decide la duración estimada de cada fase en la hoja de ruta.';

commit;

-- Después (aparte, con la lista de Tony y tras revisar los nombres con
-- /workspace/cc/serve/clientes_revision.sql) se puede marcar la etapa, por ejemplo:
--   update public.projects p set stage = 'corriendo'
--   from public.clients c
--   where c.id = p.client_id and c.name in ('Karla Zorola', 'Maria Gomez', ...);

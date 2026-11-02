-- Permite retirar embudos integrados sin alterar los proyectos creados con ellos.
alter table public.project_templates
  add column if not exists archived boolean not null default false;

create index if not exists project_templates_active_idx
  on public.project_templates (archived);

-- Renombra plan_name -> client_name (más claro: aquí va el nombre del cliente que renta la licencia)
-- y agrega fecha de inicio de contrato + mensualidad.
alter table app_license rename column plan_name to client_name;
alter table app_license add column if not exists start_date date;
alter table app_license add column if not exists monthly_amount numeric(10,2) not null default 0;
alter table app_license add column if not exists payment_link text;

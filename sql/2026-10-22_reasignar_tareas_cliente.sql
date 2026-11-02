-- NO EJECUTAR sin revisión de Tony. Script de reasignación para proyectos EXISTENTES
-- (sus tareas no se tocan automáticamente; esta es la corrección puntual pedida).
--
-- Orden sugerido:
--   1) Corre primero la consulta de solo lectura y revisa cada fila.
--   2) Si se ve bien, corre el UPDATE (solo toca tareas NO completadas, de clientes que
--      YA tienen un usuario de cliente activo vinculado).
--   3) Revisa el SELECT final de clientes sin cuenta: a esos hay que invitarlos primero
--      (no se puede reasignar su tarea porque no existe el usuario al que asignarla).
--   4) Hasta que esto esté limpio, no actives el trigger de
--      sql/2026-10-22_modalidad_y_retrasos_cliente.sql (rechazaría escrituras viejas
--      si quedó alguna tarea de cliente mal asignada).

-- 1) SOLO LECTURA — tareas de depto "cliente" que NO están asignadas al usuario cliente
select t.id, t.title, t.status, p.name as proyecto, c.name as cliente, c.user_id as cliente_user,
       u.full_name as asignado, u.role as asignado_role
from tasks t
join projects p on p.id = t.project_id
join clients c on c.id = p.client_id
left join users u on u.id = t.assigned_to
where t.department = 'cliente'
  and (u.role is distinct from 'client')
order by c.name, p.name;

-- 2) REASIGNACIÓN — solo tareas NO completadas, solo si el cliente ya tiene usuario activo.
-- begin;
update tasks t
set assigned_to = c.user_id
from projects p
join clients c on c.id = p.client_id
join users cu on cu.id = c.user_id
where t.project_id = p.id
  and t.department = 'cliente'
  and t.status <> 'completada'
  and cu.role = 'client'
  and coalesce(cu.active, true)
  and t.assigned_to is distinct from c.user_id;
-- commit;

-- 3) SOLO LECTURA — clientes SIN usuario vinculado que tienen tareas de depto "cliente".
-- A estos hay que invitarlos primero (ClientAssignmentManager → "Invitar cliente").
select distinct c.id, c.name, c.company
from tasks t
join projects p on p.id = t.project_id
join clients c on c.id = p.client_id
where t.department = 'cliente' and c.user_id is null
order by c.name;

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadModule(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exported = {}
  vm.runInNewContext(code, { exports: exported, require() { return {} } })
  return exported
}

const deq = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg)
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const ps = loadModule('src/lib/projectStatus.ts')
const { buildStatusChange, friendlyTaskError } = loadModule('src/lib/adminTasks.ts')

// ── Etiquetas y permisos ──

test('completado se muestra como Finalizado; activo y pausado sin cambio', () => {
  assert.equal(ps.projectStatusLabel('completado'), 'Finalizado')
  assert.equal(ps.projectStatusLabel('pausado'), 'Pausado')
  assert.equal(ps.projectStatusLabel('activo'), 'Activo')
  assert.equal(ps.projectStatusLabel(undefined), 'Activo')
  assert.deepEqual([...ps.PROJECT_STATUSES], ['activo', 'pausado', 'completado'])
})

test('solo el super admin activo puede cambiar el estado del proyecto y el estatus de tareas', () => {
  assert.equal(ps.canChangeProjectStatus({ is_super_admin: true, active: true }), true)
  assert.equal(ps.canChangeProjectStatus({ is_super_admin: true }), true)
  assert.equal(ps.canChangeProjectStatus({ is_super_admin: true, active: false }), false)
  assert.equal(ps.canChangeProjectStatus({ is_super_admin: false, active: true }), false)
  assert.equal(ps.canChangeProjectStatus({ role: 'admin', active: true }), false)
  assert.equal(ps.canChangeProjectStatus(null), false)
  assert.equal(ps.canEditTaskStatus({ is_super_admin: true }), true)
  assert.equal(ps.canEditTaskStatus({ role: 'admin' }), false)
  assert.equal(ps.canDeleteProjects({ is_super_admin: true, active: true }), true)
  assert.equal(ps.canDeleteProjects({ role: 'admin', is_super_admin: false }), false)
  assert.equal(ps.canDeleteProjects({ is_super_admin: true, active: false }), false)
})

// ── Proyectos finalizados en las vistas activas ──

test('las pendientes de proyectos finalizados se ocultan; las completadas quedan como historial', () => {
  const tasks = [
    { id: 'a', status: 'pendiente', project: { status: 'completado' } },
    { id: 'b', status: 'completada', project: { status: 'completado' } },
    { id: 'c', status: 'en_progreso', project: { status: 'pausado' } },
    { id: 'd', status: 'pendiente', project: { status: 'activo' } },
    { id: 'e', status: 'pendiente', project: null },
  ]
  deq(ps.hideDormantTasks(tasks).map(t => t.id), ['b', 'c', 'd', 'e'])
  deq(ps.hideDormantTasks(tasks, true).map(t => t.id), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(ps.isDormantTask(tasks[0]), true)
  assert.equal(ps.isDormantTask(tasks[2]), false, 'pausado sigue visible')
})

test('el portal del cliente abre primero el proyecto activo', () => {
  const sorted = ps.sortProjectsByStatus([
    { id: 'f', status: 'completado' }, { id: 'p', status: 'pausado' }, { id: 'a', status: 'activo' },
  ])
  deq(sorted.map(p => p.id), ['a', 'p', 'f'])
})

// ── Estatus de tareas (super admin) ──

test('buildStatusChange: sin cambios devuelve null', () => {
  assert.equal(buildStatusChange({ status: 'pendiente', completion_date: null }, 'pendiente', ''), null)
  assert.equal(buildStatusChange({ status: 'completada', completion_date: '2026-10-30' }, 'completada', '2026-10-30'), null)
  // Dejar la fecha vacía en una tarea ya realizada no la borra.
  assert.equal(buildStatusChange({ status: 'completada', completion_date: '2026-10-30' }, 'completada', ''), null)
})

test('buildStatusChange: reabrir una tarea realizada quita la fecha de realización', () => {
  deq(
    buildStatusChange({ status: 'completada', completion_date: '2026-10-30' }, 'en_progreso', '2026-10-30'),
    { p_status: 'en_progreso', p_completion_date: null },
  )
})

test('buildStatusChange: corregir la fecha de una tarea realizada', () => {
  deq(
    buildStatusChange({ status: 'completada', completion_date: '2026-10-30T00:00:00' }, 'completada', '2026-10-28'),
    { p_status: 'completada', p_completion_date: '2026-10-28' },
  )
})

test('buildStatusChange: marcar como realizada con o sin fecha', () => {
  deq(buildStatusChange({ status: 'pendiente', completion_date: null }, 'completada', ''), { p_status: 'completada', p_completion_date: null })
  deq(buildStatusChange({ status: 'pendiente', completion_date: null }, 'completada', '2026-11-01'), { p_status: 'completada', p_completion_date: '2026-11-01' })
})

test('friendlyTaskError explica cuando falta correr el SQL nuevo', () => {
  assert.match(friendlyTaskError('Could not find the function public.super_admin_set_task_status(p_completion_date, p_status, p_task_id) in the schema cache'), /actualizar la base de datos/)
  assert.equal(friendlyTaskError('Solo el super admin puede cambiar el estatus desde aquí'), 'Solo el super admin puede cambiar el estatus desde aquí')
})

// ── Pantallas ──

test('el selector de estado del proyecto solo se muestra al super admin', () => {
  const src = read('src/components/admin/ProjectDetail.tsx')
  assert.match(src, /canChangeProjectStatus\(user\)/)
  assert.match(src, /\{canChangeStatus \? \(/)
  assert.match(src, /statusOpen && canChangeStatus/)
  assert.match(src, /PROJECT_STATUS_LABELS\.completado/)
  assert.doesNotMatch(src, /label: 'Completado'/)
})

test('la tabla del proyecto permite ver todas las tareas, incluidas las realizadas', () => {
  const src = read('src/components/admin/ProjectDetail.tsx')
  assert.match(src, /<option value="todas">Todas \(con completadas\)<\/option>/)
  assert.match(src, /title="Editar tarea"/)
})

test('Editar tarea: estatus y fecha de realización solo para el super admin', () => {
  const src = read('src/components/admin/EditTaskModal.tsx')
  assert.match(src, /canEditTaskStatus\(user\)/)
  assert.match(src, /\{canEditStatus && \(/)
  assert.match(src, /super_admin_set_task_status/)
  assert.match(src, /canEditStatus \? buildStatusChange/)
})

test('el panel oculta por omisión las pendientes de proyectos finalizados y permite mostrarlas', () => {
  const src = read('src/components/admin/AdminDashboard.tsx')
  assert.match(src, /hideDormantTasks\(tasks, showFinalized\)/)
  assert.match(src, /<TeamCalendar [^>]*tasks=\{operationalTasks\}/)
  assert.match(src, /<TeamTasksManager [^>]*tasks=\{operationalTasks\}/)
  assert.match(src, /<TeamPerformance [^>]*tasks=\{metricTasks\}/)
  // El detalle del proyecto sigue recibiendo todas sus tareas (historial).
  assert.match(src, /tasks=\{tasks\.filter\(\(t\) => t\.project_id === selectedProject\.id\)\}/)
  assert.match(src, /label: 'Finalizados'/)
  assert.match(read('src/components/team/TeamDashboard.tsx'), /setTasks\(hideDormantTasks\(data \|\| \[\]\)\)/)
})

// ── SQL ──

test('SQL de control: sin DROP/DELETE/TRUNCATE y con candado de super admin', () => {
  const sql = read('sql/2026-11-02_control_super_admin.sql')
  // La única aparición de "delete" es el evento del trigger (no hay sentencias DROP/DELETE/TRUNCATE).
  assert.doesNotMatch(sql.replace(/before delete on public\.projects/g, ''), /\b(drop|delete|truncate)\b/i)
  assert.match(sql, /create or replace function public\.trg_projects_delete_super_admin_only\(\)/)
  assert.match(sql, /if auth\.uid\(\) is not null and not public\.is_active_super_admin\(\) then\s+raise exception 'Solo el super admin puede eliminar proyectos'/)
  assert.match(sql, /if not exists \(select 1 from pg_trigger where tgname = 'projects_delete_super_admin_only'[^)]*\) then\s+create trigger projects_delete_super_admin_only\s+before delete on public\.projects/)
  assert.doesNotMatch(sql, /create or replace trigger/i)
  assert.match(sql, /create or replace function public\.is_active_super_admin\(\)/)
  assert.match(sql, /create or replace function public\.super_admin_set_task_status\(p_task_id uuid, p_status text, p_completion_date date default null\)/)
  assert.match(sql, /if not public\.is_active_super_admin\(\) then\s+raise exception 'Solo el super admin/)
  assert.match(sql, /if not exists \(select 1 from pg_trigger where tgname = 'projects_status_super_admin_only'[^)]*\) then\s+create trigger projects_status_super_admin_only\s+before insert or update of status on public\.projects/)
  assert.match(sql, /insert into public\.task_audit_log/)
})

test('SQL de revisión: solo lectura y revisa el trigger de borrado', () => {
  const sql = read('sql/2026-11-02_control_super_admin_00_revision.sql')
  assert.match(sql, /'trigger_projects_delete', exists \(select 1 from pg_trigger where tgname = 'projects_delete_super_admin_only'\)/)
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i)
})

// ── Finalizar elimina las pendientes ──

test('isDeliveredTask: se conservan realizadas y entregadas (en revisión o aprobadas)', () => {
  assert.equal(ps.isDeliveredTask({ status: 'completada' }), true)
  for (const review of ['pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada']) {
    assert.equal(ps.isDeliveredTask({ status: 'en_progreso', review_status: review }), true, review)
  }
  assert.equal(ps.isDeliveredTask({ status: 'en_progreso', review_status: 'cambios_solicitados' }), false)
  assert.equal(ps.isDeliveredTask({ status: 'pendiente', review_status: null }), false)
  assert.equal(ps.isDeliveredTask({ status: 'bloqueada' }), false)
})

test('tasksDeletedOnFinalize cuenta solo las pendientes no entregadas', () => {
  const tasks = [
    { id: 'a', status: 'completada' }, { id: 'b', status: 'pendiente' },
    { id: 'c', status: 'en_progreso', review_status: 'pendiente_revision' },
    { id: 'd', status: 'en_progreso', review_status: 'cambios_solicitados' },
  ]
  deq(ps.tasksDeletedOnFinalize(tasks).map(t => t.id), ['b', 'd'])
})

test('finalizeCounts separa pendientes activas y ya archivadas', () => {
  deq(ps.finalizeCounts([
    { status: 'pendiente' }, { status: 'pendiente', archived_at: '2026-11-01T00:00:00Z' },
    { status: 'completada' }, { status: 'en_progreso', review_status: 'aprobada' },
    { status: 'en_progreso', review_status: 'cambios_solicitados' },
  ]), { active: 2, archived: 1 })
})

test('textos al elegir cómo finalizar', () => {
  assert.match(ps.finalizeChoiceText({ active: 3, archived: 0 }), /tiene 3 tareas pendientes\. .*¿Qué hacemos con las pendientes\?/)
  assert.match(ps.finalizeChoiceText({ active: 1, archived: 2 }), /1 tarea pendiente \(y 2 pendientes ya archivadas\)/)
  assert.match(ps.finalizeChoiceText({ active: 0, archived: 0 }), /No hay tareas pendientes/)
  assert.match(ps.finalizeChoiceText(null), /Contando/)
  assert.match(ps.finalizeDeleteWarning({ active: 3, archived: 2 }), /Se eliminarán para siempre 5 tareas.*no se puede deshacer/)
  assert.match(ps.finalizeResultNotice('archivar', 4), /Se archivaron 4 tareas pendientes; vuelven si lo reactivas/)
  assert.match(ps.finalizeResultNotice('borrar', 1), /Se eliminó para siempre 1 tarea pendiente/)
  assert.match(ps.finalizeResultNotice('borrar', 0), /No había tareas pendientes/)
  assert.equal(ps.finalizeResultNotice('archivar', null), 'Proyecto finalizado.')
  assert.match(ps.reactivateNotice(2), /Se restauraron 2 tareas/)
  assert.match(ps.reactivateNotice(0), /No había tareas archivadas/)
  assert.equal(ps.reactivateNotice(null), 'Proyecto reactivado.')
  assert.match(ps.PROJECT_STATUS_HINTS.completado, /Tú eliges: archivar .* o eliminarlas para siempre/)
})

test('SQL finalizar_elegir: apaga el borrado automático, RPC con dos modos, restauración al reactivar', () => {
  const sql = read('sql/2026-11-02_finalizar_elegir.sql')
  assert.doesNotMatch(sql, /\b(drop|delete|truncate)\b/i)
  assert.doesNotMatch(sql, /create or replace trigger/i)
  // 1. El trigger viejo queda vacío (no se quita).
  const noop = sql.slice(sql.indexOf('create or replace function public.trg_projects_finalize_delete()'), sql.indexOf('-- 2.'))
  assert.match(noop, /begin\s+-- Desactivado[^\n]*\n\s+return new;\s+end;/)
  assert.doesNotMatch(noop, /purge_finalized_project_tasks\(/)
  // 2. Marca y limpieza de la marca en archivados manuales.
  assert.match(sql, /alter table public\.tasks add column if not exists archived_via text;/)
  assert.match(sql, /current_setting\('app\.project_finalize', true\), ''\) <> 'on' then\s+new\.archived_via := null/)
  // 3. RPC: candado, modos, archivar o eliminar.
  assert.match(sql, /create or replace function public\.finalize_project\(p_project_id uuid, p_mode text\)\s+returns integer\s+language plpgsql\s+security definer/)
  assert.match(sql, /if not public\.is_active_super_admin\(\) then\s+raise exception 'Solo el super admin puede finalizar proyectos'/)
  assert.match(sql, /p_mode not in \('archivar', 'borrar'\)/)
  assert.match(sql, /and not public\.is_task_delivered\(t\.status::text, t\.review_status::text\)\s+for update/)
  assert.match(sql, /archived_via = 'proyecto_finalizado'\s+from pending p/)
  assert.match(sql, /'archive', before, after from changed;\s+get diagnostics v_count = row_count;/)
  assert.match(sql, /v_count := public\.purge_finalized_project_tasks\(p_project_id\);/)
  assert.match(sql, /grant execute on function public\.finalize_project\(uuid, text\) to authenticated;/)
  // 4. Reactivar restaura solo lo marcado.
  assert.match(sql, /if old\.status::text = 'completado' and new\.status::text is distinct from 'completado' then/)
  assert.match(sql, /t\.archived_at is not null and t\.archived_via = 'proyecto_finalizado'/)
  assert.match(sql, /'restore', before, after from changed/)
  assert.match(sql, /if not exists \(select 1 from pg_trigger where tgname = 'projects_reactivate_restore'[^)]*\) then\s+create trigger projects_reactivate_restore\s+after update of status on public\.projects/)
})

test('SQL de revisión de finalizar_elegir: solo lectura', () => {
  const sql = read('sql/2026-11-02_finalizar_elegir_00_revision.sql')
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i)
  assert.match(sql, /'borrado_automatico_activo'/)
  assert.match(sql, /'trigger_projects_reactivate_restore'/)
})

test('SQL finalizar_borra: trigger solo hacia Finalizado, mismo criterio y mismo borrado en cascada que la app', () => {
  const sql = read('sql/2026-11-02_finalizar_borra.sql')
  assert.doesNotMatch(sql, /\b(drop|truncate)\b/i)
  assert.doesNotMatch(sql, /create or replace trigger/i)
  assert.doesNotMatch(sql, /archived_via|restore/i)
  assert.match(sql, /if not exists \(select 1 from pg_trigger where tgname = 'projects_finalize_delete'[^)]*\) then\s+create trigger projects_finalize_delete\s+after update of status on public\.projects/)
  assert.match(sql, /in \('pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada'\)/)
  for (const table of ['task_comments', 'task_links', 'task_subtasks', 'task_time_entries', 'task_ratings']) {
    assert.match(sql, new RegExp(`delete from public\\.${table} where task_id = p_task_id;`), table)
  }
  assert.match(sql, /update public\.notifications set task_id = null where task_id = p_task_id;/)
  assert.match(sql, /update public\.chat_messages set task_id = null where task_id = p_task_id;/)
  assert.match(sql, /update public\.tasks set depends_on_task_id = null where depends_on_task_id = p_task_id;/)
  assert.match(sql, /values \(p_task_id, auth\.uid\(\), 'delete', v_snapshot, null\)/)
  assert.match(sql, /revoke all on function public\.delete_task_permanently_internal\(uuid, text\) from public, anon, authenticated;/)
  assert.match(sql, /revoke all on function public\.purge_finalized_project_tasks\(uuid\) from public, anon, authenticated;/)
  // NO retroactivo: nada recorre los proyectos ya finalizados; solo la transición hacia Finalizado.
  assert.doesNotMatch(sql, /BLOQUE RETROACTIVO|for r in select/i)
  assert.doesNotMatch(sql, /from public\.projects where status/i)
  assert.match(sql, /if old\.status::text is distinct from 'completado' and new\.status::text = 'completado' then\s+perform public\.purge_finalized_project_tasks\(new\.id\);/)
  // Mismo criterio que la app.
  assert.match(read('src/lib/projectStatus.ts'), /\['pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada'\]/)
})

test('SQL de revisión de finalizar_borra: solo lectura, llaves foráneas y conteo por proyecto finalizado', () => {
  const sql = read('sql/2026-11-02_finalizar_borra_00_revision.sql')
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i)
  assert.match(sql, /contype = 'f' and confrelid = 'public\.tasks'::regclass/)
  assert.match(sql, /'eliminables \(no se borran ahora\): '/)
  assert.match(sql, /' · se conservan: '/)
  // Proyectos de Mel con estado, etapa y pendientes (informativo, sin cambiarle nada).
  assert.match(sql, /'5_mel'[\s\S]*where c\.name ilike '%mel%'/)
  assert.match(sql, /' · etapa: '/)
})

// ── Eliminar tarea para siempre (super admin) ──

test('canDeleteTasks y aviso al eliminar', () => {
  assert.equal(ps.canDeleteTasks({ is_super_admin: true, active: true }), true)
  assert.equal(ps.canDeleteTasks({ role: 'admin', is_super_admin: false }), true)
  assert.equal(ps.canDeleteTasks({ role: 'admin', is_super_admin: false, active: false }), false)
  assert.equal(ps.canDeleteTasks({ role: 'team', is_super_admin: false }), false)
  assert.equal(ps.canDeleteTasks({ role: 'client', is_super_admin: false }), false)
  assert.equal(ps.canDeleteTasks({ is_super_admin: true, active: false }), false)
  assert.equal(ps.taskDeletedNotice('Guion 1'), 'Tarea “Guion 1” eliminada para siempre.')
})

test('el bote aparece también en Tareas del equipo (tabla y tarjetas) y en el detalle de la tarea, solo con canDeleteTasks', () => {
  const manager = read('src/components/admin/TeamTasksManager.tsx')
  assert.equal((manager.match(/\{canDeleteTask && <button [^>]*onClick=\{\(\) => setSuperDeleteTask\(task\)\} title="Borrar definitivamente"/g) || []).length, 2)
  assert.match(manager, /const canDeleteTask = canDeleteTasks\(user\)/)
  const detail = read('src/components/team/TaskDetailModal.tsx')
  assert.match(detail, /const canDeleteTask = canDeleteTasks\(user\)/)
  assert.match(detail, /\{canDeleteTask && \(\s+<button type="button" onClick=\{\(\) => setShowDeleteTask\(true\)\} title="Borrar definitivamente"/)
  assert.match(detail, /\{showDeleteTask && canDeleteTask && \(/)
})

test('SQL admin_borra_tareas: solo administradores activos y sin sentencias destructivas al correrlo', () => {
  const sql = read('sql/2026-11-06_admin_borra_tareas.sql')
  assert.doesNotMatch(sql, /\b(drop|truncate)\b/i)
  assert.match(sql, /if not public\.is_active_admin\(\) then\s+raise exception 'Solo un administrador puede borrar tareas definitivamente'/)
  assert.match(sql, /revoke all on function public\.super_admin_delete_task\(uuid\) from public, anon;/)
  assert.ok(sql.indexOf('PRUEBA FALLIDA') < sql.lastIndexOf('commit;'))
})

test('SQL borrar_tarea: RPC solo super admin que usa el borrado interno con foto, sin sentencias destructivas', () => {
  const sql = read('sql/2026-11-02_borrar_tarea.sql')
  assert.doesNotMatch(sql, /\b(drop|delete|truncate)\b/i)
  assert.match(sql, /create or replace function public\.super_admin_delete_task\(p_task_id uuid\)\s+returns uuid\s+language plpgsql\s+security definer/)
  assert.match(sql, /if not public\.is_active_super_admin\(\) then\s+raise exception 'Solo el super admin puede eliminar tareas para siempre'/)
  assert.match(sql, /perform public\.delete_task_permanently_internal\(p_task_id, 'eliminada_por_super_admin'\);/)
  assert.doesNotMatch(sql, /archived_at is null|archived_at is not null/, 'funciona archivada o no')
  assert.match(sql, /grant execute on function public\.super_admin_delete_task\(uuid\) to authenticated;/)
  const rev = read('sql/2026-11-02_borrar_tarea_00_revision.sql')
  assert.doesNotMatch(rev, /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i)
  assert.match(rev, /'fn_super_admin_delete_task'/)
})

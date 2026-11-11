// Citas: reglas en la base y tarjeta de solo lectura en la web.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('el SQL de citas bloquea empalmes con obligatorios y solo deja coordinar a admins', () => {
  const sql = read('sql/2026-11-09_citas.sql')
  assert.match(sql, /exclude using gist \(user_id with =, slot with &&\) where \(required and slot is not null\)/)
  assert.match(sql, /where coalesce\(\(x->>'required'\)::boolean, true\)/)
  for (const fn of ['schedule_appointment', 'start_appointment', 'close_appointment', 'check_appointment_conflicts']) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`))
    assert.match(body.slice(0, 1500), /is_active_admin\(\)/, fn)
  }
  assert.match(sql, /grant select on public\.appointments, public\.appointment_participants/)
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*appointment/)
  assert.match(sql, /visible_to_client or public\.app_is_staff\(\)/)
  assert.ok(sql.indexOf('PRUEBA FALLIDA') < sql.lastIndexOf('commit;'))
})

test('grabación es presencial y lo demás virtual con enlace https', () => {
  const sql = read('sql/2026-11-09_citas.sql')
  assert.match(sql, /case when p_kind = 'grabacion' then 'presencial' else 'virtual' end/)
  assert.match(sql, /p_modality = 'virtual' and coalesce\(p_meeting_url, ''\) !~ '\^https:\/\/'/)
})

test('la web muestra las próximas reuniones en la hoja de ruta, sin poder editarlas', () => {
  const card = read('src/components/roadmap/UpcomingMeetings.tsx')
  assert.match(card, /from\('appointments'\)/)
  assert.doesNotMatch(card, /\.(insert|update|delete|rpc)\(/)
  assert.match(card, /rel="noopener noreferrer"/)
  assert.match(read('src/components/admin/ProjectDetail.tsx'), /<UpcomingMeetings projectId=\{project\.id\} \/>/)
  assert.match(read('src/components/client/ClientPortal.tsx'), /<UpcomingMeetings projectId=\{selectedProject\.id\} \/>/)
  assert.match(read('src/components/shared/NotificationBell.tsx'), /appointment: '📅'/)
})

test('v2: tipos de cita editables solo por admins, cambio de horario y recordatorios', () => {
  const sql = read('sql/2026-11-10_citas_v2_y_asistencia.sql')
  assert.match(sql, /create table if not exists public\.appointment_kinds/)
  assert.match(sql, /\('accesos', 'Accesos a cuentas', 'virtual', 4\)/)
  assert.doesNotMatch(sql, /p_kind not in \('grabacion'/)
  assert.equal((sql.match(/appointment_kinds where slug = p_kind and active/g) || []).length, 2)
  assert.match(sql, /'Solo un administrador puede agregar tipos de cita'/)
  assert.match(sql, /function public\.resolve_change_request/)
  assert.match(sql, /cron\.schedule\('citas-recordatorios'/)
  assert.ok(sql.indexOf('PRUEBA FALLIDA') < sql.lastIndexOf('commit;'))
})

test('asistencia: aviso verde o naranja al registrar la primera entrada y panel en vivo', () => {
  const sql = read('sql/2026-11-10_citas_v2_y_asistencia.sql')
  assert.match(sql, /create trigger aviso_entrada after insert on public\.work_sessions/)
  assert.match(sql, /coalesce\(new\.late_minutes, 0\) <= 5 then\s+titulo := '🟢 Entrada a tiempo'/)
  assert.match(sql, /'🟠 Entrada con retardo'/)
  const panel = read('src/components/admin/AttendancePanel.tsx')
  assert.match(panel, /'Hoy en vivo'/)
  assert.match(panel, /table: 'work_sessions'/)
  assert.match(panel, /removeChannel\(channel\)/)
  assert.match(read('src/components/shared/NotificationBell.tsx'), /notification\.type === 'attendance'/)
})

test('evidencia: bucket privado, solo admins suben, clientes ven solo lo visible para ellos', () => {
  const sql = read('sql/2026-11-10_evidencia_citas.sql')
  assert.match(sql, /'appointment-evidence', 'appointment-evidence', false/)
  assert.match(sql, /create policy "evidencia_subir"[\s\S]*?public\.is_active_admin\(\)/)
  assert.match(sql, /f\.visible_to_client or public\.app_is_staff\(\)/)
  assert.match(sql, /PRUEBA FALLIDA: el bucket de evidencia quedó público/)
  const privacy = read('public/privacidad.html')
  assert.match(privacy, /Evidencia de citas/)
  assert.match(privacy, /minutos de retardo/)
})

test('ubicación: estudio de la agencia o domicilio del cliente, y descarga de la app', () => {
  const sql = read('sql/2026-11-11_ubicacion_citas.sql')
  assert.match(sql, /create table if not exists public\.appointment_places/)
  assert.match(sql, /'Indica si la cita es en el estudio o en tu domicilio'/)
  assert.match(sql, /'Solo un administrador agrega lugares'/)
  assert.match(sql, /drop function if exists public\.request_appointment\(uuid, text, text, jsonb\);/)
  assert.ok(sql.indexOf('PRUEBA FALLIDA') < sql.lastIndexOf('commit;'))
  assert.match(read('src/components/roadmap/UpcomingMeetings.tsx'), /Ver en Google Maps/)
  assert.match(read('public/app.html'), /releases\/latest\/download\/orbita-citas\.apk/)
})

test('push: tokens privados, envío una sola vez y sin bloquear el aviso', () => {
  const sql = read('sql/2026-11-11_push.sql')
  assert.match(sql, /revoke all on public\.device_tokens from anon, authenticated, public;/)
  assert.match(sql, /exception when others then\s+raise warning 'enviar-push/)
  const fn = read('supabase/functions/enviar-push/index.ts')
  assert.match(fn, /\.is\('pushed_at', null\)/)
  assert.match(fn, /Deno\.env\.get\('FCM_SERVICE_ACCOUNT'\)/)
  assert.match(fn, /priority: 'HIGH'/)
  assert.doesNotMatch(fn, /private_key"\s*:/)
})

test('embudos: se eliminan con su función, se administran desde Nuevo proyecto y sin Etapa/Tipo de embudo', () => {
  const sql = read('sql/2026-11-11_embudos.sql')
  assert.match(sql, /create or replace function public\.admin_remove_template_tasks/)
  assert.match(sql, /add column if not exists source_template_key text/)
  const modal = read('src/components/admin/CreateProjectModal.tsx')
  assert.match(modal, /Opciones del embudo/)
  assert.match(modal, /deleteFunnel\(funnel\)/)
  assert.doesNotMatch(modal, /Etapa del proyecto|FUNNEL_TYPES/)
  assert.doesNotMatch(read('src/components/admin/ProjectDetail.tsx'), /FUNNEL_TYPES|PROJECT_STAGES/)
  assert.match(read('src/components/admin/AdminDashboard.tsx'), /view === 'clientes' \|\| view === 'create_project'/)
})

test('Panel de Control: indicadores, resumen con 3 métricas, atención y proyectos en panel', () => {
  const dash = read('src/components/admin/AdminDashboard.tsx')
  for (const text of ['Proyectos activos', 'Tareas abiertas', 'Terminadas en 7 días', 'Personas activas', 'Tareas vencidas', 'Entrega a tiempo', 'En retrabajo', 'Crear el primer proyecto']) {
    assert.match(dash, new RegExp(text))
  }
  assert.match(dash, /className="pc-kpis"/)
  const css = read('src/styles/DashboardV2.css')
  assert.match(css, /\.ui-dark \.v2app \.pc-mini/)
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.v2app \.pc-kpi/)
})

test('Tareas del equipo: diseño en dos paneles con buscadores suaves y estado vacío', () => {
  const ui = read('src/components/admin/TeamTasksManager.tsx')
  assert.match(ui, /lg:grid-cols-\[300px_minmax\(0,1fr\)\] lg:items-start/)
  assert.match(ui, /bg-\[#F4F3F8\]/)
  assert.match(ui, /No hay tareas con estos filtros/)
  assert.match(read('src/index.css'), /\.ui-dark \.bg-\\[\#F4F3F8\\]/)
})

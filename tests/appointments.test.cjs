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

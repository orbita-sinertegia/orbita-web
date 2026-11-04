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
  vm.runInNewContext(code, { exports: exported, Intl, Date, require(id) {
    if (id.endsWith('/dates')) return loadModule('src/lib/dates.ts')
    if (id.endsWith('/holidays')) return loadModule('src/lib/holidays.ts')
    return {}
  } })
  return exported
}
const deq = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg)
const agenda = loadModule('src/lib/teamAgenda.ts')
const holidays = loadModule('src/lib/holidays.ts')
const owners = loadModule('src/data/templateOwners.ts')
const sel = loadModule('src/lib/taskSelection.ts')

const people = [
  { id: 'a', full_name: 'Zoe', role: 'team', department: 'copy', active: true },
  { id: 'b', full_name: 'Ana', role: 'admin', department: 'lider', active: true },
  { id: 'c', full_name: 'Cliente', role: 'client', active: true },
  { id: 'd', full_name: 'Baja', role: 'team', active: false },
  { id: 'e', full_name: 'Sin depto', role: 'team', active: true },
]
// Hoy (CDMX) = miércoles 4 nov 2026
const today = '2026-11-04'
const t = (id, extra) => ({ id, title: id, assigned_to: 'a', status: 'pendiente', ...extra })
const tasks = [
  t('hoy-compromiso', { commitment_date: '2026-11-04', needed_date: '2026-11-30' }),
  t('hoy-necesito', { needed_date: '2026-11-04' }),
  t('compromiso-gana', { commitment_date: '2026-11-10', needed_date: '2026-11-04' }),
  t('domingo', { commitment_date: '2026-11-08' }),
  t('fin-mes', { needed_date: '2026-11-30' }),
  t('diciembre', { needed_date: '2026-12-01' }),
  t('atrasada', { commitment_date: '2026-11-03' }),
  t('revision', { commitment_date: '2026-11-01', review_status: 'pendiente_revision' }),
  t('cambios', { commitment_date: '2026-11-04', review_status: 'cambios_solicitados' }),
  t('sin-fecha', {}),
  t('hecha', { status: 'completada', commitment_date: '2026-11-04' }),
  t('archivada', { commitment_date: '2026-11-04', archived_at: '2026-11-01' }),
  t('finalizado', { commitment_date: '2026-11-04', project: { status: 'completado' } }),
  t('de-ana', { assigned_to: 'b' }),
]
const ids = list => list.map(x => x.id)

test('Agenda: personas activas, equipo + admins, sin clientes ni duplicados, por nombre', () => {
  deq(ids(agenda.agendaPeople([people[0], people[3], people[4]], [people[1], people[0], people[2]])), ['b', 'e', 'a'])
})

test('Agenda: fin de ventana Hoy / Semana (domingo) / Mes', () => {
  assert.equal(agenda.windowEndKey('hoy', today), '2026-11-04')
  assert.equal(agenda.windowEndKey('semana', today), '2026-11-08')
  assert.equal(agenda.windowEndKey('semana', '2026-11-08'), '2026-11-08', 'domingo es el último día de su semana')
  assert.equal(agenda.windowEndKey('mes', today), '2026-11-30')
  assert.equal(agenda.windowEndKey('mes', '2027-02-10'), '2027-02-28')
})

test('Agenda: Mi compromiso primero, si no La necesito para; atrasadas, en revisión y sin planear', () => {
  const [row] = agenda.buildAgenda([people[0]], tasks, 'hoy', { todayKey: today })
  deq(ids(row.due), ['hoy-compromiso', 'hoy-necesito', 'cambios'])
  deq(ids(row.overdue), ['atrasada'])
  deq(ids(row.inReview), ['revision'])
  deq(ids(row.undated), ['sin-fecha'])
  const [week] = agenda.buildAgenda([people[0]], tasks, 'semana', { todayKey: today })
  deq(ids(week.due), ['hoy-compromiso', 'hoy-necesito', 'cambios', 'domingo'])
  const [month] = agenda.buildAgenda([people[0]], tasks, 'mes', { todayKey: today })
  deq(ids(month.due), ['hoy-compromiso', 'hoy-necesito', 'cambios', 'domingo', 'compromiso-gana', 'fin-mes'])
})

test('Agenda: filtro por departamento (incluye "Sin departamento")', () => {
  const list = agenda.agendaPeople(people)
  deq(ids(agenda.buildAgenda(list, tasks, 'hoy', { todayKey: today, department: 'copy' }).map(r => r.person)), ['a'])
  deq(ids(agenda.buildAgenda(list, tasks, 'hoy', { todayKey: today, department: 'sin_departamento' }).map(r => r.person)), ['e'])
  deq(agenda.agendaDepartments(list), ['copy', 'lider', 'sin_departamento'])
  const [ana] = agenda.buildAgenda([people[1]], tasks, 'hoy', { todayKey: today })
  deq(ids(ana.undated), ['de-ana'], 'los admins también aparecen con sus tareas')
})

test('Feriados oficiales MX 2026–2027 (incluye 16 nov 2026)', () => {
  assert.equal(holidays.isHoliday('2026-11-16'), true)
  assert.match(holidays.holidayName('2026-11-16'), /Revolución/)
  assert.equal(holidays.isHoliday('2026-09-16'), true)
  assert.equal(holidays.isHoliday('2027-02-01'), true)
  assert.equal(holidays.isHoliday('2026-11-17'), false)
  assert.equal(holidays.holidayName('2026-11-17'), '')
})

test('Dueños por depto de plantilla: vacío por omisión; con config resuelve por email solo a activos no cliente', () => {
  deq(owners.DEFAULT_TEMPLATE_OWNERS, {})
  deq(owners.resolveTemplateOwners(['copy', 'diseno_web'], [{ id: 'x', email: 'x@a.com', role: 'team', active: true }]), {})
  const members = [
    { id: 'x', email: 'X@a.com', role: 'team', active: true },
    { id: 'y', email: 'y@a.com', role: 'team', active: false },
    { id: 'z', email: 'z@a.com', role: 'client', active: true },
  ]
  const config = { copy: 'x@a.com', diseno: 'x@a.com', edicion: 'y@a.com', webmaster: 'z@a.com', cliente: 'x@a.com' }
  deq(owners.resolveTemplateOwners(['copy', 'diseno_web', 'edicion_reels', 'webmaster', 'cliente', 'trafficker'], members, config), { copy: 'x', diseno_web: 'x' })
})

test('Saltos del lote: cliente, realizadas (salvo super admin) y sin cambio', () => {
  const task = { id: '1', title: 'T', department: 'copy', status: 'pendiente', assigned_to: 'a', needed_date: '2026-11-20' }
  assert.equal(sel.bulkSkipReason('reasignar', task, { assigneeId: 'b' }), '')
  assert.match(sel.bulkSkipReason('reasignar', { ...task, department: 'cliente' }, { assigneeId: 'b' }), /cliente/)
  assert.match(sel.bulkSkipReason('reasignar', task, { assigneeId: 'a' }), /Ya estaba asignada/)
  assert.match(sel.bulkSkipReason('necesito', { ...task, status: 'completada' }, { neededDate: '2026-11-21' }), /super admin/)
  assert.equal(sel.bulkSkipReason('necesito', { ...task, status: 'completada' }, { neededDate: '2026-11-21', canEditCompleted: true }), '')
  assert.match(sel.bulkSkipReason('necesito', task, { neededDate: '2026-11-20' }), /Ya tenía esa fecha/)
  assert.match(sel.bulkSkipReason('necesito', { ...task, needed_date: null }, { neededDate: '' }), /No tenía fecha/)
  assert.equal(sel.bulkSkipReason('necesito', { ...task, department: 'cliente' }, { neededDate: '2026-11-21' }), '', 'la fecha sí se puede en tareas del cliente')
  deq(sel.bulkUpdateChanges('reasignar', { assigneeId: 'b' }), { assigned_to: 'b' })
  deq(sel.bulkUpdateChanges('necesito', { neededDate: '' }), { needed_date: null })
  assert.equal(sel.bulkResultNotice({ action: 'reasignar', okIds: [], failed: [], skipped: [{ id: '1' }] }), 'No hubo cambios. Se saltó 1 tarea.')
})

// Tablero semanal: métricas por persona (TZ America/Mexico_City).
process.env.TZ = 'America/Mexico_City'

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
  vm.runInNewContext(code, { exports: exported, require(id) {
    if (id.endsWith('/dates')) return loadModule('src/lib/dates.ts')
    if (id.endsWith('/taskDelays')) return loadModule('src/lib/taskDelays.ts')
    return {}
  } })
  return exported
}

const sc = loadModule('src/lib/weeklyScorecard.ts')
const NOW = new Date('2026-11-07T20:00:00Z') // sábado 7 nov 2026, 14:00 CDMX
const WEEK = '2026-11-04' // cualquier día de la semana lun 2 – sáb 7 nov
const plain = value => JSON.parse(JSON.stringify(value))

let n = 0
const task = (extra = {}) => ({ id: `t${++n}`, project_id: 'p1', title: `Tarea ${n}`, department: 'edicion', status: 'completada', assigned_to: 'valeria', created_at: '2026-11-01T15:00:00Z', ...extra })
const valeria = { id: 'valeria', department: 'edicion' }

test('week range is Monday–Saturday (+ Sunday for deliveries) in CDMX', () => {
  assert.deepEqual(plain(sc.weekRange('2026-11-08')), { monday: '2026-11-02', saturday: '2026-11-07', sunday: '2026-11-08', workdays: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'] })
})

test('classifyTask reads type and quantity from templates', () => {
  const c = (title, department) => plain(sc.classifyTask({ title, department }))
  assert.deepEqual(c('Editar VSL principal', 'edicion'), { type: 'vsl', units: 1 })
  assert.deepEqual(c('Editar 6 anuncios — ronda 1 (2 fríos, 2 templados, 2 calientes)', 'edicion'), { type: 'anuncio', units: 6 })
  assert.deepEqual(c('Editar video de Gracias', 'edicion'), { type: 'video', units: 1 })
  assert.deepEqual(c('Grabar 12 anuncios', 'grabacion'), { type: 'anuncio', units: 12 })
  assert.deepEqual(c('Diseñar 3 imágenes tipo carruseles para Meta Ads', 'diseno'), { type: 'imagen', units: 3 })
  assert.deepEqual(c('Diseñar Landing Page (LP)', 'diseno'), { type: 'pagina', units: 1 })
  assert.deepEqual(c('Montar funnel completo en GHL', 'webmaster'), { type: 'pagina', units: 1 })
  assert.deepEqual(c('Crear prompt experto: Guiones VSL y Gracias', 'copy'), { type: 'guion', units: 1 })
  assert.deepEqual(c('Montar campañas en Meta Ads', 'trafficker'), { type: 'campana', units: 1 })
  assert.deepEqual(c('🔄 Retrabajo: Editar VSL principal', 'edicion'), { type: 'retrabajo', units: 0 })
  assert.deepEqual(plain(sc.classifyTask({ title: 'Algo', department: 'edicion', work_type: 'anuncio', work_units: 4 })), { type: 'anuncio', units: 4 })
})

test('completion day uses completion_date, or updated_at in CDMX (20:00 CDMX is still the same day)', () => {
  assert.equal(sc.completionKey({ status: 'completada', completion_date: '2026-11-03' }), '2026-11-03')
  assert.equal(sc.completionKey({ status: 'completada', updated_at: '2026-11-04T02:00:00Z' }), '2026-11-03')
  assert.equal(sc.completionKey({ status: 'en_progreso', completion_date: '2026-11-03' }), null)
})

test('goal: 8 ads/week, 6 delivered → 75% red; person goal beats department goal', () => {
  const tasks = [task({ title: 'Editar 6 anuncios — ronda 1', completion_date: '2026-11-04', commitment_date: '2026-11-05' })]
  const goals = [{ department: 'edicion', work_type: 'anuncio', weekly_target: 12 }, { user_id: 'valeria', work_type: 'anuncio', weekly_target: 8 }]
  const m = sc.computeMemberWeek(valeria, tasks, [], goals, WEEK, { now: NOW })
  assert.equal(m.byType.anuncio.units, 6)
  assert.equal(m.goalPct, 75)
  assert.equal(m.semaphore, 'rojo')
  assert.equal(sc.semaphore(100), 'verde')
  assert.equal(sc.semaphore(80), 'amarillo')
  assert.equal(sc.semaphore(79), 'rojo')
  assert.equal(sc.semaphore(null), null)
})

test('points goal uses weights (VSL=3, ad=1); without goals there is no semaphore', () => {
  const tasks = [
    task({ title: 'Editar VSL principal', completion_date: '2026-11-02' }),
    task({ title: 'Editar 6 anuncios — ronda 2', completion_date: '2026-11-06' }),
    task({ title: 'Editar VSL principal', completion_date: '2026-10-30' }), // semana anterior
  ]
  const withGoal = sc.computeMemberWeek(valeria, tasks, [], [{ user_id: 'valeria', work_type: 'puntos', weekly_target: 9 }], WEEK, { now: NOW })
  assert.equal(withGoal.completedPoints, 9)
  assert.equal(withGoal.goalPct, 100)
  const custom = sc.computeMemberWeek(valeria, tasks, [], [], WEEK, { now: NOW, weights: { ...sc.DEFAULT_WEIGHTS, vsl: 5 } })
  assert.equal(custom.completedPoints, 11)
  assert.equal(custom.goalPct, null)
  assert.equal(custom.semaphore, null)
  assert.equal(custom.completedCount, 2)
})

test('on-time %: completed on/before commitment_date; client-caused delays excluded', () => {
  const tasks = [
    task({ completion_date: '2026-11-03', commitment_date: '2026-11-03' }),
    task({ completion_date: '2026-11-05', commitment_date: '2026-11-04' }),
    task({ completion_date: '2026-11-06', commitment_date: '2026-11-02', delay_responsible: 'cliente' }),
  ]
  const m = sc.computeMemberWeek(valeria, tasks, [], [], WEEK, { now: NOW })
  assert.equal(m.onTimeEvaluated, 2)
  assert.equal(m.onTimeCount, 1)
  assert.equal(m.onTimePct, 50)
  assert.equal(m.clientExcluded, 1)
})

test('first-pass approval: rework task, internal changes or client changes break it; pending review not judged', () => {
  const ok = task({ title: 'Editar VSL principal', completion_date: '2026-11-03', review_status: 'aprobada' })
  const reworked = task({ title: 'Editar video de Gracias', completion_date: '2026-11-03', review_status: 'aprobada' })
  const rework = task({ title: '🔄 Retrabajo: Editar video de Gracias', completion_date: '2026-11-05' })
  const clientChanges = task({ title: 'Editar 6 anuncios — ronda 1', completion_date: '2026-11-04', change_count: 1 })
  const pending = task({ title: 'Editar 6 anuncios — ronda 2', completion_date: '2026-11-06', review_status: 'pendiente_revision' })
  const m = sc.computeMemberWeek(valeria, [ok, reworked, rework, clientChanges, pending], [], [], WEEK, { now: NOW })
  assert.equal(m.reworkCount, 1)
  assert.equal(m.completedCount, 4)
  assert.equal(m.firstPassEvaluated, 3)
  assert.equal(m.firstPassCount, 1)
  assert.equal(m.firstPassPct, 33)
})

test('average delivery time from start_date (or creation) to completion', () => {
  const tasks = [
    task({ start_date: '2026-11-02', completion_date: '2026-11-05' }),
    task({ created_at: '2026-11-03T03:00:00Z', completion_date: '2026-11-03' }), // creada 2 nov 21:00 CDMX
  ]
  const m = sc.computeMemberWeek(valeria, tasks, [], [], WEEK, { now: NOW })
  assert.equal(m.avgDeliveryDays, 2)
})

test('assigned load and under-utilized vs underperforming flags', () => {
  const goals = [{ user_id: 'valeria', work_type: 'anuncio', weekly_target: 12 }]
  const light = [task({ title: 'Editar 6 anuncios — ronda 1', completion_date: '2026-11-04', commitment_date: '2026-11-04' })]
  const m1 = sc.computeMemberWeek(valeria, light, [], goals, WEEK, { now: NOW })
  assert.equal(m1.assignedCount, 1)
  assert.equal(m1.loadFlag, 'subutilizado')
  const heavy = [...light, task({ title: 'Editar 6 anuncios — ronda 2', status: 'en_progreso', commitment_date: '2026-11-06' }), task({ title: 'Editar 6 anuncios — ronda 3', status: 'pendiente', commitment_date: '2026-11-07' })]
  const m2 = sc.computeMemberWeek(valeria, heavy, [], goals, WEEK, { now: NOW })
  assert.equal(m2.assignedCount, 3)
  assert.equal(m2.completedOfAssigned, 1)
  assert.equal(m2.loadFlag, 'bajo_rendimiento')
  assert.equal(sc.computeMemberWeek(valeria, [], [], [], WEEK, { now: NOW }).loadFlag, 'sin_carga')
})

test('attendance and punctuality from asistencia_rango (Mon–Sat, pending/rest days ignored)', () => {
  const day = (date, estado, laborable = true) => ({ user_id: 'valeria', date, estado, laborable })
  const rows = [day('2026-11-02', 'a_tiempo'), day('2026-11-03', 'retardo'), day('2026-11-04', 'sin_registro'), day('2026-11-05', 'a_tiempo'), day('2026-11-06', 'a_tiempo'), day('2026-11-07', 'pendiente'), day('2026-11-08', 'descanso', false)]
  const m = sc.computeMemberWeek(valeria, [], rows, [], WEEK, { now: NOW })
  assert.equal(m.scheduledDays, 5)
  assert.equal(m.attendedDays, 4)
  assert.equal(m.attendancePct, 80)
  assert.equal(m.onTimeCheckIns, 3)
  assert.equal(m.punctualityPct, 75)
})

test('stuck tasks: in progress > 7 days, blocked, or no date; archived excluded everywhere', () => {
  const tasks = [
    task({ status: 'en_progreso', start_date: '2026-10-28', commitment_date: '2026-11-10' }), // 10 días
    task({ status: 'en_progreso', start_date: '2026-11-04', commitment_date: '2026-11-10' }),
    task({ status: 'bloqueada', commitment_date: '2026-11-10' }),
    task({ status: 'pendiente' }),
    task({ status: 'pendiente', archived_at: '2026-11-03T00:00:00Z' }),
    task({ completion_date: '2026-11-03', archived_at: '2026-11-04T00:00:00Z' }),
  ]
  const m = sc.computeMemberWeek(valeria, tasks, [], [], WEEK, { now: NOW })
  assert.deepEqual(plain(m.stuck), { inProgressTooLong: 1, blocked: 1, undated: 1, total: 3 })
  assert.equal(m.completedCount, 0)
})

test('scorecard UI degrades when the goals tables are missing', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/WeeklyScorecard.tsx'), 'utf8')
  assert.match(source, /setSetupReady\(false\)/)
  assert.match(source, /Sin meta/)
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql/2026-11-02_tablero_semanal.sql'), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on function public\.trg_tasks_completion_date\(\) from anon/)
  assert.match(sql, /set search_path = public/)
})

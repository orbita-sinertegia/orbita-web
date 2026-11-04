// Estimados en calendarios y hoja de ruta por cliente (TZ America/Mexico_City, reloj congelado).
process.env.TZ = 'America/Mexico_City'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const cache = new Map()
function loadModule(file, extra = {}) {
  const cacheKey = file + JSON.stringify(Object.keys(extra))
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exported = {}
  cache.set(cacheKey, exported)
  vm.runInNewContext(code, { exports: exported, require(id) {
    if (extra[id]) return extra[id]
    if (id.endsWith('/dates')) return loadModule('src/lib/dates.ts')
    if (id.endsWith('/holidays')) return loadModule('src/lib/holidays.ts')
    if (id.endsWith('/projectTemplates')) return loadModule('src/data/projectTemplates.ts')
    if (id.endsWith('/roadmapEstimate')) return loadModule('src/lib/roadmapEstimate.ts')
    if (id.endsWith('/estimateViews')) return loadModule('src/lib/estimateViews.ts')
    return {}
  } })
  return exported
}

const est = loadModule('src/lib/roadmapEstimate.ts')
const views = loadModule('src/lib/estimateViews.ts')
// El hook solo memoiza: con un useMemo que ejecuta directo se prueba su cableado.
const hook = loadModule('src/hooks/useProjectEstimates.ts', { react: { useMemo: fn => fn() } })

const MONDAY = new Date('2026-11-02T15:00:00Z') // lunes 2 nov 2026, 09:00 CDMX
const dayOf = key => new Date(`${key}T12:00:00`).getDay()
let counter = 0
const task = (phase, department, extra = {}) => ({ id: `t${++counter}`, title: `${phase}-${department}-${counter}`, department, status: 'pendiente', phase, project_id: 'p1', ...extra })
const plain = value => JSON.parse(JSON.stringify(value))

test('only active projects that are not already running campaigns get estimates', () => {
  assert.equal(est.shouldEstimateProject(undefined), true)
  assert.equal(est.shouldEstimateProject({ status: 'activo' }), true)
  assert.equal(est.shouldEstimateProject({ status: 'activo', stage: null }), true)
  assert.equal(est.shouldEstimateProject({ status: 'activo', stage: 'en_proceso' }), true)
  assert.equal(est.shouldEstimateProject({ status: 'activo', stage: 'corriendo' }), false)
  assert.equal(est.shouldEstimateProject({ status: 'pausado' }), false)
  assert.equal(est.shouldEstimateProject({ status: 'completado', stage: 'en_proceso' }), false)
})

test('estimateRoadmap reads stage from projectInfo objects, plain status strings or task.project', () => {
  const a = task('entrada', 'lider', { project_id: 'a', project: { status: 'activo', stage: 'corriendo' } })
  const b = task('entrada', 'lider', { project_id: 'b', project: { status: 'activo' } })
  const c = task('entrada', 'lider', { project_id: 'c' })
  const d = task('entrada', 'lider', { project_id: 'd' })
  const plan = est.estimateRoadmap([a, b, c, d], { b: { stage: 'en_proceso' }, c: 'pausado', d: { status: 'activo', stage: 'corriendo' } }, MONDAY)
  assert.equal(plan.has(a.id), false) // corriendo (desde task.project)
  assert.equal(plan.has(b.id), true) // en proceso
  assert.equal(plan.has(c.id), false) // estado como texto (compatibilidad)
  assert.equal(plan.has(d.id), false) // corriendo (desde projectInfo)
})

test('phase durations are keyed by funnel type and default to the current values', () => {
  assert.deepEqual(plain(est.FUNNEL_TYPES), ['low2funnel', 'vsl_high_ticket', 'high_ticket', 'restaurante', 'webinar', 'otro'])
  // Restaurante tiene sus propias duraciones (ver restaurant-template.test.cjs); el resto usa los valores actuales.
  for (const type of est.FUNNEL_TYPES.filter(type => type !== 'restaurante')) assert.deepEqual(plain(est.ESTIMATE_PHASE_DAYS_BY_FUNNEL[type]), plain(est.ESTIMATE_PHASE_DAYS))
  assert.equal(est.phaseDaysFor(null), est.ESTIMATE_PHASE_DAYS)
  assert.equal(est.phaseDaysFor('desconocido'), est.ESTIMATE_PHASE_DAYS)

  // Ajustar un tipo cambia solo los proyectos de ese tipo.
  const original = est.ESTIMATE_PHASE_DAYS_BY_FUNNEL.restaurante.entrada
  est.ESTIMATE_PHASE_DAYS_BY_FUNNEL.restaurante.entrada = 1
  try {
    const r = task('entrada', 'lider', { project_id: 'r' })
    const v = task('entrada', 'lider', { project_id: 'v' })
    const plan = est.estimateRoadmap([r, v], { r: { status: 'activo', funnel_type: 'restaurante' }, v: { status: 'activo', funnel_type: 'vsl_high_ticket' } }, MONDAY)
    assert.deepEqual(plain(plan.get(r.id)), { start: '2026-11-02', end: '2026-11-02' })
    assert.deepEqual(plain(plan.get(v.id)), { start: '2026-11-02', end: '2026-11-04' })
  } finally {
    est.ESTIMATE_PHASE_DAYS_BY_FUNNEL.restaurante.entrada = original
  }
})

test('useProjectEstimates merges context tasks, skips archived/duplicates and honours the toggle', () => {
  const mine = task('estrategia', 'copy')
  const teammate = task('entrada', 'lider')
  const archived = task('entrada', 'lider', { archived_at: '2026-10-30T00:00:00Z' })
  const withContext = hook.useProjectEstimates({ tasks: [mine], contextTasks: [teammate, mine, archived], projects: [{ id: 'p1', status: 'activo' }] })
  assert.equal(withContext.has(archived.id), false)
  assert.ok(withContext.get(mine.id).start > withContext.get(teammate.id).end) // estrategia va después de entrada
  assert.equal(hook.useProjectEstimates({ tasks: [mine], enabled: false }).size, 0)
  assert.equal(hook.useProjectEstimates({ tasks: [mine], projects: [{ id: 'p1', status: 'activo', stage: 'corriendo' }] }).size, 0)
  // computeProjectEstimates (lo que usa el hook) acepta un "now" fijo.
  const fixed = views.computeProjectEstimates([teammate], [], [{ id: 'p1', status: 'activo' }], MONDAY)
  assert.deepEqual(plain(fixed.get(teammate.id)), { start: '2026-11-02', end: '2026-11-04' })
})

test('calendar placement: real date wins, estimated tasks sit on their approximate delivery day', () => {
  const dated = task('entrada', 'lider', { commitment_date: '2026-11-10' })
  const undated = task('estrategia', 'copy')
  const done = task('entrada', 'lider', { status: 'completada' })
  const estimates = views.computeProjectEstimates([dated, undated, done], [], [{ id: 'p1', status: 'activo' }], MONDAY)
  assert.deepEqual(plain(views.calendarDayOf(dated, estimates)), { key: '2026-11-10', estimated: false })
  const placed = views.calendarDayOf(undated, estimates)
  assert.equal(placed.estimated, true)
  assert.equal(placed.key, estimates.get(undated.id).end)
  assert.notEqual(dayOf(placed.key), 0) // nunca en domingo
  assert.equal(views.calendarDayOf(done, estimates), null)
  // Al fijar una fecha real (soltar en un día) deja de ser estimada: se vuelve sólida en ese día.
  assert.deepEqual(plain(views.calendarDayOf({ ...undated, commitment_date: '2026-11-20' }, estimates)), { key: '2026-11-20', estimated: false })
  // Sin estimados (interruptor apagado) no aparece en el calendario.
  assert.equal(views.calendarDayOf(undated, new Map()), null)
})

test('client calendar weeks include estimated ranges that overlap the week', () => {
  const undated = task('guiones', 'lider')
  const estimates = views.computeProjectEstimates([undated], [], [{ id: 'p1', status: 'activo' }], MONDAY)
  const range = views.taskRange(undated, estimates)
  assert.equal(range.estimated, true)
  assert.equal(views.rangeOverlaps(range, '2026-11-02', '2026-11-08'), true)
  assert.equal(views.rangeOverlaps(range, '2026-12-28', '2027-01-03'), false)
  const real = views.taskRange(task('guiones', 'lider', { start_date: '2026-11-03', commitment_date: '2026-11-05' }), estimates)
  assert.deepEqual(plain(real), { start: '2026-11-03', end: '2026-11-05', estimated: false })
  assert.equal(views.taskRange(task('guiones', 'lider', { status: 'completada' }), estimates), null)
})

test('phase ranges are faded while any pending task is estimated and solid once all have real dates', () => {
  const entradaDone = task('entrada', 'lider', { status: 'completada', completion_date: '2026-10-28' })
  const estrategiaReal = task('estrategia', 'copy', { commitment_date: '2026-11-06' })
  const video = task('produccion_video', 'edicion')
  const pages = task('produccion_paginas', 'webmaster', { commitment_date: '2026-11-30' })
  const launch = task('lanzamiento', 'trafficker')
  const tasks = [entradaDone, estrategiaReal, video, pages, launch]
  const estimates = views.computeProjectEstimates(tasks, [], [{ id: 'p1', status: 'activo' }], MONDAY)
  const ranges = views.phaseDateRanges(tasks, estimates)
  assert.deepEqual(plain(ranges.entrada), { start: '2026-10-28', end: '2026-10-28', estimated: false })
  assert.deepEqual(plain(ranges.estrategia), { start: '2026-11-06', end: '2026-11-06', estimated: false })
  assert.equal(ranges.produccion.estimated, true) // video estimado + páginas real → difuminado
  assert.ok(ranges.produccion.end >= '2026-11-30')
  assert.equal(ranges.guiones, undefined)
  assert.equal(ranges.lanzamiento.estimated, true)
  assert.ok(ranges.lanzamiento.start > ranges.produccion.end)

  assert.equal(views.estimatedLaunchDate({ launch_date: null }, ranges), ranges.lanzamiento.end)
  assert.equal(views.estimatedLaunchDate({ launch_date: '2026-12-15' }, ranges), null)
  // Todo con fecha real: no se adivina el lanzamiento.
  const solid = views.phaseDateRanges([estrategiaReal, pages], estimates)
  assert.equal(solid.produccion.estimated, false)
  assert.equal(views.estimatedLaunchDate({}, solid), null)
  // Sin tareas de lanzamiento, se usa el fin de la última fase previa estimada.
  const noLaunch = views.phaseDateRanges([video], estimates)
  assert.equal(views.estimatedLaunchDate({}, noLaunch), noLaunch.produccion.end)
})

test('running or paused projects show no estimates anywhere (calendar or phase boxes)', () => {
  const undated = task('entrada', 'lider')
  for (const project of [{ id: 'p1', status: 'activo', stage: 'corriendo' }, { id: 'p1', status: 'pausado' }]) {
    const estimates = views.computeProjectEstimates([undated], [], [project], MONDAY)
    assert.equal(views.calendarDayOf(undated, estimates), null)
    assert.equal(views.phaseDateRanges([undated], estimates).entrada, undefined)
  }
})

test('all calendars and the client roadmap use the shared estimates hook with a "Mostrar estimados" toggle', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  for (const file of ['src/components/admin/TeamCalendar.tsx', 'src/components/team/TeamCalendarView.tsx', 'src/components/client/ClientCalendar.tsx', 'src/components/roadmap/ClientRoadmapView.tsx', 'src/components/roadmap/RoadmapView.tsx']) {
    const source = read(file)
    assert.match(source, /useProjectEstimates\(/, file)
    assert.match(source, /≈/, file)
  }
  for (const file of ['src/components/admin/TeamCalendar.tsx', 'src/components/team/TeamCalendarView.tsx', 'src/components/client/ClientCalendar.tsx', 'src/components/roadmap/ClientRoadmapView.tsx']) {
    assert.match(read(file), /EstimatesToggle/, file)
  }
  // Admin y equipo: estimadas difuminadas/punteadas; al soltarlas se guarda una fecha real.
  for (const file of ['src/components/admin/TeamCalendar.tsx', 'src/components/team/TeamCalendarView.tsx']) {
    const source = read(file)
    assert.match(source, /calendarDayOf/, file)
    assert.match(source, /border-dashed opacity-45/, file)
    assert.match(source, /update\(\{ commitment_date: /, file)
  }
  // El cliente nunca ve nombres del equipo.
  const client = read('src/components/client/ClientCalendar.tsx')
  assert.doesNotMatch(client, /assignee|full_name/)
})

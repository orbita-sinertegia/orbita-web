// Estimados de la hoja de ruta (TZ America/Mexico_City, reloj congelado).
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
    if (id.endsWith('/holidays')) return loadModule('src/lib/holidays.ts')
    if (id.endsWith('/projectTemplates')) return loadModule('src/data/projectTemplates.ts')
    return {}
  } })
  return exported
}

const est = loadModule('src/lib/roadmapEstimate.ts')
const templates = loadModule('src/data/projectTemplates.ts')

const SUNDAY_NIGHT = new Date('2026-11-02T05:06:00Z') // domingo 1 nov 2026, 23:06 CDMX
const MONDAY = new Date('2026-11-02T15:00:00Z') // lunes 2 nov, 09:00 CDMX
const dayOf = key => new Date(`${key}T12:00:00`).getDay()

let counter = 0
const task = (phase, department, extra = {}) => ({ id: `t${++counter}`, title: `${phase}-${department}-${counter}`, department, status: 'pendiente', phase, ...extra })

test('working days skip Sundays (and official holidays)', () => {
  const sat = new Date(2026, 9, 31)
  assert.equal(est.isWorkingDay(sat), true)
  assert.equal(est.isWorkingDay(new Date(2026, 10, 1)), false)
  assert.equal(est.nextWorkingDay(new Date(2026, 10, 1)).getDate(), 2)
  // viernes 30 oct + 2 días hábiles = lunes 2 nov (sábado cuenta)
  assert.equal(est.addWorkingDays(new Date(2026, 9, 30), 2).getDate(), 2)
})

test('a not-started project is estimated from the next working day, phase after phase', () => {
  const tasks = [task('entrada', 'lider'), task('estrategia', 'copy'), task('guiones', 'lider'), task('revision', 'lider')]
  const plan = est.estimateProjectSchedule(tasks, { now: SUNDAY_NIGHT })
  const [entrada, estrategia, guiones, revision] = tasks.map(t => plan.get(t.id))
  assert.deepEqual({ ...entrada }, { start: '2026-11-02', end: '2026-11-04' }) // 3 días hábiles desde el lunes
  assert.deepEqual({ ...estrategia }, { start: '2026-11-05', end: '2026-11-09' }) // 4 días hábiles: jue 5, vie 6, sáb 7, (dom no) lun 9
  assert.equal(guiones.start, '2026-11-10')
  assert.ok(revision.start > guiones.end)
  for (const span of plan.values()) {
    assert.notEqual(dayOf(span.start), 0)
    assert.notEqual(dayOf(span.end), 0)
    assert.ok(span.start <= span.end)
  }
})

test('video and pages production run in parallel and revision waits for both', () => {
  const g = task('guiones', 'lider')
  const video = task('produccion_video', 'edicion')
  const pages = task('produccion_paginas', 'webmaster')
  const rev = task('revision', 'lider')
  const plan = est.estimateProjectSchedule([g, video, pages, rev], { now: MONDAY })
  assert.equal(plan.get(video.id).start, plan.get(pages.id).start)
  assert.ok(plan.get(rev.id).start > plan.get(video.id).end)
  assert.ok(plan.get(rev.id).start > plan.get(pages.id).end)
})

test('tasks of one department share the phase in sequence; other departments go in parallel', () => {
  const a = task('estrategia', 'copy'), b = task('estrategia', 'copy'), c = task('estrategia', 'diseno')
  const plan = est.estimateProjectSchedule([a, b, c], { now: MONDAY })
  assert.equal(plan.get(a.id).start, '2026-11-02')
  assert.ok(plan.get(b.id).start > plan.get(a.id).end)
  assert.equal(plan.get(c.id).start, '2026-11-02')
})

test('a real commitment_date is not estimated and pushes later phases after it', () => {
  const e1 = task('entrada', 'lider', { commitment_date: '2026-11-20' }) // fecha real después del estimado
  const s1 = task('estrategia', 'copy')
  const plan = est.estimateProjectSchedule([e1, s1], { now: MONDAY })
  assert.equal(plan.has(e1.id), false)
  assert.equal(plan.get(s1.id).start, '2026-11-21') // sábado siguiente al 20
  // Sin fecha real, estrategia empezaría el lunes 2
  const alone = est.estimateProjectSchedule([task('estrategia', 'copy')], { now: MONDAY })
  assert.equal([...alone.values()][0].start, '2026-11-02')
})

test('completed and archived tasks are not estimated and finished phases take no time', () => {
  const done = task('entrada', 'lider', { status: 'completada', completion_date: '2026-10-20' })
  const archived = task('estrategia', 'copy', { archived_at: '2026-10-25T00:00:00Z' })
  const next = task('guiones', 'lider')
  const plan = est.estimateProjectSchedule([done, archived, next], { now: MONDAY })
  assert.equal(plan.has(done.id), false)
  assert.equal(plan.has(archived.id), false)
  assert.equal(plan.get(next.id).start, '2026-11-02')
})

test('an overdue real date does not pull estimates into the past', () => {
  const late = task('entrada', 'lider', { commitment_date: '2026-10-15' })
  const next = task('estrategia', 'copy')
  const plan = est.estimateProjectSchedule([late, next], { now: MONDAY })
  assert.equal(plan.get(next.id).start, '2026-11-02')
})

test('depends_on_task_id pushes a task after its dependency', () => {
  const dep = task('estrategia', 'copy', { commitment_date: '2026-11-03' })
  const child = task('estrategia', 'diseno', { depends_on_task_id: dep.id })
  const plan = est.estimateProjectSchedule([dep, child], { now: MONDAY })
  assert.equal(plan.get(child.id).start, '2026-11-04')
})

test('a future project start is respected', () => {
  const t = task('entrada', 'lider')
  const plan = est.estimateProjectSchedule([t], { now: MONDAY, projectStart: '2026-11-15' }) // domingo → lunes 16 es feriado → martes 17
  assert.equal(plan.get(t.id).start, '2026-11-17')
})

test('the full VSL template gets an estimate for every task, all on working days, ending ~6-7 weeks out', () => {
  const vsl = templates.PROJECT_TEMPLATES.find(t => t.id === 'vsl')
  const tasks = [...vsl.tasks, ...templates.tasksForModalidad('oficina')].map((t, index) => ({ id: `v${index}`, title: t.title, department: t.department, phase: t.phase, status: 'pendiente' }))
  const plan = est.estimateProjectSchedule(tasks, { now: SUNDAY_NIGHT })
  assert.equal(plan.size, tasks.length)
  const ends = [...plan.values()].map(span => span.end).sort()
  assert.equal([...plan.values()].map(span => span.start).sort()[0], '2026-11-02')
  assert.ok(ends.at(-1) > '2026-12-01' && ends.at(-1) < '2026-12-31', ends.at(-1))
  assert.ok([...plan.values()].every(span => dayOf(span.start) !== 0 && dayOf(span.end) !== 0))
})

test('estimateRoadmap groups by project and skips paused/completed projects', () => {
  const a = { ...task('entrada', 'lider'), project_id: 'p1', project: { status: 'activo' } }
  const b = { ...task('entrada', 'lider'), project_id: 'p2', project: { status: 'pausado' } }
  const c = { ...task('entrada', 'lider'), project_id: 'p3' }
  const plan = est.estimateRoadmap([a, b, c], { p3: 'completado' }, MONDAY)
  assert.equal(plan.has(a.id), true)
  assert.equal(plan.has(b.id), false)
  assert.equal(plan.has(c.id), false)
})

test('RoadmapView draws estimates faded with a legend and never shows assignee names', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/roadmap/RoadmapView.tsx'), 'utf8')
  assert.match(source, /useProjectEstimates\(/) // estimados compartidos (hook que usa estimateRoadmap)
  assert.match(source, /border-dashed opacity-40/)
  assert.match(source, /Fecha comprometida/)
  assert.match(source, /Estimado/)
  assert.doesNotMatch(source, /assignee/)
  assert.doesNotMatch(source, /full_name/)
})

test('official holidays are not working days: Nov 16 2026 (Revolución) is skipped', () => {
  assert.equal(est.isWorkingDay(new Date(2026, 10, 16)), false)
  assert.equal(est.isWorkingDay(new Date(2026, 10, 17)), true)
  assert.equal(est.isWorkingDay(new Date(2026, 11, 25)), false)
  const friday = new Date(2026, 10, 13)
  // vie 13 + 1 = sáb 14; + 2 = (dom 15 y lun 16 feriado) mar 17
  assert.equal(est.addWorkingDays(friday, 2).getDate(), 17)
})

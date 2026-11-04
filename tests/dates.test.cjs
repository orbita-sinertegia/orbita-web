// Fechas de solo día y "Hoy" en America/Mexico_City (UTC-6), con reloj congelado.
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
    return {}
  } })
  return exported
}

const dates = loadModule('src/lib/dates.ts')
const delays = loadModule('src/lib/taskDelays.ts')

const MORNING = new Date('2026-10-29T15:33:00Z') // jueves 29 oct, 09:33 CDMX
const EVENING = new Date('2026-10-29T23:30:00Z') // jueves 29 oct, 17:30 CDMX
const NIGHT = new Date('2026-10-30T02:00:00Z') // jueves 29 oct, 20:00 CDMX (en UTC ya es el 30)
const SUNDAY = new Date('2026-11-01T18:00:00Z') // domingo 1 nov, 12:00 CDMX

test('the test process really runs in America/Mexico_City', () => {
  assert.equal(MORNING.getHours(), 9)
  assert.equal(EVENING.getDate(), 29)
})

test('parseDateOnly reads YYYY-MM-DD as LOCAL midnight (no day-before shift)', () => {
  const date = dates.parseDateOnly('2026-10-30')
  assert.equal(date.getFullYear(), 2026)
  assert.equal(date.getMonth(), 9)
  assert.equal(date.getDate(), 30)
  assert.equal(date.getHours(), 0)
  // La forma ingenua daba el 29 en CDMX
  assert.equal(new Date('2026-10-30').getDate(), 29)
  assert.equal(dates.parseDateOnly('2026-10-30T00:00:00+00:00').getDate(), 30)
  assert.equal(dates.parseDateOnly(null), null)
  assert.equal(dates.parseDateOnly(''), null)
  assert.equal(dates.parseDateOnly('basura'), null)
})

test('formatDateOnly shows the stored day in es-MX', () => {
  assert.equal(dates.formatDateOnly('2026-10-30'), '30/10/2026')
  assert.equal(dates.formatDateOnly(undefined), '—')
})

test('cdmxTodayKey is the CDMX day at 09:33, 17:30 and 20:00 (when UTC already says the 30th)', () => {
  assert.equal(dates.cdmxTodayKey(MORNING), '2026-10-29')
  assert.equal(dates.cdmxTodayKey(EVENING), '2026-10-29')
  assert.equal(dates.cdmxTodayKey(NIGHT), '2026-10-29')
  assert.equal(NIGHT.toISOString().slice(0, 10), '2026-10-30')
  assert.equal(dates.cdmxTodayKey(SUNDAY), '2026-11-01')
})

test('isDateKeyOverdue: due today is NOT overdue, yesterday is, tomorrow is not', () => {
  for (const now of [MORNING, EVENING, NIGHT]) {
    assert.equal(dates.isDateKeyOverdue('2026-10-29', now), false)
    assert.equal(dates.isDateKeyOverdue('2026-10-28', now), true)
    assert.equal(dates.isDateKeyOverdue('2026-10-30', now), false)
  }
  assert.equal(dates.isDateKeyOverdue(null, MORNING), false)
  assert.equal(dates.isDateKeyOverdue('', MORNING), false)
})

test('taskDelays.isOverdue uses the CDMX day and ignores completed tasks', () => {
  assert.equal(delays.isOverdue({ commitment_date: '2026-10-29', status: 'pendiente' }, MORNING), false)
  assert.equal(delays.isOverdue({ commitment_date: '2026-10-29', status: 'pendiente' }, EVENING), false)
  assert.equal(delays.isOverdue({ commitment_date: '2026-10-28', status: 'en_progreso' }, MORNING), true)
  assert.equal(delays.isOverdue({ commitment_date: '2026-10-28', status: 'completada' }, MORNING), false)
})

test('delayDaysFor counts whole calendar days', () => {
  assert.equal(delays.delayDaysFor({ commitment_date: '2026-10-29' }, MORNING), 0)
  assert.equal(delays.delayDaysFor({ commitment_date: '2026-10-27' }, EVENING), 2)
  assert.equal(delays.delayDaysFor({ commitment_date: '2026-10-27', completion_date: '2026-10-30' }, MORNING), 3)
  assert.equal(delays.delayDaysFor({ commitment_date: '2026-10-30' }, MORNING), 0)
})

test('daysBetweenKeys', () => {
  assert.equal(dates.daysBetweenKeys('2026-10-29', '2026-11-02'), 4)
  assert.equal(dates.daysBetweenKeys('2026-11-02', '2026-10-29'), -4)
})

test('mondayOf: Thursday 29 Oct and Sunday 1 Nov both belong to the week of Monday 26 Oct', () => {
  assert.equal(dates.localDateKey(dates.mondayOf(MORNING)), '2026-10-26')
  assert.equal(dates.localDateKey(dates.mondayOf(EVENING)), '2026-10-26')
  assert.equal(dates.localDateKey(dates.mondayOf(SUNDAY)), '2026-10-26')
})

// Réplica de RoadmapView: timelineStart = lunes de la semana - 7 días
function roadmapStart(now) { return dates.addLocalDays(dates.mondayOf(now), -7) }
function dayAt(start, index) { return dates.localDateKey(dates.addLocalDays(start, index)) }

test('roadmap "Hoy" column is the 29th on Thursday morning and evening, and the 1st on Sunday', () => {
  for (const [now, expected] of [[MORNING, '2026-10-29'], [EVENING, '2026-10-29'], [NIGHT, '2026-10-29'], [SUNDAY, '2026-11-01']]) {
    const start = roadmapStart(now)
    assert.equal(dayAt(start, dates.todayIndexFrom(start, now)), expected)
  }
})

test('the old roadmap formula was one day ahead (regression guard)', () => {
  const DAY = 86400000
  for (const [now, wrong] of [[MORNING, '2026-10-30'], [SUNDAY, '2026-11-02']]) {
    const start = roadmapStart(now)
    const old = Math.round((dates.mondayOf(now).getTime() + (now.getDay() || 7) * DAY - start.getTime()) / DAY)
    assert.equal(dayAt(start, old), wrong)
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/roadmap/RoadmapView.tsx'), 'utf8')
  assert.match(source, /todayIndexFrom\(timelineStart\)/)
  assert.doesNotMatch(source, /getDay\(\) \|\| 7/)
})

test('monthWeeks covers October 2026 Monday-to-Sunday', () => {
  const weeks = dates.monthWeeks(new Date(2026, 9, 15))
  assert.equal(weeks.length, 5)
  assert.equal(dates.localDateKey(weeks[0][0]), '2026-09-28')
  assert.equal(dates.localDateKey(weeks[4][6]), '2026-11-01')
  assert.ok(weeks.every(week => week.length === 7 && week[0].getDay() === 1))
  // Marzo 2026 empieza en domingo: 6 semanas
  assert.equal(dates.monthWeeks(new Date(2026, 2, 1)).length, 6)
})

test('no component parses a date-only column with new Date(x.commitment_date)', () => {
  const root = path.join(__dirname, '..', 'src')
  const offenders = []
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (!/\.tsx?$/.test(entry.name)) return
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
      if (/new Date\(\w+\.commitment_date\)\s*(<|\.toLocale)/.test(line)) offenders.push(`${path.relative(root, full)}:${index + 1}`)
      if (/toISOString\(\)\.slice\(0, 10\)/.test(line) && /today/i.test(line)) offenders.push(`${path.relative(root, full)}:${index + 1}`)
    })
  })
  walk(root)
  assert.deepEqual(offenders, [])
})

test('team calendar shows Monday-Saturday and has a real month view; admin calendar has an unassigned row and blocks cross-row drops', () => {
  const team = fs.readFileSync(path.join(__dirname, '..', 'src/components/team/TeamCalendarView.tsx'), 'utf8')
  assert.match(team, /Array\.from\(\{ length: 6 \}/)
  assert.match(team, /monthWeeks\(monthAnchor\)/)
  assert.match(team, /if \(!taskId\) return/)
  assert.match(team, /No se pudo guardar la fecha/)
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/TeamCalendar.tsx'), 'utf8')
  assert.match(admin, /Sin asignar/)
  assert.match(admin, /rowOf\(task\) !== rowId/)
  assert.match(admin, /No se pudo guardar la fecha/)
})

// Tipo de embudo sugerido por plantilla y duraciones de los proyectos tipo "restaurante".
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
    if (id.endsWith('/projectTemplates')) return templates
    return {}
  } })
  return exported
}

const templates = loadModule('src/data/projectTemplates.ts')
const est = loadModule('src/lib/roadmapEstimate.ts')
const MONDAY = new Date('2026-11-02T15:00:00Z')

test('the only built-in template is the blank project', () => {
  const ids = JSON.parse(JSON.stringify(templates.PROJECT_TEMPLATES.map(t => t.id)))
  assert.deepEqual(ids, ['otro'])
  assert.deepEqual(JSON.parse(JSON.stringify(templates.BUILT_IN_TEMPLATE_IDS)), ids)
  assert.equal(templates.PROJECT_TEMPLATES[0].tasks.length, 0)
})

test('choosing a template suggests the funnel type', () => {
  assert.equal(templates.funnelTypeForTemplate('otro'), 'otro')
  assert.equal(templates.funnelTypeForTemplate('abc', 'Low 2 funnel'), 'low2funnel')
  assert.equal(templates.funnelTypeForTemplate('abc', 'LOWTICKET 11:10'), 'low2funnel')
  assert.equal(templates.funnelTypeForTemplate('abc', 'High Ticket'), 'high_ticket')
  assert.equal(templates.funnelTypeForTemplate('abc', 'VSL High Ticket'), 'vsl_high_ticket')
  assert.equal(templates.funnelTypeForTemplate('abc', 'Mi Restaurante'), 'restaurante')
  assert.equal(templates.funnelTypeForTemplate('abc', 'Webinar mensual'), 'webinar')
  assert.equal(templates.funnelTypeForTemplate('abc', 'Mi embudo'), '')
})

test('restaurant projects use shorter phase durations and no pages', () => {
  const days = est.ESTIMATE_PHASE_DAYS_BY_FUNNEL.restaurante
  assert.deepEqual(JSON.parse(JSON.stringify(days)), { entrada: 2, estrategia: 2, guiones: 3, produccion_video: 5, produccion_paginas: 0, revision: 2, lanzamiento: 1, optimizacion: 5 })
  const phases = ['entrada', 'estrategia', 'guiones', 'produccion_video', 'revision', 'lanzamiento', 'optimizacion']
  const build = prefix => phases.map(phase => ({ id: `${prefix}-${phase}`, title: phase, department: 'lider', phase, status: 'pendiente', project_id: prefix }))
  const plan = est.estimateRoadmap([...build('r'), ...build('v')], { r: { status: 'activo', funnel_type: 'restaurante' }, v: { status: 'activo', funnel_type: 'vsl_high_ticket' } }, MONDAY)
  const end = prefix => [...plan.entries()].filter(([id]) => id.startsWith(prefix)).map(([, s]) => s.end).sort().pop()
  const launch = prefix => plan.get(`${prefix}-lanzamiento`).end
  assert.ok(launch('r') < launch('v'), `${launch('r')} < ${launch('v')}`)
  assert.ok(end('r') < end('v'))
  // 2+2+3+5+2+1 = 15 días hábiles hasta lanzar, desde el lunes 2 nov (lunes a sábado, sin el
  // feriado del lunes 16 nov) → jueves 19 nov.
  assert.equal(launch('r'), '2026-11-19')
})

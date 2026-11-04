// Plantilla "Restaurante" (solo anuncios en Meta, Google Ads y TikTok) y tipo de embudo por plantilla.
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
const restaurante = templates.PROJECT_TEMPLATES.find(t => t.id === 'restaurante')
const MONDAY = new Date('2026-11-02T15:00:00Z')

test('restaurant template exists between the funnels and before "Sin plantilla"', () => {
  assert.ok(restaurante)
  assert.equal(restaurante.name, 'Restaurante')
  const ids = JSON.parse(JSON.stringify(templates.PROJECT_TEMPLATES.map(t => t.id)))
  assert.deepEqual(ids, ['vsl', 'webinar', 'restaurante', 'otro'])
  assert.deepEqual(JSON.parse(JSON.stringify(templates.BUILT_IN_TEMPLATE_IDS)), ids)
})

test('restaurant has no web pages and no VSL, only paid ads on Meta, Google and TikTok', () => {
  const tasks = restaurante.tasks
  assert.equal(tasks.filter(t => t.department === 'webmaster').length, 0)
  assert.equal(tasks.filter(t => t.phase === 'produccion_paginas').length, 0)
  assert.equal(tasks.filter(t => /\bvsl\b|landing|página de gracias|ghl|funnel/i.test(t.title)).length, 0)
  for (const platform of ['Meta Ads', 'Google Ads', 'TikTok Ads']) {
    assert.ok(tasks.some(t => t.department === 'trafficker' && t.phase === 'lanzamiento' && t.title.includes(platform)), `campañas ${platform}`)
    assert.ok(tasks.some(t => t.department === 'cliente' && t.phase === 'entrada' && t.title.includes(platform.replace(' Ads', ''))), `accesos ${platform}`)
  }
  const deps = new Set(tasks.map(t => t.department))
  for (const dep of ['cliente', 'lider', 'copy', 'diseno', 'edicion', 'trafficker', 'grabacion']) assert.ok(deps.has(dep), dep)
  const phases = new Set(tasks.map(t => t.phase))
  for (const phase of ['entrada', 'estrategia', 'guiones', 'produccion_video', 'revision', 'lanzamiento', 'optimizacion']) assert.ok(phases.has(phase), phase)
  for (const t of tasks) {
    assert.ok(templates.PHASES.includes(t.phase))
    assert.ok(['alta', 'media', 'baja', 'critica'].includes(t.priority))
  }
  const titles = tasks.map(t => `${t.department}:${t.title.toLowerCase()}`)
  assert.equal(new Set(titles).size, titles.length, 'sin duplicados')
  // Sin modalidad: la plantilla trae sus propias tareas de grabación.
  assert.equal(tasks.filter(t => t.modalidad).length, 0)
  // resolveTemplateTasks devuelve la plantilla completa cuando no hay filas en la base.
  assert.equal(templates.resolveTemplateTasks(restaurante, [], false).length, tasks.length)
})

test('existing phases are inferred for restaurant titles without changing VSL/Webinar ones', () => {
  for (const t of restaurante.tasks) assert.equal(templates.inferPhase(t.title, t.department), t.phase, t.title)
  assert.equal(templates.inferPhase('Encarpetar', 'grabacion'), 'produccion_video')
  assert.equal(templates.inferPhase('Montar campañas en Meta Ads', 'trafficker'), 'lanzamiento')
})

test('choosing a template suggests the funnel type', () => {
  assert.equal(templates.funnelTypeForTemplate('vsl'), 'vsl_high_ticket')
  assert.equal(templates.funnelTypeForTemplate('webinar'), 'webinar')
  assert.equal(templates.funnelTypeForTemplate('restaurante'), 'restaurante')
  assert.equal(templates.funnelTypeForTemplate('otro'), 'otro')
  assert.equal(templates.funnelTypeForTemplate('abc', 'Low 2 funnel'), 'low2funnel')
  assert.equal(templates.funnelTypeForTemplate('abc', 'LOWTICKET 11:10'), 'low2funnel')
  assert.equal(templates.funnelTypeForTemplate('abc', 'High Ticket'), 'high_ticket')
  assert.equal(templates.funnelTypeForTemplate('abc', 'VSL High Ticket'), 'vsl_high_ticket')
  assert.equal(templates.funnelTypeForTemplate('abc', 'Mi embudo'), '')
})

test('restaurant projects use shorter phase durations and no pages', () => {
  const days = est.ESTIMATE_PHASE_DAYS_BY_FUNNEL.restaurante
  assert.deepEqual(JSON.parse(JSON.stringify(days)), { entrada: 2, estrategia: 2, guiones: 3, produccion_video: 5, produccion_paginas: 0, revision: 2, lanzamiento: 1, optimizacion: 5 })
  const tasks = restaurante.tasks.map((t, i) => ({ ...t, id: `r${i}`, status: 'pendiente', project_id: 'r' }))
  const vsl = restaurante.tasks.map((t, i) => ({ ...t, id: `v${i}`, status: 'pendiente', project_id: 'v' }))
  const plan = est.estimateRoadmap([...tasks, ...vsl], { r: { status: 'activo', funnel_type: 'restaurante' }, v: { status: 'activo', funnel_type: 'vsl_high_ticket' } }, MONDAY)
  const end = prefix => [...plan.entries()].filter(([id]) => id.startsWith(prefix)).map(([, s]) => s.end).sort().pop()
  const launch = prefix => [...plan.entries()].filter(([id]) => id.startsWith(prefix) && restaurante.tasks[Number(id.slice(1))].phase === 'lanzamiento').map(([, s]) => s.end).sort().pop()
  assert.ok(launch('r') < launch('v'), `${launch('r')} < ${launch('v')}`)
  assert.ok(end('r') < end('v'))
  // 2+2+3+5+2+1 = 15 días hábiles hasta lanzar, desde el lunes 2 nov (lunes a sábado, sin el
  // feriado del lunes 16 nov) → jueves 19 nov.
  assert.equal(launch('r'), '2026-11-19')
})

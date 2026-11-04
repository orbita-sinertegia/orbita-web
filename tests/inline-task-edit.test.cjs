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
const m = loadModule('src/lib/inlineTaskEdit.ts')
const task = { id: 't', title: 'T', status: 'pendiente', priority: 'alta', department: 'copy', assigned_to: 'a', needed_date: '2026-11-10' }

test('canInlineEditTask: admins y super admin; realizadas solo super admin; archivadas nadie', () => {
  const admin = { role: 'admin' }, sa = { role: 'admin', is_super_admin: true, active: true }, team = { role: 'team' }
  assert.equal(m.canInlineEditTask(team, task), false)
  assert.equal(m.canInlineEditTask(null, task), false)
  assert.equal(m.canInlineEditTask(admin, task), true)
  assert.equal(m.canInlineEditTask({ role: 'admin', active: false }, task), false)
  assert.equal(m.canInlineEditTask(admin, { ...task, status: 'completada' }), false)
  assert.equal(m.canInlineEditTask(sa, { ...task, status: 'completada' }), true)
  assert.equal(m.canInlineEditTask({ ...sa, active: false }, { ...task, status: 'completada' }), false)
  assert.equal(m.canInlineEditTask(sa, { ...task, archived_at: '2026-11-01' }), false)
})

test('buildInlineChange: solo lo que cambió, valores válidos; fecha vacía = null', () => {
  assert.equal(m.buildInlineChange(task, 'priority', 'alta'), null)
  deq(m.buildInlineChange(task, 'priority', 'baja'), { priority: 'baja' })
  assert.equal(m.buildInlineChange(task, 'priority', 'urgente'), null)
  deq(m.buildInlineChange(task, 'department', 'diseno'), { department: 'diseno' })
  assert.equal(m.buildInlineChange(task, 'department', 'cliente'), null, 'cliente solo con el lápiz')
  deq(m.buildInlineChange(task, 'assigned_to', 'b'), { assigned_to: 'b' })
  assert.equal(m.buildInlineChange(task, 'assigned_to', ''), null)
  assert.equal(m.buildInlineChange({ ...task, department: 'cliente' }, 'assigned_to', 'b'), null)
  assert.equal(m.buildInlineChange(task, 'needed_date', '2026-11-10'), null)
  deq(m.buildInlineChange(task, 'needed_date', '2026-12-01'), { needed_date: '2026-12-01' })
  deq(m.buildInlineChange(task, 'needed_date', ''), { needed_date: null })
  assert.equal(m.buildInlineChange({ ...task, needed_date: undefined }, 'needed_date', ''), null)
})

test('Overrides optimistas: aplicar, revertir sin pisar un cambio más nuevo', () => {
  const members = [{ id: 'b', full_name: 'Bea' }]
  const patch = m.optimisticPatch({ assigned_to: 'b' }, members)
  deq(patch, { assigned_to: 'b', assignee: { id: 'b', full_name: 'Bea' } })
  let o = m.addOverride({}, 't', patch)
  deq(m.applyOverrides([task], o)[0].assignee, { id: 'b', full_name: 'Bea' })
  o = m.addOverride(o, 't', { priority: 'baja' })
  const newer = m.addOverride(o, 't', { priority: 'media' })
  deq(m.removeOverride(newer, 't', { priority: 'baja' })['t'].priority, 'media', 'no pisa el cambio más nuevo')
  deq(m.removeOverride(m.removeOverride(o, 't', patch), 't', { priority: 'baja' }), {})
  deq(m.optimisticPatch({ needed_date: null }, []), {})
})

test('activeAssignableMembers: sin inactivos ni repetidos, por nombre', () => {
  const list = m.activeAssignableMembers([{ id: '2', full_name: 'Zoe' }, { id: '1', full_name: 'Ana', active: true }, { id: '3', full_name: 'Ex', active: false }, { id: '1', full_name: 'Ana', active: true }])
  deq(list.map(u => u.id), ['1', '2'])
})

test('isCommittableDate: solo fechas completas con año razonable', () => {
  assert.equal(m.isCommittableDate('2026-11-20'), true)
  assert.equal(m.isCommittableDate(''), true)
  assert.equal(m.isCommittableDate('0202-11-20'), false)
  assert.equal(m.isCommittableDate('2026-11'), false)
})

test('inlineErrorNotice en español, sin doble punto', () => {
  assert.equal(m.inlineErrorNotice('assigned_to', 'Sin permiso.'), 'No se pudo cambiar la persona asignada: Sin permiso. Se regresó al valor anterior.')
})

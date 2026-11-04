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
  vm.runInNewContext(code, { exports: exported, require(id) { return id.endsWith('/projectStatus') ? loadModule('src/lib/projectStatus.ts') : {} } })
  return exported
}
const deq = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected)
const q = loadModule('src/lib/quickComplete.ts')
const sel = loadModule('src/lib/taskSelection.ts')
const sa = { is_super_admin: true, active: true }

test('canQuickComplete: solo super admin activo, no realizadas ni archivadas, y se apaga con la bandera', () => {
  const open = { status: 'pendiente' }
  assert.equal(q.ENABLE_QUICK_COMPLETE, true)
  assert.equal(q.canQuickComplete(sa, open), true)
  assert.equal(q.canQuickComplete({ role: 'admin' }, open), false)
  assert.equal(q.canQuickComplete({ ...sa, active: false }, open), false)
  assert.equal(q.canQuickComplete(sa, { status: 'completada' }), false)
  assert.equal(q.canQuickComplete(sa, { status: 'pendiente', archived_at: '2026-11-01' }), false)
  assert.equal(q.canQuickComplete(sa, open, false), false, 'bandera apagada')
  assert.equal(q.canBulkQuickComplete(sa), true)
  assert.equal(q.canBulkQuickComplete(sa, false), false)
  assert.equal(q.canBulkQuickComplete(null), false)
})

test('Argumentos de la RPC: completar (fecha null = hoy en la base) y deshacer al estatus anterior', () => {
  deq(q.quickCompleteArgs('t'), { p_task_id: 't', p_status: 'completada', p_completion_date: null })
  deq(q.undoQuickCompleteArgs('t', 'bloqueada'), { p_task_id: 't', p_status: 'bloqueada', p_completion_date: null })
  deq(q.undoQuickCompleteArgs('t', 'completada'), { p_task_id: 't', p_status: 'pendiente', p_completion_date: null })
})

test('Textos de "completar" en lote', () => {
  assert.match(sel.bulkConfirmText('completar', 2), /2 tareas como realizadas/)
  assert.equal(sel.bulkResultNotice({ action: 'completar', okIds: ['a'], failed: [] }), '1 tarea marcada como realizada.')
  assert.equal(sel.bulkResultNotice({ action: 'completar', okIds: [], failed: [{ id: 'a', title: 'A', error: 'x' }] }), 'No se pudo marcar como realizada ninguna de las 1 tarea.')
})

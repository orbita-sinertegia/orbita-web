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
const sel = loadModule('src/lib/taskSelection.ts')

test('toggleSelected marca y desmarca', () => {
  deq(sel.toggleSelected([], 'a'), ['a'])
  deq(sel.toggleSelected(['a', 'b'], 'a'), ['b'])
})

test('selectAllState: vacía, a medias y completa, solo con las visibles', () => {
  assert.equal(sel.selectAllState([], ['a', 'b']), 'none')
  assert.equal(sel.selectAllState(['a'], ['a', 'b']), 'some')
  assert.equal(sel.selectAllState(['a', 'b'], ['a', 'b']), 'all')
  assert.equal(sel.selectAllState(['a', 'b', 'z'], ['a', 'b']), 'all', 'las ocultas no cuentan')
  assert.equal(sel.selectAllState(['z'], ['a', 'b']), 'none')
  assert.equal(sel.selectAllState(['a'], []), 'none')
})

test('toggleSelectAll agrega las visibles o las quita, sin tocar las ocultas', () => {
  deq(sel.toggleSelectAll(['z'], ['a', 'b']), ['z', 'a', 'b'])
  deq(sel.toggleSelectAll(['a'], ['a', 'b']), ['a', 'b'])
  deq(sel.toggleSelectAll(['z', 'a', 'b'], ['a', 'b']), ['z'])
})

test('visibleSelection descarta las que ya no están en la lista', () => {
  deq(sel.visibleSelection(['a', 'x', 'b'], ['b', 'a']), ['a', 'b'])
})

test('Textos en español: contador, confirmación y resultado', () => {
  assert.equal(sel.selectedCountLabel(1), '1 seleccionada')
  assert.equal(sel.selectedCountLabel(4), '4 seleccionadas')
  assert.match(sel.bulkConfirmText('eliminar', 3), /3 tareas.*permanente y no se puede deshacer/)
  assert.match(sel.bulkConfirmText('necesito', 1), /fecha "La necesito para" de 1 tarea/)
  assert.equal(sel.bulkResultNotice({ action: 'eliminar', okIds: ['a', 'b'], failed: [] }), '2 tareas eliminadas para siempre.')
  assert.equal(sel.bulkResultNotice({ action: 'necesito', okIds: ['a'], failed: [] }), '1 tarea con fecha actualizada.')
  assert.equal(sel.bulkResultNotice({ action: 'necesito', okIds: ['a'], failed: [{ id: 'b', title: 'B', error: 'x' }] }), '1 tarea con fecha actualizada. No se pudo cambiar la fecha de 1 tarea.')
  assert.equal(sel.bulkResultNotice({ action: 'eliminar', okIds: [], failed: [{ id: 'b', title: 'B', error: 'x' }, { id: 'c', title: 'C', error: 'y' }] }), 'No se pudo eliminar ninguna de las 2 tareas.')
})

test('runBulk corre una por una, junta errores (incluso excepciones) y reporta avance', async () => {
  const order = []
  const progress = []
  const result = await sel.runBulk('eliminar', [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }], async task => {
    order.push(task.id)
    if (task.id === 'b') return 'rechazada'
    if (task.id === 'c') throw new Error('sin red')
    return ''
  }, (done, total) => progress.push(`${done}/${total}`))
  deq(order, ['a', 'b', 'c'])
  deq(progress, ['1/3', '2/3', '3/3'])
  deq(result, { action: 'eliminar', okIds: ['a'], failed: [{ id: 'b', title: 'B', error: 'rechazada' }, { id: 'c', title: 'C', error: 'sin red' }] })
})

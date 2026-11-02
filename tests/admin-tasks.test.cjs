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

const adminTasks = loadModule('src/lib/adminTasks.ts')
const { isArchived, excludeArchived, buildTaskChanges, canConfirmPermanentDelete, friendlyTaskError } = adminTasks

// ── isArchived / excludeArchived ──

test('isArchived is true only when archived_at is set', () => {
  assert.equal(isArchived({ archived_at: '2026-10-23T00:00:00Z' }), true)
  assert.equal(isArchived({ archived_at: null }), false)
  assert.equal(isArchived({ archived_at: undefined }), false)
})

test('excludeArchived keeps only non-archived tasks, preserving order', () => {
  const tasks = [
    { id: 'a', archived_at: null },
    { id: 'b', archived_at: '2026-10-20T00:00:00Z' },
    { id: 'c', archived_at: undefined },
  ]
  assert.deepEqual(excludeArchived(tasks).map(t => t.id), ['a', 'c'])
})

// ── buildTaskChanges ──

const baseTask = {
  id: 'task-1',
  title: 'Editar video',
  description: 'Descripción original',
  assigned_to: 'user-1',
  department: 'edicion',
  priority: 'media',
  phase: 'produccion_video',
  start_date: '2026-10-01',
  needed_date: '2026-10-05',
  commitment_date: '2026-10-10',
  approver_ids: ['user-2'],
  depends_on_task_id: null,
  project_id: 'project-1',
}

function formFrom(task, overrides = {}) {
  return {
    title: task.title,
    description: task.description || '',
    assigned_to: task.assigned_to,
    department: task.department,
    priority: task.priority,
    phase: task.phase || '',
    start_date: task.start_date || '',
    needed_date: task.needed_date || '',
    commitment_date: task.commitment_date || '',
    approver_ids: task.approver_ids || [],
    depends_on_task_id: task.depends_on_task_id || '',
    project_id: task.project_id,
    ...overrides,
  }
}

// buildTaskChanges runs inside a vm.runInNewContext() realm (via loadModule), so its
// returned objects have a different Object prototype than this file's — deepEqual/
// deepStrictEqual treat that as "not reference-equal". Comparing via JSON keeps the
// assertions about structure/values without tripping over cross-realm prototypes.
function changesOf(changes) {
  return JSON.parse(JSON.stringify(changes))
}

test('buildTaskChanges returns nothing when the form matches the original task', () => {
  const changes = buildTaskChanges(baseTask, formFrom(baseTask))
  assert.deepEqual(changesOf(changes), {})
})

test('buildTaskChanges only includes fields that actually changed', () => {
  const changes = buildTaskChanges(baseTask, formFrom(baseTask, { title: 'Editar video (v2)' }))
  assert.deepEqual(changesOf(changes), { title: 'Editar video (v2)' })
})

test('buildTaskChanges normalizes empty strings to null for nullable fields', () => {
  const changes = buildTaskChanges(baseTask, formFrom(baseTask, { phase: '', needed_date: '' }))
  assert.deepEqual(changesOf(changes), { phase: null, needed_date: null })
})

test('buildTaskChanges does not touch assigned_to when the form leaves it empty (not nullable)', () => {
  const changes = buildTaskChanges(baseTask, formFrom(baseTask, { assigned_to: '' }))
  assert.deepEqual(changesOf(changes), { assigned_to: '' })
})

test('buildTaskChanges detects approver_ids changes, including order', () => {
  const unchanged = buildTaskChanges(baseTask, formFrom(baseTask, { approver_ids: ['user-2'] }))
  assert.deepEqual(changesOf(unchanged), {})
  const changed = buildTaskChanges(baseTask, formFrom(baseTask, { approver_ids: ['user-2', 'user-3'] }))
  assert.deepEqual(changesOf(changed), { approver_ids: ['user-2', 'user-3'] })
})

test('buildTaskChanges treats a never-set optional field and an emptied field the same (both null)', () => {
  const taskWithoutPhase = { ...baseTask, phase: undefined }
  const changes = buildTaskChanges(taskWithoutPhase, formFrom(taskWithoutPhase, { phase: '' }))
  assert.deepEqual(changesOf(changes), {})
})

// ── canConfirmPermanentDelete ──

test('canConfirmPermanentDelete requires an exact, case-sensitive match (trimmed)', () => {
  assert.equal(canConfirmPermanentDelete('Editar video', 'Editar video'), true)
  assert.equal(canConfirmPermanentDelete('  Editar video  ', 'Editar video'), true)
  assert.equal(canConfirmPermanentDelete('editar video', 'Editar video'), false)
  assert.equal(canConfirmPermanentDelete('Editar vide', 'Editar video'), false)
  assert.equal(canConfirmPermanentDelete('', 'Editar video'), false)
  assert.equal(canConfirmPermanentDelete('   ', ''), false)
})

// ── friendlyTaskError ──

test('friendlyTaskError passes through our own Spanish exception messages', () => {
  assert.equal(friendlyTaskError('Solo los administradores pueden editar tareas'), 'Solo los administradores pueden editar tareas')
  assert.equal(friendlyTaskError('Campo no permitido: foo'), 'Campo no permitido: foo')
  assert.equal(
    friendlyTaskError('Las tareas del departamento cliente solo pueden asignarse al usuario cliente del proyecto.'),
    'Las tareas del departamento cliente solo pueden asignarse al usuario cliente del proyecto.',
  )
  assert.equal(friendlyTaskError('La tarea ya está archivada'), 'La tarea ya está archivada')
})

test('friendlyTaskError replaces raw Postgres/PostgREST errors with a generic message', () => {
  assert.equal(
    friendlyTaskError('duplicate key value violates unique constraint "tasks_pkey"'),
    'No se pudo guardar el cambio. Verifica los datos e intenta de nuevo.',
  )
  assert.equal(
    friendlyTaskError('invalid input syntax for type uuid: "abc"'),
    'No se pudo guardar el cambio. Verifica los datos e intenta de nuevo.',
  )
})

test('friendlyTaskError falls back to a generic message for empty input', () => {
  assert.equal(friendlyTaskError(''), 'No se pudo completar la acción. Intenta de nuevo.')
  assert.equal(friendlyTaskError(null), 'No se pudo completar la acción. Intenta de nuevo.')
  assert.equal(friendlyTaskError(undefined), 'No se pudo completar la acción. Intenta de nuevo.')
})

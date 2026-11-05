const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Execute the real component handlers with deterministic hooks and database replies.
// No production accounts or database writes are used.
function harness(file, initial, replies = [], auth = {}, props = {}) {
  const states = [...initial], refs = [], effects = [], calls = []
  let index = 0, refIndex = 0
  const user = { id: 'user-1', role: 'team', work_start: 9, work_end: 18 }
  const database = {
    async rpc(name, args) {
      calls.push({ rpc: name, args })
      assert.ok(replies.length, 'Unexpected RPC request')
      return replies.shift()
    },
    auth: { signUp: async () => ({ data: { user: { id: user.id } } }), ...auth },
    from(table) {
      const call = { table, operations: [] }
      calls.push(call)
      const builder = new Proxy({}, { get(_, key) {
        if (key === 'then') return (resolve, reject) => {
          assert.ok(replies.length, 'Unexpected database request')
          return Promise.resolve(replies.shift()).then(resolve, reject)
        }
        return (...args) => { call.operations.push([key, ...args]); return builder }
      } })
      return builder
    },
  }
  const react = {
    useState(value) {
      const slot = index++
      if (!(slot in states)) states[slot] = value
      return [states[slot], next => { states[slot] = typeof next === 'function' ? next(states[slot]) : next }]
    },
    useRef(value) { const slot = refIndex++; return refs[slot] ||= { current: value } },
    useEffect(effect) { effects.push(effect) },
    useCallback(callback) { return callback },
    createContext() { return { Provider: 'provider' } },
  }
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const exported = {}
  const surface = { addEventListener() {}, removeEventListener() {}, setTimeout: fn => { fn(); return 1 }, clearTimeout() {} }
  const context = {
    exports: exported, console, URLSearchParams,
    window: { ...surface, location: { search: auth.locationSearch || '' }, confirm: auth.confirm || (() => false) }, document: surface,
    setInterval() { return 1 }, clearInterval() {},
    require(id) {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      if (id.endsWith('/supabase')) return { supabase: database }
      if (id.endsWith('/AuthContext')) return { useAuth: () => ({ user, ...auth }) }
      if (id.endsWith('/projectStatus')) return loadModule('src/lib/projectStatus.ts')
      if (id.endsWith('/adminTasks')) return loadModule('src/lib/adminTasks.ts')
      if (id.endsWith('/taskDelays')) return loadModule('src/lib/taskDelays.ts')
      if (id.endsWith('/lib/dates')) return loadModule('src/lib/dates.ts')
      if (id.endsWith('/taskSelection')) return loadModule('src/lib/taskSelection.ts')
      if (id.endsWith('/inlineTaskEdit')) return loadModule('src/lib/inlineTaskEdit.ts')
      if (id.endsWith('/quickComplete')) return loadModule('src/lib/quickComplete.ts')
      if (id.endsWith('/workSchedule')) return { scheduleForDate: () => ({ enabled: true, start: 9, end: 0 }), nowInCdmx: () => new Date(), cdmxDateKey: () => '2026-01-01' }
      return {}
    },
  }
  vm.runInNewContext(code, context)
  return { states, effects, calls, render() {
    index = 0; refIndex = 0; effects.length = 0
    return (exported.default || exported.WorkSessionProvider || exported.AuthProvider)({ children: null, inviteToken: 'invite-1', ...props })
  } }
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return
  if (predicate(node)) return node
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate)
    if (found) return found
  }
}

const active = { id: 'session-1', user_id: 'user-1', started_at: new Date().toISOString(), date: 'today' }
const workFile = 'src/contexts/WorkSessionContext.tsx'

test('Checkout preserves the session when registrar_salida fails', async () => {
  const h = harness(workFile, [active, false, true, 60], [{ data: null, error: { message: 'denied' } }])
  assert.equal(await h.render().props.value.checkOut(), false)
  const value = h.render().props.value
  assert.equal(value.currentSession.id, active.id)
  assert.equal(value.elapsedMinutes, 60)
  assert.equal(value.showOvertimeModal, true)
  assert.ok(value.sessionError)
  assert.equal(value.savingSession, false)
})

test('Successful checkout clears the session and calls registrar_salida once', async () => {
  const h = harness(workFile, [active, false, true, 60], [{ data: 1, error: null }])
  assert.equal(await h.render().props.value.checkOut(), true)
  assert.equal(h.render().props.value.currentSession, null)
  assert.equal(h.render().props.value.showOvertimeModal, false)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].rpc, 'registrar_salida')
})

test('mi_sesion_hoy failure does not open check-in (avoids a duplicate entry)', async () => {
  const h = harness(workFile, [null, false, false, 0], [{ data: null, error: { message: 'offline' } }])
  h.render(); h.effects[0]()
  await flush()
  assert.equal(h.render().props.value.needsCheckIn, false)
})

test('mi_sesion_hoy with no open row asks for check-in; with one, restores it', async () => {
  const empty = harness(workFile, [null, false, false, 0], [{ data: [], error: null }])
  empty.render(); empty.effects[0]()
  await flush()
  assert.equal(empty.render().props.value.needsCheckIn, true)

  const restored = harness(workFile, [null, false, false, 0], [{ data: [active], error: null }])
  restored.render(); restored.effects[0]()
  await flush()
  const value = restored.render().props.value
  assert.equal(value.currentSession.id, active.id)
  assert.equal(value.needsCheckIn, false)
})

for (const file of ['src/components/team/TeamDashboard.tsx', 'src/components/client/ClientPortal.tsx']) {
  test(`${file}: permissions use native Map and individual overrides`, async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let permissions
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'fetchPermissions') permissions = node.getText(ast)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    const icons = ast.statements.find(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'lucide-react').getText(ast)
    const code = ts.transpileModule(`${icons}\n${permissions}\nexports.run = fetchPermissions`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const exported = {}
    let hidden
    let reads = 0
    const context = {
      exports: exported, require, user: { id: 'u' }, activeTab: 'mistareas', teamView: 'today', embedded: false,
      setHiddenSections(value) { hidden = value }, setActiveTab() {}, setTeamView() {},
      supabase: { from() { return { select() { return { eq() {
        return Promise.resolve({ data: reads++ === 0
          ? [{ section_key: 'chat', allowed: false }, { section_key: 'roadmap', allowed: false }]
          : [{ section_key: 'chat', allowed: true }] })
      } } } } } },
    }
    vm.runInNewContext(code, context)
    await exported.run()
    assert.equal(hidden.has('chat'), false)
    assert.equal(hidden.has('roadmap'), true)
  })
}

test('Check-in reports the failure and keeps needsCheckIn true when registrar_entrada fails', async () => {
  const h = harness(workFile, [null, true, false, 0], [{ data: null, error: { message: 'offline' } }])
  await h.render().props.value.checkIn('oficina')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].rpc, 'registrar_entrada')
  assert.equal(h.calls[0].args.p_location, 'oficina')
  assert.equal(h.render().props.value.needsCheckIn, true)
  assert.ok(h.render().props.value.sessionError)
})

test('Successful check-in keeps the modal open with a confirmation notice until dismissed', async () => {
  const session = { id: 'session-2', user_id: 'user-1', started_at: new Date().toISOString(), date: '2026-01-01', is_first_of_day: true, late_minutes: 12 }
  const h = harness(workFile, [null, true, false, 0], [{ data: session, error: null }])
  await h.render().props.value.checkIn('oficina')
  const value = h.render().props.value
  assert.equal(value.currentSession.id, session.id)
  assert.equal(value.needsCheckIn, true, 'the modal stays mounted to show the confirmation')
  assert.match(value.lastCheckInNotice, /12 min después de tu horario/)
  value.dismissCheckInNotice()
  const dismissed = h.render().props.value
  assert.equal(dismissed.needsCheckIn, false)
  assert.equal(dismissed.lastCheckInNotice, '')
})

test('A second entry the same day (is_first_of_day false) never reports a retardo, even with a stale late_minutes', async () => {
  const session = { id: 'session-3', user_id: 'user-1', started_at: new Date().toISOString(), date: '2026-01-01', is_first_of_day: false, late_minutes: 45 }
  const h = harness(workFile, [null, true, false, 0], [{ data: session, error: null }])
  await h.render().props.value.checkIn('oficina')
  assert.match(h.render().props.value.lastCheckInNotice, /a tiempo/)
})

test('Overtime is shown after scheduled end and acknowledged once per session', () => {
  const h = harness(workFile, [active, false, false, 60])
  h.render(); h.effects[1]()
  assert.equal(h.render().props.value.showOvertimeModal, true)
  h.render().props.value.continueOvertime()
  h.render(); h.effects[1]()
  assert.equal(h.render().props.value.showOvertimeModal, false)
})

test('cdmxDateKey uses the America/Mexico_City calendar day, independent of the host timezone', () => {
  const workScheduleModule = loadModule('src/lib/workSchedule.ts')
  // 05:30 UTC is 23:30 the PREVIOUS day in CDMX (UTC-6): a naive UTC-based date key would get this wrong.
  const instant = new Date('2026-03-01T05:30:00Z')
  assert.equal(workScheduleModule.cdmxDateKey(instant), '2026-02-28')
  assert.notEqual(instant.toISOString().split('T')[0], workScheduleModule.cdmxDateKey(instant))
})

test('nowInCdmx exposes getDay/getHours as CDMX wall-clock time for schedule lookups', () => {
  const workScheduleModule = loadModule('src/lib/workSchedule.ts')
  const now = workScheduleModule.nowInCdmx()
  assert.equal(typeof now.getDay(), 'number')
  assert.ok(now.getHours() >= 0 && now.getHours() < 24)
})

test('WorkSessionContext delegates "today" and minute calculations to the server (no client-side calcMinutes)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', workFile), 'utf8')
  assert.doesNotMatch(source, /function calcMinutes/)
  assert.doesNotMatch(source, /getLocalDateKey/)
  assert.match(source, /supabase\.rpc\('mi_sesion_hoy'\)/)
  assert.match(source, /supabase\.rpc\('registrar_entrada'/)
  assert.match(source, /supabase\.rpc\('registrar_salida'\)/)
  assert.match(source, /nowInCdmx/)
})

test('Attendance "sin_registro" lowers punctuality: TeamPerformance counts missed check-ins against the rate', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/TeamPerformance.tsx'), 'utf8')
  assert.match(source, /from\('asistencia_rango'\)|rpc\('asistencia_rango'/)
  assert.match(source, /a\.estado === 'a_tiempo' \|\| a\.estado === 'retardo' \|\| a\.estado === 'sin_registro'/)
  assert.match(source, /onTimeDias\.length \/ diasEvaluados\.length/)
})

test('AttendancePanel surfaces every attendance state including days with no check-in', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/AttendancePanel.tsx'), 'utf8')
  for (const estado of ['a_tiempo', 'retardo', 'sin_registro', 'pendiente', 'descanso']) {
    assert.match(source, new RegExp(estado))
  }
  assert.match(source, /admin_corregir_sesion/)
  assert.match(source, /asistencia_rango/)
})

for (const kind of ['Team', 'Client']) {
  const invite = { id: 'invite-1', email: 'test@example.invalid', role: 'team', permissions: {}, client: { id: 'client-1' } }
  const form = { full_name: 'Test User', email: invite.email, password: 'password123', confirm: 'password123' }
  const stages = 1
  for (let failure = 0; failure < stages; failure++) test(`${kind} registration stops at failed write ${failure + 1}`, async () => {
    const replies = Array.from({ length: failure }, () => ({ data: { id: 'ok' } }))
    replies.push({ data: null, error: { message: 'denied' } })
    const h = harness(`src/components/auth/${kind}RegistrationPage.tsx`, [invite, '', form, false, false, false, false, '', false], replies)
    await find(h.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    assert.equal(h.states[8], false, 'Must not display success')
    assert.ok(h.states[7], 'Must explain the failure')
    assert.equal(h.states[6], false, 'Must release saving state')
    assert.equal(h.calls.length, failure + 1, 'Must stop subsequent writes')
  })
  test(`${kind} registration succeeds when all writes succeed`, async () => {
    const h = harness(`src/components/auth/${kind}RegistrationPage.tsx`, [invite, '', form, false, false, false, false, '', false], Array.from({ length: stages }, () => ({ data: { id: 'ok' } })))
    await find(h.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    assert.equal(h.states[8], true)
  })
}

test('Password success screen can leave recovery mode', () => {
  let finished = false
  const h = harness('src/components/auth/ResetPasswordPage.tsx', ['', '', false, false, false, '', true], [], { finishPasswordRecovery() { finished = true } })
  find(h.render(), node => node.type === 'button').props.onClick()
  assert.equal(finished, true)
})

test('Signup auth events do not interrupt invitation persistence', async () => {
  let onAuthChange
  const session = { user: { id: 'user-1' } }
  const h = harness('src/contexts/AuthContext.tsx', [], [], {
    locationSearch: '?team_invite=invite-1',
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange(callback) { onAuthChange = callback; return { data: { subscription: { unsubscribe() {} } } } },
  })
  h.render(); h.effects[0]()
  await Promise.resolve()
  onAuthChange('SIGNED_IN', session)
  assert.equal(h.calls.length, 0, 'Must not reject a profile still being saved')
  assert.equal(h.render().props.value.user, null, 'Invitation form stays mounted')
  assert.equal(h.render().props.value.loading, false)
})

test('Recovery state clears on continuation and sign-out', async () => {
  let onAuthChange
  const h = harness('src/contexts/AuthContext.tsx', [], [], {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange(callback) { onAuthChange = callback; return { data: { subscription: { unsubscribe() {} } } } },
  })
  h.render(); h.effects[0]()
  await Promise.resolve()
  onAuthChange('PASSWORD_RECOVERY', { user: { id: 'user-1' } })
  assert.equal(h.render().props.value.isPasswordRecovery, true)
  h.render().props.value.finishPasswordRecovery()
  assert.equal(h.render().props.value.isPasswordRecovery, false)
  onAuthChange('PASSWORD_RECOVERY', { user: { id: 'user-1' } })
  onAuthChange('SIGNED_OUT', null)
  assert.equal(h.render().props.value.isPasswordRecovery, false)
})

test('Built-in funnel tasks and stored additions resolve to one canonical list', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/data/projectTemplates.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exported = {}
  vm.runInNewContext(code, { exports: exported, require() { return {} } })
  const vsl = { tasks: [
    { title: 'Base 1', department: 'copy', priority: 'alta', phase: 'estrategia' },
    { title: 'Base 2', department: 'diseno', priority: 'alta', phase: 'produccion_paginas' },
  ] }
  const additions = Array.from({ length: 6 }, (_, index) => ({
    title: `Extra ${index + 1}`, department: 'webmaster', priority: 'alta',
  }))
  const extended = exported.resolveTemplateTasks(vsl, additions, false)
  assert.equal(extended.length, vsl.tasks.length + additions.length)
  assert.equal(exported.resolveTemplateTasks(vsl, additions, true).length, additions.length)
  assert.equal(exported.resolveTemplateTasks(vsl, [vsl.tasks[0]], false).length, vsl.tasks.length)
})

test('Funnel manager and project creation share the canonical task resolver', () => {
  for (const file of [
    'src/components/admin/FunnelTemplatesManager.tsx',
    'src/components/admin/CreateProjectModal.tsx',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.match(source, /resolveTemplateTasks/)
  }
})

test('Removing a funnel task also removes only its linked assigned copies', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/CreateFunnelTemplateModal.tsx'), 'utf8')
  const project = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/CreateProjectModal.tsx'), 'utf8')
  const migration = fs.readFileSync(path.join(__dirname, '..', 'sql/2026-10-03_sync_deleted_template_tasks.sql'), 'utf8')
  assert.match(editor, /rpc\('admin_remove_template_tasks'/)
  assert.match(editor, /¿Eliminar también las tareas asignadas\?/)
  assert.match(project, /source_template_id: form\.templateId/)
  assert.match(project, /source_template_key:.*templateTaskKey/)
  assert.match(migration, /where source_template_id = p_template_id/)
  assert.match(migration, /source_template_key = any\(p_task_keys\)/)
  assert.doesNotMatch(migration, /delete from public\.tasks\s+where lower\(trim\(title\)\)/)
})

test('New task loads every active funnel and reports template save failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/CreateTaskModal.tsx'), 'utf8')
  assert.match(source, /from\('project_templates'\)/)
  assert.match(source, /templateOptions\.map/)
  assert.match(source, /!template\.archived/)
  assert.match(source, /templateError/)
  assert.match(source, /no se pudo fijar en el embudo/)
  assert.doesNotMatch(source, /useState<'vsl' \| 'webinar'>/)
})

test('New task requires a deliverable and keeps template settings under more options', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/CreateTaskModal.tsx'), 'utf8')
  assert.match(source, /referenceLinks\.length === 0 && pendingFiles\.length === 0/)
  assert.match(source, /Agrega al menos un entregable: un enlace o un archivo/)
  assert.match(source, /Entregables \*/)
  assert.match(source, /📆 Fecha de entrega/)
  assert.match(source, /Más opciones/)
  assert.match(source, /advancedOpen && <div/)
  assert.match(source, /La necesito para \(Líder\)/)
})

test('New task loads all active administrators and team members, including the signed-in user', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/CreateTaskModal.tsx'), 'utf8')
  assert.match(source, /from\('users'\)/)
  assert.match(source, /\.in\('role', \['admin', 'team'\]\)/)
  assert.match(source, /\.eq\('active', true\)/)
  assert.match(source, /mergeAssignableMembers\(user, \(data \|\| \[\]\) as User\[\]\)/)
  assert.match(source, /byId\.set\(currentUser\.id, currentUser\)/)
  assert.match(source, /member\.id === user\?\.id \? ' \(yo\)'/)
  assert.equal((source.match(/assignableMembers\.map/g) || []).length, 2)
})

test('Team tasks includes active administrators and uses responsive task cards', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/TeamTasksManager.tsx'), 'utf8')
  assert.match(source, /\.in\('role', \['admin', 'team'\]\)/)
  assert.match(source, /\.eq\('active', true\)/)
  assert.match(source, /grid gap-3 xl:grid-cols-2/)
  assert.match(source, /hidden overflow-hidden rounded-xl/)
  assert.doesNotMatch(source, /min-w-\[1120px\]/)
})

test('Administrators can have an independent operational role', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/RolePermissionsManager.tsx'), 'utf8')
  assert.match(source, /selected\.role !== 'team' && selected\.role !== 'admin'/)
  assert.match(source, /selected\.role === 'team' \|\| selected\.role === 'admin'/)
  assert.match(source, /Rol operativo de/)
  assert.match(source, /independiente de sus permisos de administrador/)
})

test('Administrators can configure their weekly work schedule', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/RolePermissionsManager.tsx'), 'utf8')
  assert.match(source, /async function updateWorkSchedule[\s\S]*selected\.role !== 'team' && selected\.role !== 'admin'/)
  const scheduleEditorUses = source.match(/<WeeklyScheduleEditor/g) || []
  assert.equal(scheduleEditorUses.length, 1)
  assert.doesNotMatch(source, /selected\.role === 'team' && <WeeklyScheduleEditor/)
})

test('Review authorization is visible only to explicitly selected people', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'src/components/team/TeamDashboard.tsx'), 'utf8')
  const detail = fs.readFileSync(path.join(__dirname, '..', 'src/components/team/TaskDetailModal.tsx'), 'utf8')
  assert.match(dashboard, /task\.reviewer_id === user\?\.id/)
  assert.match(dashboard, /approverIds\.includes\(user\.id\)/)
  assert.match(detail, /const canAuthorize = isReviewer/)
  assert.match(detail, /Selecciona quién debe revisar y autorizar esta tarea/)
  assert.doesNotMatch(detail, /Trafficker \/ Líder \(por defecto\)/)
  assert.doesNotMatch(detail, /select\('id'\)\.eq\('role', 'admin'\)/)
  assert.doesNotMatch(detail, /select\('id'\)\.eq\('department', 'trafficker'\)/)
})

test('My workflow separates completed tasks, charts them in green, and refreshes administrator updates', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/team/TeamDashboard.tsx'), 'utf8')
  assert.match(source, /const byStatus = filter === 'todas' \? tasks\.filter\(t => t\.status !== 'completada'\)/)
  assert.match(source, /task\.status !== 'completada' && task\.priority === priority/)
  assert.match(source, /\{ name: 'Completadas', value: tasks\.filter\(task => task\.status === 'completada'\)\.length, color: '#10B981' \}/)
  assert.match(source, /channel\(`my-tasks-\$\{user\.id\}`\)/)
  assert.match(source, /filter: `assigned_to=eq\.\$\{user\.id\}`/)
  assert.match(source, /window\.addEventListener\('focus', refreshTasks\)/)
})

test('Global search covers application records, handles failures, and opens every result type', () => {
  const search = fs.readFileSync(path.join(__dirname, '..', 'src/components/shared/GlobalSearch.tsx'), 'utf8')
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/AdminDashboard.tsx'), 'utf8')
  const team = fs.readFileSync(path.join(__dirname, '..', 'src/components/team/TeamDashboard.tsx'), 'utf8')
  const client = fs.readFileSync(path.join(__dirname, '..', 'src/components/client/ClientPortal.tsx'), 'utf8')
  for (const table of ['tasks', 'projects', 'clients', 'users', 'project_templates']) {
    assert.match(search, new RegExp(`from\\('${table}'\\)`))
  }
  assert.match(search, /finally \{[\s\S]*setLoading\(false\)/)
  assert.match(search, /normalize\('NFD'\)/)
  for (const eventName of ['open-task', 'open-project', 'open-client', 'open-person', 'open-funnel', 'open-section']) {
    assert.match(search, new RegExp(eventName))
  }
  assert.match(admin, /addEventListener\('open-client'/)
  assert.match(admin, /addEventListener\('open-funnel'/)
  assert.match(team, /addEventListener\('open-section'/)
  assert.match(client, /addEventListener\('open-task'/)
})

const projectProps = {
  project: { id: 'project-1', name: 'Project example', description: 'Description', status: 'activo' },
  tasks: [], projects: [], teamMembers: [], onBack() {}, onUpdate() {},
}
const projectFile = 'src/components/admin/ProjectDetail.tsx'
function buttonText(node, text) {
  return node.type === 'button' && [node.props.children].flat().includes(text)
}
const superAdminAuth = { user: { id: 'valeria', role: 'admin', is_super_admin: true, active: true } }
function openProjectMenu(h) {
  find(h.render(), node => node.props?.['aria-label'] === 'Opciones del proyecto').props.onClick()
}

test('Project actions menu opens the inline editor', () => {
  const h = harness(projectFile, [], [], {}, projectProps)
  openProjectMenu(h)
  find(h.render(), node => buttonText(node, ' Editar proyecto')).props.onClick()
  assert.ok(find(h.render(), node => node.props?.['aria-label'] === 'Nombre del proyecto'))
  assert.ok(find(h.render(), node => node.props?.['aria-label'] === 'Descripción del proyecto'))
})

test('Project deletion uses an application modal and cancel makes no database calls', async () => {
  const h = harness(projectFile, [], [], superAdminAuth, projectProps)
  openProjectMenu(h)
  find(h.render(), node => buttonText(node, ' Eliminar proyecto')).props.onClick()
  const modal = find(h.render(), node => node.props?.role === 'dialog')
  assert.ok(modal)
  assert.match(JSON.stringify(modal), /Project example/)
  assert.match(JSON.stringify(modal), /no se puede deshacer/)
  find(modal, node => buttonText(node, 'Cancelar')).props.onClick()
  assert.equal(h.calls.length, 0)
  assert.equal(find(h.render(), node => node.props?.role === 'dialog'), undefined)
})

for (const [label, reply, success] of [
  ['success', { data: 'project-1' }, true],
  ['failure', { error: { message: 'denied' } }, false],
  ['missing confirmation', { data: null }, false],
]) test(`Project deletion ${label}`, async () => {
  let navigated = false, refreshed = false
  const h = harness(projectFile, [], [reply], superAdminAuth, {
    ...projectProps, onBack() { navigated = true }, onUpdate() { refreshed = true },
  })
  openProjectMenu(h)
  find(h.render(), node => buttonText(node, ' Eliminar proyecto')).props.onClick()
  const modal = find(h.render(), node => node.props?.role === 'dialog')
  await find(modal, node => buttonText(node, success ? 'Sí, eliminar proyecto' : 'Sí, eliminar proyecto')).props.onClick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].rpc, 'admin_delete_project')
  assert.equal(h.calls[0].args.p_project_id, 'project-1')
  assert.equal(navigated, success)
  assert.equal(refreshed, success)
  assert.equal(Boolean(find(h.render(), node => node.props?.role === 'alert')), !success)
  assert.equal(Boolean(find(h.render(), node => node.props?.role === 'dialog')), !success)
})

test('Failed project edit stays open and reports the failure', async () => {
  const h = harness(projectFile, [], [{ error: { message: 'denied' } }], {}, projectProps)
  openProjectMenu(h)
  find(h.render(), node => buttonText(node, ' Editar proyecto')).props.onClick()
  await find(h.render(), node => buttonText(node, 'Guardar')).props.onClick()
  assert.ok(find(h.render(), node => node.props?.['aria-label'] === 'Nombre del proyecto'))
  assert.ok(find(h.render(), node => node.props?.role === 'alert'))
})

// ─────────────────────────────────────────────────────────────────────────
// Plantillas VSL/Webinar, modalidad de grabación y retrasos del cliente
// ─────────────────────────────────────────────────────────────────────────

function loadModule(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exported = {}
  vm.runInNewContext(code, { exports: exported, require(id) {
    if (id.endsWith('/types')) return {}
    if (id.endsWith('/projectTemplates')) return loadModule('src/data/projectTemplates.ts')
    if (id.endsWith('/roadmapPhases')) return loadModule('src/lib/roadmapPhases.ts')
    if (id.endsWith('/dates')) return loadModule('src/lib/dates.ts')
    if (id.endsWith('/projectStatus')) return loadModule('src/lib/projectStatus.ts')
    return {}
  } })
  return exported
}

// ── Asignación al cliente ──

test('CreateProjectModal blocks project creation without a client user and never falls back to the creator', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/CreateProjectModal.tsx'), 'utf8')
  assert.match(source, /blockedNoClientUser/)
  assert.match(source, /Primero invita al cliente al portal/)
  assert.match(source, /t\.department === 'cliente' \? clientUser!\.id : \(taskOverrides\[idx\] \|\| deptAssignees\[t\.group \|\| t\.department\] \|\| user!\.id\)/)
  assert.doesNotMatch(source, /clientGroupAssignees/)
})

test('CreateTaskModal fixes department "cliente" tasks to the project client user', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/CreateTaskModal.tsx'), 'utf8')
  assert.match(source, /projectClientUserId/)
  assert.match(source, /form\.department === 'cliente' && \(!projectClientUserId \|\| form\.assigned_to !== projectClientUserId\)/)
})

test('Client portal lets the client deliver and complete their own tasks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/client/ClientPortal.tsx'), 'utf8')
  assert.match(source, /Mis pendientes/)
  assert.match(source, /client_complete_task/)
  assert.match(source, /task_links/)
  assert.match(source, /Vence en|Vencida hace/)
})

// ── Retrasos del cliente (src/lib/taskDelays.ts) ──

const delays = loadModule('src/lib/taskDelays.ts')
const today = new Date('2026-10-22T12:00:00Z')

test('Oficina: an overdue Grabación task with no mark counts against the agency', () => {
  const task = { department: 'grabacion', commitment_date: '2026-10-10', status: 'pendiente', delay_responsible: undefined }
  assert.equal(delays.isClientAttributableDelay(task, today), false)
  assert.equal(delays.countsForTeamOnTimeMetric(task), true)
})

test('Oficina: marking "no show" makes the delay attributable to the client and exempts the team', () => {
  const task = { department: 'grabacion', commitment_date: '2026-10-10', status: 'pendiente', delay_responsible: 'cliente' }
  assert.equal(delays.isClientAttributableDelay(task, today), true)
  assert.equal(delays.countsForTeamOnTimeMetric(task), false)
})

test('Remota: an overdue client recording task is attributable to the client by default', () => {
  const task = { department: 'cliente', commitment_date: '2026-10-10', status: 'pendiente', delay_responsible: undefined }
  assert.equal(delays.isClientAttributableDelay(task, today), true)
})

test('An admin override to "agencia" takes precedence over the department default', () => {
  const task = { department: 'cliente', commitment_date: '2026-10-10', status: 'pendiente', delay_responsible: 'agencia' }
  assert.equal(delays.isClientAttributableDelay(task, today), false)
})

test('Overdue client tasks and inherited client delays never lower "entregas a tiempo"', () => {
  const overdueClient = { department: 'cliente', delay_responsible: undefined }
  const inheritedDelay = { department: 'edicion', delay_responsible: 'cliente' }
  const agencyDelay = { department: 'grabacion', delay_responsible: 'agencia' }
  assert.equal(delays.countsForTeamOnTimeMetric(overdueClient), false)
  assert.equal(delays.countsForTeamOnTimeMetric(inheritedDelay), false)
  assert.equal(delays.countsForTeamOnTimeMetric(agencyDelay), true)
})

test('wasDeliveredOnTime compares completion_date against commitment_date', () => {
  assert.equal(delays.wasDeliveredOnTime({ commitment_date: '2026-10-10', completion_date: '2026-10-09' }), true)
  assert.equal(delays.wasDeliveredOnTime({ commitment_date: '2026-10-10', completion_date: '2026-10-11' }), false)
  assert.equal(delays.wasDeliveredOnTime({ commitment_date: '2026-10-10', completion_date: null }), false)
})

test('TeamPerformance scorecard excludes client-department and client-attributed delays from on-time delivery and uses the agreed weights', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/TeamPerformance.tsx'), 'utf8')
  assert.match(source, /countsForTeamOnTimeMetric/)
  assert.match(source, /wasDeliveredOnTime/)
  assert.match(source, /onTimeRate \* 0\.1/)
  assert.match(source, /entregasATiempoRate \* 0\.1/)
  assert.match(source, /noRetrabajoRate \* 0\.25/)
})

test('Admin can mark "client did not show up" on the recording session task and the badge appears in the task and roadmap', () => {
  const detail = fs.readFileSync(path.join(__dirname, '..', 'src/components/team/TaskDetailModal.tsx'), 'utf8')
  const roadmap = fs.readFileSync(path.join(__dirname, '..', 'src/components/roadmap/RoadmapView.tsx'), 'utf8')
  const projectDetail = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ProjectDetail.tsx'), 'utf8')
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/AdminDashboard.tsx'), 'utf8')
  assert.match(detail, /El cliente no asistió \/ reprogramó/)
  assert.match(detail, /isClientAttributableDelay/)
  assert.match(roadmap, /isClientAttributableDelay/)
  assert.match(projectDetail, /isClientAttributableDelay/)
  assert.match(dashboard, /clientDelayTasks/)
})

// ─────────────────────────────────────────────────────────────────────────
// FASE 2: hoja de ruta del cliente y vista de admin de clientes
// ─────────────────────────────────────────────────────────────────────────

const roadmapPhases = loadModule('src/lib/roadmapPhases.ts')
const templatesForPhases = loadModule('src/data/projectTemplates.ts')

test('inferPhase assigns a valid phase from the department', () => {
  assert.equal(templatesForPhases.inferPhase('Cualquier título', 'trafficker'), 'lanzamiento')
  assert.equal(templatesForPhases.inferPhase('Cualquier título', 'copy'), 'estrategia')
  assert.equal(templatesForPhases.inferPhase('Cualquier título', 'desconocido'), 'entrada')
})

test('Phase progress counts only approved tasks as done; pendiente_revision does not count', () => {
  const tasks = [
    { title: 'a', department: 'copy', phase: 'estrategia', status: 'completada', review_status: 'aprobada' },
    { title: 'b', department: 'copy', phase: 'estrategia', status: 'completada', review_status: 'pendiente_revision' },
    { title: 'c', department: 'copy', phase: 'estrategia', status: 'pendiente', review_status: null },
  ]
  const stats = roadmapPhases.phaseStats(tasks, 'estrategia')
  assert.equal(stats.total, 3)
  assert.equal(stats.done, 1)
  assert.equal(stats.pct, 33)
})

test('Current phase is the first incomplete one, and "produccion" combines both lanes', () => {
  const done = (phase, title) => ({ title, department: 'lider', phase, status: 'completada', review_status: null })
  const pending = (phase, title) => ({ title, department: 'lider', phase, status: 'pendiente', review_status: null })
  const tasks = [
    done('entrada', 'e1'), done('estrategia', 's1'), done('guiones', 'g1'),
    done('produccion_video', 'v1'), pending('produccion_paginas', 'p1'),
  ]
  assert.equal(roadmapPhases.currentDisplayPhase(tasks), 'produccion')
  const stats = roadmapPhases.displayPhaseStats(tasks, 'produccion')
  assert.equal(stats.total, 2)
  assert.equal(stats.done, 1)
  assert.equal(stats.lanes.produccion_video.done, 1)
  assert.equal(stats.lanes.produccion_paginas.done, 0)
})

test('Current phase falls through to optimizacion once every other phase is complete', () => {
  const done = phase => ({ title: `t-${phase}`, department: 'lider', phase, status: 'completada', review_status: null })
  const tasks = templatesForPhases.PHASES.filter(p => p !== 'optimizacion').map(done)
  assert.equal(roadmapPhases.currentDisplayPhase(tasks), 'optimizacion')
})

test('Launch delay breakdown: client days + agency days always equals the date difference', () => {
  const project = { launch_date: '2026-11-10', launch_date_original: '2026-11-01' }
  for (const events of [
    [{ responsible: 'cliente', days: 3 }],
    [{ responsible: 'cliente', days: 3 }, { responsible: 'agencia', days: 2 }],
    [{ responsible: 'cliente', days: 50 }], // más que la diferencia total: se limita
    [],
  ]) {
    const breakdown = roadmapPhases.launchDelayBreakdown(project, events)
    assert.equal(breakdown.totalDays, 9)
    assert.equal(breakdown.clientDays + breakdown.agencyDays, breakdown.totalDays)
  }
})

test('Launch delay breakdown is zero without both launch dates', () => {
  const breakdown = roadmapPhases.launchDelayBreakdown({ launch_date: null, launch_date_original: null }, [])
  assert.equal(breakdown.totalDays, 0)
  assert.equal(breakdown.clientDays, 0)
  assert.equal(breakdown.agencyDays, 0)
})

test('Both recording modalities show the correct responsible for the "grabación" milestone', () => {
  const tasks = [{ title: 'Agendar sesión de grabación', department: 'lider', phase: 'entrada', status: 'pendiente', review_status: null }]
  const oficina = roadmapPhases.buildMilestones({ recording_mode: 'oficina', launch_date: null }, tasks)
  const remota = roadmapPhases.buildMilestones({ recording_mode: 'remota', launch_date: null }, tasks)
  assert.match(oficina.find(m => m.key === 'grabacion').detail, /Grabación/)
  assert.match(remota.find(m => m.key === 'grabacion').detail, /Cliente/)
})

const today2026 = new Date('2026-10-22T12:00:00Z')

test('Project health: atrasado when launch moved or a task is more than 3 days overdue', () => {
  const movedLaunch = { launch_date: '2026-11-05', launch_date_original: '2026-11-01' }
  assert.equal(roadmapPhases.projectHealth([], movedLaunch, [], today2026).status, 'atrasado')
  const overdueTask = [{ title: 't', department: 'copy', phase: 'estrategia', status: 'pendiente', review_status: null, commitment_date: '2026-10-15' }]
  assert.equal(roadmapPhases.projectHealth(overdueTask, {}, [], today2026).status, 'atrasado')
})

test('Project health: en riesgo for a task overdue 1-3 days, or due within 2 days and not started', () => {
  const overdue2days = [{ title: 't', department: 'copy', phase: 'estrategia', status: 'pendiente', review_status: null, commitment_date: '2026-10-20' }]
  assert.equal(roadmapPhases.projectHealth(overdue2days, {}, [], today2026).status, 'en_riesgo')
  const dueSoonNotStarted = [{ title: 't', department: 'copy', phase: 'estrategia', status: 'pendiente', review_status: null, commitment_date: '2026-10-23' }]
  assert.equal(roadmapPhases.projectHealth(dueSoonNotStarted, {}, [], today2026).status, 'en_riesgo')
})

test('Project health: en tiempo otherwise', () => {
  const healthy = [{ title: 't', department: 'copy', phase: 'estrategia', status: 'completada', review_status: 'aprobada', commitment_date: '2026-10-15' }]
  assert.equal(roadmapPhases.projectHealth(healthy, {}, [], today2026).status, 'en_tiempo')
  assert.equal(roadmapPhases.projectHealth([], {}, [], today2026).status, 'en_tiempo')
})

test('Projects are ordered by risk: atrasado before en riesgo before en tiempo, then by more delay days', () => {
  const items = [
    { status: 'en_tiempo', totalDays: 0 },
    { status: 'atrasado', totalDays: 2 },
    { status: 'en_riesgo', totalDays: 1 },
    { status: 'atrasado', totalDays: 10 },
  ]
  const sorted = [...items].sort(roadmapPhases.compareByRisk)
  assert.deepEqual(sorted.map(item => `${item.status}:${item.totalDays}`), ['atrasado:10', 'atrasado:2', 'en_riesgo:1', 'en_tiempo:0'])
})

// ── Vista del cliente: sin nombres internos, solo su proyecto ──

test('ClientRoadmapView never reads or renders team member names', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/roadmap/ClientRoadmapView.tsx'), 'utf8')
  assert.doesNotMatch(source, /assignee/)
  assert.doesNotMatch(source, /full_name/)
  assert.match(source, /mode === 'interno'/)
})

test('ClientPortal scopes "Mi hoja de ruta" to the selected project only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/client/ClientPortal.tsx'), 'utf8')
  assert.match(source, /mihojaderuta/)
  assert.match(source, /mode="cliente"/)
  assert.match(source, /tasks=\{projectTasks\}/)
})

// ── Vista interna y pestaña del proyecto ──

test('ProjectDetail exposes a "Hoja de ruta del cliente" tab reusing ClientRoadmapView in internal mode', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ProjectDetail.tsx'), 'utf8')
  assert.match(source, /Hoja de ruta del cliente/)
  assert.match(source, /mode="interno"/)
})

test('Clientes view can open the roadmap for a specific client card', () => {
  const card = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ClientAssignmentManager.tsx'), 'utf8')
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/AdminDashboard.tsx'), 'utf8')
  assert.match(card, /onOpenRoadmap/)
  assert.match(dashboard, /setRoadmapClientId\(clientId\)/)
})

// ── Menú y permisos de administración ──

test('"client_roadmaps" is a first-class admin section controlled by role_permissions/user_permissions', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/AdminDashboard.tsx'), 'utf8')
  const permissions = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/RolePermissionsManager.tsx'), 'utf8')
  assert.match(dashboard, /id: 'client_roadmaps', label: 'Hoja de ruta de clientes'/)
  assert.match(permissions, /\['client_roadmaps', 'Hoja de ruta de clientes'/)
})

test('Team "client_roadmaps" section is off by default unless explicitly allowed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/team/TeamDashboard.tsx'), 'utf8')
  assert.match(source, /resolved\.get\('client_roadmaps'\) !== true\) hidden\.add\('client_roadmaps'\)/)
  const permissions = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/RolePermissionsManager.tsx'), 'utf8')
  assert.match(permissions, /Ver el resumen de sus clientes asignados/)
})

test('ClientRoadmapsManager restricts the team to their own assigned clients or tasks, mirroring ClientChatsHub', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ClientRoadmapsManager.tsx'), 'utf8')
  assert.match(source, /from\('client_team_members'\)\.select\('client_id'\)\.eq\('user_id', user\.id\)/)
  assert.match(source, /from\('tasks'\)\.select\('project_id'\)\.eq\('assigned_to', user\.id\)/)
  assert.match(source, /restricted/)
})

// ── Selector de cliente/proyecto con memoria en localStorage ──

test('ClientRoadmapsManager remembers the last client/project per user with the agreed localStorage key', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ClientRoadmapsManager.tsx'), 'utf8')
  assert.match(source, /`client-roadmap-last-\$\{userId\}`/)
  assert.match(source, /localStorage\.setItem\(storageKey\(user\.id\)/)
  assert.match(source, /localStorage\.getItem\(storageKey\(user\.id\)\)/)
})

test('Selecting a client picks its first project and switching projects keeps the same client scoped', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ClientRoadmapsManager.tsx'), 'utf8')
  assert.match(source, /function selectClient\(clientId: string\)/)
  assert.match(source, /const clientProjects = projects\.filter\(project => project\.client_id === clientId\)/)
  assert.match(source, /function selectProject\(project: Project\)/)
})

test('Admin summary cards show modalidad, phase, launch delta, semáforo, client pendings and responsible', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ClientRoadmapsManager.tsx'), 'utf8')
  assert.match(source, /recording_mode === 'remota' \? 'Remota' : 'Oficina'/)
  assert.match(source, /DISPLAY_PHASE_LABELS\[card\.phase\]/)
  assert.match(source, /card\.lider/)
})

// ─────────────────────────────────────────────────────────────────────────
// Misiones sin fecha (ventana después del check-in) — src/lib/missingDates.ts
// ─────────────────────────────────────────────────────────────────────────

const missingDates = loadModule('src/lib/missingDates.ts')

function mission(overrides = {}) {
  return {
    id: 'task-1', title: 'Tarea', department: 'copy', status: 'pendiente', review_status: null,
    commitment_date: null, assigned_to: 'user-1', project_id: 'project-1', phase: 'estrategia',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    project: { status: 'activo', launch_date: null, name: 'Proyecto', client: { name: 'Cliente' } },
    ...overrides,
  }
}

test('isUndatedMission: excludes dated, client-department, done, and finished-project tasks', () => {
  assert.equal(missingDates.isUndatedMission(mission()), true)
  assert.equal(missingDates.isUndatedMission(mission({ commitment_date: '2026-11-01' })), false)
  assert.equal(missingDates.isUndatedMission(mission({ department: 'cliente' })), false)
  assert.equal(missingDates.isUndatedMission(mission({ status: 'completada', review_status: null })), false)
  assert.equal(missingDates.isUndatedMission(mission({ status: 'completada', review_status: 'aprobada' })), false)
  assert.equal(missingDates.isUndatedMission(mission({ project: { status: 'completado' } })), false)
})

test('isUndatedMission: tasks pending review or with rework requested still count as a mission', () => {
  assert.equal(missingDates.isUndatedMission(mission({ status: 'completada', review_status: 'pendiente_revision' })), true)
  assert.equal(missingDates.isUndatedMission(mission({ status: 'completada', review_status: 'pendiente_trafficker' })), true)
  assert.equal(missingDates.isUndatedMission(mission({ status: 'completada', review_status: 'cambios_solicitados' })), true)
})

test('filterUndatedMissions scopes to the given user and drops dated/done/client tasks', () => {
  const tasks = [
    mission({ id: 'a' }),
    mission({ id: 'b', assigned_to: 'user-2' }),
    mission({ id: 'c', commitment_date: '2026-11-01' }),
    mission({ id: 'd', department: 'cliente' }),
  ]
  const result = missingDates.filterUndatedMissions(tasks, 'user-1')
  assert.deepEqual(result.map(t => t.id), ['a'])
})

test('orderMissions: projects with a closer launch date come first', () => {
  const tasks = [
    mission({ id: 'far', project_id: 'p-far', project: { status: 'activo', launch_date: '2026-12-01', name: 'Lejos' } }),
    mission({ id: 'near', project_id: 'p-near', project: { status: 'activo', launch_date: '2026-11-01', name: 'Cerca' } }),
  ]
  const ordered = missingDates.orderMissions(tasks)
  assert.deepEqual(Array.from(ordered, t => t.id), ['near', 'far'])
})

test('orderMissions: projects without a launch date rank after dated ones, by most recent activity', () => {
  const tasks = [
    mission({ id: 'stale', project_id: 'p-stale', updated_at: '2026-10-01T00:00:00Z', project: { status: 'activo', launch_date: null, name: 'Viejo' } }),
    mission({ id: 'dated', project_id: 'p-dated', updated_at: '2026-10-01T00:00:00Z', project: { status: 'activo', launch_date: '2026-12-01', name: 'Con fecha' } }),
    mission({ id: 'fresh', project_id: 'p-fresh', updated_at: '2026-10-20T00:00:00Z', project: { status: 'activo', launch_date: null, name: 'Reciente' } }),
  ]
  const ordered = missingDates.orderMissions(tasks)
  assert.deepEqual(Array.from(ordered, t => t.id), ['dated', 'fresh', 'stale'])
})

test('orderMissions: within the same project, orders by funnel phase and then by creation date', () => {
  const tasks = [
    mission({ id: 'late-phase', phase: 'revision', created_at: '2026-10-01T00:00:00Z' }),
    mission({ id: 'early-phase-later', phase: 'entrada', created_at: '2026-10-05T00:00:00Z' }),
    mission({ id: 'early-phase-first', phase: 'entrada', created_at: '2026-10-01T00:00:00Z' }),
  ]
  const ordered = missingDates.orderMissions(tasks)
  assert.deepEqual(Array.from(ordered, t => t.id), ['early-phase-first', 'early-phase-later', 'late-phase'])
})

test('isPastDate and isAfterLaunch compare date keys as strings', () => {
  assert.equal(missingDates.isPastDate('2026-10-22', '2026-10-23'), true)
  assert.equal(missingDates.isPastDate('2026-10-23', '2026-10-23'), false)
  assert.equal(missingDates.isPastDate('2026-10-24', '2026-10-23'), false)
  assert.equal(missingDates.isAfterLaunch('2026-11-05', '2026-11-01'), true)
  assert.equal(missingDates.isAfterLaunch('2026-11-01', '2026-11-01'), false)
  assert.equal(missingDates.isAfterLaunch('2026-11-05', null), false)
})

test('shouldShowMissingDatesModal: for team and admins (never clients), with an open session, outside the check-in gate, with pending missions, and not skipped today', () => {
  const base = { role: 'team', hasSessionToday: true, checkInGateOpen: false, skippedOn: null, todayKey: '2026-10-23', count: 3 }
  assert.equal(missingDates.shouldShowMissingDatesModal(base), true)
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, role: 'admin' }), true, 'admins y super admin también')
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, role: 'client' }), false)
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, hasSessionToday: false }), false)
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, checkInGateOpen: true }), false)
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, count: 0 }), false)
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, skippedOn: '2026-10-23' }), false)
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, skippedOn: '2026-10-22' }), true)
})

test('countUndatedByAssignee tallies pending missions per person, excluding client tasks and finished projects', () => {
  const tasks = [
    mission({ id: 'a', assigned_to: 'user-1' }),
    mission({ id: 'b', assigned_to: 'user-1' }),
    mission({ id: 'c', assigned_to: 'user-2' }),
    mission({ id: 'd', assigned_to: 'user-2', department: 'cliente' }),
    mission({ id: 'e', assigned_to: 'user-3', project: { status: 'completado' } }),
    mission({ id: 'f', assigned_to: 'user-4', commitment_date: '2026-11-01' }),
  ]
  const counts = missingDates.countUndatedByAssignee(tasks)
  assert.equal(counts.get('user-1'), 2)
  assert.equal(counts.get('user-2'), 1)
  assert.equal(counts.get('user-3'), undefined)
  assert.equal(counts.get('user-4'), undefined)
})

test('MissingDatesModal is mounted for team and admins (their own undated tasks) and never for clients', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/App.tsx'), 'utf8')
  assert.match(source, /user\.role !== 'client' && <MissingDatesModal \/>/)
  const modal = fs.readFileSync(path.join(__dirname, '..', 'src/components/shared/MissingDatesModal.tsx'), 'utf8')
  assert.match(modal, /user\.role === 'client' \|\| !currentSession/)
  assert.match(modal, /\.eq\('assigned_to', user\.id\)/)
})

test('TeamTasksManager shows an undated-missions count per person and a team total', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/TeamTasksManager.tsx'), 'utf8')
  assert.match(source, /countUndatedByAssignee/)
  assert.match(source, /Sin fecha: \$\{undated\}/)
  assert.match(source, /sin fecha en el equipo/)
})

// ─────────────────────────────────────────────────────────────────────────
// Estado del proyecto: solo el super admin (Activo / Pausado / Finalizado)
// ─────────────────────────────────────────────────────────────────────────

const isStatusToggle = node => node.type === 'button' && /^Estado del proyecto/.test(node.props?.['aria-label'] || '')

test('Un admin normal ve el estado del proyecto pero no puede cambiarlo', () => {
  const h = harness(projectFile, [], [], { user: { id: 'admin-1', role: 'admin', is_super_admin: false } }, projectProps)
  assert.equal(find(h.render(), isStatusToggle), undefined)
  assert.ok(find(h.render(), node => node.type === 'span' && node.props?.title === 'Solo el super admin puede cambiar el estado'))
})

const findButtonWith = (root, text) => find(root, node => node.type === 'button' && JSON.stringify(node.props?.children || '').includes(text))

const finalizeRows = [
  { id: 't1', status: 'pendiente', review_status: null, archived_at: null },
  { id: 't2', status: 'en_progreso', review_status: 'cambios_solicitados', archived_at: null },
  { id: 't3', status: 'completada', review_status: 'aprobada', archived_at: null },
  { id: 't4', status: 'en_progreso', review_status: 'pendiente_revision', archived_at: null },
  { id: 't5', status: 'bloqueada', review_status: null, archived_at: '2026-11-01T00:00:00Z' },
]
async function openFinalizeDialog(h) {
  find(h.render(), isStatusToggle).props.onClick()
  await findButtonWith(h.render(), '"Finalizado"').props.onClick()
  await flush()
  return find(h.render(), node => node.props?.role === 'dialog')
}

test('Finalizar muestra cuántas pendientes hay y deja elegir; Archivar llama finalize_project', async () => {
  let refreshed = false
  const h = harness(projectFile, [], [{ data: finalizeRows, error: null }, { data: 2, error: null }], superAdminAuth, { ...projectProps, onUpdate() { refreshed = true } })
  const dialog = await openFinalizeDialog(h)
  assert.equal(h.calls.filter(call => call.rpc).length, 0, 'nada cambia antes de elegir')
  assert.match(JSON.stringify(dialog), /tiene 2 tareas pendientes \(y 1 pendiente ya archivada\)/)
  assert.ok(findButtonWith(dialog, 'Eliminar para siempre'))
  assert.ok(findButtonWith(dialog, 'Cancelar'))
  await findButtonWith(dialog, 'Archivar (se pueden recuperar)').props.onClick()
  await flush()
  const rpc = h.calls.find(call => call.rpc)
  assert.equal(rpc.rpc, 'finalize_project')
  assert.equal(JSON.stringify(rpc.args), JSON.stringify({ p_project_id: 'project-1', p_mode: 'archivar' }))
  assert.equal(h.calls.filter(call => call.table === 'projects').length, 0, 'el estado lo cambia la RPC')
  assert.equal(refreshed, true)
  assert.equal(find(h.render(), node => node.props?.role === 'dialog'), undefined)
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'status')), /Se archivaron 2 tareas pendientes/)
})

test('Eliminar para siempre pide una segunda confirmación con el total', async () => {
  const h = harness(projectFile, [], [{ data: finalizeRows, error: null }, { data: 3, error: null }], superAdminAuth, projectProps)
  const dialog = await openFinalizeDialog(h)
  findButtonWith(dialog, 'Eliminar para siempre').props.onClick()
  const confirm = find(h.render(), node => node.props?.role === 'dialog')
  assert.match(JSON.stringify(confirm), /Se eliminarán para siempre 3 tareas/)
  assert.equal(h.calls.filter(call => call.rpc).length, 0, 'todavía no elimina')
  await findButtonWith(confirm, 'Sí, eliminar 3 para siempre').props.onClick()
  await flush()
  assert.equal(JSON.stringify(h.calls.find(call => call.rpc).args), JSON.stringify({ p_project_id: 'project-1', p_mode: 'borrar' }))
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'status')), /Se eliminaron para siempre 3 tareas pendientes/)
})

test('Cancelar la elección de Finalizado no cambia nada', async () => {
  const h = harness(projectFile, [], [{ data: finalizeRows, error: null }], superAdminAuth, projectProps)
  const dialog = await openFinalizeDialog(h)
  findButtonWith(dialog, 'Cancelar').props.onClick()
  assert.equal(find(h.render(), node => node.props?.role === 'dialog'), undefined)
  assert.equal(h.calls.filter(call => call.rpc || call.table === 'projects').length, 0)
})

test('Si falta el SQL (no existe finalize_project), se avisa y no cambia el estado', async () => {
  const h = harness(projectFile, [], [{ data: finalizeRows, error: null }, { data: null, error: { message: 'Could not find the function public.finalize_project(p_mode, p_project_id) in the schema cache' } }], superAdminAuth, projectProps)
  const dialog = await openFinalizeDialog(h)
  await findButtonWith(dialog, 'Archivar (se pueden recuperar)').props.onClick()
  await flush()
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'alert')), /finalizar_elegir\.sql/)
  assert.ok(find(h.render(), node => node.props?.role === 'dialog'), 'el diálogo sigue abierto')
})

test('Reactivar un proyecto finalizado avisa cuántas tareas se restauraron', async () => {
  const finalized = { ...projectProps, project: { ...projectProps.project, status: 'completado' } }
  const h = harness(projectFile, [], [{ count: 4, error: null }, { data: { id: 'project-1' }, error: null }, { count: 0, error: null }], superAdminAuth, finalized)
  find(h.render(), isStatusToggle).props.onClick()
  await findButtonWith(h.render(), '"Activo"').props.onClick()
  await flush(30)
  assert.match(JSON.stringify(h.calls.find(call => call.table === 'projects').operations), /"status":"activo"/)
  assert.match(JSON.stringify(h.calls.find(call => call.table === 'tasks').operations), /"archived_via","proyecto_finalizado"/)
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'status')), /Se restauraron 4 tareas/)
})

test('Pasar de Activo a Pausado no abre diálogo ni cuenta tareas', async () => {
  const h = harness(projectFile, [], [{ data: { id: 'project-1' }, error: null }], superAdminAuth, projectProps)
  find(h.render(), isStatusToggle).props.onClick()
  await findButtonWith(h.render(), '"Pausado"').props.onClick()
  await flush()
  assert.equal(h.calls.length, 1)
  assert.equal(find(h.render(), node => node.props?.role === 'dialog'), undefined)
})

test('Solo el super admin ve "Eliminar proyecto"', () => {
  for (const user of [{ id: 'admin-1', role: 'admin', is_super_admin: false }, { id: 'sa-off', role: 'admin', is_super_admin: true, active: false }, { id: 'team-1', role: 'team' }]) {
    const h = harness(projectFile, [], [], { user }, projectProps)
    openProjectMenu(h)
    assert.ok(find(h.render(), node => buttonText(node, ' Editar proyecto')), 'editar sigue disponible')
    assert.equal(find(h.render(), node => buttonText(node, ' Eliminar proyecto')), undefined, `oculto para ${user.id}`)
  }
  const h = harness(projectFile, [], [], superAdminAuth, projectProps)
  openProjectMenu(h)
  assert.ok(find(h.render(), node => buttonText(node, ' Eliminar proyecto')))
})

test('Si la base rechaza el borrado por no ser super admin, se explica', async () => {
  const h = harness(projectFile, [], [{ error: { message: 'Solo el super admin puede eliminar proyectos' } }], superAdminAuth, projectProps)
  openProjectMenu(h)
  find(h.render(), node => buttonText(node, ' Eliminar proyecto')).props.onClick()
  await find(find(h.render(), node => node.props?.role === 'dialog'), node => buttonText(node, 'Sí, eliminar proyecto')).props.onClick()
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'alert')), /Solo el super admin puede eliminar proyectos/)
})

// ─────────────────────────────────────────────────────────────────────────
// Eliminar una tarea para siempre (bote junto a archivar): solo el super admin
// ─────────────────────────────────────────────────────────────────────────

const rowTask = { id: 'task-9', title: 'Guion anuncio 3', status: 'pendiente', priority: 'media', department: 'copy', project_id: 'project-1' }
const isTrash = node => node.type === 'button' && node.props?.title === 'Eliminar tarea para siempre'

test('El bote de basura junto a archivar solo aparece para el super admin', () => {
  const props = { ...projectProps, tasks: [rowTask] }
  for (const user of [{ id: 'admin-1', role: 'admin', is_super_admin: false }, { id: 'sa-off', role: 'admin', is_super_admin: true, active: false }]) {
    const h = harness(projectFile, [], [], { user }, props)
    assert.ok(find(h.render(), node => node.type === 'button' && node.props?.title === 'Archivar tarea'), 'archivar sigue')
    assert.equal(find(h.render(), isTrash), undefined, `sin bote para ${user.id}`)
  }
  const h = harness(projectFile, [], [], superAdminAuth, props)
  const trash = find(h.render(), isTrash)
  assert.ok(trash)
  trash.props.onClick()
  const modal = find(h.render(), node => node.props?.task?.id === 'task-9' && typeof node.props?.onDeleted === 'function')
  assert.ok(modal, 'abre el diálogo de eliminar con la tarea')
})

const deleteModalFile = 'src/components/admin/DeleteTaskModal.tsx'

test('Eliminar tarea: el diálogo muestra el nombre y "no se puede deshacer"; confirmar llama super_admin_delete_task', async () => {
  let deleted = null
  const h = harness(deleteModalFile, [], [{ data: 'task-9', error: null }], {}, { task: rowTask, onClose() {}, onDeleted(title) { deleted = title } })
  const dialog = find(h.render(), node => node.props?.role === 'dialog')
  assert.match(JSON.stringify(dialog), /Guion anuncio 3/)
  assert.match(JSON.stringify(dialog), /no se puede deshacer/)
  await find(h.render(), node => buttonText(node, ' Sí, eliminar para siempre') || (node.type === 'button' && JSON.stringify(node.props.children).includes('Sí, eliminar para siempre'))).props.onClick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].rpc, 'super_admin_delete_task')
  assert.equal(h.calls[0].args.p_task_id, 'task-9')
  assert.equal(deleted, 'Guion anuncio 3')
})

test('Eliminar tarea: si la base lo rechaza, se queda abierto con el error', async () => {
  let deleted = false
  const h = harness(deleteModalFile, [], [{ data: null, error: { message: 'Solo el super admin puede eliminar tareas para siempre' } }], {}, { task: rowTask, onClose() {}, onDeleted() { deleted = true } })
  await find(h.render(), node => node.type === 'button' && JSON.stringify(node.props.children).includes('Sí, eliminar para siempre')).props.onClick()
  assert.equal(deleted, false)
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'alert')), /Solo el super admin/)
})

// ─────────────────────────────────────────────────────────────────────────
// Selección múltiple: casilla junto al nombre, archivar / eliminar varias de una
// ─────────────────────────────────────────────────────────────────────────

const multiTasks = [
  { id: 't-1', title: 'Guion 1', status: 'pendiente', priority: 'alta', department: 'copy', project_id: 'project-1' },
  { id: 't-2', title: 'Guion 2', status: 'pendiente', priority: 'alta', department: 'copy', project_id: 'project-1' },
  { id: 't-3', title: 'Diseño 1', status: 'pendiente', priority: 'media', department: 'diseno', project_id: 'project-1' },
]
const isRowBox = id => node => typeof node.props?.onToggle === 'function' && node.props?.label === `Seleccionar tarea ${id}`
const isAllBox = node => typeof node.props?.onToggle === 'function' && /todas/.test(node.props?.label || '')
const isBar = node => typeof node.props?.onArchive === 'function' && typeof node.props?.onClear === 'function'
const isBulkModal = node => typeof node.props?.onDone === 'function' && Array.isArray(node.props?.tasks)

test('Tareas del proyecto: casillas por tarea y "seleccionar todas" solo para admins', () => {
  const props = { ...projectProps, tasks: multiTasks }
  const team = harness(projectFile, [], [], { user: { id: 'u', role: 'team' } }, props)
  assert.equal(find(team.render(), isAllBox), undefined, 'el equipo no ve casillas')
  assert.equal(find(team.render(), isRowBox('Guion 1')), undefined)
  const admin = harness(projectFile, [], [], { user: { id: 'admin-1', role: 'admin', is_super_admin: false } }, props)
  assert.ok(find(admin.render(), isAllBox))
  assert.ok(find(admin.render(), isRowBox('Guion 1')))
})

test('Seleccionar varias: la barra muestra cuántas, "todas" queda a medias y luego completa', () => {
  const h = harness(projectFile, [], [], superAdminAuth, { ...projectProps, tasks: multiTasks })
  assert.equal(find(h.render(), isBar).props.count, 0)
  assert.equal(find(h.render(), isAllBox).props.state, 'none')
  find(h.render(), isRowBox('Guion 1')).props.onToggle()
  find(h.render(), isRowBox('Diseño 1')).props.onToggle()
  assert.equal(find(h.render(), isBar).props.count, 2)
  assert.equal(find(h.render(), isAllBox).props.state, 'some', 'indeterminada')
  assert.equal(find(h.render(), isRowBox('Guion 1')).props.state, true)
  find(h.render(), isAllBox).props.onToggle()
  assert.equal(find(h.render(), isBar).props.count, 3)
  assert.equal(find(h.render(), isAllBox).props.state, 'all')
  find(h.render(), isAllBox).props.onToggle()
  assert.equal(find(h.render(), isBar).props.count, 0)
  find(h.render(), isRowBox('Guion 2')).props.onToggle()
  find(h.render(), isBar).props.onClear()
  assert.equal(find(h.render(), isBar).props.count, 0, 'quitar selección')
})

test('Eliminar en lote: solo super admin; el admin solo puede archivar', () => {
  const props = { ...projectProps, tasks: multiTasks }
  const admin = harness(projectFile, [], [], { user: { id: 'admin-1', role: 'admin', is_super_admin: false } }, props)
  let bar = find(admin.render(), isBar)
  assert.equal(bar.props.canArchive, true)
  assert.equal(bar.props.canDelete, false)
  find(admin.render(), isRowBox('Guion 1')).props.onToggle()
  find(admin.render(), isBar).props.onDelete()
  assert.equal(find(admin.render(), isBulkModal), undefined, 'sin permiso no abre el diálogo de eliminar')
  find(admin.render(), isBar).props.onArchive()
  const modal = find(admin.render(), isBulkModal)
  assert.equal(modal.props.action, 'archivar')
  assert.deepEqual(JSON.parse(JSON.stringify(modal.props.tasks)).map(({ id, title }) => ({ id, title })), [{ id: 't-1', title: 'Guion 1' }])
  assert.equal(modal.props.tasks[0].department, 'copy', 'el lote lleva depto/estado para saber cuáles saltar')

  const sa = harness(projectFile, [], [], superAdminAuth, props)
  bar = find(sa.render(), isBar)
  assert.equal(bar.props.canDelete, true)
  find(sa.render(), isAllBox).props.onToggle()
  find(sa.render(), isBar).props.onDelete()
  const del = find(sa.render(), isBulkModal)
  assert.equal(del.props.action, 'eliminar')
  assert.equal(del.props.tasks.length, 3)
})

test('Al terminar el lote: se limpia la selección (menos las que fallaron), avisa y refresca', () => {
  let refreshed = 0
  const h = harness(projectFile, [], [], superAdminAuth, { ...projectProps, tasks: multiTasks, onUpdate() { refreshed++ } })
  find(h.render(), isAllBox).props.onToggle()
  find(h.render(), isBar).props.onDelete()
  find(h.render(), isBulkModal).props.onDone({ action: 'eliminar', okIds: ['t-1', 't-2'], failed: [{ id: 't-3', title: 'Diseño 1', error: 'x' }] })
  assert.equal(find(h.render(), isBulkModal), undefined)
  assert.equal(refreshed, 1)
  assert.equal(find(h.render(), isBar).props.count, 1, 'la que falló sigue seleccionada')
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'status')), /2 tareas eliminadas para siempre\. No se pudo eliminar 1 tarea\./)
})

test('Las seleccionadas que el filtro oculta no cuentan ni se borran', () => {
  const h = harness(projectFile, [], [], superAdminAuth, { ...projectProps, tasks: multiTasks })
  find(h.render(), isAllBox).props.onToggle()
  // filtro de departamento → solo "copy"
  const deptSelect = find(h.render(), node => node.type === 'select' && [node.props.children].flat(Infinity).some(c => c?.props?.value === 'copy'))
  assert.ok(deptSelect, 'filtro de departamento')
  deptSelect.props.onChange({ target: { value: 'copy' } })
  assert.equal(find(h.render(), isBar).props.count, 2)
  assert.equal(find(h.render(), isAllBox).props.state, 'all', 'todas las visibles')
  find(h.render(), isBar).props.onDelete()
  assert.deepEqual([...find(h.render(), isBulkModal).props.tasks.map(t => t.id)], ['t-1', 't-2'])
})

const bulkFile = 'src/components/admin/BulkTaskActionModal.tsx'
const bulkTasks = [{ id: 't-1', title: 'Guion 1' }, { id: 't-2', title: 'Guion 2' }, { id: 't-3', title: 'Diseño 1' }]
const textOf = node => JSON.stringify(node)
const confirmBtn = text => node => node.type === 'button' && textOf(node.props.children).includes(text)

test('Eliminar en lote: el diálogo dice cuántas y que es permanente; llama super_admin_delete_task por cada una', async () => {
  let done = null
  const replies = bulkTasks.map(t => ({ data: t.id, error: null }))
  const h = harness(bulkFile, [], replies, {}, { action: 'eliminar', tasks: bulkTasks, onClose() {}, onDone(r) { done = r } })
  const dialog = find(h.render(), node => node.props?.role === 'dialog')
  assert.match(textOf(dialog), /Eliminar 3 tareas/)
  assert.match(textOf(dialog), /permanente y no se puede deshacer/)
  await find(h.render(), confirmBtn('Sí, eliminar 3 para siempre')).props.onClick()
  assert.deepEqual(h.calls.map(c => c.rpc), ['super_admin_delete_task', 'super_admin_delete_task', 'super_admin_delete_task'])
  assert.deepEqual(h.calls.map(c => c.args.p_task_id), ['t-1', 't-2', 't-3'])
  assert.deepEqual(JSON.parse(JSON.stringify(done)), { action: 'eliminar', okIds: ['t-1', 't-2', 't-3'], failed: [] })
})

test('Eliminar en lote con fallas parciales: muestra cuáles fallaron y avisa al cerrar', async () => {
  let done = null
  const replies = [{ data: 't-1', error: null }, { data: null, error: { message: 'Solo el super admin puede eliminar tareas para siempre' } }, { data: null, error: null }]
  const h = harness(bulkFile, [], replies, {}, { action: 'eliminar', tasks: bulkTasks, onClose() {}, onDone(r) { done = r } })
  await find(h.render(), confirmBtn('Sí, eliminar 3 para siempre')).props.onClick()
  assert.equal(done, null, 'espera a que lo lea')
  const alert = find(h.render(), node => node.props?.role === 'alert')
  assert.match(textOf(alert), /1 tarea eliminada para siempre\. No se pudo eliminar 2 tareas\./)
  assert.match(textOf(alert), /Guion 2/)
  assert.match(textOf(alert), /Solo el super admin/)
  assert.match(textOf(alert), /Diseño 1/)
  assert.match(textOf(alert), /No se confirmó el borrado/)
  find(h.render(), confirmBtn('Entendido')).props.onClick()
  assert.deepEqual([...done.okIds], ['t-1'])
  assert.deepEqual([...done.failed.map(f => f.id)], ['t-2', 't-3'])
})

test('Archivar en lote: usa admin_archive_task con el mismo motivo para todas', async () => {
  let done = null
  const replies = bulkTasks.slice(0, 2).map(t => ({ data: { id: t.id }, error: null }))
  const h = harness(bulkFile, [], replies, {}, { action: 'archivar', tasks: bulkTasks.slice(0, 2), onClose() {}, onDone(r) { done = r } })
  assert.match(textOf(find(h.render(), node => node.props?.role === 'dialog')), /Archivar 2 tareas/)
  find(h.render(), node => node.type === 'textarea').props.onChange({ target: { value: '  duplicadas ' } })
  await find(h.render(), confirmBtn('Archivar 2')).props.onClick()
  assert.deepEqual(h.calls.map(c => [c.rpc, c.args.p_task_id, c.args.p_reason]), [['admin_archive_task', 't-1', 'duplicadas'], ['admin_archive_task', 't-2', 'duplicadas']])
  assert.equal(done.failed.length, 0)
})

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
test('TeamTasksManager: casillas, seleccionar todas y barra de acciones (eliminar solo super admin)', () => {
  const manager = read('src/components/admin/TeamTasksManager.tsx')
  assert.match(manager, /<TaskSelectionBar[\s\S]*?canDelete=\{canDeleteTask\}/)
  assert.equal((manager.match(/onToggle=\{\(\) => setSelectedTaskIds\(prev => toggleSelected\(prev, task\.id\)\)\}/g) || []).length, 2, 'casilla en tarjeta y tabla')
  assert.equal((manager.match(/toggleSelectAll\(prev, visibleTaskIds\)/g) || []).length, 2)
  assert.match(manager, /\{bulkAction && isAdmin && \(bulkAction\.action === 'archivar' \|\| bulkAction\.action === 'reasignar' \|\| bulkAction\.action === 'necesito' \|\| \(bulkAction\.action === 'eliminar' && canDeleteTask\)/)
  assert.match(manager, /setSelectedTaskIds\(result\.failed\.map\(item => item\.id\)\)/)
  assert.match(manager, /void onTasksChange\(\)\n  \}/)
})

// ─────────────────────────────────────────────────────────────────────────
// Edición en línea en "Tareas del proyecto": Asignado a, Depto, Prioridad, La necesito para
// ─────────────────────────────────────────────────────────────────────────

const inlineTasks = [
  { id: 'i-1', title: 'Brief', status: 'pendiente', priority: 'alta', department: 'lider', project_id: 'project-1', assigned_to: 'valeria', assignee: { id: 'valeria', full_name: 'Valeria Ruiz' }, needed_date: '2026-11-10' },
  { id: 'i-2', title: 'Hecha', status: 'completada', priority: 'media', department: 'copy', project_id: 'project-1', assigned_to: 'dani', assignee: { id: 'dani', full_name: 'Dani' } },
  { id: 'i-3', title: 'Del cliente', status: 'pendiente', priority: 'media', department: 'cliente', project_id: 'project-1', assigned_to: 'cli', assignee: { id: 'cli', full_name: 'Cliente' } },
]
const inlineMembers = [{ id: 'valeria', full_name: 'Valeria Ruiz', active: true }, { id: 'dani', full_name: 'Dani', active: true }, { id: 'fabi', full_name: 'Fabi', active: true }, { id: 'old', full_name: 'Ex', active: false }]
const inlineEditor = (prefix, title) => node => typeof node.props?.onSave === 'function' && node.props?.label === `${prefix} de ${title}`
const adminAuth = { user: { id: 'admin-1', role: 'admin', is_super_admin: false } }

test('Edición en línea: el equipo solo ve texto; admins editan tareas abiertas; las realizadas solo el super admin', () => {
  const props = { ...projectProps, tasks: inlineTasks, teamMembers: inlineMembers }
  const team = harness(projectFile, [], [], { user: { id: 'u', role: 'team' } }, props)
  for (const prefix of ['persona asignada', 'departamento', 'prioridad', 'fecha "La necesito para"']) {
    assert.equal(find(team.render(), inlineEditor(prefix, 'Brief')), undefined, `equipo sin editor de ${prefix}`)
  }
  const admin = harness(projectFile, [], [], adminAuth, props)
  for (const prefix of ['persona asignada', 'departamento', 'prioridad', 'fecha "La necesito para"']) {
    assert.ok(find(admin.render(), inlineEditor(prefix, 'Brief')), `admin edita ${prefix}`)
  }
  assert.equal(find(admin.render(), inlineEditor('prioridad', 'Hecha')), undefined, 'admin no edita una realizada')
  const showAll = h => find(h.render(), node => node.type === 'select' && [node.props.children].flat(Infinity).some(c => c?.props?.value === 'abiertas')).props.onChange({ target: { value: 'todas' } })
  showAll(admin)
  assert.ok(find(admin.render(), node => node.type === 'td' && node.props.children === 'Hecha'), 'la realizada se ve')
  assert.equal(find(admin.render(), inlineEditor('prioridad', 'Hecha')), undefined, 'admin no edita una realizada (filtro Todas)')
  const sa = harness(projectFile, [], [], superAdminAuth, props)
  showAll(sa)
  assert.ok(find(sa.render(), inlineEditor('prioridad', 'Hecha')), 'super admin sí edita una realizada')
  // Tareas del cliente: persona y depto con el lápiz; prioridad y fecha sí en línea.
  assert.equal(find(sa.render(), inlineEditor('persona asignada', 'Del cliente')), undefined)
  assert.equal(find(sa.render(), inlineEditor('departamento', 'Del cliente')), undefined)
  assert.ok(find(sa.render(), inlineEditor('prioridad', 'Del cliente')))
})

test('Edición en línea: opciones de persona (solo activos), depto sin "cliente" y las 4 prioridades', () => {
  const h = harness(projectFile, [], [], superAdminAuth, { ...projectProps, tasks: inlineTasks, teamMembers: inlineMembers })
  const people = find(h.render(), inlineEditor('persona asignada', 'Brief')).props.options.map(o => o.value)
  assert.deepEqual([...people].sort(), ['dani', 'fabi', 'valeria'])
  assert.ok(!people.includes('old'), 'sin inactivos')
  assert.ok(!people.includes('cli'), 'sin el usuario cliente')
  const depts = find(h.render(), inlineEditor('departamento', 'Brief')).props.options.map(o => o.value)
  assert.ok(!depts.includes('cliente'))
  assert.ok(depts.includes('copy') && depts.includes('lider'))
  assert.deepEqual([...find(h.render(), inlineEditor('prioridad', 'Brief')).props.options.map(o => o.value)], ['critica', 'alta', 'media', 'baja'])
})

test('Reasignar en línea: cambio optimista, guarda con admin_update_task (la misma RPC del lápiz) y refresca', async () => {
  let refreshed = 0
  const h = harness(projectFile, [], [{ data: { id: 'i-1' }, error: null }], superAdminAuth, { ...projectProps, tasks: inlineTasks, teamMembers: inlineMembers, onUpdate() { refreshed++ } })
  find(h.render(), inlineEditor('persona asignada', 'Brief')).props.onSave('fabi')
  const optimistic = find(h.render(), inlineEditor('persona asignada', 'Brief'))
  assert.equal(optimistic.props.value, 'fabi', 'se ve el cambio antes de que conteste la base')
  assert.match(JSON.stringify(optimistic.props.display), /Fabi/)
  await flush()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].rpc, 'admin_update_task')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)), { p_task_id: 'i-1', p_changes: { assigned_to: 'fabi' } })
  assert.equal(refreshed, 1)
})

test('Si la base rechaza el cambio en línea, se regresa al valor anterior y sale un aviso', async () => {
  const h = harness(projectFile, [], [{ data: null, error: { message: 'Solo los administradores pueden editar tareas' } }], adminAuth, { ...projectProps, tasks: inlineTasks, teamMembers: inlineMembers })
  find(h.render(), inlineEditor('prioridad', 'Brief')).props.onSave('critica')
  assert.equal(find(h.render(), inlineEditor('prioridad', 'Brief')).props.value, 'critica')
  await flush()
  assert.equal(find(h.render(), inlineEditor('prioridad', 'Brief')).props.value, 'alta', 'revertido')
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'status')), /No se pudo cambiar la prioridad: Solo los administradores pueden editar tareas\. Se regresó al valor anterior\./)
})

test('La necesito para: elegir fecha y quitarla mandan needed_date (fecha o null); mismo valor no guarda', async () => {
  const h = harness(projectFile, [], [{ data: {}, error: null }, { data: {}, error: null }], superAdminAuth, { ...projectProps, tasks: inlineTasks, teamMembers: inlineMembers })
  find(h.render(), inlineEditor('fecha "La necesito para"', 'Brief')).props.onSave('2026-11-10')
  await flush()
  assert.equal(h.calls.length, 0, 'misma fecha: no llama a la base')
  find(h.render(), inlineEditor('fecha "La necesito para"', 'Brief')).props.onSave('2026-11-20')
  await flush()
  find(h.render(), inlineEditor('fecha "La necesito para"', 'Brief')).props.onSave('')
  await flush()
  assert.deepEqual(h.calls.map(c => JSON.parse(JSON.stringify(c.args.p_changes))), [{ needed_date: '2026-11-20' }, { needed_date: null }])
})

test('Depto en línea guarda el departamento; en tareas del cliente no hay editor', async () => {
  const h = harness(projectFile, [], [{ data: {}, error: null }], superAdminAuth, { ...projectProps, tasks: inlineTasks, teamMembers: inlineMembers })
  find(h.render(), inlineEditor('departamento', 'Brief')).props.onSave('copy')
  await flush()
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args.p_changes)), { department: 'copy' })
})

test('Tareas del equipo: persona y prioridad editables en la tarjeta con la misma regla y la misma RPC', () => {
  const manager = read('src/components/admin/TeamTasksManager.tsx')
  assert.match(manager, /canInlineEditTask\(user, task\) && !inlineFieldLocked\(task, 'assigned_to'\)/)
  assert.match(manager, /label=\{`prioridad de \$\{task\.title\}`\}/)
  assert.match(manager, /supabase\.rpc\('admin_update_task', \{ p_task_id: task\.id, p_changes: changes \}\)/)
  assert.match(manager, /setTaskOverrides\(prev => removeOverride\(prev, task\.id, patch\)\)\n      setDeleteNotice\(inlineErrorNotice/)
})

// ─────────────────────────────────────────────────────────────────────────
// TEMPORAL (ENABLE_QUICK_COMPLETE): palomita verde "marcar realizada", solo super admin
// ─────────────────────────────────────────────────────────────────────────

const quickTasks = [
  { id: 'q-1', title: 'Video 1', status: 'en_progreso', priority: 'alta', department: 'edicion', project_id: 'project-1' },
  { id: 'q-2', title: 'Video 2', status: 'completada', priority: 'alta', department: 'edicion', project_id: 'project-1' },
]
const isQuick = title => node => node.type === 'button' && node.props?.['aria-label'] === `Marcar como realizada ${title}`

test('Palomita verde: solo el super admin, a la derecha del bote, y no en tareas realizadas', () => {
  const props = { ...projectProps, tasks: quickTasks }
  const admin = harness(projectFile, [], [], adminAuth, props)
  assert.equal(find(admin.render(), isQuick('Video 1')), undefined, 'el admin no la ve')
  const sa = harness(projectFile, [], [], superAdminAuth, props)
  const quick = find(sa.render(), isQuick('Video 1'))
  assert.ok(quick)
  find(sa.render(), node => node.type === 'select' && [node.props.children].flat(Infinity).some(c => c?.props?.value === 'abiertas')).props.onChange({ target: { value: 'todas' } })
  assert.equal(find(sa.render(), isQuick('Video 2')), undefined, 'ya realizada: sin palomita')
  const actions = find(sa.render(), node => node.type === 'div' && node.props?.className === 'flex justify-end gap-2' && [node.props.children].flat(Infinity).some(isQuick('Video 1')))
  const kids = [actions.props.children].flat(Infinity).filter(Boolean)
  const trashIdx = kids.findIndex(k => k.props?.title === 'Eliminar tarea para siempre')
  const quickIdx = kids.findIndex(k => k.props?.title === 'Marcar como realizada')
  assert.ok(trashIdx >= 0 && quickIdx === trashIdx + 1, 'justo a la derecha del bote')
})

test('Palomita verde: marca completada con super_admin_set_task_status (fecha la pone la base), avisa y se puede deshacer', async () => {
  let refreshed = 0
  const replies = [{ data: { id: 'q-1', status: 'completada' }, error: null }, { data: { id: 'q-1', status: 'en_progreso' }, error: null }]
  const h = harness(projectFile, [], replies, superAdminAuth, { ...projectProps, tasks: quickTasks, onUpdate() { refreshed++ } })
  find(h.render(), isQuick('Video 1')).props.onClick()
  await flush()
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { rpc: 'super_admin_set_task_status', args: { p_task_id: 'q-1', p_status: 'completada', p_completion_date: null } })
  assert.equal(refreshed, 1)
  const toast = find(h.render(), node => node.props?.role === 'status' && /marcada como realizada/.test(JSON.stringify(node)))
  assert.ok(toast)
  await find(toast, node => node.type === 'button' && node.props.children === 'Deshacer').props.onClick()
  await flush()
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1].args)), { p_task_id: 'q-1', p_status: 'en_progreso', p_completion_date: null })
  assert.equal(refreshed, 2)
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'status')), /volvió a su estatus anterior/)
})

test('Palomita verde: si la base la rechaza, se explica', async () => {
  const h = harness(projectFile, [], [{ data: null, error: { message: 'Solo el super admin puede cambiar el estatus desde aquí' } }], superAdminAuth, { ...projectProps, tasks: quickTasks })
  find(h.render(), isQuick('Video 1')).props.onClick()
  await flush()
  assert.match(JSON.stringify(find(h.render(), node => node.props?.role === 'status')), /No se pudo marcar como realizada: Solo el super admin/)
})

test('Barra de selección: "Marcar realizadas" solo para el super admin y abre el diálogo con las tareas', () => {
  const props = { ...projectProps, tasks: multiTasks }
  const admin = harness(projectFile, [], [], adminAuth, props)
  assert.equal(find(admin.render(), isBar).props.canComplete, false)
  find(admin.render(), isAllBox).props.onToggle()
  find(admin.render(), isBar).props.onComplete()
  assert.equal(find(admin.render(), isBulkModal), undefined)
  const sa = harness(projectFile, [], [], superAdminAuth, props)
  assert.equal(find(sa.render(), isBar).props.canComplete, true)
  find(sa.render(), isAllBox).props.onToggle()
  find(sa.render(), isBar).props.onComplete()
  const modal = find(sa.render(), isBulkModal)
  assert.equal(modal.props.action, 'completar')
  assert.equal(modal.props.tasks.length, 3)
})

test('Marcar realizadas en lote: una por una con super_admin_set_task_status; reporta las que fallan', async () => {
  let done = null
  const replies = [{ data: {}, error: null }, { data: null, error: { message: 'La tarea no existe' } }, { data: {}, error: null }]
  const h = harness(bulkFile, [], replies, {}, { action: 'completar', tasks: bulkTasks, onClose() {}, onDone(r) { done = r } })
  assert.match(textOf(find(h.render(), node => node.props?.role === 'dialog')), /Marcar 3 tareas como realizadas/)
  await find(h.render(), confirmBtn('Marcar 3 como realizadas')).props.onClick()
  assert.deepEqual(h.calls.map(c => [c.rpc, c.args.p_task_id, c.args.p_status, c.args.p_completion_date]), [
    ['super_admin_set_task_status', 't-1', 'completada', null],
    ['super_admin_set_task_status', 't-2', 'completada', null],
    ['super_admin_set_task_status', 't-3', 'completada', null],
  ])
  assert.equal(done, null)
  assert.match(textOf(find(h.render(), node => node.props?.role === 'alert')), /2 tareas marcadas como realizadas\. No se pudo marcar como realizada 1 tarea\./)
  find(h.render(), confirmBtn('Entendido')).props.onClick()
  assert.deepEqual([...done.failed.map(f => f.id)], ['t-2'])
})

test('Tareas del equipo y detalle: "Marcar realizadas" en la barra y palomita en el detalle, todo detrás de ENABLE_QUICK_COMPLETE', () => {
  const manager = read('src/components/admin/TeamTasksManager.tsx')
  assert.match(manager, /canComplete=\{canBulkQuickComplete\(user\)\}/)
  assert.match(manager, /bulkAction\.action === 'completar' && canBulkQuickComplete\(user\)/)
  const detail = read('src/components/team/TaskDetailModal.tsx')
  assert.match(detail, /\{canQuickComplete\(user, task\) && \(/)
  assert.match(detail, /supabase\.rpc\('super_admin_set_task_status', quickCompleteArgs\(task\.id\)\)/)
  const flag = read('src/lib/quickComplete.ts')
  assert.match(flag, /export const ENABLE_QUICK_COMPLETE = true/)
})

// ── Fase 1: reasignar y fecha "La necesito para" en lote ──
const editTasks = [
  { id: 'r-1', title: 'Copy 1', department: 'copy', status: 'pendiente', assigned_to: 'u-a', needed_date: null },
  { id: 'r-2', title: 'Aprobar guion', department: 'cliente', status: 'pendiente', assigned_to: 'u-c', needed_date: null },
  { id: 'r-3', title: 'Diseño hecho', department: 'diseno', status: 'completada', assigned_to: 'u-a', needed_date: null },
  { id: 'r-4', title: 'Ya de Bea', department: 'copy', status: 'pendiente', assigned_to: 'u-b', needed_date: '2026-11-20' },
]
const members = [{ id: 'u-a', full_name: 'Ana' }, { id: 'u-b', full_name: 'Bea' }]

test('Reasignar en lote: elige persona, usa admin_update_task y salta cliente, realizadas y las que ya eran suyas', async () => {
  let done = null
  const h = harness(bulkFile, [], [{ data: null, error: null }], {}, { action: 'reasignar', tasks: editTasks, members, onClose() {}, onDone(r) { done = r } })
  const select = find(h.render(), node => node.type === 'select')
  assert.match(textOf(select), /Bea/)
  assert.equal(find(h.render(), confirmBtn('Reasignar')).props.disabled, true, 'sin persona no se puede confirmar')
  select.props.onChange({ target: { value: 'u-b' } })
  const dialog = textOf(find(h.render(), node => node.props?.role === 'dialog'))
  assert.match(dialog, /Se saltarán 3 tareas/)
  await find(h.render(), confirmBtn('Reasignar 1')).props.onClick()
  assert.deepEqual(h.calls.map(c => [c.rpc, c.args.p_task_id, JSON.stringify(c.args.p_changes)]), [['admin_update_task', 'r-1', '{"assigned_to":"u-b"}']])
  assert.equal(done, null, 'muestra lo que se saltó antes de cerrar')
  const alert = textOf(find(h.render(), node => node.props?.role === 'alert'))
  assert.match(alert, /1 tarea reasignada\. Se saltaron 3 tareas\./)
  assert.match(alert, /Es tarea del cliente/)
  assert.match(alert, /solo el super admin la edita/)
  assert.match(alert, /Ya estaba asignada a esa persona/)
  find(h.render(), confirmBtn('Entendido')).props.onClick()
  assert.deepEqual([...done.okIds], ['r-1'])
  assert.deepEqual([...done.skipped.map(s => s.id)], ['r-2', 'r-3', 'r-4'])
})

test('Reasignar en lote: el super admin sí puede reasignar realizadas', async () => {
  const h = harness(bulkFile, [], [{ data: null, error: null }, { data: null, error: null }], {}, { action: 'reasignar', tasks: editTasks.slice(0, 3), members, canEditCompleted: true, onClose() {}, onDone() {} })
  find(h.render(), node => node.type === 'select').props.onChange({ target: { value: 'u-b' } })
  await find(h.render(), confirmBtn('Reasignar 2')).props.onClick()
  assert.deepEqual(h.calls.map(c => c.args.p_task_id), ['r-1', 'r-3'])
})

test('Fecha "La necesito para" en lote: poner fecha y quitarla mandan needed_date (fecha o null)', async () => {
  let done = null
  const set = harness(bulkFile, [], [{ data: null, error: null }, { data: null, error: null }, { data: null, error: null }], {}, { action: 'necesito', tasks: [editTasks[0], editTasks[1], editTasks[3]], members, onClose() {}, onDone(r) { done = r } })
  find(set.render(), node => node.type === 'input' && node.props.type === 'date').props.onChange({ target: { value: '2026-11-25' } })
  await find(set.render(), confirmBtn('Guardar fecha en 3')).props.onClick()
  assert.deepEqual(set.calls.map(c => JSON.stringify(c.args.p_changes)), ['{"needed_date":"2026-11-25"}', '{"needed_date":"2026-11-25"}', '{"needed_date":"2026-11-25"}'])
  assert.equal(done.failed.length, 0)

  const clear = harness(bulkFile, [], [{ data: null, error: null }], {}, { action: 'necesito', tasks: [editTasks[0], editTasks[3]], members, onClose() {}, onDone() {} })
  find(clear.render(), node => node.type === 'input' && node.props.type === 'radio' && node.props.checked === false).props.onChange()
  await find(clear.render(), confirmBtn('Quitar fecha a 1')).props.onClick()
  assert.deepEqual(clear.calls.map(c => [c.args.p_task_id, JSON.stringify(c.args.p_changes)]), [['r-4', '{"needed_date":null}']])
})

test('Barra de selección: Reasignar y Fecha para admins en Tareas del proyecto y del equipo', () => {
  const bar = read('src/components/admin/TaskSelectionBar.tsx')
  assert.match(bar, /canEdit && onReassign/)
  assert.match(bar, /Fecha “La necesito para”/)
  for (const file of ['src/components/admin/ProjectDetail.tsx', 'src/components/admin/TeamTasksManager.tsx']) {
    const src = read(file)
    assert.match(src, /onReassign=\{\(\) => openBulk\('reasignar'\)\}/, file)
    assert.match(src, /onSetNeeded=\{\(\) => openBulk\('necesito'\)\}/, file)
    assert.match(src, /canEditCompleted=\{/, file)
    assert.match(src, /department: t(ask)?\.department, status: t(ask)?\.status, assigned_to: t(ask)?\.assigned_to/, file)
  }
})

test('Agenda del equipo: vista de admins en Operación, siempre visible, con equipo + admins', () => {
  const dash = read('src/components/admin/AdminDashboard.tsx')
  assert.match(dash, /\{ id: 'agenda', label: 'Agenda del equipo'/)
  assert.match(dash, /ids: \['overview', 'team', 'team_tasks', 'agenda',/)
  assert.match(dash, /item\.id === 'agenda' \|\|/)
  assert.match(dash, /<TeamAgenda teamMembers=\{teamMembers\} adminMembers=\{adminMembers\} tasks=\{operationalTasks\}/)
})

test('Mi día y calendario del equipo usan la fecha de CDMX', () => {
  assert.match(read('src/components/team/TeamDashboard.tsx'), /const todayKey = cdmxTodayKey\(\)/)
  assert.match(read('src/components/team/TeamCalendarView.tsx'), /cdmxTodayKey\(\)/)
})

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
  const vsl = exported.PROJECT_TEMPLATES.find(template => template.id === 'vsl')
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
  const h = harness(projectFile, [], [], {}, projectProps)
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
  const h = harness(projectFile, [], [reply], {}, {
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
    return {}
  } })
  return exported
}

const templatesModule = loadModule('src/data/projectTemplates.ts')
const { PROJECT_TEMPLATES, resolveTemplateTasks, tasksForModalidad } = templatesModule

function taskSetFor(templateId, modalidad) {
  const tpl = PROJECT_TEMPLATES.find(t => t.id === templateId)
  const resolved = resolveTemplateTasks(tpl, [], false)
  return [...resolved, ...tasksForModalidad(modalidad)]
}

for (const [templateId, modalidad, expectedTotal, expectedCliente, expectedGrabacion] of [
  ['vsl', 'oficina', 64, 5, 3],
  ['vsl', 'remota', 64, 6, 2],
  ['webinar', 'oficina', 70, 7, 3],
  ['webinar', 'remota', 70, 8, 2],
]) test(`${templateId} · ${modalidad} resolves to ${expectedTotal} tasks (cliente ${expectedCliente}, grabación ${expectedGrabacion})`, () => {
  const full = taskSetFor(templateId, modalidad)
  assert.equal(full.length, expectedTotal)
  assert.equal(full.filter(t => t.department === 'cliente').length, expectedCliente)
  assert.equal(full.filter(t => t.department === 'grabacion').length, expectedGrabacion)
})

test('No template/modalidad combination duplicates a title+department pair', () => {
  for (const templateId of ['vsl', 'webinar']) {
    for (const modalidad of ['oficina', 'remota']) {
      const full = taskSetFor(templateId, modalidad)
      const keys = full.map(t => `${t.department}:${t.title.trim().toLowerCase()}`)
      assert.equal(new Set(keys).size, keys.length, `${templateId}/${modalidad} has duplicate tasks`)
    }
  }
})

test('VSL never includes webinar-only tasks', () => {
  for (const modalidad of ['oficina', 'remota']) {
    const vsl = taskSetFor('vsl', modalidad)
    assert.ok(!vsl.some(t => t.title === 'Crear Presentación'))
    assert.ok(!vsl.some(t => t.title === 'Solicitar reunión de revisión de presentación con Alfredo Mota'))
    assert.ok(!vsl.some(t => t.title === 'Cambiar diseño visual de Pág. Ingreso al Webinar'))
    assert.ok(!vsl.some(t => t.title === 'Crear el Evento en Addevent'))
    assert.ok(!vsl.some(t => t.title === 'Video de Edificación - Presentación'))
  }
})

test('No task appears in both modalidades at once, and "Grabar VSL de webinar..." no longer exists', () => {
  const oficina = tasksForModalidad('oficina').map(t => t.title)
  const remota = tasksForModalidad('remota').map(t => t.title)
  assert.equal(oficina.filter(title => remota.includes(title)).length, 0)
  for (const templateId of ['vsl', 'webinar']) {
    const all = resolveTemplateTasks(PROJECT_TEMPLATES.find(t => t.id === templateId), [], false)
    assert.ok(!all.some(t => t.title === 'Grabar VSL de webinar, Gracias y 12 anuncios'))
  }
})

test('Oficina: client only has "Asistir a la sesión de grabación"; Grabación has both recording tasks', () => {
  const oficina = tasksForModalidad('oficina')
  assert.equal(JSON.stringify(oficina.filter(t => t.department === 'cliente').map(t => t.title)), JSON.stringify(['Asistir a la sesión de grabación']))
  assert.equal(JSON.stringify(oficina.filter(t => t.department === 'grabacion').map(t => t.title).sort()), JSON.stringify(['Grabar 12 anuncios', 'Grabar VSL y Video de Gracias'].sort()))
})

test('Remota: client is responsible for recording and sharing; Grabación only supports', () => {
  const remota = tasksForModalidad('remota')
  assert.equal(JSON.stringify(remota.filter(t => t.department === 'cliente').map(t => t.title).sort()), JSON.stringify([
    'Grabar VSL, Gracias y 12 anuncios',
    'Compartir la grabación de video de VSL, Gracias, 12 anuncios',
  ].sort()))
  assert.equal(remota.filter(t => t.department === 'grabacion').length, 1)
})

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

function taskSetForPhases(templateId, modalidad) {
  const tpl = templatesForPhases.PROJECT_TEMPLATES.find(t => t.id === templateId)
  const resolved = templatesForPhases.resolveTemplateTasks(tpl, [], false)
  return [...resolved, ...templatesForPhases.tasksForModalidad(modalidad)]
}

test('inferPhase assigns a non-null phase to every VSL (64) and Webinar (70) task', () => {
  for (const [templateId, modalidad, expectedTotal] of [
    ['vsl', 'oficina', 64], ['vsl', 'remota', 64], ['webinar', 'oficina', 70], ['webinar', 'remota', 70],
  ]) {
    const full = taskSetForPhases(templateId, modalidad)
    assert.equal(full.length, expectedTotal)
    for (const task of full) {
      const phase = templatesForPhases.inferPhase(task.title, task.department)
      assert.ok(phase, `${templateId}/${modalidad}: "${task.title}" got no phase`)
      assert.ok(templatesForPhases.PHASES.includes(phase), `${templateId}/${modalidad}: "${task.title}" got invalid phase "${phase}"`)
    }
  }
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

test('inferTemplateLabel recognizes Webinar-only titles and falls back to VSL/Personalizado', () => {
  assert.equal(roadmapPhases.inferTemplateLabel([{ title: 'Crear Presentación' }]), 'Webinar')
  assert.equal(roadmapPhases.inferTemplateLabel([{ title: 'Montar funnel completo en GHL' }]), 'VSL')
  assert.equal(roadmapPhases.inferTemplateLabel([]), 'Personalizado')
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

test('Admin summary cards show template, modalidad, phase, launch delta, semáforo, client pendings and responsible', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/ClientRoadmapsManager.tsx'), 'utf8')
  assert.match(source, /inferTemplateLabel/)
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

test('shouldShowMissingDatesModal: only for team, with an open session, outside the check-in gate, with pending missions, and not skipped today', () => {
  const base = { role: 'team', hasSessionToday: true, checkInGateOpen: false, skippedOn: null, todayKey: '2026-10-23', count: 3 }
  assert.equal(missingDates.shouldShowMissingDatesModal(base), true)
  assert.equal(missingDates.shouldShowMissingDatesModal({ ...base, role: 'admin' }), false)
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

test('MissingDatesModal is mounted only for the team role and never for admin/client', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/App.tsx'), 'utf8')
  assert.match(source, /user\.role === 'team' && <MissingDatesModal \/>/)
})

test('TeamTasksManager shows an undated-missions count per person and a team total', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/admin/TeamTasksManager.tsx'), 'utf8')
  assert.match(source, /countUndatedByAssignee/)
  assert.match(source, /Sin fecha: \$\{undated\}/)
  assert.match(source, /sin fecha en el equipo/)
})

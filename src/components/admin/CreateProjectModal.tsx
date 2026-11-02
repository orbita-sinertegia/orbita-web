import { useState, useEffect } from 'react'
import { X, Plus, ChevronLeft, CheckSquare, Square, GripVertical, MoreVertical, Pencil, Trash2, MessageSquare, Check, Copy, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Client, Department, Priority, User } from '../../types'
import { PROJECT_TEMPLATES, GROUP_LABELS, GROUP_COLORS, TEMPLATE_GROUP_ORDER, DEPT_LABELS, resolveTemplateTasks, templateTaskKey, tasksForModalidad, inferPhase, type Modalidad, type Phase } from '../../data/projectTemplates'
import CreateFunnelTemplateModal from './CreateFunnelTemplateModal'

interface CustomTemplate { id: string; name: string; icon: string; description: string | null; taskCount: number }
interface DbProjectTemplate { id: string; name: string; icon: string; description: string | null; archived?: boolean }
interface StoredTemplateTask { template_id: string; title: string; department: Department; priority: Priority; group?: string }

interface Props {
  clients: Client[]
  teamMembers: User[]
  onClose: () => void
  onCreated: () => void
}

interface CombinedTask {
  title: string
  department: string
  priority: string
  isCustom: boolean
  group?: string
  note?: string
  phase?: Phase
}

export default function CreateProjectModal({ clients, teamMembers, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [newClient, setNewClient] = useState({ name: '', company: '' })
  const [form, setForm] = useState({ name: '', description: '', templateId: '', modalidad: 'oficina' as Modalidad })
  const [saving, setSaving] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [error, setError] = useState('')

  // Bloqueo: no se puede crear un proyecto sin un usuario de cliente activo
  const [blockedNoClientUser, setBlockedNoClientUser] = useState(false)
  const [blockedClientId, setBlockedClientId] = useState('')
  const [blockedClientName, setBlockedClientName] = useState('')
  const [checkingClientUser, setCheckingClientUser] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [invitingClient, setInvitingClient] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)

  const [selectedTeamMembers, setSelectedTeamMembers] = useState<string[]>([])

  const [combinedTasks, setCombinedTasks] = useState<CombinedTask[]>([])
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [deptAssignees, setDeptAssignees] = useState<Record<string, string>>({})
  const [deptAssignees2, setDeptAssignees2] = useState<Record<string, string>>({})
  const [taskOverrides, setTaskOverrides] = useState<Record<number, string>>({})
  const [addingTaskToGroup, setAddingTaskToGroup] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [openMenuIdx, setOpenMenuIdx] = useState<number | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editTitleValue, setEditTitleValue] = useState('')
  const [commentingIdx, setCommentingIdx] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [clientUser, setClientUser] = useState<User | null>(null)
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([])
  const [databaseTemplateIds, setDatabaseTemplateIds] = useState<Set<string>>(new Set())
  const [archivedTemplateIds, setArchivedTemplateIds] = useState<Set<string>>(new Set())
  const [storedTemplateTasks, setStoredTemplateTasks] = useState<StoredTemplateTask[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [showCreateFunnel, setShowCreateFunnel] = useState(false)

  useEffect(() => {
    fetchCustomTemplates()
  }, [])

  async function fetchCustomTemplates() {
    setTemplatesLoaded(false)
    const [templateResult, taskResult] = await Promise.all([
      supabase.from('project_templates').select('*').order('created_at'),
      supabase.from('template_tasks').select('template_id, title, department, priority').order('created_at'),
    ])
    if (templateResult.error || taskResult.error) {
      setError('No se pudieron cargar los embudos y sus tareas. Cierra esta ventana e intenta de nuevo.')
      setTemplatesLoaded(false)
      return
    }
    const templates = (templateResult.data || []) as DbProjectTemplate[]
    const storedTasks = (taskResult.data || []) as StoredTemplateTask[]
    const activeTemplates = templates.filter((template: { archived?: boolean }) => !template.archived)
    setDatabaseTemplateIds(new Set(activeTemplates.map((template: { id: string }) => template.id)))
    setArchivedTemplateIds(new Set(templates.filter((template: { archived?: boolean }) => template.archived).map((template: { id: string }) => template.id)))
    const countByTemplate: Record<string, number> = {}
    storedTasks.forEach(row => { countByTemplate[row.template_id] = (countByTemplate[row.template_id] || 0) + 1 })
    setCustomTemplates(activeTemplates.filter(t => !['vsl', 'webinar', 'otro'].includes(t.id)).map(t => ({
      id: t.id, name: t.name, icon: t.icon, description: t.description, taskCount: countByTemplate[t.id] || 0,
    })))
    setStoredTemplateTasks(storedTasks)
    setTemplatesLoaded(true)
  }

  async function handleFunnelCreated(tpl: { id: string; name: string; icon: string; description: string }) {
    setShowCreateFunnel(false)
    await fetchCustomTemplates()
    setForm(f => ({ ...f, templateId: tpl.id }))
  }

  // El grupo Cliente ya no es elegible: sus tareas siempre son del usuario cliente del proyecto.
  const allAssignees = [
    ...(user ? [{ id: user.id, full_name: `${user.full_name} (yo)` }] : []),
    ...teamMembers,
  ]

  function validateStep1() {
    if (!form.name.trim()) { setError('El nombre del proyecto es obligatorio'); return false }
    if (mode === 'existing' && !selectedClientId) { setError('Selecciona un cliente'); return false }
    if (mode === 'new' && !newClient.name.trim()) { setError('El nombre del cliente es obligatorio'); return false }
    if (!form.templateId) { setError('Selecciona un tipo de proyecto'); return false }
    setError('')
    return true
  }

  function resetBlock() {
    setBlockedNoClientUser(false)
    setBlockedClientId('')
    setBlockedClientName('')
    setInviteLink('')
    setInviteCopied(false)
  }

  async function inviteBlockedClient() {
    if (!blockedClientId) return
    setInvitingClient(true)
    const { data } = await supabase.from('client_invitations').insert({ client_id: blockedClientId }).select('id').single()
    if (data) setInviteLink(`https://agencia.sinertegia.com?invite=${data.id}`)
    setInvitingClient(false)
  }

  async function copyInviteLink() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setInviteCopied(true)
    window.setTimeout(() => setInviteCopied(false), 2000)
  }

  // "Nuevo cliente" solo da de alta el registro y genera su invitación — el proyecto se
  // crea después, eligiendo "Cliente existente" una vez que el cliente ya tiene cuenta.
  async function handleCreateClientAndInvite() {
    setSaving(true)
    setError('')
    const { data, error: clientErr } = await supabase.from('clients').insert({
      name: newClient.name.trim(),
      company: newClient.company.trim() || newClient.name.trim(),
    }).select().single()
    if (clientErr || !data) { setError('Error al crear el cliente'); setSaving(false); return }

    if (selectedTeamMembers.length > 0) {
      await supabase.from('client_team_members').insert(
        selectedTeamMembers.map(userId => ({ client_id: data.id, user_id: userId }))
      )
    }

    setBlockedClientId(data.id)
    setBlockedClientName(data.name)
    setBlockedNoClientUser(true)
    setSaving(false)
    onCreated()
  }

  async function handleContinue() {
    if (!validateStep1()) return
    if (!templatesLoaded) {
      setError('Espera a que terminen de cargar las tareas de los embudos.')
      return
    }

    if (mode === 'new') {
      await handleCreateClientAndInvite()
      return
    }

    const selectedClient = clients.find(c => c.id === selectedClientId)
    if (!selectedClient?.user_id) {
      setBlockedClientId(selectedClientId)
      setBlockedClientName(selectedClient?.name || '')
      setBlockedNoClientUser(true)
      return
    }

    setCheckingClientUser(true)
    const { data: cUser } = await supabase.from('users').select('*')
      .eq('id', selectedClient.user_id).eq('role', 'client').eq('active', true).maybeSingle()
    setCheckingClientUser(false)
    if (!cUser) {
      setBlockedClientId(selectedClientId)
      setBlockedClientName(selectedClient.name)
      setBlockedNoClientUser(true)
      return
    }
    resetBlock()

    const tpl = PROJECT_TEMPLATES.find(t => t.id === form.templateId)

    setLoadingTasks(true)
    const customDbTasks = storedTemplateTasks.filter(task => task.template_id === form.templateId)

    if (form.templateId === 'otro' && (!customDbTasks || customDbTasks.length === 0)) {
      setLoadingTasks(false)
      handleCreate([])
      return
    }

    // tpl viene de PROJECT_TEMPLATES (vsl/webinar/otro); si es un embudo personalizado, tpl es undefined
    // y todas sus tareas vienen de template_tasks (customDbTasks) en vez de tareas fijas en el código.
    const resolvedTasks = resolveTemplateTasks(
      tpl,
      customDbTasks,
      databaseTemplateIds.has(form.templateId),
    )
    // La modalidad de grabación solo aplica a VSL/Webinar; se agrega aparte porque se
    // elige por proyecto y no es parte de la definición fija de la plantilla.
    const withModalidad = (form.templateId === 'vsl' || form.templateId === 'webinar')
      ? [...resolvedTasks, ...tasksForModalidad(form.modalidad)]
      : resolvedTasks
    const storedKeys = new Set(customDbTasks.map(task => `${task.department}:${task.title.trim().toLocaleLowerCase('es-MX')}`))
    const all: CombinedTask[] = withModalidad.map(task => ({
      ...task,
      isCustom: storedKeys.has(`${task.department}:${task.title.trim().toLocaleLowerCase('es-MX')}`),
    }))

    setCombinedTasks(all)
    setSelectedTasks(new Set(all.map((_, i) => i)))

    const defaults: Record<string, string> = {}
    if (user) { defaults['lider'] = user.id }
    setClientUser(cUser as User)
    defaults['cliente'] = cUser.id

    setDeptAssignees(defaults)
    setLoadingTasks(false)
    setStep(2)
  }

  function toggleTask(idx: number) {
    setSelectedTasks(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function toggleDept(groupKey: string) {
    const idxs = combinedTasks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => (t.group || t.department) === groupKey)
      .map(({ i }) => i)
    const allSel = idxs.every(i => selectedTasks.has(i))
    setSelectedTasks(prev => {
      const next = new Set(prev)
      idxs.forEach(i => allSel ? next.delete(i) : next.add(i))
      return next
    })
  }

  function handleDrop(targetIdx: number) {
    if (draggedIdx === null || draggedIdx === targetIdx) { setDraggedIdx(null); setDragOverIdx(null); return }
    const draggedGroup = combinedTasks[draggedIdx].group || combinedTasks[draggedIdx].department
    const targetGroup = combinedTasks[targetIdx].group || combinedTasks[targetIdx].department
    if (draggedGroup !== targetGroup) { setDraggedIdx(null); setDragOverIdx(null); return }

    const newTasks = [...combinedTasks]
    const [moved] = newTasks.splice(draggedIdx, 1)
    newTasks.splice(draggedIdx < targetIdx ? targetIdx - 1 : targetIdx, 0, moved)

    const oldToNew: Record<number, number> = {}
    newTasks.forEach((task, newIdx) => { const o = combinedTasks.indexOf(task); if (o !== -1) oldToNew[o] = newIdx })

    const newSelected = new Set<number>()
    selectedTasks.forEach(i => { if (oldToNew[i] !== undefined) newSelected.add(oldToNew[i]) })

    const newOverrides: Record<number, string> = {}
    Object.entries(taskOverrides).forEach(([k, v]) => { const n = oldToNew[parseInt(k)]; if (n !== undefined) newOverrides[n] = v })

    setCombinedTasks(newTasks)
    setSelectedTasks(newSelected)
    setTaskOverrides(newOverrides)
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  function groupToDepartment(groupKey: string): string {
    if (groupKey === 'diseno_web' || groupKey === 'diseno_ads') return 'diseno'
    if (groupKey === 'edicion_video' || groupKey === 'edicion_presentacion') return 'edicion'
    return groupKey
  }

  function addTaskToGroup(groupKey: string) {
    if (!newTaskTitle.trim()) return
    const department = groupToDepartment(groupKey)
    const newTask: CombinedTask = {
      title: newTaskTitle.trim(),
      department,
      priority: 'media',
      isCustom: true,
      group: groupKey,
      phase: inferPhase(newTaskTitle.trim(), department as any),
    }
    const newIdx = combinedTasks.length
    setCombinedTasks(prev => [...prev, newTask])
    setSelectedTasks(prev => new Set([...prev, newIdx]))
    if (deptAssignees[groupKey]) {
      setTaskOverrides(prev => ({ ...prev, [newIdx]: deptAssignees[groupKey] }))
    }
    setNewTaskTitle('')
    setAddingTaskToGroup(null)
  }

  function startEditTask(idx: number) {
    setEditingIdx(idx)
    setEditTitleValue(combinedTasks[idx].title)
    setOpenMenuIdx(null)
  }

  function saveEditTask(idx: number) {
    if (!editTitleValue.trim()) { setEditingIdx(null); return }
    setCombinedTasks(prev => prev.map((t, i) => i === idx ? { ...t, title: editTitleValue.trim() } : t))
    setEditingIdx(null)
  }

  function deleteTaskRow(idx: number) {
    const newTasks = combinedTasks.filter((_, i) => i !== idx)
    const oldToNew: Record<number, number> = {}
    let shift = 0
    combinedTasks.forEach((_, i) => {
      if (i === idx) { shift = 1; return }
      oldToNew[i] = i - shift
    })

    const newSelected = new Set<number>()
    selectedTasks.forEach(i => { if (i !== idx && oldToNew[i] !== undefined) newSelected.add(oldToNew[i]) })

    const newOverrides: Record<number, string> = {}
    Object.entries(taskOverrides).forEach(([k, v]) => {
      const o = Number(k)
      if (o !== idx && oldToNew[o] !== undefined) newOverrides[oldToNew[o]] = v
    })

    setCombinedTasks(newTasks)
    setSelectedTasks(newSelected)
    setTaskOverrides(newOverrides)
    setOpenMenuIdx(null)
  }

  function openComment(idx: number) {
    setCommentingIdx(idx)
    setCommentDraft(combinedTasks[idx].note || '')
    setOpenMenuIdx(null)
  }

  function saveComment(idx: number) {
    setCombinedTasks(prev => prev.map((t, i) => i === idx ? { ...t, note: commentDraft.trim() || undefined } : t))
    setCommentingIdx(null)
  }

  async function handleCreate(tasks?: CombinedTask[]) {
    if (!validateStep1()) return
    setSaving(true)

    let clientId = selectedClientId
    if (mode === 'new') {
      const { data, error: clientErr } = await supabase.from('clients').insert({
        name: newClient.name.trim(),
        company: newClient.company.trim() || newClient.name.trim(),
      }).select().single()
      if (clientErr || !data) { setError('Error al crear el cliente'); setSaving(false); return }
      clientId = data.id

      // Guardar asignaciones de equipo
      if (selectedTeamMembers.length > 0) {
        await supabase.from('client_team_members').insert(
          selectedTeamMembers.map(userId => ({ client_id: clientId, user_id: userId }))
        )
      }
    }

    const { data: project, error: projErr } = await supabase.from('projects').insert({
      client_id: clientId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: 'activo',
      source_template_id: form.templateId === 'otro' ? null : form.templateId,
      recording_mode: form.modalidad,
    }).select().single()
    if (projErr || !project) { setError('Error al crear el proyecto'); setSaving(false); return }

    const tasksToUse = tasks !== undefined ? tasks : combinedTasks
    const selectedList = [...selectedTasks].sort((a, b) => a - b)
    if (selectedList.length > 0) {
      const tasksToInsert = selectedList.map(idx => {
        const t = tasksToUse[idx]
        return {
          project_id: project.id,
          title: t.title,
          department: t.department,
          // Las tareas del departamento cliente siempre son del usuario cliente del proyecto —
          // nunca de quien crea el proyecto ni de alguien del equipo.
          assigned_to: t.department === 'cliente' ? clientUser!.id : (taskOverrides[idx] || deptAssignees[t.group || t.department] || user!.id),
          priority: t.priority,
          status: 'pendiente',
          created_by: user!.id,
          phase: t.phase || inferPhase(t.title, t.department as any),
          source_template_id: form.templateId === 'otro' ? null : form.templateId,
          source_template_key: form.templateId === 'otro' ? null : templateTaskKey({ title: t.title, department: t.department as Department }),
          _note: t.note || null, // no es columna real, se usa abajo para crear el comentario
        }
      })
      const taskRows = tasksToInsert.map(task => ({
        project_id: task.project_id,
        title: task.title,
        department: task.department,
        assigned_to: task.assigned_to,
        priority: task.priority,
        status: task.status,
        created_by: task.created_by,
        phase: task.phase,
        source_template_id: task.source_template_id,
        source_template_key: task.source_template_key,
      }))
      const { data: insertedTasks } = await supabase.from('tasks').insert(taskRows).select('id')

      // Las notas que se escribieron al armar la plantilla se guardan como el primer
      // comentario de cada tarea (para que le lleguen al encargado que la asignó).
      if (insertedTasks && insertedTasks.length === tasksToInsert.length) {
        const commentsToInsert = tasksToInsert
          .map((t, i) => ({ task_id: insertedTasks[i].id, note: t._note }))
          .filter(t => t.note)
          .map(t => ({ task_id: t.task_id, user_id: user!.id, content: t.note as string }))
        if (commentsToInsert.length > 0) {
          await supabase.from('task_comments').insert(commentsToInsert)
        }
      }

      // Agregar asignados a client_team_members para que puedan ver el chat
      const uniqueAssignees = [...new Set(tasksToInsert.map(t => t.assigned_to).filter(Boolean))]
      if (uniqueAssignees.length > 0) {
        const { data: existing } = await supabase
          .from('client_team_members')
          .select('user_id')
          .eq('client_id', clientId)
        const existingIds = new Set((existing || []).map((member: { user_id: string }) => member.user_id))
        const toAdd = uniqueAssignees.filter(id => !existingIds.has(id))
        if (toAdd.length > 0) {
          await supabase.from('client_team_members').insert(
            toAdd.map(userId => ({ client_id: clientId, user_id: userId }))
          )
        }
      }

      // Notificar a cada asignado único (excluyendo al creador)
      const assigneesToNotify = uniqueAssignees.filter(id => id !== user!.id)
      const clientName = mode === 'existing'
        ? clients.find(client => client.id === clientId)?.name || 'un cliente'
        : newClient.name || 'un cliente'
      if (assigneesToNotify.length > 0) {
        await supabase.from('notifications').insert(
          assigneesToNotify.map(userId => ({
            user_id: userId,
            title: '📋 Tienes nuevas tareas',
            message: `Se creó el proyecto "${form.name}" para ${clientName}. Revisa tus tareas asignadas.`,
            type: 'task',
          }))
        )
      }
    }

    onCreated()
    onClose()
  }

  // Group combined tasks by sub-grupo (group ?? department)
  const tasksByGroup: Record<string, Array<{ title: string; idx: number; isCustom: boolean }>> = {}
  combinedTasks.forEach((t, i) => {
    const key = t.group || t.department
    if (!tasksByGroup[key]) tasksByGroup[key] = []
    tasksByGroup[key].push({ title: t.title, idx: i, isCustom: t.isCustom })
  })
  const visibleGroupOrder = [...TEMPLATE_GROUP_ORDER.filter(group => tasksByGroup[group]), ...Object.keys(tasksByGroup).filter(group => !TEMPLATE_GROUP_ORDER.includes(group))]

  const selectedCount = selectedTasks.size
  const selectedTpl = PROJECT_TEMPLATES.find(t => t.id === form.templateId)
    || customTemplates.find(t => t.id === form.templateId)
  const effectiveTaskCount = (templateId: string) => {
    const template = PROJECT_TEMPLATES.find(item => item.id === templateId)
    const stored = storedTemplateTasks.filter(task => task.template_id === templateId)
    return resolveTemplateTasks(
      template,
      stored,
      databaseTemplateIds.has(templateId),
    ).length
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[92vh] ${step === 2 ? 'max-w-3xl' : 'max-w-lg'}`}>

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button onClick={() => setStep(1)} className="text-gray-400 hover:text-gray-600 transition">
                <ChevronLeft size={20} />
              </button>
            )}
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {step === 1 ? 'Nuevo proyecto' : `Selecciona las tareas — ${selectedTpl?.icon} ${selectedTpl?.name}`}
              </h3>
              {step === 2 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedCount} tareas seleccionadas · desmarca las que no apliquen
                  {combinedTasks.some(t => t.isCustom) && (
                    <span className="ml-2 text-blue-500">· 🔖 = tarea fija personalizada</span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div className="p-6 space-y-5 overflow-y-auto">
            {/* Cliente */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Cliente *</label>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => { setMode('existing'); resetBlock() }}
                  className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition ${mode === 'existing' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  Cliente existente
                </button>
                <button type="button" onClick={() => { setMode('new'); resetBlock() }}
                  className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition flex items-center justify-center gap-1 ${mode === 'new' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  <Plus size={14} /> Nuevo cliente
                </button>
              </div>
              {mode === 'existing' ? (
                <select value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); resetBlock() }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Selecciona un cliente</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company && c.company !== c.name ? ` — ${c.company}` : ''}</option>)}
                </select>
              ) : (
                <div className="space-y-3">
                  <input value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })}
                    placeholder="Nombre del cliente *"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={newClient.company} onChange={e => setNewClient({ ...newClient, company: e.target.value })}
                    placeholder="Empresa (opcional)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

                  {/* Equipo asignado a este cliente */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                      Equipo asignado a este cliente
                    </label>
                    <div className="border border-gray-200 rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                      {teamMembers.map(member => {
                        const isSelected = selectedTeamMembers.includes(member.id)
                        return (
                          <label key={member.id}
                            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => setSelectedTeamMembers(prev =>
                                isSelected ? prev.filter(id => id !== member.id) : [...prev, member.id]
                              )}
                              className="w-4 h-4 accent-blue-600"
                            />
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-red-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {member.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-800">{member.full_name}</p>
                              {member.department && (
                                <p className="text-xs text-gray-400 capitalize">{member.department}</p>
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                    {selectedTeamMembers.length > 0 && (
                      <p className="text-xs text-blue-600 mt-1.5 font-medium">
                        {selectedTeamMembers.length} persona{selectedTeamMembers.length > 1 ? 's' : ''} seleccionada{selectedTeamMembers.length > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Nombre del proyecto */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Nombre del proyecto *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Lanzamiento Webinar Q2, Campaña Meta..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Descripción</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2} placeholder="Breve descripción del proyecto..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>

            {/* Tipo de embudo */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Tipo de embudo *</label>
              <div className="grid grid-cols-3 gap-3">
                {PROJECT_TEMPLATES.filter(t => t.id !== 'otro' && !archivedTemplateIds.has(t.id)).map(tpl => (
                  <button key={tpl.id} type="button"
                    onClick={() => setForm({ ...form, templateId: tpl.id })}
                    className={`border-2 rounded-xl p-4 text-left transition cursor-pointer ${
                      form.templateId === tpl.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                    }`}>
                    <p className="text-2xl mb-1">{tpl.icon}</p>
                    <p className="font-semibold text-sm text-gray-800">{tpl.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-tight">{tpl.description}</p>
                    {templatesLoaded && effectiveTaskCount(tpl.id) > 0 && (
                      <p className="text-xs font-semibold text-blue-500 mt-2">{effectiveTaskCount(tpl.id)} tareas</p>
                    )}
                    {!templatesLoaded && <p className="mt-2 text-xs font-medium text-gray-400">Cargando tareas...</p>}
                  </button>
                ))}

                {customTemplates.map(tpl => (
                  <button key={tpl.id} type="button"
                    onClick={() => setForm({ ...form, templateId: tpl.id })}
                    className={`border-2 rounded-xl p-4 text-left transition cursor-pointer ${
                      form.templateId === tpl.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                    }`}>
                    <p className="text-2xl mb-1">{tpl.icon}</p>
                    <p className="font-semibold text-sm text-gray-800">{tpl.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-tight">{tpl.description}</p>
                    {tpl.taskCount > 0 && (
                      <p className="text-xs font-semibold text-blue-500 mt-2">{tpl.taskCount} tareas</p>
                    )}
                  </button>
                ))}

                {PROJECT_TEMPLATES.filter(t => t.id === 'otro' && !archivedTemplateIds.has(t.id)).map(tpl => (
                  <button key={tpl.id} type="button"
                    onClick={() => setForm({ ...form, templateId: tpl.id })}
                    className={`border-2 rounded-xl p-4 text-left transition cursor-pointer ${
                      form.templateId === tpl.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                    }`}>
                    <p className="text-2xl mb-1">{tpl.icon}</p>
                    <p className="font-semibold text-sm text-gray-800">{tpl.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-tight">{tpl.description}</p>
                  </button>
                ))}

                <button type="button" onClick={() => setShowCreateFunnel(true)}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-left transition cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 flex flex-col items-start justify-center">
                  <p className="text-2xl mb-1 text-blue-500"><Plus size={24} /></p>
                  <p className="font-semibold text-sm text-blue-600">Crear embudo nuevo</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-tight">Define sus tareas una sola vez y reúsalo</p>
                </button>
              </div>
            </div>

            {/* Modalidad de grabación — solo aplica a VSL/Webinar */}
            {(form.templateId === 'vsl' || form.templateId === 'webinar') && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Modalidad de grabación *</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setForm({ ...form, modalidad: 'oficina' })}
                    className={`flex-1 py-2 text-sm rounded-lg font-medium transition text-left px-3 ${form.modalidad === 'oficina' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    <span className="block font-semibold">🏢 Oficina</span>
                    <span className={`block text-xs ${form.modalidad === 'oficina' ? 'text-blue-100' : 'text-gray-400'}`}>Grabación es responsable; el cliente solo asiste</span>
                  </button>
                  <button type="button" onClick={() => setForm({ ...form, modalidad: 'remota' })}
                    className={`flex-1 py-2 text-sm rounded-lg font-medium transition text-left px-3 ${form.modalidad === 'remota' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    <span className="block font-semibold">🌐 Remota</span>
                    <span className={`block text-xs ${form.modalidad === 'remota' ? 'text-blue-100' : 'text-gray-400'}`}>El cliente graba y comparte el material</span>
                  </button>
                </div>
              </div>
            )}

            {blockedNoClientUser && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-bold text-orange-800">Primero invita al cliente al portal</p>
                <p className="text-xs text-orange-700">
                  {blockedClientName ? `"${blockedClientName}"` : 'Este cliente'} todavía no tiene una cuenta activa en el portal. Las tareas del departamento Cliente siempre deben ser suyas, así que no se puede crear el proyecto hasta que se registre.
                  {mode === 'new' && ' El cliente ya se guardó — genera su invitación y vuelve a crear el proyecto eligiendo "Cliente existente" cuando ya tenga cuenta.'}
                </p>
                {!inviteLink ? (
                  <button type="button" onClick={inviteBlockedClient} disabled={invitingClient}
                    className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 text-white text-xs font-semibold rounded-lg hover:bg-orange-700 transition disabled:opacity-60">
                    <UserPlus size={13} /> {invitingClient ? 'Generando...' : 'Generar invitación'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-white border border-orange-200 rounded-lg px-3 py-2">
                    <p className="flex-1 truncate font-mono text-xs text-orange-700">{inviteLink}</p>
                    <button type="button" onClick={copyInviteLink} className="shrink-0 flex items-center gap-1 text-xs font-semibold text-orange-700">
                      {inviteCopied ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              {!blockedNoClientUser && (
                <button type="button" onClick={handleContinue} disabled={loadingTasks || !templatesLoaded || checkingClientUser || saving}
                  className="px-6 py-2 bg-gradient-to-r from-blue-700 to-red-600 text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                  {!templatesLoaded ? 'Cargando embudos...' : checkingClientUser ? 'Verificando cliente...' : loadingTasks || saving ? 'Cargando...' : form.templateId === 'otro' && mode === 'existing' ? 'Crear proyecto' : mode === 'new' ? 'Guardar cliente y continuar' : 'Siguiente → Seleccionar tareas'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2: Task selection ── */}
        {step === 2 && (
          <>
            <div className="overflow-y-auto flex-1">
              {visibleGroupOrder.map(groupKey => {
                const groupTasks = tasksByGroup[groupKey]
                const allSel = groupTasks.every(t => selectedTasks.has(t.idx))
                const colorClass = GROUP_COLORS[groupKey] || 'bg-gray-100 text-gray-700 border-gray-200'
                const isCliente = groupKey === 'cliente'
                // Si alguna tarea del grupo tiene override individual, desactivar el selector grupal
                const groupIdxSet = new Set(groupTasks.map(t => t.idx))
                const hasIndividualOverrides = groupTasks.some(t => !!taskOverrides[t.idx])

                return (
                  <div key={groupKey}>
                    <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-y border-gray-100 sticky top-0 z-10">
                      <button onClick={() => toggleDept(groupKey)} className="shrink-0">
                        {allSel
                          ? <CheckSquare size={18} className="text-blue-600" />
                          : <Square size={18} className="text-gray-400" />}
                      </button>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${colorClass}`}>
                        {GROUP_LABELS[groupKey] || DEPT_LABELS[groupKey] || groupKey}
                      </span>
                      <span className="text-xs text-gray-400">
                        {groupTasks.filter(t => selectedTasks.has(t.idx)).length}/{groupTasks.length}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        {isCliente ? (
                          <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg font-medium">
                            👤 {clientUser?.full_name || 'Cliente'} (siempre el cliente)
                          </span>
                        ) : hasIndividualOverrides ? (
                          <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded-lg">
                            Asignación individual activa
                          </span>
                        ) : (
                          <>
                            {/* Persona principal */}
                            <select value={deptAssignees[groupKey] || ''}
                              onChange={e => {
                                setDeptAssignees(prev => ({ ...prev, [groupKey]: e.target.value }))
                                if (!e.target.value) {
                                  setDeptAssignees2(prev => { const n = {...prev}; delete n[groupKey]; return n })
                                  setTaskOverrides(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !groupIdxSet.has(Number(k)))))
                                }
                              }}
                              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                              <option value="">Asignar persona...</option>
                              {allAssignees.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                            </select>

                            {/* Persona 2: solo si hay persona 1 */}
                            {deptAssignees[groupKey] && (
                              deptAssignees2[groupKey] ? (
                                <select value={deptAssignees2[groupKey]}
                                  onChange={e => {
                                    if (!e.target.value) {
                                      setDeptAssignees2(prev => { const n = {...prev}; delete n[groupKey]; return n })
                                      setTaskOverrides(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !groupIdxSet.has(Number(k)))))
                                    } else {
                                      setDeptAssignees2(prev => ({ ...prev, [groupKey]: e.target.value }))
                                    }
                                  }}
                                  className="text-sm border border-purple-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-purple-50 text-purple-700">
                                  <option value="">— quitar</option>
                                  {allAssignees.filter(m => m.id !== deptAssignees[groupKey]).map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                                </select>
                              ) : (
                                <button
                                  onClick={() => setDeptAssignees2(prev => ({ ...prev, [groupKey]: '' }))}
                                  title="Agregar segunda persona a este grupo"
                                  className="flex items-center gap-1 text-xs text-purple-600 border border-purple-200 bg-purple-50 hover:bg-purple-100 px-2 py-1.5 rounded-lg transition shrink-0 font-medium">
                                  <Plus size={12} /> persona
                                </button>
                              )
                            )}
                          </>
                        )}

                        <button
                          onClick={() => {
                            setAddingTaskToGroup(addingTaskToGroup === groupKey ? null : groupKey)
                            setNewTaskTitle('')
                          }}
                          title="Agregar tarea a esta área"
                          className="w-7 h-7 flex items-center justify-center bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition shrink-0">
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>

                    {addingTaskToGroup === groupKey && (
                      <div className="flex items-center gap-2 px-5 py-2.5 bg-blue-50 border-b border-blue-100">
                        <input
                          autoFocus
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') addTaskToGroup(groupKey)
                            if (e.key === 'Escape') { setAddingTaskToGroup(null); setNewTaskTitle('') }
                          }}
                          placeholder="Título de la nueva tarea..."
                          className="flex-1 border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                        <button onClick={() => addTaskToGroup(groupKey)} disabled={!newTaskTitle.trim()}
                          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                          Agregar
                        </button>
                        <button onClick={() => { setAddingTaskToGroup(null); setNewTaskTitle('') }}
                          className="px-3 py-1.5 bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-300 transition">
                          Cancelar
                        </button>
                      </div>
                    )}

                    <div className="divide-y divide-gray-50">
                      {groupTasks.map(task => (
                        <div key={task.idx}
                          draggable
                          onDragStart={() => setDraggedIdx(task.idx)}
                          onDragOver={e => { e.preventDefault(); setDragOverIdx(task.idx) }}
                          onDrop={() => handleDrop(task.idx)}
                          onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null) }}
                          className={`group flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition
                            ${!selectedTasks.has(task.idx) ? 'opacity-40' : ''}
                            ${draggedIdx === task.idx ? 'opacity-25' : ''}
                            ${dragOverIdx === task.idx && draggedIdx !== task.idx ? 'border-t-2 border-blue-400' : ''}
                          `}>
                          <GripVertical size={14}
                            className="text-gray-300 opacity-0 group-hover:opacity-100 transition shrink-0 cursor-grab active:cursor-grabbing" />
                          <input type="checkbox" checked={selectedTasks.has(task.idx)}
                            onChange={() => toggleTask(task.idx)}
                            className="w-4 h-4 accent-blue-600 shrink-0 cursor-pointer" />
                          {editingIdx === task.idx ? (
                            <input
                              autoFocus
                              value={editTitleValue}
                              onChange={e => setEditTitleValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveEditTask(task.idx)
                                if (e.key === 'Escape') setEditingIdx(null)
                              }}
                              onBlur={() => saveEditTask(task.idx)}
                              className="flex-1 text-sm border border-blue-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <span className="text-sm text-gray-700 flex-1 leading-tight">{task.title}</span>
                          )}
                          {task.isCustom && (
                            <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-medium shrink-0">🔖</span>
                          )}
                          {/* Asignación individual por tarea (no disponible en grupo cliente) */}
                          {selectedTasks.has(task.idx) && !isCliente && (
                            <select
                              value={taskOverrides[task.idx] || ''}
                              onChange={e => {
                                if (e.target.value) {
                                  setTaskOverrides(prev => ({ ...prev, [task.idx]: e.target.value }))
                                } else {
                                  setTaskOverrides(prev => { const n = {...prev}; delete n[task.idx]; return n })
                                }
                              }}
                              onClick={e => e.stopPropagation()}
                              className={`text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 shrink-0 ${
                                taskOverrides[task.idx]
                                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 bg-white text-gray-400'
                              }`}>
                              <option value="">👤 Individual...</option>
                              {allAssignees.map(m => <option key={m.id} value={m.id}>{m.full_name.split(' ')[0]}</option>)}
                            </select>
                          )}

                          {/* Comentario / nota de la tarea */}
                          <button type="button" onClick={() => openComment(task.idx)}
                            title={combinedTasks[task.idx].note ? 'Ver/editar comentario' : 'Agregar comentario'}
                            className={`shrink-0 p-1 rounded transition ${combinedTasks[task.idx].note ? 'text-blue-500' : 'text-gray-300 hover:text-gray-500'}`}>
                            <MessageSquare size={14} />
                          </button>

                          {/* Menú de 3 puntos: editar / eliminar */}
                          <div className="relative shrink-0">
                            <button type="button" onClick={() => setOpenMenuIdx(openMenuIdx === task.idx ? null : task.idx)}
                              className="p-1 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition">
                              <MoreVertical size={14} />
                            </button>
                            {openMenuIdx === task.idx && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenMenuIdx(null)} />
                                <div className="absolute right-0 top-6 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[150px]">
                                  <button type="button" onClick={() => startEditTask(task.idx)}
                                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
                                    <Pencil size={12} /> Editar tarea
                                  </button>
                                  <button type="button" onClick={() => deleteTaskRow(task.idx)}
                                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                                    <Trash2 size={12} /> Eliminar
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-gray-100 p-4 bg-white shrink-0 flex items-center justify-between gap-4">
              <div className="text-sm text-gray-500">
                <span className="font-semibold text-gray-800">{selectedCount}</span> tareas se crearán
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">← Volver</button>
                <button onClick={() => handleCreate()} disabled={saving || selectedCount === 0}
                  className="px-6 py-2 bg-gradient-to-r from-blue-700 to-red-600 text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                  {saving ? 'Creando...' : `Crear proyecto con ${selectedCount} tareas`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {commentingIdx !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onClick={() => setCommentingIdx(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-gray-800 mb-1">Comentario para la tarea</p>
            <p className="text-xs text-gray-400 mb-3 truncate">{combinedTasks[commentingIdx]?.title}</p>
            <textarea
              autoFocus
              value={commentDraft}
              onChange={e => setCommentDraft(e.target.value)}
              rows={4}
              placeholder="Escribe una nota o instrucción para esta tarea..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setCommentingIdx(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              <button onClick={() => saveComment(commentingIdx)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateFunnel && (
        <CreateFunnelTemplateModal
          onClose={() => setShowCreateFunnel(false)}
          onCreated={handleFunnelCreated}
        />
      )}
    </div>
  )
}

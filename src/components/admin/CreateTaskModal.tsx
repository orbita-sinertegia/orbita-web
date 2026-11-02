import { useEffect, useState } from 'react'
import { ChevronDown, FileUp, Link2, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Project, User, Priority, Department } from '../../types'
import { PROJECT_TEMPLATES, templateTaskKey } from '../../data/projectTemplates'

interface TemplateOption {
  id: string
  name: string
  icon: string
}

interface StoredProjectTemplate extends TemplateOption {
  archived?: boolean
}

interface Props {
  projects: Project[]
  teamMembers: User[]
  defaultProjectId?: string
  prefillTitle?: string
  onClose: () => void
  onCreated: () => void
}

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'edicion', label: 'Edición' },
  { value: 'grabacion', label: 'Grabación' },
  { value: 'diseno', label: 'Diseño' },
  { value: 'copy', label: 'Copy' },
  { value: 'webmaster', label: 'Webmaster' },
  { value: 'trafficker', label: 'Trafficker' },
  { value: 'lider', label: 'Líder de Proyecto' },
  { value: 'cliente', label: 'Tarea del Cliente' },
]

function mergeAssignableMembers(currentUser: User | null, members: User[]) {
  const byId = new Map(members.map(member => [member.id, member]))
  if (currentUser) byId.set(currentUser.id, currentUser)
  return [...byId.values()].sort((a, b) => {
    if (a.id === currentUser?.id) return -1
    if (b.id === currentUser?.id) return 1
    return a.full_name.localeCompare(b.full_name, 'es')
  })
}

export default function CreateTaskModal({ projects, teamMembers, defaultProjectId, prefillTitle, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const [assignableMembers, setAssignableMembers] = useState<User[]>(() => mergeAssignableMembers(user, teamMembers))
  const [form, setForm] = useState({
    project_id: defaultProjectId || '',
    title: prefillTitle || '',
    description: '',
    assigned_to: '',
    approver_ids: user?.id ? [user.id] : [] as string[],
    department: '' as Department,
    priority: 'media' as Priority,
    start_date: '',
    needed_date: '',
    commitment_date: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveToTemplate, setSaveToTemplate] = useState(false)
  const [templateType, setTemplateType] = useState('')
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [referenceLinks, setReferenceLinks] = useState<Array<{ label: string; url: string }>>([])
  const [linkDraft, setLinkDraft] = useState({ label: '', url: '' })
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    async function loadAssignableMembers() {
      const { data, error: membersError } = await supabase
        .from('users')
        .select('*')
        .in('role', ['admin', 'team'])
        .eq('active', true)
        .order('full_name')

      if (membersError) {
        setAssignableMembers(mergeAssignableMembers(user, teamMembers))
        return
      }
      setAssignableMembers(mergeAssignableMembers(user, (data || []) as User[]))
    }

    void loadAssignableMembers()
  }, [teamMembers, user])

  const selectedProject = projects.find(p => p.id === form.project_id)
  const projectClientUserId = selectedProject?.client?.user_id || ''

  // Las tareas del departamento cliente siempre son del usuario cliente del proyecto —
  // se fijan automáticamente y no se pueden reasignar a nadie del equipo.
  useEffect(() => {
    if (form.department === 'cliente' && form.assigned_to !== projectClientUserId) {
      setForm(current => ({ ...current, assigned_to: projectClientUserId }))
    }
  }, [form.department, projectClientUserId])

  useEffect(() => {
    async function loadTemplateOptions() {
      setTemplatesLoading(true)
      const { data, error: templatesError } = await supabase
        .from('project_templates')
        .select('id, name, icon, archived')
        .order('created_at')

      if (templatesError) {
        setError('No se pudieron cargar los embudos disponibles. Cierra esta ventana e intenta de nuevo.')
        setTemplatesLoading(false)
        return
      }

      const stored = (data || []) as StoredProjectTemplate[]
      const builtIns = PROJECT_TEMPLATES
        .filter(template => template.id !== 'otro' && stored.find(item => item.id === template.id)?.archived !== true)
        .map(template => {
          const override = stored.find(item => item.id === template.id)
          return { id: template.id, name: override?.name || template.name, icon: override?.icon || template.icon }
        })
      const custom = stored
        .filter(template => !template.archived && template.id !== 'otro' && !PROJECT_TEMPLATES.some(item => item.id === template.id))
        .map(({ id, name, icon }) => ({ id, name, icon }))
      const options = [...builtIns, ...custom]

      setTemplateOptions(options)
      setTemplateType(current => options.some(option => option.id === current) ? current : (options[0]?.id || ''))
      setTemplatesLoading(false)
    }

    void loadTemplateOptions()
  }, [])

  function addReferenceLink() {
    const url = linkDraft.url.trim()
    if (!url) return
    try {
      new URL(url)
    } catch {
      setError('Escribe un link válido, por ejemplo https://drive.google.com/...')
      return
    }
    setReferenceLinks(current => [...current, {
      label: linkDraft.label.trim() || new URL(url).hostname.replace(/^www\./, ''),
      url,
    }])
    setLinkDraft({ label: '', url: '' })
    setError('')
  }

  function addFiles(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files)
    if (selected.some(file => file.size > 20 * 1024 * 1024)) {
      setError('Cada archivo debe pesar máximo 20 MB')
      return
    }
    setPendingFiles(current => [...current, ...selected])
    setError('')
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.project_id || !form.title || !form.assigned_to || form.approver_ids.length === 0 || !form.department) {
      setError('Por favor completa todos los campos requeridos')
      return
    }
    if (form.department === 'cliente' && (!projectClientUserId || form.assigned_to !== projectClientUserId)) {
      setError('Este proyecto no tiene un usuario de cliente activo; invita al cliente al portal antes de crear tareas de su departamento.')
      return
    }
    if (referenceLinks.length === 0 && pendingFiles.length === 0) {
      setError('Agrega al menos un entregable: un enlace o un archivo')
      return
    }
    if (saveToTemplate && (!templateType || templatesLoading)) {
      setError('Selecciona el embudo donde quieres fijar esta tarea')
      return
    }
    setSaving(true)
    const { data: createdTask, error: err } = await supabase.from('tasks').insert({
      project_id: form.project_id,
      title: form.title,
      description: form.description || null,
      assigned_to: form.assigned_to,
      approver_id: form.approver_ids[0],
      approver_ids: form.approver_ids,
      department: form.department,
      priority: form.priority,
      status: 'pendiente',
      start_date: form.start_date || null,
      needed_date: form.needed_date || null,
      commitment_date: form.commitment_date || null,
      created_by: user!.id,
    }).select('id').single()
    if (err) { setError('Error al crear la tarea'); setSaving(false); return }

    if (referenceLinks.length > 0) {
      const { error: linksError } = await supabase.from('task_links').insert(
        referenceLinks.map(link => ({ task_id: createdTask.id, label: link.label, url: link.url }))
      )
      if (linksError) {
        setError('La tarea se creó, pero no se pudieron guardar sus links. Abre la tarea para agregarlos.')
        setSaving(false)
        return
      }
    }

    for (const file of pendingFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
      const path = `task-deliverables/${createdTask.id}/${Date.now()}_${safeName}`
      const { error: uploadError } = await supabase.storage.from('chat-files').upload(path, file, { contentType: file.type || undefined })
      if (uploadError) {
        setError(`La tarea se creó, pero no se pudo subir ${file.name}. Abre la tarea para intentarlo nuevamente.`)
        setSaving(false)
        return
      }
      const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(path)
      const { error: fileLinkError } = await supabase.from('task_links').insert({ task_id: createdTask.id, label: file.name, url: publicUrl })
      if (fileLinkError) {
        setError(`El archivo ${file.name} subió, pero no pudo vincularse a la tarea.`)
        setSaving(false)
        return
      }
    }

    // Guardar en plantilla si se marcó
    if (saveToTemplate && form.title && form.department) {
      const { error: templateError } = await supabase.from('template_tasks').insert({
        title: form.title,
        department: form.department,
        priority: form.priority,
        template_id: templateType,
      })
      if (templateError) {
        setError(`La tarea se creó, pero no se pudo fijar en el embudo: ${templateError.message}`)
        setSaving(false)
        return
      }
      const { error: sourceError } = await supabase.from('tasks').update({
        source_template_id: templateType,
        source_template_key: templateTaskKey({ title: form.title, department: form.department }),
      }).eq('id', createdTask.id)
      if (sourceError) {
        setError(`La tarea se fijó en el embudo, pero no pudo vincularse para sincronizar cambios: ${sourceError.message}`)
        setSaving(false)
        return
      }
    }

    // Notificaciones al asignado y al cliente
    const project = projects.find(p => p.id === form.project_id)
    const notifs: Array<{ user_id: string; title: string; message: string; type: string; task_id: string }> = []

    if (form.assigned_to) {
      notifs.push({
        user_id: form.assigned_to,
        title: '📋 Nueva tarea asignada',
        message: `"${form.title}" — ${project?.client?.name || project?.name || 'Proyecto'}`,
        type: 'task',
        task_id: createdTask.id,
      })
    }

    form.approver_ids.filter(id => id !== form.assigned_to).forEach(approverId => {
      notifs.push({
        user_id: approverId,
        title: 'Tarea pendiente de tu autorización',
        message: `Cuando "${form.title}" sea entregada, te llegará para revisión y autorización.`,
        type: 'review',
        task_id: createdTask.id,
      })
    })

    if (project?.client?.user_id) {
      notifs.push({
        user_id: project.client.user_id,
        title: '📋 Nueva tarea en tu proyecto',
        message: `"${form.title}" — ${project?.name || 'Tu proyecto'}`,
        type: 'task',
        task_id: createdTask.id,
      })
    }

    if (notifs.length > 0) {
      await supabase.from('notifications').insert(notifs)
    }

    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">Nueva tarea</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <form onSubmit={handleCreate} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Proyecto / Cliente *</label>
            <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona un proyecto</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.client?.name} — {p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Título de la tarea *</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="Ej: Editar 3 videos para campaña"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Descripción</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2} placeholder="Detalle de la tarea..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Entregables *</label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)_auto]">
              <input value={linkDraft.label} onChange={event => setLinkDraft(current => ({ ...current, label: event.target.value }))} placeholder="Nombre (opcional)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="url" value={linkDraft.url} onChange={event => setLinkDraft(current => ({ ...current, url: event.target.value }))} placeholder="https://..." className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={addReferenceLink} disabled={!linkDraft.url.trim()} className="grid h-10 w-10 place-items-center rounded-lg bg-blue-600 text-white disabled:opacity-40" title="Agregar link"><Plus size={18} /></button>
            </div>
            {referenceLinks.length > 0 && <div className="mt-2 space-y-2">{referenceLinks.map((link, index) => <div key={`${link.url}-${index}`} className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2"><Link2 size={14} className="shrink-0 text-blue-600" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-blue-800">{link.label}</p><p className="truncate text-[11px] text-blue-500">{link.url}</p></div><button type="button" onClick={() => setReferenceLinks(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-gray-400 hover:text-red-500" title="Quitar link"><Trash2 size={14} /></button></div>)}</div>}
            <input id="new-task-deliverables" type="file" multiple className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.zip,.mp4,.mov" onChange={event => { addFiles(event.target.files); event.target.value = '' }} />
            <label htmlFor="new-task-deliverables" className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-500 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"><FileUp size={16} /> Subir archivo (imagen, PDF, Word, .html, etc.)</label>
            {pendingFiles.length > 0 && <div className="mt-2 space-y-2">{pendingFiles.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"><FileUp size={14} className="shrink-0 text-gray-500" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700">{file.name}</span><button type="button" onClick={() => setPendingFiles(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-gray-400 hover:text-red-500" title="Quitar archivo"><Trash2 size={14} /></button></div>)}</div>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Asignar a *</label>
              {form.department === 'cliente' ? (
                projectClientUserId ? (
                  <div className="w-full border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm text-blue-700 font-medium">
                    👤 {selectedProject?.client?.name || 'Cliente'} (siempre el cliente)
                  </div>
                ) : (
                  <div className="w-full border border-red-200 bg-red-50 rounded-lg px-3 py-2 text-xs text-red-600">
                    Este proyecto no tiene un usuario de cliente activo. Invítalo al portal antes de crear tareas de su departamento.
                  </div>
                )
              ) : (
                <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Selecciona persona</option>
                  {assignableMembers.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}{member.id === user?.id ? ' (yo)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Departamento *</label>
              <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value as Department })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Selecciona</option>
                {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-blue-700 mb-1 uppercase tracking-wide">Quiénes revisan y autorizan *</label>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border-2 border-blue-200 bg-blue-50 p-2">
              {assignableMembers.map(member => {
                const checked = form.approver_ids.includes(member.id)
                return (
                  <label key={member.id} className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm transition ${checked ? 'bg-blue-600 font-semibold text-white' : 'bg-white text-gray-700 hover:bg-blue-100'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setForm(current => ({
                        ...current,
                        approver_ids: checked
                          ? current.approver_ids.filter(id => id !== member.id)
                          : [...current.approver_ids, member.id],
                      }))}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <span>{member.full_name}{member.id === user?.id ? ' (yo)' : ''}</span>
                  </label>
                )
              })}
            </div>
            <p className="mt-1 text-xs text-blue-600">Selecciona una o varias personas. A todas les aparecerá la tarea y cualquiera podrá aprobarla o solicitar cambios.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Prioridad</label>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as Priority })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="critica">🔴 Crítica</option>
              <option value="alta">🟠 Alta</option>
              <option value="media">🟡 Media</option>
              <option value="baja">🟢 Baja</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Fecha de inicio</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-orange-600 mb-1 uppercase tracking-wide">📅 La necesito para (Líder)</label>
              <input type="date" value={form.needed_date} onChange={e => setForm({ ...form, needed_date: e.target.value })}
                className="w-full border-2 border-orange-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-green-700 mb-1 uppercase tracking-wide">📆 Fecha de entrega</label>
            <input type="date" value={form.commitment_date} onChange={e => setForm({ ...form, commitment_date: e.target.value })}
              className="w-full border-2 border-green-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-green-50" />
            <p className="text-xs text-green-600 mt-1">Fecha acordada para entregar esta tarea.</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50">
            <button type="button" onClick={() => setAdvancedOpen(open => !open)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700">
              Más opciones
              <ChevronDown size={17} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </button>
            {advancedOpen && <div className="border-t border-gray-200 p-4">
              <div className={`border-2 rounded-xl p-4 transition ${saveToTemplate ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}`}>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={saveToTemplate} onChange={e => setSaveToTemplate(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  <div>
                    <p className="text-sm font-semibold text-gray-700">🔖 Fijar en plantilla para futuros proyectos</p>
                    <p className="text-xs text-gray-400">Esta tarea aparecerá automáticamente la próxima vez que crees un proyecto de ese tipo</p>
                  </div>
                </label>
                {saveToTemplate && (
                  <div className="mt-3">
                    {templatesLoading ? (
                      <p className="text-xs font-medium text-gray-500">Cargando embudos...</p>
                    ) : templateOptions.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {templateOptions.map(template => (
                          <button key={template.id} type="button" onClick={() => setTemplateType(template.id)} className={`min-w-0 rounded-lg px-3 py-2 text-sm font-medium transition ${templateType === template.id ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
                            <span className="block truncate">{template.icon} {template.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-medium text-red-600">No hay embudos disponibles.</p>
                    )}
                  </div>
                )}
              </div>
            </div>}
          </div>

          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 bg-gradient-to-r from-blue-700 to-red-600 text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
              {saving ? 'Creando...' : 'Crear tarea'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

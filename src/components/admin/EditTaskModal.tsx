import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Department, Priority, Project, Task, User } from '../../types'
import { PHASES, PHASE_LABELS } from '../../data/projectTemplates'
import { buildTaskChanges, friendlyTaskError, type TaskFormValues } from '../../lib/adminTasks'

interface Props {
  task: Task
  onClose: () => void
  onSaved: (updatedTask: Task) => void
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

function mergeMembers(extra: User | undefined, members: User[]) {
  const byId = new Map(members.map(member => [member.id, member]))
  if (extra) byId.set(extra.id, extra)
  return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
}

export default function EditTaskModal({ task, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const [assignableMembers, setAssignableMembers] = useState<User[]>(() => mergeMembers(task.assignee, []))
  const [projects, setProjects] = useState<Project[]>(() => (task.project ? [task.project] : []))
  const [projectTasks, setProjectTasks] = useState<Task[]>([])
  const [form, setForm] = useState<TaskFormValues>({
    title: task.title,
    description: task.description || '',
    assigned_to: task.assigned_to,
    department: task.department,
    priority: task.priority,
    phase: task.phase || '',
    start_date: task.start_date || '',
    needed_date: task.needed_date || '',
    commitment_date: task.commitment_date || '',
    approver_ids: task.approver_ids?.length ? task.approver_ids : (task.approver_id ? [task.approver_id] : []),
    depends_on_task_id: task.depends_on_task_id || '',
    project_id: task.project_id,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('users')
      .select('*')
      .in('role', ['admin', 'team'])
      .eq('active', true)
      .order('full_name')
      .then(({ data, error: membersError }) => {
        if (membersError) return
        setAssignableMembers(mergeMembers(task.assignee, (data || []) as User[]))
      })
  }, [task.assignee])

  useEffect(() => {
    supabase
      .from('projects')
      .select('*, client:clients(*)')
      .order('created_at', { ascending: false })
      .then(({ data, error: projectsError }) => {
        if (projectsError) return
        setProjects((data || []) as Project[])
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    const query = form.project_id
      ? supabase.from('tasks').select('id, title, status').eq('project_id', form.project_id).neq('id', task.id).is('archived_at', null)
      : Promise.resolve({ data: [] as Pick<Task, 'id' | 'title' | 'status'>[] })
    query.then(({ data }) => { if (!cancelled) setProjectTasks((data as Task[]) || []) })
    return () => { cancelled = true }
  }, [form.project_id, task.id])

  const selectedProject = projects.find(p => p.id === form.project_id)
  const projectClientUserId = selectedProject?.client?.user_id || ''

  function clientUserIdFor(projectId: string) {
    return projects.find(p => p.id === projectId)?.client?.user_id || ''
  }

  function changeDepartment(nextDepartment: Department) {
    setForm(current => ({
      ...current,
      department: nextDepartment,
      assigned_to: nextDepartment === 'cliente' ? clientUserIdFor(current.project_id) : current.assigned_to,
    }))
  }

  function changeProject(nextProjectId: string) {
    setForm(current => ({
      ...current,
      project_id: nextProjectId,
      assigned_to: current.department === 'cliente' ? clientUserIdFor(nextProjectId) : current.assigned_to,
    }))
  }

  const changes = buildTaskChanges(task, form)
  const hasChanges = Object.keys(changes).length > 0

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { setError('El título no puede estar vacío'); return }
    if (form.department !== 'cliente' && form.approver_ids.length === 0) { setError('Selecciona al menos una persona que revise y autorice'); return }
    if (form.department === 'cliente' && (!projectClientUserId || form.assigned_to !== projectClientUserId)) {
      setError('Este proyecto no tiene un usuario de cliente activo; invita al cliente al portal antes de mover tareas a su departamento.')
      return
    }
    if (!hasChanges) { setError('No hay cambios'); return }

    setSaving(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('admin_update_task', { p_task_id: task.id, p_changes: changes })
    setSaving(false)
    if (rpcError) {
      setError(friendlyTaskError(rpcError.message))
      return
    }
    onSaved(data as Task)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">Editar tarea</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Proyecto / Cliente</label>
            <select value={form.project_id} onChange={e => changeProject(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {projects.map(p => <option key={p.id} value={p.id}>{p.client?.name} — {p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Título de la tarea *</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Descripción</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
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
                    Este proyecto no tiene un usuario de cliente activo.
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
              <select value={form.department} onChange={e => changeDepartment(e.target.value as Department)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
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
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Fase de la hoja de ruta</label>
              <select value={form.phase} onChange={e => setForm({ ...form, phase: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Automática (según título)</option>
                {PHASES.map(phase => <option key={phase} value={phase}>{PHASE_LABELS[phase]}</option>)}
              </select>
            </div>
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
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Depende de</label>
            <select value={form.depends_on_task_id} onChange={e => setForm({ ...form, depends_on_task_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Ninguna</option>
              {projectTasks.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === 'completada' ? ' ✓' : ''}</option>)}
            </select>
          </div>

          {error && <p role="alert" className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 bg-gradient-to-r from-blue-700 to-red-600 text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

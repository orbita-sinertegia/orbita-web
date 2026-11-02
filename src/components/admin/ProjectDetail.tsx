import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Archive, Plus, ChevronDown, Pencil, Check, X, MoreVertical, Trash2, Map as MapIcon, ListChecks } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, Project, User } from '../../types'
import PriorityBadge from '../shared/PriorityBadge'
import StatusBadge from '../shared/StatusBadge'
import ProgressBar from '../shared/ProgressBar'
import TaskDetailModal from '../team/TaskDetailModal'
import CreateTaskModal from './CreateTaskModal'
import EditTaskModal from './EditTaskModal'
import ArchiveTaskModal from './ArchiveTaskModal'
import { isClientAttributableDelay } from '../../lib/taskDelays'
import ClientRoadmapView, { type DelayEventLike } from '../roadmap/ClientRoadmapView'

interface Props {
  project: Project
  tasks: Task[]
  teamMembers: User[]
  projects: Project[]
  onBack: () => void
  onUpdate: () => void
}

const DEPT_LABELS: Record<string, string> = {
  edicion: 'Edición', grabacion: 'Grabación', diseno: 'Diseño',
  copy: 'Copy', webmaster: 'Webmaster', trafficker: 'Trafficker',
  lider: 'Líder', cliente: 'Cliente',
}

const STATUS_OPTIONS = [
  { value: 'activo', label: 'Activo', color: 'bg-green-100 text-green-700' },
  { value: 'pausado', label: 'Pausado', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'completado', label: 'Completado', color: 'bg-gray-100 text-gray-600' },
]

const REVIEW_BADGES: Record<string, { label: string; color: string }> = {
  pendiente_revision: { label: '🔍 En revisión', color: 'bg-yellow-100 text-yellow-700' },
  en_revision: { label: '🔍 Revisando', color: 'bg-orange-100 text-orange-700' },
  aprobada: { label: '✅ Aprobada', color: 'bg-green-100 text-green-700' },
}

export default function ProjectDetail({ project, tasks, teamMembers, projects, onBack, onUpdate }: Props) {
  const { user } = useAuth()
  // Admin = rol admin o super admin (igual que is_active_admin() en SQL).
  const isAdmin = user?.role === 'admin' || !!user?.is_super_admin
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [archivingTask, setArchivingTask] = useState<Task | null>(null)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(project.status)
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [editDesc, setEditDesc] = useState(project.description || '')
  const [editRecordingMode, setEditRecordingMode] = useState(project.recording_mode || 'oficina')
  const [editLaunchDate, setEditLaunchDate] = useState(project.launch_date || '')
  const [savingName, setSavingName] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('todos')
  const [filterDept, setFilterDept] = useState<string>('todos')
  const [filterPerson, setFilterPerson] = useState<string>('todos')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)
  const [tab, setTab] = useState<'tareas' | 'hoja_ruta'>('tareas')
  const [delayEvents, setDelayEvents] = useState<DelayEventLike[]>([])
  const actionsRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    supabase.from('project_delay_events').select('id, task_id, responsible, days, reason, created_at')
      .eq('project_id', project.id).order('created_at', { ascending: false })
      .then(({ data }) => setDelayEvents((data as DelayEventLike[]) || []))
  }, [project.id])

  useEffect(() => {
    function handleOpenTask(event: Event) {
      const taskId = (event as CustomEvent).detail?.taskId
      const found = tasks.find(task => task.id === taskId)
      if (found) setSelectedTask(found)
    }
    window.addEventListener('open-task', handleOpenTask)
    return () => window.removeEventListener('open-task', handleOpenTask)
  }, [tasks])

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false)
        setStatusOpen(false)
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActionsOpen(false)
        setStatusOpen(false)
        if (!busyRef.current) setShowDeleteConfirm(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  function startEditing() {
    setEditName(project.name)
    setEditDesc(project.description || '')
    setEditRecordingMode(project.recording_mode || 'oficina')
    setEditLaunchDate(project.launch_date || '')
    setActionError('')
    setActionsOpen(false)
    setEditingName(true)
  }

  const completed = tasks.filter(t => t.status === 'completada').length
  const pct = tasks.length ? (completed / tasks.length) * 100 : 0
  const overdue = tasks.filter(t => t.commitment_date && t.status !== 'completada' && new Date(t.commitment_date) < new Date() && !isClientAttributableDelay(t))
  const clientDelays = tasks.filter(t => isClientAttributableDelay(t) && t.status !== 'completada')
  const launchDelta = project.launch_date && project.launch_date_original
    ? Math.round((new Date(project.launch_date).getTime() - new Date(project.launch_date_original).getTime()) / 86400000)
    : 0

  async function saveProjectName() {
    if (!editName.trim() || busyRef.current) return
    busyRef.current = true
    setSavingName(true)
    setActionError('')
    try {
      const launchChanged = editLaunchDate && editLaunchDate !== project.launch_date
      const { error } = await supabase.from('projects').update({
        name: editName.trim(),
        description: editDesc.trim() || null,
        recording_mode: editRecordingMode,
        launch_date: editLaunchDate || null,
        // La modalidad no modifica tareas existentes — solo se ajustan manualmente si aplica.
        ...(launchChanged && !project.launch_date_original ? { launch_date_original: editLaunchDate } : {}),
      }).eq('id', project.id).select('id').single()
      if (error) throw error
      setEditName(editName.trim())
      setEditDesc(editDesc.trim())
      setEditingName(false)
      onUpdate()
    } catch {
      setActionError('No se pudieron guardar los cambios. Intenta de nuevo.')
    } finally {
      busyRef.current = false
      setSavingName(false)
    }
  }

  async function changeProjectStatus(newStatus: 'activo' | 'pausado' | 'completado') {
    if (busyRef.current) return
    busyRef.current = true
    setSavingStatus(true)
    setActionError('')
    try {
      const { error } = await supabase.from('projects').update({ status: newStatus }).eq('id', project.id).select('id').single()
      if (error) throw error
      setCurrentStatus(newStatus)
      setStatusOpen(false)
      onUpdate()
    } catch {
      setActionError('No se pudo cambiar el estado del proyecto. Intenta de nuevo.')
    } finally {
      busyRef.current = false
      setSavingStatus(false)
    }
  }

  async function deleteProject() {
    if (busyRef.current) return
    busyRef.current = true
    setDeleting(true)
    setActionError('')
    try {
      const { data, error } = await supabase.rpc('admin_delete_project', { p_project_id: project.id })
      if (error || data !== project.id) throw error || new Error('Eliminación sin confirmar')
      setShowDeleteConfirm(false)
      onBack()
      onUpdate()
    } catch {
      setActionError('No se pudo eliminar el proyecto. No se confirmó ningún borrado. Intenta de nuevo o contacta al administrador.')
    } finally {
      busyRef.current = false
      setDeleting(false)
    }
  }

  const statusOpt = STATUS_OPTIONS.find(s => s.value === currentStatus) || STATUS_OPTIONS[0]

  const filteredTasks = tasks.filter(t => {
    if (filterStatus === 'todos' && t.status === 'completada') return false
    if (filterStatus !== 'todos' && t.status !== filterStatus) return false
    if (filterDept !== 'todos' && t.department !== filterDept) return false
    if (filterPerson !== 'todos' && t.assigned_to !== filterPerson) return false
    return true
  })

  const departments = [...new Set(tasks.map(t => t.department))].filter(Boolean)

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition">
        <ArrowLeft size={15} /> Volver a proyectos
      </button>

      {/* Header del proyecto */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{project.client?.name}</p>
            {editingName ? (
              <div className="mt-1 space-y-2">
                <input
                  aria-label="Nombre del proyecto"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  autoFocus
                  className="w-full text-xl font-bold text-gray-900 border border-blue-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  aria-label="Descripción del proyecto"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  placeholder="Descripción (opcional)"
                  className="w-full text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <select
                    aria-label="Modalidad de grabación"
                    value={editRecordingMode}
                    onChange={e => setEditRecordingMode(e.target.value as 'oficina' | 'remota')}
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="oficina">🏢 Grabación en oficina</option>
                    <option value="remota">🌐 Grabación remota</option>
                  </select>
                  <input
                    aria-label="Fecha de lanzamiento"
                    type="date"
                    value={editLaunchDate}
                    onChange={e => setEditLaunchDate(e.target.value)}
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-gray-400">Cambiar la modalidad no modifica las tareas ya creadas — ajusta manualmente las que correspondan.</p>
                <div className="flex gap-2">
                  <button onClick={saveProjectName} disabled={savingName || !editName.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
                    <Check size={13} /> {savingName ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button disabled={savingName} onClick={() => { setEditingName(false); setEditName(project.name); setEditDesc(project.description || ''); setActionError('') }}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50 transition">
                    <X size={13} /> Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 mt-0.5 group">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{editName}</h3>
                  {editDesc && <p className="text-sm text-gray-500 mt-1">{editDesc}</p>}
                </div>
                <button onClick={startEditing} disabled={deleting || savingStatus}
                  title="Editar nombre del proyecto"
                  className="opacity-0 group-hover:opacity-100 transition mt-1 p-1 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 shrink-0">
                  <Pencil size={14} />
                </button>
              </div>
            )}
          </div>
          {/* Estado clickeable */}
          <div ref={actionsRef} className="relative flex items-center gap-2 shrink-0">
            <button disabled={deleting || savingName || savingStatus} onClick={() => { setStatusOpen(!statusOpen); setActionsOpen(false) }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition ${statusOpt.color}`}>
              {statusOpt.label}
              <ChevronDown size={12} />
            </button>
            <button type="button" aria-label="Opciones del proyecto" aria-expanded={actionsOpen} aria-controls="project-actions" disabled={deleting || savingName || savingStatus}
              onClick={() => { setActionsOpen(!actionsOpen); setStatusOpen(false) }}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition disabled:opacity-50">
              <MoreVertical size={20} />
            </button>
            {actionsOpen && (
              <div id="project-actions" className="absolute right-0 top-10 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-52 py-1">
                <button type="button" onClick={startEditing} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                  <Pencil size={15} /> Editar proyecto
                </button>
                <button type="button" onClick={() => { setActionsOpen(false); setActionError(''); setShowDeleteConfirm(true) }} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                  <Trash2 size={15} /> Eliminar proyecto
                </button>
              </div>
            )}
            {statusOpen && (
              <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-lg z-10 min-w-[140px] py-1">
                {STATUS_OPTIONS.map(opt => (
                  <button key={opt.value} disabled={savingStatus || opt.value === currentStatus} onClick={() => changeProjectStatus(opt.value as 'activo' | 'pausado' | 'completado')}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 font-medium ${opt.value === currentStatus ? 'opacity-50 cursor-default' : ''}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {deleting && <p role="status" className="text-sm text-gray-500 mb-3">Eliminando proyecto y tareas...</p>}
        {actionError && <p role="alert" className="text-sm text-red-600 mb-3">{actionError}</p>}
        <ProgressBar percentage={pct} />
        <div className="flex gap-6 mt-4 text-sm text-gray-500 flex-wrap">
          <span>{completed}/{tasks.length} tareas completadas</span>
          {overdue.length > 0 && <span className="text-red-600 font-semibold">⚠ {overdue.length} vencida{overdue.length > 1 ? 's' : ''}</span>}
          {clientDelays.length > 0 && <span className="text-orange-600 font-semibold">🕐 {clientDelays.length} retraso{clientDelays.length > 1 ? 's' : ''} atribuible{clientDelays.length > 1 ? 's' : ''} al cliente</span>}
          <span className="text-gray-400">{tasks.filter(t => !t.commitment_date).length} sin fecha de compromiso</span>
          {project.launch_date && (
            <span className="text-gray-500">
              🚀 Lanzamiento: {new Date(project.launch_date + 'T00:00:00').toLocaleDateString('es-MX')}
              {project.launch_date_original && launchDelta > 0 && (
                <> ({new Date(project.launch_date_original + 'T00:00:00').toLocaleDateString('es-MX')}, +{launchDelta} día{launchDelta > 1 ? 's' : ''} por retraso del cliente)</>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Pestañas: tareas / hoja de ruta del cliente */}
      <div className="mb-4 inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <button type="button" onClick={() => setTab('tareas')} className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === 'tareas' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
          <ListChecks size={14} /> Tareas
        </button>
        <button type="button" onClick={() => setTab('hoja_ruta')} className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === 'hoja_ruta' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
          <MapIcon size={14} /> Hoja de ruta del cliente
        </button>
      </div>

      {tab === 'hoja_ruta' && (
        <ClientRoadmapView project={project} tasks={tasks} delayEvents={delayEvents} mode="interno" />
      )}

      {tab === 'tareas' && (
      <>
      {/* Filtros + botón nueva tarea */}
      <div className="flex flex-wrap gap-2 mb-4 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_progreso">En progreso</option>
            <option value="completada">Completada</option>
            <option value="bloqueada">Bloqueada</option>
          </select>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">Todos los deptos</option>
            {departments.map(d => <option key={d} value={d}>{DEPT_LABELS[d] || d}</option>)}
          </select>
          <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">Todas las personas</option>
            {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </div>
        <button onClick={() => setShowCreateTask(true)}
          className="flex items-center gap-1.5 bg-gradient-to-r from-blue-700 to-red-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90 transition">
          <Plus size={14} /> Nueva tarea
        </button>
      </div>

      {/* Tabla de tareas */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h4 className="font-semibold text-gray-800">
            Tareas del proyecto
            {filteredTasks.length !== tasks.length && (
              <span className="ml-2 text-xs text-gray-400 font-normal">({filteredTasks.length} de {tasks.length})</span>
            )}
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Tarea</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Asignado a</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Depto</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Estatus</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Prioridad</th>
                <th className="text-left px-4 py-3 font-semibold text-orange-500">La necesito para</th>
                <th className="text-left px-4 py-3 font-semibold text-blue-500">Mi compromiso</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Fecha de entrega</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Revisión</th>
                {isAdmin && <th className="text-right px-4 py-3 font-semibold text-gray-500">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredTasks.length === 0 && (
                <tr><td colSpan={isAdmin ? 10 : 9} className="text-center py-8 text-gray-400">No hay tareas con estos filtros</td></tr>
              )}
              {filteredTasks.map(task => {
                const isLate = task.commitment_date && task.status !== 'completada' && new Date(task.commitment_date) < new Date()
                const noCommitment = !task.commitment_date && task.status !== 'completada'
                const reviewBadge = task.review_status ? REVIEW_BADGES[task.review_status] : null
                return (
                  <tr key={task.id} onClick={() => setSelectedTask(task)}
                    className={`cursor-pointer hover:bg-gray-50 transition ${isLate ? 'bg-red-50' : noCommitment ? 'bg-orange-50/40' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800 max-w-[180px] truncate">{task.title}</td>
                    <td className="px-4 py-3 text-gray-600">{task.assignee?.full_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{task.department ? DEPT_LABELS[task.department] : '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                    <td className="px-4 py-3"><PriorityBadge priority={task.priority} /></td>
                    <td className="px-4 py-3 text-xs text-orange-600 font-medium">
                      {task.needed_date ? new Date(task.needed_date + 'T00:00:00').toLocaleDateString('es-MX') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {task.commitment_date ? (
                        <span className={`text-xs font-semibold ${isLate ? 'text-red-600' : 'text-blue-600'}`}>
                          {new Date(task.commitment_date + 'T00:00:00').toLocaleDateString('es-MX')}
                          {isLate && ' ⚠️'}
                        </span>
                      ) : (
                        <span className="text-xs text-orange-400 font-medium">Sin fecha</span>
                      )}
                      {isClientAttributableDelay(task) && (
                        <span className="block text-[10px] font-semibold text-orange-600 mt-0.5">Retraso atribuible al cliente</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {task.completion_date ? new Date(task.completion_date + 'T00:00:00').toLocaleDateString('es-MX') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {reviewBadge
                        ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${reviewBadge.color}`}>{reviewBadge.label}</span>
                        : <span className="text-xs text-gray-300">—</span>
                      }
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingTask(task)} title="Editar tarea" className="rounded-lg border border-blue-200 p-1.5 text-blue-600 hover:bg-blue-50"><Pencil size={14} /></button>
                          <button type="button" onClick={() => setArchivingTask(task)} title="Archivar tarea" className="rounded-lg border border-amber-200 p-1.5 text-amber-600 hover:bg-amber-50"><Archive size={14} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {selectedTask && (
        <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} onUpdate={onUpdate} />
      )}

      {editingTask && (
        <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onSaved={() => { setEditingTask(null); onUpdate() }} />
      )}

      {archivingTask && (
        <ArchiveTaskModal task={archivingTask} onClose={() => setArchivingTask(null)} onArchived={() => { setArchivingTask(null); onUpdate() }} />
      )}

      {showCreateTask && (
        <CreateTaskModal
          projects={projects}
          teamMembers={teamMembers}
          defaultProjectId={project.id}
          onClose={() => setShowCreateTask(false)}
          onCreated={onUpdate}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => {
          if (event.target === event.currentTarget && !deleting) setShowDeleteConfirm(false)
        }}>
          <div role="dialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-description"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="border-b border-red-100 bg-gradient-to-r from-red-50 to-orange-50 px-6 py-5">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <Trash2 size={21} />
                </div>
                <div>
                  <h2 id="delete-project-title" className="text-lg font-bold text-gray-900">Eliminar proyecto</h2>
                  <p className="mt-1 text-sm text-gray-600">Esta acción es permanente y no se puede deshacer.</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5">
              <p id="delete-project-description" className="text-sm leading-6 text-gray-600">
                Se eliminará el proyecto <span className="font-bold text-gray-900">{project.name}</span> y sus <span className="font-bold text-gray-900">{tasks.length} tareas</span>, incluidas las completadas.
              </p>
              <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                También se eliminarán sus subtareas, comentarios, enlaces, valoraciones y registros de tiempo. La cuenta del cliente y sus otros proyectos se conservarán.
              </div>
              {actionError && <p role="alert" className="mt-4 text-sm font-medium text-red-600">{actionError}</p>}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => { setShowDeleteConfirm(false); setActionError('') }} disabled={deleting}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={deleteProject} disabled={deleting}
                className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60">
                <Trash2 size={16} /> {deleting ? 'Eliminando...' : 'Sí, eliminar proyecto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

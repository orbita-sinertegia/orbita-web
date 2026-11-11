import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Archive, CheckCircle2, Plus, ChevronDown, Pencil, Check, X, MoreVertical, Trash2, Map as MapIcon, ListChecks } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { isDateKeyOverdue } from '../../lib/dates'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, Project, User } from '../../types'
import PriorityBadge from '../shared/PriorityBadge'
import StatusBadge from '../shared/StatusBadge'
import ProgressBar from '../shared/ProgressBar'
import TaskDetailModal from '../team/TaskDetailModal'
import CreateTaskModal from './CreateTaskModal'
import EditTaskModal from './EditTaskModal'
import DeleteTaskModal from './DeleteTaskModal'
import BulkTaskActionModal from './BulkTaskActionModal'
import TaskSelectionBar, { TaskCheckbox } from './TaskSelectionBar'
import { InlineDateCell, InlineSelectCell } from './InlineTaskCell'
import { canBulkQuickComplete, canQuickComplete, quickCompleteArgs, quickCompleteNotice, quickUndoNotice, undoQuickCompleteArgs, type QuickCompleteUndo } from '../../lib/quickComplete'
import { friendlyTaskError } from '../../lib/adminTasks'
import { INLINE_DEPARTMENTS, INLINE_PRIORITIES, activeAssignableMembers, addOverride, applyOverrides, buildInlineChange, canInlineEditTask, inlineErrorNotice, inlineFieldLocked, optimisticPatch, removeOverride, type InlineField, type TaskOverrides } from '../../lib/inlineTaskEdit'
import { bulkResultNotice, selectAllState, toggleSelectAll, toggleSelected, visibleSelection, type BulkResult, type BulkTaskAction, type BulkTaskRef } from '../../lib/taskSelection'
import { isClientAttributableDelay } from '../../lib/taskDelays'
import { PROJECT_STATUS_HINTS, PROJECT_STATUS_LABELS, canChangeProjectStatus, canDeleteProjects, canDeleteTasks, taskDeletedNotice, FINALIZE_ARCHIVE_MARKER, finalizeChoiceText, finalizeCounts, finalizeDeleteWarning, finalizeResultNotice, reactivateNotice, type FinalizeCounts, type FinalizeMode, type ProjectStatus } from '../../lib/projectStatus'
import ClientRoadmapView, { type DelayEventLike } from '../roadmap/ClientRoadmapView'
import UpcomingMeetings from '../roadmap/UpcomingMeetings'

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

// 'completado' en la base = "Finalizado" en pantalla (el cliente ya no trabaja con nosotros).
const STATUS_OPTIONS: { value: ProjectStatus; label: string; color: string }[] = [
  { value: 'activo', label: PROJECT_STATUS_LABELS.activo, color: 'bg-green-100 text-green-700' },
  { value: 'pausado', label: PROJECT_STATUS_LABELS.pausado, color: 'bg-yellow-100 text-yellow-700' },
  { value: 'completado', label: PROJECT_STATUS_LABELS.completado, color: 'bg-gray-200 text-gray-700' },
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
  // Activo / Pausado / Finalizado y eliminar el proyecto: solo el super admin (la base también lo exige).
  const canChangeStatus = canChangeProjectStatus(user)
  const canDeleteProject = canDeleteProjects(user)
  // Borrar una tarea definitivamente: solo administradores.
  const canDeleteTask = canDeleteTasks(user)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(project.status)
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [editDesc, setEditDesc] = useState(project.description || '')
  const [editRecordingMode, setEditRecordingMode] = useState(project.recording_mode || 'oficina')
  const [editLaunchDate, setEditLaunchDate] = useState(project.launch_date || '')
  // Etapa y tipo de embudo: solo si la base ya tiene las columnas (sql/2026-11-02_etapa_proyecto.sql).
  // (El proyecto se lee con select('*'): si trae la llave, la columna existe.)
  const [savingName, setSavingName] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('abiertas')
  const [filterDept, setFilterDept] = useState<string>('todos')
  const [filterPerson, setFilterPerson] = useState<string>('todos')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)
  const [statusNotice, setStatusNotice] = useState('')
  // Confirmación de Finalizado: cuántas tareas pendientes se eliminarían (null = contando).
  // counts null = contando; confirmDelete = segunda confirmación de "Eliminar para siempre".
  const [finalizeConfirm, setFinalizeConfirm] = useState<{ counts: FinalizeCounts | null; confirmDelete: boolean } | null>(null)
  const [tab, setTab] = useState<'tareas' | 'hoja_ruta'>('tareas')
  const [delayEvents, setDelayEvents] = useState<DelayEventLike[]>([])
  // Selección múltiple para actuar sobre varias de una.
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkAction, setBulkAction] = useState<{ action: BulkTaskAction; tasks: BulkTaskRef[] } | null>(null)
  // Edición en línea (Asignado a, Depto, Prioridad, La necesito para): cambios optimistas.
  const [taskOverrides, setTaskOverrides] = useState<TaskOverrides>({})
  // TEMPORAL (ENABLE_QUICK_COMPLETE): palomita verde "marcar realizada" con aviso para deshacer.
  const [quickUndo, setQuickUndo] = useState<QuickCompleteUndo | null>(null)
  const [quickBusyId, setQuickBusyId] = useState('')
  // Mismas personas que el lápiz: admins y equipo activos.
  const [assignableMembers, setAssignableMembers] = useState<User[] | null>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('users').select('*').in('role', ['admin', 'team']).eq('active', true).order('full_name')
      .then(({ data, error }) => { if (!error && data) setAssignableMembers(activeAssignableMembers(data as User[])) })
  }, [isAdmin])

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
        if (!busyRef.current) { setShowDeleteConfirm(false); setFinalizeConfirm(null) }
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
  const overdue = tasks.filter(t => t.commitment_date && t.status !== 'completada' && isDateKeyOverdue(t.commitment_date) && !isClientAttributableDelay(t))
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

  function statusErrorMessage(error: unknown, fallback: string) {
    const message = (error as { message?: string } | null)?.message || ''
    if (/super admin/i.test(message)) return 'Solo el super admin puede cambiar el estado del proyecto.'
    if (/could not find the function|does not exist/i.test(message)) return 'Falta actualizar la base de datos (sql/2026-11-02_finalizar_elegir.sql). No se cambió nada.'
    return fallback
  }

  /** Activo / Pausado (también reactivar un finalizado: la base restaura lo archivado al finalizar). */
  async function changeProjectStatus(newStatus: ProjectStatus) {
    if (busyRef.current || !canChangeStatus) return
    busyRef.current = true
    setSavingStatus(true)
    setActionError('')
    setStatusNotice('')
    const reactivating = currentStatus === 'completado' && newStatus !== 'completado'
    try {
      const markedBefore = reactivating ? await countFinalizeArchived() : null
      const { error } = await supabase.from('projects').update({ status: newStatus }).eq('id', project.id).select('id').single()
      if (error) throw error
      setCurrentStatus(newStatus)
      setStatusOpen(false)
      if (reactivating) {
        // El trigger projects_reactivate_restore restaura; aquí solo se cuenta.
        const markedAfter = await countFinalizeArchived()
        setStatusNotice(reactivateNotice(markedBefore !== null && markedAfter !== null ? Math.max(0, markedBefore - markedAfter) : null))
      }
      onUpdate()
    } catch (error) {
      setActionError(statusErrorMessage(error, 'No se pudo cambiar el estado del proyecto. Intenta de nuevo.'))
    } finally {
      busyRef.current = false
      setSavingStatus(false)
    }
  }

  /** Finalizar eligiendo qué pasa con las pendientes (RPC finalize_project). */
  async function finalizeProject(mode: FinalizeMode) {
    if (busyRef.current || !canChangeStatus) return
    busyRef.current = true
    setSavingStatus(true)
    setActionError('')
    setStatusNotice('')
    try {
      const { data, error } = await supabase.rpc('finalize_project', { p_project_id: project.id, p_mode: mode })
      if (error) throw error
      setCurrentStatus('completado')
      setStatusOpen(false)
      setFinalizeConfirm(null)
      setStatusNotice(finalizeResultNotice(mode, typeof data === 'number' ? data : null))
      onUpdate()
    } catch (error) {
      setActionError(statusErrorMessage(error, 'No se pudo finalizar el proyecto. No se cambió nada. Intenta de nuevo.'))
    } finally {
      busyRef.current = false
      setSavingStatus(false)
    }
  }

  /** Pendientes no entregadas del proyecto (archivadas aparte). null si no se pudo contar. */
  async function countPendingOnFinalize(): Promise<FinalizeCounts | null> {
    try {
      const { data, error } = await supabase.from('tasks').select('id, status, review_status, archived_at').eq('project_id', project.id)
      if (error || !Array.isArray(data)) return null
      return finalizeCounts(data as Pick<Task, 'status' | 'review_status' | 'archived_at'>[])
    } catch {
      return null
    }
  }

  /** Tareas archivadas por la finalización (se restauran al reactivar). null si no se pudo contar. */
  async function countFinalizeArchived(): Promise<number | null> {
    try {
      const { count, error } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('project_id', project.id).eq('archived_via', FINALIZE_ARCHIVE_MARKER).not('archived_at', 'is', null)
      if (error || typeof count !== 'number') return null
      return count
    } catch {
      return null
    }
  }

  async function openFinalizeConfirm() {
    if (!canChangeStatus || busyRef.current) return
    setStatusOpen(false)
    setActionError('')
    setFinalizeConfirm({ counts: null, confirmDelete: false })
    const counted = await countPendingOnFinalize()
    // Si no se pudo consultar, se usa lo que ya está en pantalla (sin archivadas).
    setFinalizeConfirm(current => current && { ...current, counts: counted ?? finalizeCounts(tasks) })
  }

  function pickStatus(value: ProjectStatus) {
    if (value === 'completado' && currentStatus !== 'completado') void openFinalizeConfirm()
    else void changeProjectStatus(value)
  }

  useEffect(() => {
    if (!statusNotice) return
    const timer = window.setTimeout(() => setStatusNotice(''), 8000)
    return () => window.clearTimeout(timer)
  }, [statusNotice])

  useEffect(() => {
    if (!quickUndo) return
    const timer = window.setTimeout(() => setQuickUndo(null), 10000)
    return () => window.clearTimeout(timer)
  }, [quickUndo])

  async function deleteProject() {
    if (busyRef.current || !canDeleteProject) return
    busyRef.current = true
    setDeleting(true)
    setActionError('')
    try {
      const { data, error } = await supabase.rpc('admin_delete_project', { p_project_id: project.id })
      if (error || data !== project.id) throw error || new Error('Eliminación sin confirmar')
      setShowDeleteConfirm(false)
      onBack()
      onUpdate()
    } catch (error) {
      const message = (error as { message?: string } | null)?.message || ''
      setActionError(/super admin/i.test(message)
        ? 'Solo el super admin puede eliminar proyectos. No se borró nada.'
        : 'No se pudo eliminar el proyecto. No se confirmó ningún borrado. Intenta de nuevo o contacta al administrador.')
    } finally {
      busyRef.current = false
      setDeleting(false)
    }
  }

  const statusOpt = STATUS_OPTIONS.find(s => s.value === currentStatus) || STATUS_OPTIONS[0]

  // Mientras carga la lista de la base (admins + equipo activos): el equipo activo y yo.
  const assignableOptions = assignableMembers ?? activeAssignableMembers([...teamMembers, ...(user ? [user] : [])])

  /** Guarda un campo en línea con la misma RPC que el lápiz (admin_update_task: notifica reasignaciones). */
  async function saveInline(task: Task, field: InlineField, rawValue: string) {
    if (!canInlineEditTask(user, task) || inlineFieldLocked(task, field)) return
    const changes = buildInlineChange(task, field, rawValue)
    if (!changes) return
    const patch = optimisticPatch(changes, assignableOptions)
    setTaskOverrides(prev => addOverride(prev, task.id, patch))
    const { error } = await supabase.rpc('admin_update_task', { p_task_id: task.id, p_changes: changes })
    if (error) {
      setTaskOverrides(prev => removeOverride(prev, task.id, patch))
      setStatusNotice(inlineErrorNotice(field, friendlyTaskError(error.message)))
      return
    }
    await Promise.resolve(onUpdate())
    setTaskOverrides(prev => removeOverride(prev, task.id, patch))
  }

  /** TEMPORAL: marcar realizada de un clic (super admin), misma RPC que el editor de estatus. */
  async function quickComplete(task: Task) {
    if (!canQuickComplete(user, task) || quickBusyId) return
    setQuickBusyId(task.id)
    const { error } = await supabase.rpc('super_admin_set_task_status', quickCompleteArgs(task.id))
    setQuickBusyId('')
    if (error) {
      setQuickUndo(null)
      setStatusNotice(`No se pudo marcar como realizada: ${friendlyTaskError(error.message)}`)
      return
    }
    setStatusNotice('')
    setQuickUndo({ taskId: task.id, title: task.title, previousStatus: task.status })
    onUpdate()
  }

  async function undoQuickComplete() {
    const undo = quickUndo
    if (!undo) return
    setQuickUndo(null)
    const { error } = await supabase.rpc('super_admin_set_task_status', undoQuickCompleteArgs(undo.taskId, undo.previousStatus))
    setStatusNotice(error ? `No se pudo deshacer: ${friendlyTaskError(error.message)}` : quickUndoNotice(undo.title))
    onUpdate()
  }

  const displayTasks = applyOverrides(tasks, taskOverrides)
  const filteredTasks = displayTasks.filter(t => {
    if (filterStatus === 'abiertas' && t.status === 'completada') return false
    if (filterStatus !== 'abiertas' && filterStatus !== 'todas' && t.status !== filterStatus) return false
    if (filterDept !== 'todos' && t.department !== filterDept) return false
    if (filterPerson !== 'todos' && t.assigned_to !== filterPerson) return false
    return true
  })

  // Selección múltiple (casilla junto al nombre): solo cuentan las tareas visibles con los filtros.
  const visibleTaskIds = filteredTasks.map(t => t.id)
  const selectedVisibleIds = visibleSelection(selectedTaskIds, visibleTaskIds)
  const selectedVisibleTasks = filteredTasks.filter(t => selectedVisibleIds.includes(t.id))
  const allState = selectAllState(selectedTaskIds, visibleTaskIds)

  function openBulk(action: BulkTaskAction) {
    if (!selectedVisibleTasks.length) return
    // Foto de la selección al abrir: si la lista se refresca a media acción, no cambia.
    setBulkAction({ action, tasks: selectedVisibleTasks.map(t => ({ id: t.id, title: t.title, department: t.department, status: t.status, assigned_to: t.assigned_to, needed_date: t.needed_date || null })) })
  }

  function handleBulkDone(result: BulkResult) {
    setBulkAction(null)
    // Las que fallaron se quedan seleccionadas para reintentar; las demás se limpian.
    setSelectedTaskIds(result.failed.map(item => item.id))
    setStatusNotice(bulkResultNotice(result))
    onUpdate()
  }

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
            {canChangeStatus ? (
              <button type="button" aria-label={`Estado del proyecto: ${statusOpt.label}. Cambiar`} aria-expanded={statusOpen}
                disabled={deleting || savingName || savingStatus} onClick={() => { setStatusOpen(!statusOpen); setActionsOpen(false) }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition ${statusOpt.color}`}>
                {statusOpt.label}
                <ChevronDown size={12} />
              </button>
            ) : (
              <span title="Solo el super admin puede cambiar el estado" className={`px-3 py-1 rounded-full text-xs font-semibold ${statusOpt.color}`}>
                {statusOpt.label}
              </span>
            )}
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
                {canDeleteProject && (
                  <button type="button" onClick={() => { setActionsOpen(false); setActionError(''); setShowDeleteConfirm(true) }} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                    <Trash2 size={15} /> Eliminar proyecto
                  </button>
                )}
              </div>
            )}
            {statusOpen && canChangeStatus && (
              <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-lg z-10 w-72 py-1">
                {STATUS_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" disabled={savingStatus || opt.value === currentStatus} onClick={() => pickStatus(opt.value)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-50 ${opt.value === currentStatus ? 'opacity-50 cursor-default' : ''}`}>
                    <span className="block text-sm font-semibold text-gray-800">{opt.label}</span>
                    <span className="block text-xs text-gray-500">{PROJECT_STATUS_HINTS[opt.value]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {deleting && <p role="status" className="text-sm text-gray-500 mb-3">Eliminando proyecto y tareas...</p>}
        {actionError && <p role="alert" className="text-sm text-red-600 mb-3">{actionError}</p>}
        {currentStatus === 'completado' && (
          <p className="text-sm text-gray-600 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 mb-3">
            Proyecto finalizado: aquí se conservan las realizadas y las entregadas. Si sus pendientes se archivaron, vuelven al reactivarlo; si se eliminaron, no.
          </p>
        )}
        {currentStatus === 'pausado' && (
          <p className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-3">
            Proyecto pausado: sigue visible, pero sin fechas estimadas.
          </p>
        )}
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
        <>
          <UpcomingMeetings projectId={project.id} />
          <ClientRoadmapView project={project} tasks={tasks} delayEvents={delayEvents} mode="interno" />
        </>
      )}

      {tab === 'tareas' && (
      <>
      {/* Filtros + botón nueva tarea */}
      <div className="flex flex-wrap gap-2 mb-4 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="abiertas">Sin completadas</option>
            <option value="todas">Todas (con completadas)</option>
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
          className="flex items-center gap-1.5 bg-gradient-to-r from-blue-700 to-blue-500 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90 transition">
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
        {isAdmin && (
          <TaskSelectionBar
            count={selectedVisibleIds.length}
            canDelete={canDeleteTask}
            onDelete={() => openBulk('eliminar')}
            onClear={() => setSelectedTaskIds([])}
            canComplete={canBulkQuickComplete(user)}
            onComplete={() => openBulk('completar')}
            canEdit={isAdmin}
            onReassign={() => openBulk('reasignar')}
            onSetNeeded={() => openBulk('necesito')}
          />
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {isAdmin && (
                  <th className="w-10 pl-4 pr-0 py-3">
                    <TaskCheckbox state={allState} onToggle={() => setSelectedTaskIds(prev => toggleSelectAll(prev, visibleTaskIds))}
                      label={allState === 'all' ? 'Quitar selección de todas' : 'Seleccionar todas las tareas visibles'} />
                  </th>
                )}
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
                <tr><td colSpan={isAdmin ? 11 : 9} className="text-center py-8 text-gray-400">No hay tareas con estos filtros</td></tr>
              )}
              {filteredTasks.map(task => {
                const isLate = task.status !== 'completada' && isDateKeyOverdue(task.commitment_date)
                const noCommitment = !task.commitment_date && task.status !== 'completada'
                const reviewBadge = task.review_status ? REVIEW_BADGES[task.review_status] : null
                return (
                  <tr key={task.id} onClick={() => setSelectedTask(task)}
                    className={`cursor-pointer hover:bg-gray-50 transition ${selectedVisibleIds.includes(task.id) ? 'bg-blue-50/70' : isLate ? 'bg-red-50' : noCommitment ? 'bg-orange-50/40' : ''}`}>
                    {isAdmin && (
                      <td className="w-10 pl-4 pr-0 py-3" onClick={event => event.stopPropagation()}>
                        <TaskCheckbox state={selectedVisibleIds.includes(task.id)} onToggle={() => setSelectedTaskIds(prev => toggleSelected(prev, task.id))}
                          label={`Seleccionar tarea ${task.title}`} />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-gray-800 max-w-[180px] truncate">{task.title}</td>
                    {(() => {
                      const editable = canInlineEditTask(user, task)
                      const assigneeText = <span className="truncate">{task.assignee?.full_name || '—'}</span>
                      const deptText = <span>{task.department ? DEPT_LABELS[task.department] : '—'}</span>
                      const neededText = <span>{task.needed_date ? new Date(task.needed_date + 'T00:00:00').toLocaleDateString('es-MX') : '—'}</span>
                      return (
                        <>
                          <td className="px-4 py-3 text-gray-600" onClick={editable && !inlineFieldLocked(task, 'assigned_to') ? event => event.stopPropagation() : undefined}>
                            {editable && !inlineFieldLocked(task, 'assigned_to')
                              ? <InlineSelectCell label={`persona asignada de ${task.title}`} value={task.assigned_to || ''} display={assigneeText} placeholder="Selecciona persona"
                                  options={assignableOptions.map(m => ({ value: m.id, label: `${m.full_name}${m.id === user?.id ? ' (yo)' : ''}` }))}
                                  onSave={value => { void saveInline(task, 'assigned_to', value) }} />
                              : assigneeText}
                          </td>
                          <td className="px-4 py-3 text-gray-500" onClick={editable && !inlineFieldLocked(task, 'department') ? event => event.stopPropagation() : undefined}>
                            {editable && !inlineFieldLocked(task, 'department')
                              ? <InlineSelectCell label={`departamento de ${task.title}`} value={task.department || ''} display={deptText} placeholder="Selecciona departamento"
                                  options={INLINE_DEPARTMENTS} onSave={value => { void saveInline(task, 'department', value) }} />
                              : deptText}
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                          <td className="px-4 py-3" onClick={editable ? event => event.stopPropagation() : undefined}>
                            {editable
                              ? <InlineSelectCell label={`prioridad de ${task.title}`} value={task.priority} display={<PriorityBadge priority={task.priority} />}
                                  options={INLINE_PRIORITIES} onSave={value => { void saveInline(task, 'priority', value) }} />
                              : <PriorityBadge priority={task.priority} />}
                          </td>
                          <td className="px-4 py-3 text-xs text-orange-600 font-medium" onClick={editable ? event => event.stopPropagation() : undefined}>
                            {editable
                              ? <InlineDateCell label={`fecha "La necesito para" de ${task.title}`} value={(task.needed_date || '').slice(0, 10)} display={neededText}
                                  onSave={value => { void saveInline(task, 'needed_date', value) }} />
                              : neededText}
                          </td>
                        </>
                      )
                    })()}
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
                          {canDeleteTask && <button type="button" onClick={() => setDeletingTask(task)} title="Borrar definitivamente" aria-label={`Borrar definitivamente ${task.title}`} className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>}
                          {canQuickComplete(user, task) && <button type="button" disabled={quickBusyId === task.id} onClick={() => { void quickComplete(task) }} title="Marcar como realizada" aria-label={`Marcar como realizada ${task.title}`} className="rounded-lg border border-emerald-200 p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"><CheckCircle2 size={14} /></button>}
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

      {deletingTask && canDeleteTask && (
        <DeleteTaskModal task={deletingTask} onClose={() => setDeletingTask(null)} onDeleted={title => { setDeletingTask(null); setStatusNotice(taskDeletedNotice(title)); onUpdate() }} />
      )}

      {bulkAction && isAdmin && (bulkAction.action === 'reasignar' || bulkAction.action === 'necesito' || (bulkAction.action === 'eliminar' && canDeleteTask) || (bulkAction.action === 'completar' && canBulkQuickComplete(user))) && (
        <BulkTaskActionModal
          action={bulkAction.action}
          tasks={bulkAction.tasks}
          members={assignableOptions}
          canEditCompleted={canChangeStatus}
          onClose={() => setBulkAction(null)}
          onDone={handleBulkDone}
        />
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

      {quickUndo && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[91] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-xl bg-emerald-700 px-4 py-3 text-sm text-white shadow-2xl">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{quickCompleteNotice(quickUndo.title)}</span>
          <button type="button" onClick={() => { void undoQuickComplete() }} className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold hover:bg-white/25">Deshacer</button>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setQuickUndo(null)} className="text-emerald-100 hover:text-white"><X size={14} /></button>
        </div>
      )}

      {statusNotice && (
        <div role="status" className="fixed bottom-6 right-6 z-[90] flex max-w-sm items-start gap-3 rounded-xl border border-gray-200 bg-gray-900 px-4 py-3 text-sm text-white shadow-2xl">
          <span>{statusNotice}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setStatusNotice('')} className="text-gray-300 hover:text-white"><X size={14} /></button>
        </div>
      )}

      {finalizeConfirm && canChangeStatus && (() => {
        const counts = finalizeConfirm.counts
        const hasPending = !!counts && counts.active + counts.archived > 0
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => {
            if (event.target === event.currentTarget && !savingStatus) setFinalizeConfirm(null)
          }}>
            <div role="dialog" aria-modal="true" aria-labelledby="finalize-project-title" aria-describedby="finalize-project-description"
              className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
              <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-amber-50 px-6 py-5">
                <h2 id="finalize-project-title" className="text-lg font-bold text-gray-900">Finalizar {project.name}</h2>
                <p className="mt-1 text-sm text-gray-600">El cliente ya no trabaja con nosotros.</p>
              </div>
              <div className="px-6 py-5">
                {finalizeConfirm.confirmDelete && counts ? (
                  <p id="finalize-project-description" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{finalizeDeleteWarning(counts)}</p>
                ) : (
                  <p id="finalize-project-description" className="text-sm leading-6 text-gray-700">{finalizeChoiceText(counts)}</p>
                )}
                {actionError && <p role="alert" className="mt-4 text-sm font-medium text-red-600">{actionError}</p>}
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => { setFinalizeConfirm(null); setActionError('') }} disabled={savingStatus}
                  className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                  Cancelar
                </button>
                {finalizeConfirm.confirmDelete && counts ? (
                  <button type="button" onClick={() => finalizeProject('borrar')} disabled={savingStatus}
                    className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60">
                    <Trash2 size={16} /> {savingStatus ? 'Eliminando...' : `Sí, eliminar ${counts.active + counts.archived} para siempre`}
                  </button>
                ) : hasPending ? (
                  <>
                    <button type="button" onClick={() => setFinalizeConfirm(current => current && { ...current, confirmDelete: true })} disabled={savingStatus}
                      className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50">
                      Eliminar para siempre
                    </button>
                    <button type="button" onClick={() => finalizeProject('archivar')} disabled={savingStatus}
                      className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">
                      <Archive size={16} /> {savingStatus ? 'Archivando...' : 'Archivar (se pueden recuperar)'}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => finalizeProject('archivar')} disabled={savingStatus || !counts}
                    className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">
                    {savingStatus ? 'Finalizando...' : 'Sí, finalizar'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {showDeleteConfirm && canDeleteProject && (
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

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, Eye, MessageSquare, Pencil, Search, Trash2, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, TaskStatus, User } from '../../types'
import { countUndatedByAssignee } from '../../lib/missingDates'
import { friendlyTaskError } from '../../lib/adminTasks'
import PriorityBadge from '../shared/PriorityBadge'
import StatusBadge from '../shared/StatusBadge'
import UserAvatar from '../shared/UserAvatar'
import TaskDetailModal from '../team/TaskDetailModal'
import EditTaskModal from './EditTaskModal'
import DeleteTaskModal from './DeleteTaskModal'
import { canChangeProjectStatus, canDeleteTasks, taskDeletedNotice } from '../../lib/projectStatus'
import BulkTaskActionModal from './BulkTaskActionModal'
import TaskSelectionBar, { TaskCheckbox } from './TaskSelectionBar'
import { InlineSelectCell } from './InlineTaskCell'
import { canBulkQuickComplete } from '../../lib/quickComplete'
import { INLINE_PRIORITIES, activeAssignableMembers, addOverride, applyOverrides, buildInlineChange, canInlineEditTask, inlineErrorNotice, inlineFieldLocked, optimisticPatch, removeOverride, type InlineField, type TaskOverrides } from '../../lib/inlineTaskEdit'
import { bulkResultNotice, selectAllState, toggleSelectAll, toggleSelected, visibleSelection, type BulkResult, type BulkTaskAction, type BulkTaskRef } from '../../lib/taskSelection'

interface Props {
  teamMembers: User[]
  tasks: Task[]
  onTasksChange: () => void | Promise<void>
}

type StatusFilter = 'activas' | TaskStatus | 'todas'
type TaskCommentSummary = {
  id: string
  task_id: string
  content: string
  created_at: string
  user?: { full_name?: string } | null
}

function mergeMembers(currentUser: User | null, members: User[]) {
  const byId = new Map(members.map(member => [member.id, member]))
  if (currentUser) byId.set(currentUser.id, currentUser)
  return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
}

export default function TeamTasksManager({ teamMembers, tasks, onTasksChange }: Props) {
  const { user } = useAuth()
  // Admin = rol admin o super admin (igual que is_active_admin() en SQL).
  const isAdmin = user?.role === 'admin' || !!user?.is_super_admin
  const [selectedMemberId, setSelectedMemberId] = useState('all')
  const [memberSearch, setMemberSearch] = useState('')
  const [taskSearch, setTaskSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('activas')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [busyTaskId, setBusyTaskId] = useState('')
  const [error, setError] = useState('')
  const [comments, setComments] = useState<TaskCommentSummary[]>([])
  const [eligibleMembers, setEligibleMembers] = useState<User[]>(() => mergeMembers(
    user,
    [...teamMembers, ...tasks.flatMap(task => task.assignee ? [task.assignee] : [])],
  ))
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  // Borrar una tarea definitivamente: solo administradores.
  const canDeleteTask = canDeleteTasks(user)
  const [superDeleteTask, setSuperDeleteTask] = useState<Task | null>(null)
  const [deleteNotice, setDeleteNotice] = useState('')
  // Selección múltiple (casilla junto al nombre) para actuar sobre varias de una.
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkAction, setBulkAction] = useState<{ action: BulkTaskAction; tasks: BulkTaskRef[] } | null>(null)
  // Edición en línea en las tarjetas (persona asignada y prioridad): cambios optimistas.
  const [taskOverrides, setTaskOverrides] = useState<TaskOverrides>({})

  useEffect(() => {
    let cancelled = false
    supabase
      .from('users')
      .select('*')
      .in('role', ['admin', 'team'])
      .eq('active', true)
      .order('full_name')
      .then(({ data, error: membersError }) => {
        if (cancelled) return
        const fallback = [...teamMembers, ...tasks.flatMap(task => task.assignee ? [task.assignee] : [])]
        setEligibleMembers(mergeMembers(user, membersError ? fallback : (data || []) as User[]))
      })
    return () => { cancelled = true }
  }, [teamMembers, tasks, user])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('task_comments')
      .select('id, task_id, content, created_at, user:users!user_id(full_name)')
      .order('created_at', { ascending: false })
      .then(({ data, error: commentsError }) => {
        if (cancelled) return
        if (commentsError) {
          setError(`No se pudieron cargar los comentarios: ${commentsError.message}`)
          return
        }
        setComments((data || []) as unknown as TaskCommentSummary[])
      })
    return () => { cancelled = true }
  }, [tasks])

  const commentsByTask = useMemo(() => {
    const grouped = new Map<string, TaskCommentSummary[]>()
    comments.forEach((comment) => grouped.set(comment.task_id, [...(grouped.get(comment.task_id) || []), comment]))
    return grouped
  }, [comments])

  const members = useMemo(() => eligibleMembers, [eligibleMembers])
  const visibleMembers = members.filter((member) => member.full_name.toLowerCase().includes(memberSearch.toLowerCase()))
  const assignableMembers = activeAssignableMembers(eligibleMembers)
  const displayTasks = applyOverrides(tasks, taskOverrides)

  /** Guarda en línea con la misma RPC que el lápiz (admin_update_task: notifica reasignaciones). */
  async function saveInline(task: Task, field: InlineField, rawValue: string) {
    if (!canInlineEditTask(user, task) || inlineFieldLocked(task, field)) return
    const changes = buildInlineChange(task, field, rawValue)
    if (!changes) return
    const patch = optimisticPatch(changes, assignableMembers)
    setTaskOverrides(prev => addOverride(prev, task.id, patch))
    const { error: rpcError } = await supabase.rpc('admin_update_task', { p_task_id: task.id, p_changes: changes })
    if (rpcError) {
      setTaskOverrides(prev => removeOverride(prev, task.id, patch))
      setDeleteNotice(inlineErrorNotice(field, friendlyTaskError(rpcError.message)))
      return
    }
    await onTasksChange()
    setTaskOverrides(prev => removeOverride(prev, task.id, patch))
  }

  const memberTasks = selectedMemberId === 'all' ? displayTasks : displayTasks.filter((task) => task.assigned_to === selectedMemberId)
  const filteredTasks = memberTasks
    .filter((task) => {
      if (statusFilter === 'todas') return true
      if (statusFilter === 'activas') return task.status !== 'completada'
      return task.status === statusFilter
    })
    .filter((task) => {
      const query = taskSearch.trim().toLowerCase()
      if (!query) return true
      return [task.title, task.project?.name, task.project?.client?.name, task.assignee?.full_name].some((value) => value?.toLowerCase().includes(query))
    })
    .sort((a, b) => {
      if (a.status === 'completada' && b.status !== 'completada') return 1
      if (a.status !== 'completada' && b.status === 'completada') return -1
      return (a.commitment_date || '9999-12-31').localeCompare(b.commitment_date || '9999-12-31')
    })

  // Solo cuentan las seleccionadas que siguen visibles con la persona, el estado y la búsqueda.
  const visibleTaskIds = filteredTasks.map(task => task.id)
  const selectedVisibleIds = visibleSelection(selectedTaskIds, visibleTaskIds)
  const allState = selectAllState(selectedTaskIds, visibleTaskIds)
  const isSelected = (task: Task) => selectedVisibleIds.includes(task.id)

  function openBulk(action: BulkTaskAction) {
    const chosen = filteredTasks.filter(isSelected).map(task => ({ id: task.id, title: task.title, department: task.department, status: task.status, assigned_to: task.assigned_to, needed_date: task.needed_date || null }))
    if (!chosen.length) return
    setBulkAction({ action, tasks: chosen })
  }

  function handleBulkDone(result: BulkResult) {
    setBulkAction(null)
    // Las que fallaron se quedan seleccionadas para reintentar; las demás se limpian.
    setSelectedTaskIds(result.failed.map(item => item.id))
    setDeleteNotice(bulkResultNotice(result))
    void onTasksChange()
  }

  const activeCount = memberTasks.filter((task) => task.status !== 'completada').length
  const completedCount = memberTasks.filter((task) => task.status === 'completada').length
  const undatedCounts = useMemo(() => countUndatedByAssignee(tasks), [tasks])
  const totalUndated = [...undatedCounts.values()].reduce((sum, count) => sum + count, 0)

  async function completeTask(task: Task) {
    if (!window.confirm(`¿Marcar “${task.title}” como completada?\n\nNo será necesario que ${task.assignee?.full_name || 'el integrante'} la envíe a revisión.`)) return
    setBusyTaskId(task.id)
    setError('')
    const { error: actionError } = await supabase.rpc('admin_complete_team_task', { p_task_id: task.id })
    setBusyTaskId('')
    if (actionError) {
      setError(`No se pudo completar la tarea: ${actionError.message}`)
      return
    }
    setSelectedTask(null)
    await onTasksChange()
  }

  function handleTaskSaved() {
    setEditingTask(null)
    void onTasksChange()
  }

  return (
    <div className="mx-auto max-w-[1400px] p-3 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Control operativo</p>
          <h1 className="text-2xl font-bold text-gray-950">Tareas del equipo</h1>
          <p className="mt-1 text-sm text-gray-500">Consulta y administra directamente las tareas de cada integrante.</p>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4"><b className="text-xl text-blue-600">{activeCount}</b><span className="ml-2 text-sm text-gray-500">activas</span></div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4"><b className="text-xl text-emerald-600">{completedCount}</b><span className="ml-2 text-sm text-gray-500">completadas</span></div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4"><b className={totalUndated > 0 ? 'text-xl text-amber-600' : 'text-xl text-emerald-600'}>{totalUndated}</b><span className="ml-2 text-sm text-gray-500">sin fecha en el equipo</span></div>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:min-h-[650px] lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-gray-200 bg-gray-50/70 p-4 lg:border-b-0 lg:border-r">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Buscar integrante..." className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
          </div>
          <button type="button" onClick={() => setSelectedMemberId('all')} className={`mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${selectedMemberId === 'all' ? 'bg-blue-600 text-white' : 'hover:bg-white'}`}>
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${selectedMemberId === 'all' ? 'bg-white/20' : 'bg-blue-100 text-blue-600'}`}><Users size={19} /></span>
            <span className="min-w-0 flex-1"><b className="block text-sm">Todo el equipo</b><small className={selectedMemberId === 'all' ? 'text-blue-100' : 'text-gray-500'}>{tasks.length} tareas</small></span>
          </button>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:block lg:max-h-[555px] lg:space-y-1 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0 lg:pr-1">
            {visibleMembers.map((member) => {
              const count = tasks.filter((task) => task.assigned_to === member.id && task.status !== 'completada').length
              const undated = undatedCounts.get(member.id) || 0
              return <button key={member.id} type="button" onClick={() => setSelectedMemberId(member.id)} className={`flex min-w-[220px] items-center gap-3 rounded-xl px-3 py-3 text-left lg:w-full lg:min-w-0 ${selectedMemberId === member.id ? 'border border-blue-200 bg-blue-50' : 'border border-transparent hover:bg-white'}`}>
                <UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={40} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm text-gray-900">{member.full_name}</b>
                  <small className="block truncate capitalize text-gray-500">{member.department || 'Sin departamento'}</small>
                  <small className={`block font-semibold ${undated > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{undated > 0 ? `Sin fecha: ${undated}` : 'Al día ✅'}</small>
                </span>
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600">{count}</span>
              </button>
            })}
          </div>
        </aside>

        <section className="min-w-0 p-3 sm:p-4 lg:p-6">
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Buscar tarea, cliente o proyecto..." className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500">
              <option value="activas">Activas</option><option value="pendiente">Pendientes</option><option value="en_progreso">En progreso</option><option value="bloqueada">Bloqueadas</option><option value="completada">Completadas</option><option value="todas">Todas</option>
            </select>
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full table-fixed text-left text-sm">
              <colgroup><col className="w-[24%]" /><col className="w-[17%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[12%]" /><col className="w-[14%]" /><col className="w-[12%]" /></colgroup>
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">{isAdmin && <span className="mr-2 inline-block align-middle"><TaskCheckbox state={allState} onToggle={() => setSelectedTaskIds(prev => toggleSelectAll(prev, visibleTaskIds))} label={allState === 'all' ? 'Quitar selección de todas' : 'Seleccionar todas las tareas visibles'} /></span>}Tarea</th><th className="px-4 py-3">Integrante</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Prioridad</th><th className="px-4 py-3">Entrega</th><th className="px-4 py-3">Comentarios</th><th className="px-4 py-3 text-right">Acciones</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTasks.map((task) => {
                  const taskComments = commentsByTask.get(task.id) || []
                  const latestComment = taskComments[0]
                  return <tr key={task.id} className={`hover:bg-blue-50/30 ${isSelected(task) ? 'bg-blue-50/70' : ''}`}>
                  <td className="px-4 py-3"><div className="flex items-start gap-2">{isAdmin && <span className="pt-0.5"><TaskCheckbox state={isSelected(task)} onToggle={() => setSelectedTaskIds(prev => toggleSelected(prev, task.id))} label={`Seleccionar tarea ${task.title}`} /></span>}<button type="button" onClick={() => setSelectedTask(task)} className="min-w-0 max-w-[300px] text-left"><b className="block truncate text-gray-900 hover:text-blue-600">{task.title}</b><small className="block truncate text-gray-500">{task.project?.client?.name || 'Sin cliente'} · {task.project?.name || 'Sin proyecto'}</small></button></div></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><UserAvatar name={task.assignee?.full_name || 'Sin asignar'} avatarUrl={task.assignee?.avatar_url} size={28} /><span className="max-w-[145px] truncate">{task.assignee?.full_name || 'Sin asignar'}</span></div></td>
                  <td className="px-4 py-3"><StatusBadge status={task.status} /></td><td className="px-4 py-3"><PriorityBadge priority={task.priority} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{task.commitment_date ? new Date(`${task.commitment_date}T00:00:00`).toLocaleDateString('es-MX') : 'Sin fecha'}</td>
                  <td className="max-w-[250px] px-4 py-3">
                    {latestComment ? <button type="button" onClick={() => setSelectedTask(task)} className="group flex w-full items-start gap-2 text-left" title="Abrir todos los comentarios">
                      <span className="mt-0.5 rounded-lg bg-blue-50 p-1.5 text-blue-600"><MessageSquare size={14} /></span>
                      <span className="min-w-0"><span className="block truncate text-xs font-semibold text-gray-700 group-hover:text-blue-600">{latestComment.user?.full_name || 'Usuario'} · {taskComments.length}</span><span className="block truncate text-xs text-gray-500">{latestComment.content}</span></span>
                    </button> : <span className="text-xs text-gray-400">Sin comentarios</span>}
                  </td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" onClick={() => setSelectedTask(task)} title="Ver detalle" className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:border-blue-300 hover:text-blue-600"><Eye size={16} /></button>{isAdmin && <button type="button" disabled={busyTaskId === task.id} onClick={() => setEditingTask(task)} title="Editar tarea" className="rounded-lg border border-blue-200 p-2 text-blue-600 hover:bg-blue-50 disabled:opacity-50"><Pencil size={16} /></button>}{task.status !== 'completada' && <button type="button" disabled={busyTaskId === task.id} onClick={() => completeTask(task)} title="Marcar completada" className="rounded-lg border border-emerald-200 p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"><CheckCircle2 size={16} /></button>}{canDeleteTask && <button type="button" disabled={busyTaskId === task.id} onClick={() => setSuperDeleteTask(task)} title="Borrar definitivamente" className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={16} /></button>}</div></td>
                </tr>})}
              </tbody>
            </table>
            {!filteredTasks.length && <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center text-gray-400"><ClipboardList size={42} className="mb-3 text-gray-300" /><b className="text-gray-600">No hay tareas con estos filtros</b><span className="mt-1 text-sm">Prueba otra persona, estado o búsqueda.</span></div>}
          </div>

          {isAdmin && filteredTasks.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 bg-white">
              <label className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm text-gray-600">
                <TaskCheckbox state={allState} onToggle={() => setSelectedTaskIds(prev => toggleSelectAll(prev, visibleTaskIds))} label={allState === 'all' ? 'Quitar selección de todas' : 'Seleccionar todas las tareas visibles'} />
                <span>{allState === 'all' ? 'Quitar selección' : `Seleccionar todas (${filteredTasks.length})`}</span>
              </label>
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
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-2">
            {filteredTasks.map(task => {
              const taskComments = commentsByTask.get(task.id) || []
              const latestComment = taskComments[0]
              return <article key={task.id} className={`rounded-xl border bg-white p-4 shadow-sm ${isSelected(task) ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}>
                <div className="flex items-start gap-3">
                  {isAdmin && <span className="pt-0.5"><TaskCheckbox state={isSelected(task)} onToggle={() => setSelectedTaskIds(prev => toggleSelected(prev, task.id))} label={`Seleccionar tarea ${task.title}`} /></span>}
                  <button type="button" onClick={() => setSelectedTask(task)} className="min-w-0 flex-1 text-left">
                    <b className="block text-sm text-gray-900">{task.title}</b>
                    <small className="mt-1 block text-gray-500">{task.project?.client?.name || 'Sin cliente'} · {task.project?.name || 'Sin proyecto'}</small>
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="mr-auto flex min-w-0 items-center gap-2"><UserAvatar name={task.assignee?.full_name || 'Sin asignar'} avatarUrl={task.assignee?.avatar_url} size={28} />{canInlineEditTask(user, task) && !inlineFieldLocked(task, 'assigned_to')
                    ? <InlineSelectCell label={`persona asignada de ${task.title}`} value={task.assigned_to || ''} placeholder="Selecciona persona"
                        display={<span className="truncate text-sm">{task.assignee?.full_name || 'Sin asignar'}</span>}
                        options={assignableMembers.map(m => ({ value: m.id, label: `${m.full_name}${m.id === user?.id ? ' (yo)' : ''}` }))}
                        onSave={value => { void saveInline(task, 'assigned_to', value) }} />
                    : <span className="truncate text-sm">{task.assignee?.full_name || 'Sin asignar'}</span>}</div>
                  <StatusBadge status={task.status} />
                  {canInlineEditTask(user, task)
                    ? <InlineSelectCell label={`prioridad de ${task.title}`} value={task.priority} display={<PriorityBadge priority={task.priority} />}
                        options={INLINE_PRIORITIES} onSave={value => { void saveInline(task, 'priority', value) }} />
                    : <PriorityBadge priority={task.priority} />}
                </div>
                <div className="mt-3 grid gap-2 text-xs text-gray-500 sm:grid-cols-2">
                  <span><b className="text-gray-600">Entrega:</b> {task.commitment_date ? new Date(`${task.commitment_date}T00:00:00`).toLocaleDateString('es-MX') : 'Sin fecha'}</span>
                  <button type="button" onClick={() => setSelectedTask(task)} className="truncate text-left hover:text-blue-600"><b className="text-gray-600">Comentarios:</b> {latestComment ? `${latestComment.user?.full_name || 'Usuario'} · ${taskComments.length} — ${latestComment.content}` : 'Sin comentarios'}</button>
                </div>
                <div className="mt-3 flex justify-end gap-2 border-t border-gray-100 pt-3"><button type="button" onClick={() => setSelectedTask(task)} title="Ver detalle" className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:border-blue-300 hover:text-blue-600"><Eye size={16} /></button>{isAdmin && <button type="button" disabled={busyTaskId === task.id} onClick={() => setEditingTask(task)} title="Editar tarea" className="rounded-lg border border-blue-200 p-2 text-blue-600 hover:bg-blue-50 disabled:opacity-50"><Pencil size={16} /></button>}{task.status !== 'completada' && <button type="button" disabled={busyTaskId === task.id} onClick={() => completeTask(task)} title="Marcar completada" className="rounded-lg border border-emerald-200 p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"><CheckCircle2 size={16} /></button>}{canDeleteTask && <button type="button" disabled={busyTaskId === task.id} onClick={() => setSuperDeleteTask(task)} title="Borrar definitivamente" className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={16} /></button>}</div>
              </article>
            })}
            {!filteredTasks.length && <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-gray-200 p-8 text-center text-gray-400"><ClipboardList size={42} className="mb-3 text-gray-300" /><b className="text-gray-600">No hay tareas con estos filtros</b><span className="mt-1 text-sm">Prueba otra persona, estado o búsqueda.</span></div>}
          </div>
        </section>
      </div>

      {selectedTask && <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} onUpdate={async () => { setSelectedTask(null); await onTasksChange() }} />}
      {editingTask && <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onSaved={handleTaskSaved} />}
      {superDeleteTask && canDeleteTask && (
        <DeleteTaskModal task={superDeleteTask} onClose={() => setSuperDeleteTask(null)} onDeleted={title => { setSuperDeleteTask(null); setDeleteNotice(taskDeletedNotice(title)); void onTasksChange() }} />
      )}
      {deleteNotice && (
        <div role="status" className="fixed bottom-6 right-6 z-[90] flex max-w-sm items-start gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-2xl">
          <span>{deleteNotice}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setDeleteNotice('')} className="text-gray-300 hover:text-white">×</button>
        </div>
      )}
      {bulkAction && isAdmin && (bulkAction.action === 'reasignar' || bulkAction.action === 'necesito' || (bulkAction.action === 'eliminar' && canDeleteTask) || (bulkAction.action === 'completar' && canBulkQuickComplete(user))) && (
        <BulkTaskActionModal action={bulkAction.action} tasks={bulkAction.tasks} members={assignableMembers} canEditCompleted={canChangeProjectStatus(user)} onClose={() => setBulkAction(null)} onDone={handleBulkDone} />
      )}
    </div>
  )
}

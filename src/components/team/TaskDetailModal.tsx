import { useState, useEffect, useRef } from 'react'
import { X, ExternalLink, Send, CheckCircle, RotateCcw, ShieldCheck, Plus, Trash2, MessageSquare, Pencil, Upload, FileCode, Image as ImageIcon, File as FileIcon, ListChecks, Timer, Play, Square, Link2, AlertTriangle, ChevronDown, SlidersHorizontal, UserX, Archive } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, User, Comment, Subtask, TimeEntry } from '../../types'
import { isClientAttributableDelay, delayDaysFor } from '../../lib/taskDelays'
import EditTaskModal from '../admin/EditTaskModal'
import ArchiveTaskModal from '../admin/ArchiveTaskModal'

interface Props {
  task: Task
  onClose: () => void
  onUpdate: () => void
  onReviewDone?: (taskId: string) => void
  reviewAttention?: boolean
}

export default function TaskDetailModal({ task, onClose, onUpdate, onReviewDone, reviewAttention = false }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // Editar/archivar: rol admin o super admin (igual que is_active_admin() en SQL).
  const canManageTasks = isAdmin || !!user?.is_super_admin
  const isTeam = user?.role === 'team'
  const approverIds = task.approver_ids?.length ? task.approver_ids : (task.approver_id ? [task.approver_id] : [])
  const isReviewer = user?.id === task.reviewer_id || (!!user?.id && approverIds.includes(user.id))
  const canAuthorize = isReviewer

  const [teamMembers, setTeamMembers] = useState<User[]>([])
  const [links, setLinks] = useState<{ id: string; label: string; url: string }[]>(task.links || [])
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [reviewerId, setReviewerId] = useState(task.reviewer_id || approverIds[0] || '')
  const [reworkNote, setReworkNote] = useState('')
  const [showRework, setShowRework] = useState(false)
  const [busy, setBusy] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(task.status)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [commitDate, setCommitDate] = useState(task.commitment_date || '')
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentValue, setEditCommentValue] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [linksError, setLinksError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [showEditTask, setShowEditTask] = useState(false)
  const [showArchiveTask, setShowArchiveTask] = useState(false)

  // Subtareas
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [newSubtask, setNewSubtask] = useState('')

  // Tiempo trabajado
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Dependencias
  const [projectTasks, setProjectTasks] = useState<Task[]>([])
  const [dependsOn, setDependsOn] = useState(task.depends_on_task_id || '')

  // Retraso atribuible al cliente — "no asistió / reprogramó" en la sesión de grabación
  const [markingNoShow, setMarkingNoShow] = useState(false)
  const [noShowReason, setNoShowReason] = useState('')
  const [markingDelay, setMarkingDelay] = useState(false)
  const isRecordingSessionTask = task.department === 'cliente' && task.title === 'Asistir a la sesión de grabación'

  useEffect(() => {
    supabase.from('users').select('*')
      .in('role', ['admin', 'team'])
      .order('full_name')
      .then(({ data }) => setTeamMembers(data || []))
  }, [])

  useEffect(() => {
    fetchLinks()
    fetchComments()
    fetchSubtasks()
    fetchTimeEntries()
    if (task.project_id) fetchProjectTasks()
  }, [task.id])

  async function fetchLinks() {
    setLinksError('')
    const { data, error } = await supabase
      .from('task_links')
      .select('id, label, url')
      .eq('task_id', task.id)
      .order('id', { ascending: true })

    if (error) {
      console.error('No se pudieron cargar los entregables de la tarea:', error)
      setLinksError('No se pudieron cargar los entregables. Actualiza la página o avisa al administrador.')
      return
    }
    setLinks(data || [])
  }

  useEffect(() => {
    if (activeEntry) {
      const startedAt = new Date(activeEntry.started_at).getTime()
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
      }, 1000)
      return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }
  }, [activeEntry])

  async function fetchSubtasks() {
    const { data } = await supabase
      .from('task_subtasks')
      .select('*')
      .eq('task_id', task.id)
      .order('position', { ascending: true })
    setSubtasks((data as Subtask[]) || [])
  }

  async function fetchTimeEntries() {
    const { data } = await supabase
      .from('task_time_entries')
      .select('*, user:users(full_name)')
      .eq('task_id', task.id)
      .order('started_at', { ascending: false })
    const entries = (data as TimeEntry[]) || []
    setTimeEntries(entries)
    const mine = entries.find(e => e.user_id === user?.id && !e.ended_at)
    setActiveEntry(mine || null)
  }

  async function fetchProjectTasks() {
    const { data } = await supabase
      .from('tasks')
      .select('id, title, status')
      .eq('project_id', task.project_id)
      .neq('id', task.id)
      .is('archived_at', null)
    setProjectTasks((data as any) || [])
  }

  async function fetchComments() {
    const { data } = await supabase
      .from('task_comments')
      .select('*, user:users(id, full_name)')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true })
    setComments((data as Comment[]) || [])
  }

  async function sendComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim() || !user) return
    setSendingComment(true)
    await supabase.from('task_comments').insert({
      task_id: task.id, user_id: user.id, content: newComment.trim(),
    })

    // Avisar al encargado que creó/asignó la tarea (si no es quien comenta)
    if (task.created_by && task.created_by !== user.id) {
      await supabase.from('notifications').insert({
        user_id: task.created_by,
        title: '💬 Nuevo comentario',
        message: `${user.full_name} comentó en "${task.title}": ${newComment.trim().slice(0, 80)}`,
        type: 'comment',
        task_id: task.id,
      })
    }

    setNewComment('')
    await fetchComments()
    setSendingComment(false)
    onUpdate()
  }

  function startEditComment(c: Comment) {
    setEditingCommentId(c.id)
    setEditCommentValue(c.content)
  }

  async function saveEditComment(id: string) {
    if (!editCommentValue.trim()) return
    try {
      const { error } = await supabase.from('task_comments').update({ content: editCommentValue.trim() }).eq('id', id)
      if (error) console.error('Error al editar comentario:', error)
      setEditingCommentId(null)
      await fetchComments()
    } catch (err) {
      console.error('Error al editar comentario:', err)
      setEditingCommentId(null)
    }
  }

  async function deleteComment(id: string) {
    try {
      const { error } = await supabase.from('task_comments').delete().eq('id', id)
      if (error) console.error('Error al borrar comentario:', error)
      await fetchComments()
      onUpdate()
    } catch (err) {
      console.error('Error al borrar comentario:', err)
    }
  }

  // ─── Subtareas ───────────────────────────────────────────────────────────
  async function addSubtask(e: React.FormEvent) {
    e.preventDefault()
    if (!newSubtask.trim()) return
    const { data } = await supabase.from('task_subtasks')
      .insert({ task_id: task.id, title: newSubtask.trim(), position: subtasks.length })
      .select().single()
    if (data) setSubtasks(prev => [...prev, data])
    setNewSubtask('')
  }

  async function toggleSubtask(s: Subtask) {
    setSubtasks(prev => prev.map(x => x.id === s.id ? { ...x, completed: !x.completed } : x))
    await supabase.from('task_subtasks').update({ completed: !s.completed }).eq('id', s.id)
  }

  async function deleteSubtask(id: string) {
    setSubtasks(prev => prev.filter(s => s.id !== id))
    await supabase.from('task_subtasks').delete().eq('id', id)
  }

  // ─── Tiempo trabajado (cronómetro manual) ───────────────────────────────
  async function startTimer() {
    if (!user) return
    const { data } = await supabase.from('task_time_entries')
      .insert({ task_id: task.id, user_id: user.id, started_at: new Date().toISOString() })
      .select('*, user:users(full_name)').single()
    if (data) {
      setActiveEntry(data as TimeEntry)
      setElapsedSec(0)
      await fetchTimeEntries()
    }
  }

  async function stopTimer() {
    if (!activeEntry) return
    const endedAt = new Date()
    const minutes = Math.max(1, Math.round((endedAt.getTime() - new Date(activeEntry.started_at).getTime()) / 60000))
    await supabase.from('task_time_entries')
      .update({ ended_at: endedAt.toISOString(), minutes })
      .eq('id', activeEntry.id)
    setActiveEntry(null)
    setElapsedSec(0)
    await fetchTimeEntries()
  }

  // ─── Dependencia entre tareas ────────────────────────────────────────────
  async function saveDependsOn(value: string) {
    setDependsOn(value)
    await supabase.from('tasks').update({ depends_on_task_id: value || null }).eq('id', task.id)
    onUpdate()
  }

  // ─── Admin marca que el cliente no asistió / reprogramó la sesión de grabación ──────────
  async function markClientNoShow() {
    if (!noShowReason.trim() || !user) return
    setMarkingDelay(true)
    const dependents = projectTasks.filter(t => t.depends_on_task_id === task.id)
    const affectedIds = [task.id, ...dependents.map(t => t.id)]
    await supabase.from('tasks').update({
      delay_responsible: 'cliente',
      delay_reason: noShowReason.trim(),
      delay_marked_at: new Date().toISOString(),
      delay_marked_by: user.id,
    }).in('id', affectedIds)
    await supabase.from('project_delay_events').insert(
      affectedIds.map(id => ({
        project_id: task.project_id,
        task_id: id,
        responsible: 'cliente',
        reason: noShowReason.trim(),
        created_by: user.id,
      }))
    )
    setMarkingDelay(false)
    setMarkingNoShow(false)
    setNoShowReason('')
    onUpdate()
  }

  // ─── determinar paso actual ───────────────────────────────────────────────
  const step = !task.review_status ? 1
    : task.review_status === 'pendiente_revision' ? 2
    : task.review_status === 'pendiente_trafficker' ? 3
    : task.review_status === 'aprobada' ? 4
    : task.review_status === 'cambios_solicitados' ? 0   // retrabajo
    : 1

  // ─── helpers ─────────────────────────────────────────────────────────────
  async function addLink(e: React.FormEvent) {
    e.preventDefault()
    if (!newUrl.trim()) return
    let automaticLabel = 'Entregable'
    try { automaticLabel = new URL(newUrl.trim()).hostname.replace(/^www\./, '') || automaticLabel } catch { /* type=url valida antes */ }
    setLinksError('')
    const { data, error } = await supabase.from('task_links')
      .insert({ task_id: task.id, label: newLabel.trim() || automaticLabel, url: newUrl.trim() })
      .select().single()
    if (error) {
      console.error('No se pudo guardar el entregable:', error)
      setLinksError('No se pudo guardar el enlace. Intenta nuevamente.')
      return
    }
    if (data) setLinks(prev => [...prev, data])
    setNewLabel(''); setNewUrl('')
  }

  async function removeLink(id: string) {
    await supabase.from('task_links').delete().eq('id', id)
    setLinks(prev => prev.filter(l => l.id !== id))
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('El archivo no puede pesar más de 20MB')
      return
    }
    setUploadError('')
    setUploadingFile(true)
    const path = `task-deliverables/${task.id}/${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from('chat-files').upload(path, file, { contentType: file.type || undefined })
    if (error) {
      setUploadError('No se pudo subir el archivo')
      setUploadingFile(false)
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(path)
    const { data, error: linkError } = await supabase.from('task_links')
      .insert({ task_id: task.id, label: file.name, url: publicUrl })
      .select().single()
    if (linkError) {
      console.error('No se pudo registrar el archivo como entregable:', linkError)
      setUploadError('El archivo subió, pero no se pudo añadir a la tarea')
    }
    if (data) setLinks(prev => [...prev, data])
    setUploadingFile(false)
  }

  function fileIconFor(url: string) {
    const lower = url.toLowerCase()
    if (lower.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/)) return ImageIcon
    if (lower.includes('.html')) return FileCode
    if (lower.match(/\.(pdf|docx?|xlsx?|pptx?|txt)(\?|$)/)) return FileIcon
    return ExternalLink
  }

  async function updateReviewStatus(newStatus: string) {
    await supabase.rpc('update_task_review_status', {
      p_task_id: task.id,
      p_review_status: newStatus,
    })
  }

  // ─── PASO 1 → solicitar revisión ─────────────────────────────────────────
  async function submitForReview() {
    const selectedReviewers = approverIds.length > 0 ? approverIds : (reviewerId ? [reviewerId] : [])
    if (selectedReviewers.length === 0) {
      setSubmitAttempted(true)
      return
    }
    setBusy(true)
    await supabase.from('tasks').update({
      status: 'completada',
      ...(reviewerId ? { reviewer_id: reviewerId } : {}),
    }).eq('id', task.id)
    await updateReviewStatus('pendiente_revision')

    const notifyIds = [...new Set(selectedReviewers.filter(id => id !== user?.id))]
    if (notifyIds.length > 0) {
      await supabase.from('notifications').insert(notifyIds.map(id => ({
        user_id: id,
        title: '🔍 Revisión solicitada',
        message: `${user?.full_name} solicita revisión de: "${task.title}"`,
        type: 'review',
        task_id: task.id,
      })))
    }
    setBusy(false); onUpdate(); onClose()
  }

  // ─── PASO 2 → solicitar retrabajo ────────────────────────────────────────
  async function requestRework() {
    if (!reworkNote.trim()) return
    setBusy(true)
    await updateReviewStatus('cambios_solicitados')
    await supabase.from('tasks').insert({
      project_id: task.project_id,
      title: `🔄 Retrabajo: ${task.title}`,
      description: reworkNote.trim(),
      assigned_to: task.assigned_to,
      department: task.department,
      priority: task.priority,
      status: 'pendiente',
      created_by: user!.id,
    })
    if (task.assigned_to) {
      await supabase.from('notifications').insert({
        user_id: task.assigned_to, title: '🔄 Se solicitaron cambios',
        message: `"${task.title}" necesita ajustes: ${reworkNote.trim().slice(0, 80)}`,
        type: 'review', task_id: task.id,
      })
    }
    setBusy(false); onReviewDone?.(task.id); onUpdate(); onClose()
  }

  // ─── ADMIN → reactivar tarea ─────────────────────────────────────────────
  async function reactivateTask() {
    setBusy(true)
    await supabase.from('tasks').update({
      status: 'en_progreso',
      review_status: null,
      completion_date: null,
    }).eq('id', task.id)
    setBusy(false); onUpdate(); onClose()
  }

  // ─── PASO 3 → trafficker autoriza para cliente ───────────────────────────
  async function authorizeForClient() {
    setBusy(true)
    await updateReviewStatus('aprobada')
    const notifs: any[] = []
    if (task.assigned_to) notifs.push({
      user_id: task.assigned_to, title: '✅ Entregable autorizado',
      message: `"${task.title}" fue autorizado y el cliente ya puede verlo.`, type: 'review',
    })
    const clientUserId = task.project?.client?.user_id
    if (clientUserId) notifs.push({
      user_id: clientUserId, title: '🎉 Nuevo entregable listo',
      message: `"${task.title}" ya está disponible para ti.`, type: 'review',
    })
    if (notifs.length > 0) await supabase.from('notifications').insert(notifs)
    setBusy(false); onUpdate(); onClose()
  }

  // ─── cambiar estatus operativo ───────────────────────────────────────────
  const STATUS_OPTIONS = [
    { value: 'pendiente',   label: 'Pendiente',   color: 'bg-gray-100 text-gray-600 border-gray-300' },
    { value: 'en_progreso', label: 'En progreso', color: 'bg-blue-100 text-blue-700 border-blue-300' },
    { value: 'bloqueada',   label: '⚠ Detenida',  color: 'bg-red-100 text-red-700 border-red-300' },
  ]

  async function saveCommitDate(date: string) {
    setCommitDate(date)
    await supabase.from('tasks').update({ commitment_date: date || null }).eq('id', task.id)
    onUpdate()
  }

  async function changeStatus(newStatus: string) {
    setCurrentStatus(newStatus as any)
    setStatusMenuOpen(false)
    await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id)
    onUpdate()
  }

  // ─── UI helpers ──────────────────────────────────────────────────────────
  const stepLabel = ['🔄 Retrabajo pendiente', '📝 En progreso', '🔍 En revisión', '⏳ Esperando Trafficker', '✅ Autorizado'][step] || ''
  const stepColor = [
    'bg-orange-100 text-orange-700 border-orange-300',
    'bg-gray-100 text-gray-600 border-gray-300',
    'bg-yellow-100 text-yellow-700 border-yellow-300',
    'bg-blue-100 text-blue-700 border-blue-300',
    'bg-green-100 text-green-700 border-green-300',
  ][step] || ''

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-8">

        {/* ── Cabecera ── */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex-1 min-w-0 pr-4">
            <h3 className="text-base font-bold text-gray-900 leading-snug">{task.title}</h3>
            <p className="text-xs text-gray-400 mt-1">{task.project?.client?.name} — {task.project?.name}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Selector de estatus operativo — visible si la tarea no está completada */}
            {currentStatus !== 'completada' && (isTeam || isAdmin) && (() => {
              const opt = STATUS_OPTIONS.find(o => o.value === currentStatus) || STATUS_OPTIONS[0]
              return (
                <div className="relative">
                  <button type="button" onClick={() => setStatusMenuOpen(o => !o)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer transition hover:opacity-80 ${opt.color}`}>
                    {opt.label} ▾
                  </button>
                  {statusMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} />
                      <div className="absolute right-0 top-8 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[140px] py-1 overflow-hidden">
                        {STATUS_OPTIONS.map(o => (
                          <button key={o.value} type="button" onClick={() => changeStatus(o.value)}
                            className={`w-full text-left px-4 py-2 text-xs font-medium hover:bg-gray-50 transition ${o.value === currentStatus ? 'opacity-40 cursor-default' : ''}`}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            {canManageTasks && !task.archived_at && (
              <>
                <button type="button" onClick={() => setShowEditTask(true)} title="Editar tarea"
                  className="text-blue-500 hover:text-blue-700 transition p-1.5 rounded-lg hover:bg-blue-50">
                  <Pencil size={16} />
                </button>
                <button type="button" onClick={() => setShowArchiveTask(true)} title="Archivar tarea"
                  className="text-amber-500 hover:text-amber-700 transition p-1.5 rounded-lg hover:bg-amber-50">
                  <Archive size={16} />
                </button>
              </>
            )}

            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition p-1 rounded-lg hover:bg-gray-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">

          {reviewAttention && canAuthorize && (
            <div className="relative overflow-hidden rounded-xl border-2 border-blue-500 bg-blue-50 px-4 py-4 shadow-sm">
              <div className="absolute inset-y-0 left-0 w-1.5 bg-blue-600" />
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-600 text-white">
                  <ShieldCheck size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">Tarea que debes autorizar</p>
                  <p className="mt-1 text-sm font-bold text-blue-950">{task.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-blue-700">
                    Revisa sus entregables y después autoriza o solicita cambios.
                  </p>
                  <button type="button"
                    onClick={() => document.getElementById(`review-action-${task.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700">
                    Ir a la decisión <ExternalLink size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Flujo compacto */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[11px] font-medium text-gray-500">Preparando entrega <span className="mx-1 text-gray-300">→</span> Revisión <span className="mx-1 text-gray-300">→</span> Autorización</p>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stepColor}`}>{stepLabel}</span>
          </div>

          {/* ── Retraso atribuible al cliente/agencia ── */}
          {isClientAttributableDelay(task) && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-orange-500 shrink-0" />
                <p className="text-xs font-semibold text-orange-700">Retraso atribuible al cliente · {delayDaysFor(task)} día{delayDaysFor(task) === 1 ? '' : 's'}</p>
              </div>
              {isAdmin && task.delay_responsible === 'cliente' && (
                <button type="button" onClick={async () => {
                  await supabase.from('tasks').update({ delay_responsible: 'agencia', delay_reason: 'Corregido por un administrador' }).eq('id', task.id)
                  await supabase.from('project_delay_events').insert({ project_id: task.project_id, task_id: task.id, responsible: 'agencia', reason: 'Corregido por un administrador', created_by: user?.id })
                  onUpdate()
                }} className="shrink-0 text-xs font-semibold text-orange-600 underline hover:text-orange-800">
                  No fue el cliente
                </button>
              )}
            </div>
          )}

          {/* ── Admin: el cliente no asistió / reprogramó la sesión de grabación ── */}
          {isAdmin && isRecordingSessionTask && task.status !== 'completada' && task.delay_responsible !== 'cliente' && (
            <div className="rounded-xl border border-dashed border-red-200 bg-red-50/50 p-3 space-y-2">
              {!markingNoShow ? (
                <button type="button" onClick={() => setMarkingNoShow(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-red-700 border border-red-200 bg-white hover:bg-red-50 px-3 py-2 rounded-lg transition">
                  <UserX size={13} /> El cliente no asistió / reprogramó
                </button>
              ) : (
                <>
                  <textarea value={noShowReason} onChange={e => setNoShowReason(e.target.value)} rows={2}
                    placeholder="Motivo (para el historial de retrasos)..."
                    className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
                  <div className="flex gap-2">
                    <button type="button" onClick={markClientNoShow} disabled={markingDelay || !noShowReason.trim()}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2 rounded-lg transition disabled:opacity-50">
                      {markingDelay ? 'Marcando...' : 'Confirmar — marcar como retraso del cliente'}
                    </button>
                    <button type="button" onClick={() => { setMarkingNoShow(false); setNoShowReason('') }}
                      className="px-3 py-2 border border-gray-200 text-xs text-gray-600 rounded-lg hover:bg-gray-50 transition">
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Fecha compromiso ── */}
          {(isTeam || isAdmin) && step === 1 && (
            <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
              <span className="text-lg shrink-0">📅</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-orange-700 mb-1">¿Para cuándo te comprometes a entregar?</p>
                <input
                  type="date"
                  value={commitDate}
                  onChange={e => saveCommitDate(e.target.value)}
                  className="text-sm border border-orange-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white text-gray-700 w-full sm:w-auto"
                />
              </div>
              {commitDate && (
                <button type="button" onClick={() => saveCommitDate('')}
                  className="text-xs text-orange-400 hover:text-orange-600 shrink-0">
                  Borrar
                </button>
              )}
            </div>
          )}

          {/* Mostrar fecha si ya está fijada y no está en paso 1 */}
          {commitDate && step > 1 && (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2">
              <span>📅</span>
              <span>Compromiso de entrega: <strong className="text-gray-700">{new Date(commitDate + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></span>
            </div>
          )}

          <button type="button" onClick={() => setAdvancedOpen(open => !open)}
            className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50">
            <SlidersHorizontal size={15} className="text-blue-600" />
            <span className="flex-1"><b className="block text-xs text-gray-700">Opciones adicionales</b><small className="text-[11px] text-gray-400">Dependencias, subtareas y tiempo trabajado</small></span>
            <ChevronDown size={16} className={`text-gray-400 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>

          {advancedOpen && (
            <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50/40 p-4">

          {/* ── Dependencia con otra tarea ── */}
          {(() => {
            const depTask = dependsOn ? projectTasks.find(t => t.id === dependsOn) : null
            const depBlocking = depTask && depTask.status !== 'completada'
            return (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Link2 size={13} /> Depende de
                </p>
                {(isTeam || isAdmin) ? (
                  <select value={dependsOn} onChange={e => saveDependsOn(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Ninguna</option>
                    {projectTasks.map(t => (
                      <option key={t.id} value={t.id}>{t.title}{t.status === 'completada' ? ' ✓' : ''}</option>
                    ))}
                  </select>
                ) : depTask ? (
                  <p className="text-sm text-gray-600">{depTask.title}</p>
                ) : (
                  <p className="text-sm text-gray-400">Ninguna</p>
                )}
                {depBlocking && (
                  <div className="mt-2 flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                    <AlertTriangle size={13} className="text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-700">Esta tarea depende de "<strong>{depTask!.title}</strong>", que aún no está completada.</p>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Subtareas ── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <ListChecks size={13} /> Subtareas
              {subtasks.length > 0 && (
                <span className="text-gray-400 font-normal normal-case">
                  ({subtasks.filter(s => s.completed).length}/{subtasks.length})
                </span>
              )}
            </p>
            <div className="space-y-1.5 mb-2">
              {subtasks.map(s => (
                <div key={s.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 group">
                  <input type="checkbox" checked={s.completed} onChange={() => toggleSubtask(s)}
                    className="w-4 h-4 accent-blue-600 shrink-0 cursor-pointer" />
                  <span className={`text-sm flex-1 ${s.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>{s.title}</span>
                  <button type="button" onClick={() => deleteSubtask(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {subtasks.length === 0 && (
                <p className="text-xs text-gray-400">Sin subtareas — desglosa esta tarea en pasos más chicos si lo necesitas</p>
              )}
            </div>
            <form onSubmit={addSubtask} className="flex gap-2">
              <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
                placeholder="Agregar subtarea..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="submit" className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition text-xs font-semibold">
                <Plus size={14} />
              </button>
            </form>
          </div>

          {/* ── Tiempo trabajado ── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Timer size={13} /> Tiempo trabajado
              {timeEntries.length > 0 && (
                <span className="text-gray-400 font-normal normal-case">
                  (total: {Math.round(timeEntries.reduce((acc, e) => acc + (e.minutes || 0), 0) / 6) / 10}h)
                </span>
              )}
            </p>
            {(isTeam || isAdmin) && (
              <div className="mb-2">
                {activeEntry ? (
                  <button type="button" onClick={stopTimer}
                    className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition">
                    <Square size={13} /> Detener — {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:{String(elapsedSec % 60).padStart(2, '0')}
                  </button>
                ) : (
                  <button type="button" onClick={startTimer}
                    className="w-full flex items-center justify-center gap-2 border border-green-300 bg-green-50 hover:bg-green-100 text-green-700 text-sm font-semibold py-2 rounded-lg transition">
                    <Play size={13} /> Iniciar tiempo
                  </button>
                )}
              </div>
            )}
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {timeEntries.filter(e => e.ended_at).map(e => (
                <div key={e.id} className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-1.5">
                  <span>{e.user?.full_name || 'Usuario'}</span>
                  <span>{e.minutes} min · {new Date(e.started_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
              {timeEntries.filter(e => e.ended_at).length === 0 && (
                <p className="text-xs text-gray-400">Sin tiempo registrado todavía</p>
              )}
            </div>
          </div>
            </div>
          )}

          {/* ── Links / Entregables ── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Entregables</p>
            {linksError && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs font-medium text-red-600">{linksError}</p>
                <button type="button" onClick={fetchLinks} className="shrink-0 text-xs font-bold text-red-700 underline">
                  Reintentar
                </button>
              </div>
            )}
            {submitAttempted && links.length === 0 && (
              <p className="text-xs text-red-500 mb-2 font-medium">📎 Es obligatorio añadir al menos un link o archivo del entregable</p>
            )}
            <div className="space-y-1.5 mb-3">
              {links.map(link => {
                const LinkIcon = fileIconFor(link.url)
                return (
                  <div key={link.id} className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                    <LinkIcon size={13} className="text-blue-500 shrink-0" />
                    <a href={link.url} target="_blank" rel="noreferrer"
                      className="text-sm text-blue-600 hover:underline flex-1 truncate font-medium">
                      {link.label}
                    </a>
                    {(isTeam || isAdmin) && (
                      <button type="button" onClick={() => removeLink(link.id)}
                        className="text-gray-300 hover:text-red-400 transition shrink-0">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Agregar link o archivo .html (solo equipo o admin, y solo en pasos 1-2) */}
            {(isTeam || isAdmin) && step <= 2 && (
              <div className="space-y-2">
                <form onSubmit={addLink} className="flex gap-2">
                  <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                    placeholder="Nombre (opcional)"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={newUrl} onChange={e => setNewUrl(e.target.value)}
                    placeholder="https://..." type="url" required
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button type="submit"
                    className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition text-xs font-semibold">
                    <Plus size={14} />
                  </button>
                </form>

                <label className="flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 cursor-pointer transition">
                  <Upload size={13} />
                  {uploadingFile ? 'Subiendo...' : 'Subir archivo (imagen, PDF, Word, .html, etc.)'}
                  <input type="file" className="hidden" onChange={uploadFile} disabled={uploadingFile} />
                </label>
                {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════
              PASO 1 — Admin/Líder: completar sin revisión
          ═══════════════════════════════════════════════════════ */}
          {step === 1 && isAdmin && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-green-800">¿Lista la tarea?</p>
              <p className="text-xs text-green-600">Como líder, puedes completar esta tarea directamente sin pasar por revisión.</p>
              <button type="button" onClick={async () => {
                setBusy(true)
                await supabase.from('tasks').update({ status: 'completada' }).eq('id', task.id)
                await updateReviewStatus('aprobada')
                setBusy(false); onUpdate(); onClose()
              }} disabled={busy || links.length === 0}
                title={links.length === 0 ? 'Añade al menos un entregable primero' : undefined}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50">
                <CheckCircle size={14} />
                {busy ? 'Completando...' : 'Marcar como completada'}
              </button>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              PASO 1 — Equipo solicita revisión
          ═══════════════════════════════════════════════════════ */}
          {step === 1 && isTeam && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-blue-700 mb-1">Enviar para revisión y autorización a</label>
                <select value={reviewerId} onChange={e => setReviewerId(e.target.value)}
                  disabled={approverIds.length > 0}
                  className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Selecciona una persona</option>
                  {teamMembers.filter(m => m.id !== user?.id).map(m => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
                {approverIds.length > 0 && <p className="mt-1 text-xs text-blue-600">Esta tarea se enviará a {approverIds.length} persona{approverIds.length === 1 ? '' : 's'} responsable{approverIds.length === 1 ? '' : 's'}.</p>}
                {submitAttempted && approverIds.length === 0 && !reviewerId && <p className="mt-1 text-xs font-medium text-red-600">Selecciona quién debe revisar y autorizar esta tarea.</p>}
              </div>
              <button type="button" onClick={() => {
                setSubmitAttempted(true)
                if (links.length > 0) void submitForReview()
              }} disabled={busy || (approverIds.length === 0 && !reviewerId)}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50">
                <Send size={14} />
                {busy ? 'Enviando...' : 'Enviar a revisión'}
              </button>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              PASO 2 — Revisor aprueba o pide cambios
          ═══════════════════════════════════════════════════════ */}
          {step === 2 && (isReviewer || canAuthorize) && (
            <div id={`review-action-${task.id}`} className={`${reviewAttention ? 'ring-4 ring-blue-100' : ''} bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-3`}>
              <p className="text-sm font-bold text-yellow-800">Paso 2 — Revisión del entregable</p>
              <p className="text-xs text-yellow-600">Revisa los links de arriba y decide.</p>

              {/* Solo la persona elegida puede autorizar */}
              {canAuthorize && (
                <button type="button" onClick={authorizeForClient} disabled={busy}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50">
                  <ShieldCheck size={14} />
                  {busy ? 'Autorizando...' : 'Autorizar tarea terminada'}
                </button>
              )}

              {/* Solicitar retrabajo */}
              {!showRework ? (
                <button type="button" onClick={() => setShowRework(true)}
                  className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                  <RotateCcw size={14} />
                  🔄 Solicitar retrabajo
                </button>
              ) : (
                <div className="space-y-2">
                  <textarea value={reworkNote} onChange={e => setReworkNote(e.target.value)} rows={3}
                    placeholder="Describe qué cambios se necesitan..."
                    className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" />
                  <div className="flex gap-2">
                    <button type="button" onClick={requestRework} disabled={busy || !reworkNote.trim()}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50">
                      {busy ? 'Enviando...' : 'Confirmar retrabajo'}
                    </button>
                    <button type="button" onClick={() => { setShowRework(false); setReworkNote('') }}
                      className="px-4 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              PASO 3 — Trafficker autoriza para el cliente
          ═══════════════════════════════════════════════════════ */}
          {step === 3 && canAuthorize && (
            <div id={`review-action-${task.id}`} className={`${reviewAttention ? 'ring-4 ring-blue-100' : ''} bg-green-50 border border-green-200 rounded-xl p-4 space-y-3`}>
              <p className="text-sm font-bold text-green-800">Paso 3 — Autorización final</p>
              <p className="text-xs text-green-600">El revisor ya aprobó el entregable. Autorízalo para que el cliente lo vea.</p>
              <button type="button" onClick={authorizeForClient} disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50">
                <ShieldCheck size={14} />
                {busy ? 'Autorizando...' : '🛡️ Autorizar — el cliente ya puede verlo'}
              </button>
              {/* También puede pedir retrabajo */}
              {!showRework ? (
                <button type="button" onClick={() => setShowRework(true)}
                  className="w-full flex items-center justify-center gap-2 border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 text-sm font-semibold py-2 rounded-lg transition">
                  <RotateCcw size={14} />
                  Solicitar cambios
                </button>
              ) : (
                <div className="space-y-2">
                  <textarea value={reworkNote} onChange={e => setReworkNote(e.target.value)} rows={3}
                    placeholder="Describe qué cambios se necesitan..."
                    className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" />
                  <div className="flex gap-2">
                    <button type="button" onClick={requestRework} disabled={busy || !reworkNote.trim()}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50">
                      {busy ? 'Enviando...' : 'Confirmar cambios'}
                    </button>
                    <button type="button" onClick={() => { setShowRework(false); setReworkNote('') }}
                      className="px-4 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Estado: autorizado ✅ */}
          {step === 4 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle size={20} className="text-green-500 shrink-0" />
              <div>
                <p className="text-sm font-bold text-green-800">Entregable autorizado</p>
                <p className="text-xs text-green-600 mt-0.5">El cliente ya puede ver este entregable.</p>
              </div>
            </div>
          )}

          {/* Estado: retrabajo solicitado */}
          {step === 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
              <RotateCcw size={20} className="text-orange-500 shrink-0" />
              <div>
                <p className="text-sm font-bold text-orange-800">Se creó una tarea de retrabajo</p>
                <p className="text-xs text-orange-600 mt-0.5">El responsable original fue notificado para hacer los ajustes.</p>
              </div>
            </div>
          )}

          {/* ── Admin: reactivar tarea ── */}
          {isAdmin && step > 1 && (
            <div className="border border-dashed border-red-200 rounded-xl p-3 flex items-center justify-between gap-3 bg-red-50/50">
              <div>
                <p className="text-xs font-semibold text-red-700">Zona admin</p>
                <p className="text-[11px] text-red-400">Regresa la tarea a "En progreso" y borra el avance de revisión.</p>
              </div>
              <button type="button" onClick={reactivateTask} disabled={busy}
                className="shrink-0 flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition disabled:opacity-50">
                <RotateCcw size={13} />
                Reactivar
              </button>
            </div>
          )}

          {/* ── Comentarios ── */}
          <div>
            <button type="button" onClick={() => setCommentsOpen(open => !open)}
              className="flex w-full items-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-left transition hover:bg-gray-50">
              <MessageSquare size={14} className="text-gray-500" />
              <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Comentarios {comments.length > 0 ? `(${comments.length})` : ''}</span>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${commentsOpen ? 'rotate-180' : ''}`} />
            </button>
            {commentsOpen && (
              <div className="mt-3">
            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
              {comments.length === 0 && (
                <p className="text-xs text-gray-400">Aún no hay comentarios, escribe el primero</p>
              )}
              {comments.map(c => {
                const canEdit = user?.id === c.user_id || isAdmin
                return (
                  <div key={c.id} className="bg-gray-50 rounded-lg px-3 py-2 group">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-gray-700">{c.user?.full_name || 'Usuario'}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400">
                          {new Date(c.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {canEdit && editingCommentId !== c.id && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                            <button type="button" onClick={() => startEditComment(c)}
                              title="Editar comentario" className="text-gray-400 hover:text-blue-500 transition">
                              <Pencil size={11} />
                            </button>
                            <button type="button" onClick={() => deleteComment(c.id)}
                              title="Borrar comentario" className="text-gray-400 hover:text-red-500 transition">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {editingCommentId === c.id ? (
                      <div className="flex gap-1.5 mt-1">
                        <input
                          autoFocus
                          value={editCommentValue}
                          onChange={e => setEditCommentValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEditComment(c.id)
                            if (e.key === 'Escape') setEditingCommentId(null)
                          }}
                          className="flex-1 border border-blue-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                        <button type="button" onClick={() => saveEditComment(c.id)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 px-2">Guardar</button>
                        <button type="button" onClick={() => setEditingCommentId(null)}
                          className="text-xs text-gray-400 hover:text-gray-600 px-1">Cancelar</button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.content}</p>
                    )}
                  </div>
                )
              })}
            </div>
            <form onSubmit={sendComment} className="flex gap-2">
              <input value={newComment} onChange={e => setNewComment(e.target.value)}
                placeholder="Escribe un comentario..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="submit" disabled={sendingComment || !newComment.trim()}
                className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                <Send size={14} />
              </button>
            </form>
              </div>
            )}
          </div>

        </div>
      </div>

      {showEditTask && (
        <EditTaskModal task={task} onClose={() => setShowEditTask(false)} onSaved={() => { setShowEditTask(false); onUpdate(); onClose() }} />
      )}
      {showArchiveTask && (
        <ArchiveTaskModal task={task} onClose={() => setShowArchiveTask(false)} onArchived={() => { setShowArchiveTask(false); onUpdate(); onClose() }} />
      )}
    </div>
  )
}

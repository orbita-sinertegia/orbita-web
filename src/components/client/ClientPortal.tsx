import { useEffect, useState, useRef } from 'react'
import { ExternalLink, Send, Camera, Loader2, PlusCircle, CheckCircle, X, ChevronDown, CheckCheck, ClipboardList, LayoutGrid, CalendarDays, Map as MapIcon, Route, MessageCircle, Link2, Clock3, Eye, Sparkles, UserRound, LogOut, Upload, FileUp, History } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, Project, Client } from '../../types'
import StatusBadge from '../shared/StatusBadge'
import PriorityBadge from '../shared/PriorityBadge'
import ClientCalendar from './ClientCalendar'
import ClientChatRoom from '../chat/ClientChatRoom'
import ClientDeliverables from '../admin/ClientDeliverables'
import RoadmapView from '../roadmap/RoadmapView'
import RequestTaskModal from './RequestTaskModal'
import Logo from '../shared/Logo'
import TopBarActions from '../shared/TopBarActions'
import StarRating from './StarRating'
import UserProfile from '../shared/UserProfile'
import { DEPT_LABELS, DEPT_COLORS, DEPT_ORDER } from '../../data/projectTemplates'
import ClientRoadmapView from '../roadmap/ClientRoadmapView'
import '../../styles/DashboardV2.css'

interface DelayEvent {
  id: string
  task_id: string | null
  responsible: 'cliente' | 'agencia'
  days: number | null
  reason: string | null
  created_at: string
}

function dueLabel(commitmentDate: string): { text: string; late: boolean } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(commitmentDate + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) return { text: `Vencida hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? '' : 's'}`, late: true }
  if (diffDays === 0) return { text: 'Vence hoy', late: false }
  return { text: `Vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`, late: false }
}

type Tab = 'mistareas' | 'progreso' | 'area' | 'calendario' | 'roadmap' | 'mihojaderuta' | 'chat' | 'entregables' | 'profile'

const CLIENT_NAV_ITEMS = [
  { id: 'mistareas' as Tab, label: 'Mis pendientes', icon: CheckCheck },
  { id: 'progreso' as Tab, label: 'Todas las tareas', icon: ClipboardList },
  { id: 'area' as Tab, label: 'Por área', icon: LayoutGrid },
  { id: 'calendario' as Tab, label: 'Calendario', icon: CalendarDays },
  { id: 'roadmap' as Tab, label: 'Hoja de Ruta', icon: MapIcon },
  { id: 'mihojaderuta' as Tab, label: 'Mi hoja de ruta', icon: Route },
  { id: 'chat' as Tab, label: 'Chat con el equipo', icon: MessageCircle },
  { id: 'entregables' as Tab, label: 'Entregables', icon: Link2 },
]

interface TaskRequest {
  id: string
  title: string
  description?: string
  department: string
  status: string
  created_at: string
  assignee?: { full_name: string }
}

export default function ClientPortal() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [clientRecord, setClientRecord] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('mistareas')
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [myRequests, setMyRequests] = useState<TaskRequest[]>([])
  const [ratings, setRatings] = useState<Record<string, { stars: number; comment: string | null }>>({})

  const [coverImage, setCoverImage] = useState<string | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [, setUploadStatus] = useState('')
  const [coverError, setCoverError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [requestingChanges, setRequestingChanges] = useState<string | null>(null)
  const [changeComment, setChangeComment] = useState('')
  const [changeImage, setChangeImage] = useState<File | null>(null)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [reviewPanelOpen, setReviewPanelOpen] = useState(true)
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set())

  // Mis pendientes: entrega y marcado de tareas del departamento cliente
  const [deliveringTaskId, setDeliveringTaskId] = useState<string | null>(null)
  const [deliverLinkUrl, setDeliverLinkUrl] = useState('')
  const [deliverError, setDeliverError] = useState('')
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [delayEvents, setDelayEvents] = useState<DelayEvent[]>([])
  const [delayHistoryOpen, setDelayHistoryOpen] = useState(false)

  useEffect(() => {
    if (user) fetchData()
    fetchPermissions()
  }, [user])

  async function fetchPermissions() {
    if (!user) return
    const [roleResult, userResult] = await Promise.all([
      supabase.from('role_permissions').select('section_key, allowed').eq('role', 'client'),
      supabase.from('user_permissions').select('section_key, allowed').eq('user_id', user.id),
    ])
    const resolved = new Map<string, boolean>()
    ;(roleResult.data || []).forEach(row => resolved.set(row.section_key, row.allowed))
    ;(userResult.data || []).forEach(row => resolved.set(row.section_key, row.allowed))
    const hidden = new Set([...resolved].filter(([, allowed]) => !allowed).map(([key]) => key))
    setHiddenSections(hidden)
    if (hidden.has(activeTab)) setActiveTab('mistareas')
  }

  useEffect(() => {
    function handleOpenChat(e: Event) {
      const room = (e as CustomEvent).detail?.room
      if (room === 'client') setActiveTab('chat')
    }
    window.addEventListener('open-chat', handleOpenChat)
    return () => window.removeEventListener('open-chat', handleOpenChat)
  }, [])

  useEffect(() => {
    const handleOpenProfile = () => setActiveTab('profile')
    window.addEventListener('open-profile', handleOpenProfile)
    return () => window.removeEventListener('open-profile', handleOpenProfile)
  }, [])

  useEffect(() => {
    const openTask = (event: Event) => {
      const taskId = (event as CustomEvent).detail?.taskId
      if (!taskId || !tasks.some(task => task.id === taskId)) return
      setActiveTab('progreso')
      setOpenTaskId(taskId)
    }
    const openProject = (event: Event) => {
      const projectId = (event as CustomEvent).detail?.projectId
      const project = projects.find(item => item.id === projectId)
      if (project) setSelectedProject(project)
      setActiveTab('progreso')
    }
    const openClient = () => setActiveTab('progreso')
    const openSection = (event: Event) => {
      const target = (event as CustomEvent).detail?.view as Tab | undefined
      if (target && !hiddenSections.has(target)) setActiveTab(target)
    }
    window.addEventListener('open-task', openTask)
    window.addEventListener('open-project', openProject)
    window.addEventListener('open-client', openClient)
    window.addEventListener('open-section', openSection)
    return () => {
      window.removeEventListener('open-task', openTask)
      window.removeEventListener('open-project', openProject)
      window.removeEventListener('open-client', openClient)
      window.removeEventListener('open-section', openSection)
    }
  }, [hiddenSections, projects, tasks])

  async function fetchData() {
    const { data: client } = await supabase.from('clients').select('*').eq('user_id', user!.id).single()
    if (!client) { setLoading(false); return }
    setClientRecord(client)
    if (client.cover_image) setCoverImage(client.cover_image)

    const { data: proj } = await supabase.from('projects').select('*, client:clients(*)').eq('client_id', client.id)
    const { data: tsk } = await supabase.from('tasks')
      .select('*, project:projects(*), assignee:users!assigned_to(full_name), links:task_links(*), comments:task_comments(*, user:users(full_name))')
      .in('project_id', (proj || []).map(p => p.id))
      .is('archived_at', null)
      .order('priority')

    setProjects(proj || [])
    setTasks(tsk || [])
    if (proj && proj.length > 0) setSelectedProject(proj[0])

    if (proj && proj.length > 0) {
      const { data: events } = await supabase
        .from('project_delay_events')
        .select('id, task_id, responsible, days, reason, created_at')
        .in('project_id', proj.map(p => p.id))
        .order('created_at', { ascending: false })
      setDelayEvents((events as DelayEvent[]) || [])
    }

    const { data: reqs } = await supabase
      .from('task_requests')
      .select('*, assignee:users!assigned_to(full_name)')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
    setMyRequests((reqs as any) || [])

    // Cargar calificaciones existentes del cliente
    if (proj && proj.length > 0) {
      const projectIds = (proj || []).map((p: any) => p.id)
      const { data: allTasks } = await supabase.from('tasks').select('id').in('project_id', projectIds)
      const taskIds = (allTasks || []).map((t: any) => t.id)
      if (taskIds.length > 0) {
        const { data: ratingData } = await supabase
          .from('task_ratings')
          .select('task_id, stars, comment')
          .eq('client_id', client.id)
          .in('task_id', taskIds)
        const ratingMap: Record<string, { stars: number; comment: string | null }> = {}
        ;(ratingData || []).forEach((r: any) => { ratingMap[r.task_id] = { stars: r.stars, comment: r.comment } })
        setRatings(ratingMap)
      }
    }

    setLoading(false)
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!clientRecord) {
      setCoverError('Error: cuenta no vinculada a cliente. Avisa al administrador.')
      return
    }
    setUploadingCover(true)
    setUploadStatus('Subiendo...')
    setCoverError('')
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${clientRecord.id}/cover.${ext}`
    const { error: upErr } = await supabase.storage
      .from('client-covers')
      .upload(path, file, { upsert: true })
    if (upErr) {
      setCoverError('Error al subir: ' + upErr.message)
      setUploadingCover(false)
      setUploadStatus('')
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('client-covers').getPublicUrl(path)
    const { error: updateErr } = await supabase.from('clients').update({ cover_image: publicUrl }).eq('id', clientRecord.id)
    if (updateErr) {
      setCoverError('Error al guardar: ' + updateErr.message)
    } else {
      setCoverImage(publicUrl + '?t=' + Date.now())
    }
    setUploadingCover(false)
    setUploadStatus('')
  }

  async function deliverLink(taskId: string) {
    const url = deliverLinkUrl.trim()
    if (!url) return
    try { new URL(url) } catch { setDeliverError('Escribe un link válido, por ejemplo https://drive.google.com/...'); return }
    setDeliverError('')
    const { error } = await supabase.from('task_links').insert({ task_id: taskId, label: 'Entregable del cliente', url })
    if (error) { setDeliverError('No se pudo guardar el link. Intenta de nuevo.'); return }
    setDeliverLinkUrl('')
    fetchData()
  }

  async function deliverFile(taskId: string, file: File) {
    if (file.size > 20 * 1024 * 1024) { setDeliverError('El archivo debe pesar máximo 20 MB'); return }
    setDeliverError('')
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const path = `task-deliverables/${taskId}/${Date.now()}_${safeName}`
    const { error: uploadError } = await supabase.storage.from('chat-files').upload(path, file, { contentType: file.type || undefined })
    if (uploadError) { setDeliverError('No se pudo subir el archivo'); return }
    const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(path)
    const { error: linkError } = await supabase.from('task_links').insert({ task_id: taskId, label: file.name, url: publicUrl })
    if (linkError) { setDeliverError('El archivo subió, pero no se pudo vincular a la tarea'); return }
    fetchData()
  }

  async function markTaskDelivered(taskId: string) {
    setCompletingTaskId(taskId)
    const { error } = await supabase.rpc('client_complete_task', { p_task_id: taskId })
    setCompletingTaskId(null)
    if (error) { setDeliverError('No se pudo marcar la tarea como entregada. Intenta de nuevo.'); return }
    setDeliveringTaskId(null)
    fetchData()
  }

  async function sendComment(taskId: string) {
    if (!comment.trim()) return
    await supabase.from('task_comments').insert({ task_id: taskId, user_id: user!.id, content: comment.trim() })
    setComment('')
    fetchData()
  }

  async function approveDeliverable(taskId: string) {
    await supabase.from('tasks').update({ client_approval: 'aprobada' }).eq('id', taskId)
    const task = tasks.find(t => t.id === taskId)
    if (task?.assigned_to) {
      await supabase.from('notifications').insert({
        user_id: task.assigned_to,
        title: '✅ Cliente aprobó el entregable',
        message: `${user?.full_name} aprobó: "${task.title}"`,
        type: 'approval',
      })
    }
    fetchData()
  }

  async function submitChangeRequest(taskId: string) {
    if (!changeComment.trim() && !changeImage) return
    setSubmittingFeedback(true)
    const task = tasks.find(t => t.id === taskId)
    const currentCount = task?.change_count ?? 0
    const newCount = currentCount + 1

    let imageUrl: string | null = null
    if (changeImage) {
      const ext = changeImage.name.split('.').pop() || 'jpg'
      const path = `task-feedback/${taskId}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('chat-files').upload(path, changeImage)
      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(path)
        imageUrl = publicUrl
      }
    }

    const changeLabel = newCount === 1 ? '1er cambio' : `${newCount}° cambio`

    await supabase.from('task_comments').insert({
      task_id: taskId,
      user_id: user!.id,
      content: `[${changeLabel}] ${changeComment.trim() || '(Sin mensaje)'}`,
      image_url: imageUrl,
    })

    await supabase.from('tasks').update({
      client_approval: 'cambios_solicitados',
      change_count: newCount,
    }).eq('id', taskId)

    const toNotify: string[] = []
    if (task?.assigned_to) toNotify.push(task.assigned_to)
    const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin')
    admins?.forEach((a: any) => { if (!toNotify.includes(a.id)) toNotify.push(a.id) })

    if (toNotify.length > 0) {
      await supabase.from('notifications').insert(
        toNotify.map(id => ({
          user_id: id,
          title: `✍️ ${changeLabel} — ${user?.full_name}`,
          message: `Solicitó cambios en: "${task?.title}"`,
          type: 'change_request',
        }))
      )
    }

    setChangeComment('')
    setChangeImage(null)
    setRequestingChanges(null)
    setSubmittingFeedback(false)
    fetchData()
  }

  const projectTasks = tasks.filter(t => t.project_id === selectedProject?.id)
  const completed = projectTasks.filter(t => t.status === 'completada').length
  const pct = projectTasks.length ? (completed / projectTasks.length) * 100 : 0
  const activeTasks = projectTasks.filter(t => t.status !== 'completada')
  const today = new Date().toISOString().slice(0, 10)
  const datedActiveTasks = activeTasks
    .filter(t => t.commitment_date && t.commitment_date >= today)
    .sort((a, b) => String(a.commitment_date).localeCompare(String(b.commitment_date)))
  const nextDelivery = datedActiveTasks[0]?.commitment_date

  // Tareas con entregables disponibles que el cliente aún no ha revisado
  const pendingReview = tasks.filter(t =>
    t.links && t.links.length > 0 &&
    (!t.review_status || t.review_status === 'aprobada') &&
    !t.client_approval
  )
  const clientApproved = tasks.filter(t => t.client_approval === 'aprobada')

  // Mis pendientes: tareas del departamento cliente, ordenadas por fecha compromiso.
  const myPendingTasks = projectTasks
    .filter(t => t.department === 'cliente' && t.status !== 'completada')
    .sort((a, b) => {
      if (!a.commitment_date && !b.commitment_date) return 0
      if (!a.commitment_date) return 1
      if (!b.commitment_date) return -1
      return a.commitment_date.localeCompare(b.commitment_date)
    })
  const projectDelayEvents = delayEvents.filter(e => projectTasks.some(t => t.id === e.task_id) || !e.task_id)

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando tu proyecto...</div>

  return (
    <div className="v2app">
      <div className="v2-shell">
        <aside className="v2-sidebar">
          <div className="v2-brand">
            <div className="v2-brand-mark"><Logo size={26} /></div>
            <div className="v2-brand-text">
              <div className="v2-brand-name">Sinertegia Launch 57</div>
              <div className="v2-brand-sub">Portal de cliente</div>
            </div>
          </div>

          {CLIENT_NAV_ITEMS.filter(item => !hiddenSections.has(item.id)).map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)}
              className={`v2-nav-item ${activeTab === id ? 'active' : ''}`}>
              <Icon size={17} />
              {label}
              {id === 'mistareas' && myPendingTasks.length > 0 && (
                <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {myPendingTasks.length}
                </span>
              )}
            </button>
          ))}
          <div className="mt-auto border-t border-white/10 pt-3">
            <button type="button" onClick={() => setActiveTab('profile')} className={`v2-profile-link ${activeTab === 'profile' ? 'active' : ''}`}>
              <UserRound size={17} /><span>Mi perfil</span>
            </button>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('request-logout'))} className="v2-logout-link">
              <LogOut size={17} /><span>Cerrar sesión</span>
            </button>
          </div>
        </aside>

        <div className="v2-main bg-[#f5f7fb]" style={{ position: 'relative' }}>
          <header className="v2-topbar">
            <span className="v2-top-title display">Mi proyecto</span>
            <div className="v2-top-spacer" />
            <button
              onClick={() => setShowRequestModal(true)}
              className="v2-btn v2-btn-primary"
            >
              <PlusCircle size={16} /> Solicitar tarea
            </button>
            <TopBarActions />
          </header>

          {/* ── Contenido principal ── */}
          <div className="v2-content" style={{ position: 'relative', zIndex: 10 }}>
          {/* Selector de proyecto */}
      {projects.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {projects.map(p => (
            <button key={p.id} onClick={() => setSelectedProject(p)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${selectedProject?.id === p.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Progress card */}
      {selectedProject && activeTab === 'mistareas' && (
        <>
          <section className="relative mb-5 min-h-[220px] overflow-hidden rounded-3xl bg-gradient-to-br from-[#0d2258] via-[#153c9d] to-[#5b35a8] text-white shadow-[0_18px_50px_rgba(21,45,110,0.18)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(255,255,255,.22),transparent_28%)]" />
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
            <div className="relative z-10 flex min-h-[220px] flex-col justify-between p-6 pr-6 md:p-8 md:pr-[230px]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-md">
                    <Sparkles size={13} /> Portal de tu proyecto
                  </div>
                  <p className="text-sm font-semibold uppercase tracking-[.14em] text-blue-100">{selectedProject.name}</p>
                  <h1 className="mt-1 text-2xl font-bold md:text-3xl">Hola, {user?.full_name?.split(' ')[0] || 'bienvenido'}</h1>
                  <p className="mt-2 max-w-xl text-sm text-blue-100 md:text-base">Consulta avances, entregas y conversaciones con tu equipo desde un solo lugar.</p>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingCover} className="mt-3 flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold md:hidden">
                    {uploadingCover ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} Cambiar imagen
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-end justify-between gap-4">
                  <span className="text-sm text-blue-100">Avance general · {completed} de {projectTasks.length} tareas</span>
                  <strong className="text-2xl">{Math.round(pct)}%</strong>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/20 ring-1 ring-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-white transition-all duration-700" style={{ width: `${Math.round(pct)}%` }} />
                </div>
              </div>
            </div>
            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingCover}
              className="absolute right-6 top-1/2 z-20 hidden h-[160px] w-[170px] -translate-y-1/2 overflow-hidden rounded-2xl border border-white/25 bg-white/10 shadow-2xl transition hover:scale-[1.02] md:block">
              {coverImage ? <img src={coverImage} alt={`Imagen de ${selectedProject.name}`} className="h-full w-full object-cover" /> : <span className="flex h-full flex-col items-center justify-center gap-2 text-sm"><Camera size={22} /> Agregar imagen</span>}
              <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 shadow-lg backdrop-blur-sm" title="Cambiar imagen">
                {uploadingCover ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              </span>
            </button>
          </section>

          {coverError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{coverError}</div>}

          <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ClipboardList size={18} /></div>
              <p className="text-2xl font-bold text-slate-900">{activeTasks.length}</p><p className="text-xs font-medium text-slate-500">Tareas activas</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Eye size={18} /></div>
              <p className="text-2xl font-bold text-slate-900">{pendingReview.length}</p><p className="text-xs font-medium text-slate-500">Por revisar</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle size={18} /></div>
              <p className="text-2xl font-bold text-slate-900">{completed}</p><p className="text-xs font-medium text-slate-500">Completadas</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Clock3 size={18} /></div>
              <p className="text-base font-bold text-slate-900">{nextDelivery ? new Date(`${nextDelivery}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : 'Sin fecha'}</p><p className="text-xs font-medium text-slate-500">Próxima entrega</p>
            </div>
          </section>
        </>
      )}

      {/* ── Panel: Actividades por revisar ── */}
      {activeTab === 'mistareas' && pendingReview.length > 0 && (
        <div className="mb-5 bg-orange-50 border border-orange-200 rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setReviewPanelOpen(!reviewPanelOpen)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-orange-100 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-orange-800">📋 Actividades por revisar</span>
              <span className="bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {pendingReview.length}
              </span>
            </div>
            <ChevronDown size={16} className={`text-orange-600 transition-transform ${reviewPanelOpen ? 'rotate-180' : ''}`} />
          </button>
          {reviewPanelOpen && (
            <div className="divide-y divide-orange-100 bg-white">
              {pendingReview.map(task => (
                <div
                  key={task.id}
                  onClick={() => { setActiveTab('progreso'); setOpenTaskId(task.id) }}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-orange-50 cursor-pointer transition"
                >
                  <span className="text-orange-400 text-lg shrink-0">📋</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${DEPT_COLORS[task.department] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {DEPT_LABELS[task.department] || task.department}
                      </span>
                      {task.project?.name && <span className="text-xs text-gray-400">{task.project.name}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-orange-600 font-semibold shrink-0">Ver →</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Panel: Tareas ya aprobadas ── */}
      {activeTab === 'mistareas' && clientApproved.length > 0 && (
        <div className="mb-5 bg-green-50 border border-green-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-green-800">✅ Ya aprobadas por ti</span>
              <span className="bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{clientApproved.length}</span>
            </div>
          </div>
          <div className="divide-y divide-green-100 bg-white">
            {clientApproved.map(task => (
              <div
                key={task.id}
                onClick={() => { setActiveTab('progreso'); setOpenTaskId(task.id) }}
                className="flex items-center gap-3 px-5 py-3 hover:bg-green-50 cursor-pointer transition"
              >
                <CheckCircle size={16} className="text-green-500 shrink-0" />
                <p className="text-sm text-gray-500 truncate line-through flex-1">{task.title}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${DEPT_COLORS[task.department] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {DEPT_LABELS[task.department] || task.department}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Mis pendientes ── */}
      {activeTab === 'mistareas' && (
        <div className="space-y-6">
          {/* Tareas asignadas al cliente (departamento cliente) */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              Mis pendientes
              {myPendingTasks.length > 0 && (
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{myPendingTasks.length}</span>
              )}
            </h3>
            {myPendingTasks.length === 0 ? (
              <div className="bg-gray-50 rounded-xl p-6 text-center text-gray-400 text-sm">
                No tienes tareas pendientes por ahora
              </div>
            ) : (
              <div className="space-y-2">
                {myPendingTasks.map(task => {
                  const due = task.commitment_date ? dueLabel(task.commitment_date) : null
                  const isDelivering = deliveringTaskId === task.id
                  return (
                    <div key={task.id} className={`bg-white border rounded-xl p-4 shadow-sm ${due?.late ? 'border-red-200' : 'border-gray-200'}`}>
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">
                          {task.status === 'en_progreso' ? <span className="text-blue-500 text-xl">▶</span> : <span className="text-gray-300 text-xl">○</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-800">{task.title}</p>
                          {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                          {due && (
                            <p className={`text-xs mt-1 font-medium ${due.late ? 'text-red-600' : 'text-gray-400'}`}>
                              {due.late ? '⚠ ' : ''}{due.text}
                              {task.delay_responsible === 'cliente' && <span className="ml-1 text-red-500">· Retraso atribuible a ti</span>}
                            </p>
                          )}
                          {task.links && task.links.length > 0 && (
                            <p className="text-xs text-blue-500 mt-1">{task.links.length} archivo{task.links.length > 1 ? 's' : ''} entregado{task.links.length > 1 ? 's' : ''}</p>
                          )}
                        </div>
                        <StatusBadge status={task.status} />
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button onClick={() => { setDeliveringTaskId(isDelivering ? null : task.id); setDeliverError(''); setDeliverLinkUrl('') }}
                          className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                          <Upload size={13} /> Subir archivo o link
                        </button>
                        <button onClick={() => markTaskDelivered(task.id)} disabled={completingTaskId === task.id}
                          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg transition disabled:opacity-60">
                          <CheckCircle size={13} /> {completingTaskId === task.id ? 'Marcando...' : 'Marcar como entregado'}
                        </button>
                      </div>

                      {isDelivering && (
                        <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2">
                          <div className="flex gap-2">
                            <input value={deliverLinkUrl} onChange={e => setDeliverLinkUrl(e.target.value)}
                              placeholder="https://..." type="url"
                              className="flex-1 border border-blue-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            <button onClick={() => deliverLink(task.id)} disabled={!deliverLinkUrl.trim()}
                              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                              Agregar link
                            </button>
                          </div>
                          <label className="flex items-center justify-center gap-2 border border-dashed border-blue-300 rounded-lg px-3 py-2 text-xs text-blue-500 hover:bg-blue-100 cursor-pointer transition">
                            <FileUp size={13} /> Subir archivo
                            <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) deliverFile(task.id, f) }} />
                          </label>
                          {deliverError && <p className="text-xs text-red-500">{deliverError}</p>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Historial de retrasos */}
          {projectDelayEvents.length > 0 && (
            <div>
              <button type="button" onClick={() => setDelayHistoryOpen(open => !open)}
                className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-left hover:bg-gray-100 transition">
                <span className="font-semibold text-gray-800 flex items-center gap-2">
                  <History size={15} className="text-gray-500" /> Historial de retrasos
                  <span className="bg-gray-200 text-gray-700 text-xs font-bold px-2 py-0.5 rounded-full">{projectDelayEvents.length}</span>
                </span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${delayHistoryOpen ? 'rotate-180' : ''}`} />
              </button>
              {delayHistoryOpen && (
                <div className="divide-y divide-gray-100 bg-white border border-gray-200 border-t-0 rounded-b-xl">
                  {projectDelayEvents.map(ev => (
                    <div key={ev.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-700">{ev.reason || (ev.responsible === 'cliente' ? 'Retraso del cliente' : 'Retraso de la agencia')}</p>
                        <p className="text-xs text-gray-400">{new Date(ev.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}{ev.days ? ` · ${ev.days} día${ev.days === 1 ? '' : 's'}` : ''}</p>
                      </div>
                      <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${ev.responsible === 'cliente' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        {ev.responsible === 'cliente' ? 'Tuyo' : 'De la agencia'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Solicitudes enviadas */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
              Mis solicitudes de tareas
            </h3>
            {myRequests.length === 0 ? (
              <div className="bg-gray-50 rounded-xl p-6 text-center text-sm text-gray-400">
                Aún no has enviado solicitudes.{' '}
                <button onClick={() => setShowRequestModal(true)} className="text-blue-600 hover:underline">
                  Solicitar una tarea
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {myRequests.map(req => (
                  <div key={req.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-800">{req.title}</p>
                        {req.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{req.description}</p>}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${DEPT_COLORS[req.department] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                            {DEPT_LABELS[req.department] || req.department}
                          </span>
                          {req.assignee && <span className="text-xs text-gray-400">{(req.assignee as any).full_name}</span>}
                          <span className="text-xs text-gray-300">
                            {new Date(req.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      </div>
                      <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                        req.status === 'pendiente' ? 'bg-orange-100 text-orange-700' :
                        req.status === 'aprobada' ? 'bg-green-100 text-green-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {req.status === 'pendiente' ? '⏳ En revisión' : req.status === 'aprobada' ? '✅ Aprobada' : '❌ No aprobada'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Progreso (lista completa) ── */}
      {activeTab === 'progreso' && (
        <div className="space-y-3">
          {projectTasks.length === 0 && (
            <div className="text-center py-12 text-gray-400">No hay tareas en este proyecto aún</div>
          )}
          {projectTasks.map(task => (
            <div key={task.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 cursor-pointer hover:bg-gray-50 transition" onClick={() => setOpenTaskId(openTaskId === task.id ? null : task.id)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                      {task.department && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${DEPT_COLORS[task.department] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {DEPT_LABELS[task.department] || task.department}
                        </span>
                      )}
                      {task.review_status === 'aprobada' && !task.client_approval && (
                        <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-orange-100 text-orange-700 border-orange-200">
                          📋 Por revisar
                        </span>
                      )}
                      {task.client_approval === 'aprobada' && (
                        <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-green-100 text-green-700 border-green-200">
                          ✅ Aprobada
                        </span>
                      )}
                      {task.client_approval === 'cambios_solicitados' && (
                        <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-blue-100 text-blue-700 border-blue-200">
                          ✍️ Cambios pedidos
                        </span>
                      )}
                    </div>
                    <p className={`font-medium ${task.status === 'completada' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {task.title}
                    </p>
                    {task.description && <p className="text-sm text-gray-500 mt-1">{task.description}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {task.commitment_date && (
                      <p className="text-xs text-gray-400">Entrega: {new Date(task.commitment_date + 'T00:00:00').toLocaleDateString('es-MX')}</p>
                    )}
                    {task.completion_date && (
                      <p className="text-xs text-green-600 font-medium">✓ {new Date(task.completion_date + 'T00:00:00').toLocaleDateString('es-MX')}</p>
                    )}
                  </div>
                </div>
              </div>

              {openTaskId === task.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
                  {/* Entregables: visibles solo si aprobados por el trafficker (o sin proceso de revisión) */}
                  {task.links && task.links.length > 0 && (!task.review_status || task.review_status === 'aprobada') && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Entregables</p>
                      <div className="space-y-1.5">
                        {task.links.map(link => (
                          <a key={link.id} href={link.url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 bg-blue-50 rounded-lg px-3 py-2 transition">
                            <ExternalLink size={13} />
                            {link.label}
                          </a>
                        ))}
                      </div>
                      {clientRecord && (
                        <StarRating
                          taskId={task.id}
                          clientId={clientRecord.id}
                          existing={ratings[task.id] || null}
                          onRated={fetchData}
                        />
                      )}

                      {/* Aprobar o solicitar cambios */}
                      {(() => {
                        const count = task.change_count ?? 0
                        const maxReached = count >= 2
                        return (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            {/* Contador de cambios */}
                            {count > 0 && (
                              <div className={`flex items-center gap-2 mb-3 text-xs font-semibold px-3 py-1.5 rounded-full w-fit ${
                                count >= 2 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {count >= 2 ? '🔴' : '🟡'} {count}/2 cambios utilizados
                              </div>
                            )}

                            {task.client_approval === 'aprobada' ? (
                              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
                                <CheckCircle size={15} />
                                <span className="font-semibold">Aprobaste este entregable</span>
                              </div>
                            ) : task.client_approval === 'cambios_solicitados' ? (
                              <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-700">
                                <p className="font-semibold">✍️ Cambios solicitados ({count === 1 ? '1er cambio' : `${count}° cambio`})</p>
                                <p className="text-xs mt-0.5 text-orange-600">El equipo fue notificado y está trabajando en ello.</p>
                                {maxReached && <p className="text-xs mt-1 text-red-600 font-semibold">Has alcanzado el límite de 2 cambios para esta tarea.</p>}
                              </div>
                            ) : (
                              <>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => approveDeliverable(task.id)}
                                    className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-lg transition"
                                  >
                                    ✅ Aprobar entregable
                                  </button>
                                  {!maxReached ? (
                                    <button
                                      onClick={() => { setRequestingChanges(task.id); setChangeComment(''); setChangeImage(null) }}
                                      className="flex-1 flex items-center justify-center gap-2 border border-orange-300 text-orange-600 hover:bg-orange-50 text-sm font-semibold py-2.5 rounded-lg transition"
                                    >
                                      ✍️ Solicitar cambios {count > 0 && `(${count + 1}/2)`}
                                    </button>
                                  ) : (
                                    <div className="flex-1 flex items-center justify-center text-xs text-red-500 border border-red-200 rounded-lg py-2.5 bg-red-50">
                                      🔴 Límite de cambios alcanzado
                                    </div>
                                  )}
                                </div>

                                {requestingChanges === task.id && (
                                  <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
                                    <p className="text-sm font-semibold text-orange-800">
                                      ✍️ {count === 0 ? '1er cambio' : `${count + 1}° cambio`} — ¿Qué necesitas cambiar?
                                    </p>
                                    <textarea
                                      value={changeComment}
                                      onChange={e => setChangeComment(e.target.value)}
                                      rows={3}
                                      placeholder="Describe los cambios que necesitas..."
                                      className="w-full border border-orange-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none bg-white"
                                    />
                                    <div>
                                      <label className="flex items-center gap-2 cursor-pointer text-sm text-orange-700 hover:text-orange-900 w-fit">
                                        <Camera size={15} />
                                        <span>{changeImage ? changeImage.name : 'Adjuntar captura de pantalla (opcional)'}</span>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={e => setChangeImage(e.target.files?.[0] || null)}
                                        />
                                      </label>
                                      {changeImage && (
                                        <div className="mt-2 relative inline-block">
                                          <img
                                            src={URL.createObjectURL(changeImage)}
                                            alt="preview"
                                            className="h-24 rounded-lg object-cover border border-orange-200"
                                          />
                                          <button
                                            onClick={() => setChangeImage(null)}
                                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center"
                                          >
                                            <X size={11} />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => submitChangeRequest(task.id)}
                                        disabled={submittingFeedback || (!changeComment.trim() && !changeImage)}
                                        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                                      >
                                        {submittingFeedback ? 'Enviando...' : 'Enviar solicitud de cambios'}
                                      </button>
                                      <button
                                        onClick={() => { setRequestingChanges(null); setChangeComment(''); setChangeImage(null) }}
                                        className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )}
                  {/* Entregable en revisión: aviso al cliente */}
                  {task.links && task.links.length > 0 && task.review_status === 'pendiente_revision' && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                      <p className="text-xs font-semibold text-yellow-700">🔍 Entregable en revisión</p>
                      <p className="text-xs text-yellow-600 mt-1">
                        El equipo terminó este entregable. Está siendo revisado antes de publicarse aquí.
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Comentarios</p>
                    {task.comments && task.comments.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {(task.comments as any[]).map((c: any) => (
                          <div key={c.id} className="bg-white rounded-lg px-3 py-2 border border-gray-200">
                            <p className="text-xs font-semibold text-gray-600">{c.user?.full_name}</p>
                            <p className="text-sm text-gray-700 mt-0.5">{c.content}</p>
                            {c.image_url && (
                              <a href={c.image_url} target="_blank" rel="noreferrer" className="mt-2 block">
                                <img src={c.image_url} alt="captura" className="max-h-48 rounded-lg border border-gray-200 object-cover hover:opacity-90 transition" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input value={comment} onChange={e => setComment(e.target.value)}
                        placeholder="Escribe un comentario o pregunta..."
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <button onClick={() => sendComment(task.id)}
                        className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition">
                        <Send size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Tab: Por área ── */}
      {activeTab === 'area' && (
        <div className="space-y-4">
          {DEPT_ORDER.filter(dept => projectTasks.some(t => t.department === dept)).map(dept => {
            const deptTasks = projectTasks.filter(t => t.department === dept)
            const deptCompleted = deptTasks.filter(t => t.status === 'completada').length
            const deptPct = deptTasks.length ? Math.round((deptCompleted / deptTasks.length) * 100) : 0
            const colorClass = DEPT_COLORS[dept] || 'bg-gray-100 text-gray-700 border-gray-200'

            return (
              <div key={dept} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Department header */}
                <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${colorClass}`}>
                    {DEPT_LABELS[dept]}
                  </span>
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full transition-all ${deptPct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${deptPct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-500">{deptCompleted}/{deptTasks.length} · {deptPct}%</span>
                </div>

                {/* Tasks */}
                <div className="divide-y divide-gray-50">
                  {deptTasks.map(task => {
                    const isLate = task.commitment_date && task.status !== 'completada' && new Date(task.commitment_date) < new Date()
                    return (
                      <div key={task.id} className={`flex items-center gap-3 px-5 py-3 ${isLate ? 'bg-red-50' : ''}`}>
                        <div className="shrink-0">
                          {task.status === 'completada'
                            ? <span className="text-green-500 text-lg">✓</span>
                            : task.status === 'en_progreso'
                            ? <span className="text-blue-500 text-lg">▶</span>
                            : task.status === 'bloqueada'
                            ? <span className="text-red-500 text-lg">⛔</span>
                            : <span className="text-gray-300 text-lg">○</span>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${task.status === 'completada' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                            {task.title}
                          </p>
                          {(task.assignee as any)?.full_name && (
                            <p className="text-xs text-gray-400">{(task.assignee as any).full_name}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {task.commitment_date && (
                            <p className={`text-xs font-medium ${isLate ? 'text-red-600' : 'text-gray-400'}`}>
                              {isLate && '⚠ '}
                              {new Date(task.commitment_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                            </p>
                          )}
                          {task.status === 'completada' && task.completion_date && (
                            <p className="text-xs text-green-600">
                              ✓ {new Date(task.completion_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Tab: Calendario ── */}
      {activeTab === 'calendario' && (
        <ClientCalendar tasks={projectTasks} />
      )}

      {/* ── Tab: Hoja de Ruta ── */}
      {activeTab === 'roadmap' && (
        <RoadmapView tasks={projectTasks} title={selectedProject?.name} />
      )}

      {/* ── Tab: Mi hoja de ruta (fases, hitos y lanzamiento, sin nombres internos) ── */}
      {activeTab === 'mihojaderuta' && selectedProject && (
        <ClientRoadmapView project={selectedProject} tasks={projectTasks} delayEvents={projectDelayEvents} mode="cliente" />
      )}
      {activeTab === 'mihojaderuta' && !selectedProject && (
        <div className="text-center py-12 text-gray-400"><p className="text-sm">Todavía no tienes un proyecto asignado.</p></div>
      )}

      {/* ── Tab: Chat con el equipo ── */}
      {activeTab === 'chat' && clientRecord && (
        <div className="h-[calc(100vh-150px)] min-h-[520px]">
          <ClientChatRoom client={clientRecord} projectName={selectedProject?.name} />
        </div>
      )}
      {activeTab === 'chat' && !clientRecord && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No se encontró tu perfil de cliente.</p>
        </div>
      )}

      {/* Entregables: solo tareas autorizadas por el trafficker */}
      {activeTab === 'entregables' && clientRecord && (
        <ClientDeliverables fixedClientId={clientRecord.id} onlyApproved={true} />
      )}
      {activeTab === 'entregables' && !clientRecord && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No se encontró tu perfil de cliente.</p>
        </div>
      )}

      {activeTab === 'profile' && (
        <UserProfile
          embedded
          onChangePhoto={() => window.dispatchEvent(new CustomEvent('change-profile-photo'))}
          onChangePassword={() => window.dispatchEvent(new CustomEvent('change-profile-password'))}
        />
      )}

          </div>{/* fin v2-content */}
        </div>{/* fin v2-main */}
      </div>{/* fin v2-shell */}

      {/* Modal solicitar tarea */}
      {showRequestModal && clientRecord && (
        <RequestTaskModal
          client={clientRecord}
          project={selectedProject}
          onClose={() => setShowRequestModal(false)}
          onSent={() => setShowRequestModal(false)}
        />
      )}
    </div>
  )
}

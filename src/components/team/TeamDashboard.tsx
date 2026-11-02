import { useEffect, useState, useRef } from 'react'
import { MessageSquare, CheckCircle, Clock, ClipboardList, MessageCircle, Map as MapIcon, Plus, CalendarDays, Link2, Loader2, XCircle, FileText, ChevronDown, Home, AlertTriangle, ArrowRight, PlayCircle, Eye, UserRound, PanelLeftClose, PanelLeftOpen, LogOut, Route } from 'lucide-react'
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, Project, User, Priority } from '../../types'
import PriorityBadge from '../shared/PriorityBadge'
import StatusBadge from '../shared/StatusBadge'
import Logo from '../shared/Logo'
import TopBarActions from '../shared/TopBarActions'
import '../../styles/DashboardV2.css'
import TaskDetailModal from './TaskDetailModal'
import TeamMessagingHub from '../chat/TeamMessagingHub'
import ClientChatsHub from '../chat/ClientChatsHub'
import RoadmapView from '../roadmap/RoadmapView'
import TeamCalendarView from './TeamCalendarView'
import CreateTaskModal from '../admin/CreateTaskModal'
import ClientDeliverables from '../admin/ClientDeliverables'
import ClientRoadmapsManager from '../admin/ClientRoadmapsManager'
import UserProfile from '../shared/UserProfile'

type TeamView = 'today' | 'tasks' | 'calendar' | 'roadmap' | 'client_roadmaps' | 'chat_team' | 'chat_clients' | 'entregables' | 'profile'

// client_roadmaps es opcional y apagada por defecto — solo aparece si un admin la activa
// explícitamente en Permisos (ver fetchPermissions).
const TEAM_NAV_ITEMS = [
  { id: 'today' as TeamView, label: 'Mi día', icon: Home },
  { id: 'tasks' as TeamView, label: 'Mis tareas', icon: ClipboardList },
  { id: 'calendar' as TeamView, label: 'Mi Calendario', icon: CalendarDays },
  { id: 'roadmap' as TeamView, label: 'Hoja de Ruta', icon: MapIcon },
  { id: 'client_roadmaps' as TeamView, label: 'Hoja de ruta de clientes', icon: Route },
  { id: 'chat_team' as TeamView, label: 'Chat del Equipo', icon: MessageSquare },
  { id: 'chat_clients' as TeamView, label: 'Chat con Clientes', icon: MessageCircle },
  { id: 'entregables' as TeamView, label: 'Entregables', icon: Link2 },
]

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const PRIORITY_CHART: Record<Priority, { label: string; color: string }> = {
  critica: { label: 'Crítica', color: '#ef4444' },
  alta: { label: 'Alta', color: '#f97316' },
  media: { label: 'Media', color: '#eab308' },
  baja: { label: 'Baja', color: '#22c55e' },
}

interface Props {
  embedded?: boolean
}

export default function TeamDashboard({ embedded = false }: Props) {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [reviewTasks, setReviewTasks] = useState<Task[]>([])
  const [myReviewTasks, setMyReviewTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [teamMembers, setTeamMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [filter, setFilter] = useState<'todas' | 'pendiente' | 'en_progreso' | 'completada'>('todas')
  const [clientFilter, setClientFilter] = useState<string>('todos')
  const [clientFilterOpen, setClientFilterOpen] = useState(false)
  const [clientFilterPos, setClientFilterPos] = useState({ top: 0, left: 0 })
  const clientFilterBtnRef = useRef<HTMLButtonElement>(null)
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'todos'>('todos')
  const [priorityFilterOpen, setPriorityFilterOpen] = useState(false)
  const [priorityFilterPos, setPriorityFilterPos] = useState({ top: 0, left: 0 })
  const priorityFilterBtnRef = useRef<HTMLButtonElement>(null)
  const [teamView, setTeamView] = useState<TeamView>(embedded ? 'tasks' : 'today')
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const isTraffickerOrLider = user?.department === 'trafficker' || user?.department === 'lider'

  useEffect(() => {
    if (user) {
      fetchTasks()
      fetchProjects()
      fetchTeamMembers()
      fetchMyReviewTasks()
      if (isTraffickerOrLider) fetchReviewTasks()
      fetchPermissions()
    }
  }, [user])

  useEffect(() => {
    if (!user?.id) return
    const refreshTasks = () => { void fetchTasks() }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshTasks()
    }
    const channel = supabase
      .channel(`my-tasks-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tasks',
        filter: `assigned_to=eq.${user.id}`,
      }, refreshTasks)
      .subscribe()

    window.addEventListener('focus', refreshTasks)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshTasks)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      void supabase.removeChannel(channel)
    }
  }, [user?.id])

  async function fetchPermissions() {
    const [roleResult, userResult] = await Promise.all([
      supabase.from('role_permissions').select('section_key, allowed').eq('role', 'team'),
      supabase.from('user_permissions').select('section_key, allowed').eq('user_id', user!.id),
    ])
    const resolved = new Map<string, boolean>()
    ;(roleResult.data || []).forEach(row => resolved.set(row.section_key, row.allowed))
    ;(userResult.data || []).forEach(row => resolved.set(row.section_key, row.allowed))
    const hidden = new Set([...resolved].filter(([, allowed]) => !allowed).map(([key]) => key))
    // client_roadmaps es la única sección del equipo apagada por defecto: solo se ve si
    // un admin la activó explícitamente (allowed: true) en Permisos.
    if (resolved.get('client_roadmaps') !== true) hidden.add('client_roadmaps')
    setHiddenSections(hidden)
    if (hidden.has(teamView)) setTeamView(embedded ? 'tasks' : 'today')
  }

  useEffect(() => {
    async function handleOpenTask(e: Event) {
      const taskId = (e as CustomEvent).detail?.taskId
      const taskTitle = (e as CustomEvent).detail?.taskTitle
      setTeamView('tasks')
      setFilter('todas')
      setClientFilter('todos')
      setPriorityFilter('todos')

      let query = supabase
        .from('tasks')
        .select('*, project:projects(*, client:clients(*)), links:task_links(*), comments:task_comments(content, created_at)')
      if (taskId) query = query.eq('id', taskId)
      else if (taskTitle) query = query.eq('assigned_to', user!.id).ilike('title', taskTitle)
      else return

      const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) {
        setFocusedTaskId(data.id)
        setSelectedTask(data as Task)
      }
    }
    window.addEventListener('open-task', handleOpenTask)
    return () => window.removeEventListener('open-task', handleOpenTask)
  }, [user])

  useEffect(() => {
    if (teamView !== 'tasks' || !focusedTaskId) return
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-task-id="${focusedTaskId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [teamView, focusedTaskId])

  useEffect(() => {
    const openProfile = () => setTeamView('profile')
    window.addEventListener('open-profile', openProfile)
    return () => window.removeEventListener('open-profile', openProfile)
  }, [])

  useEffect(() => {
    const openProject = () => setTeamView('roadmap')
    const openClient = () => setTeamView('chat_clients')
    const openPerson = () => setTeamView('chat_team')
    const openSection = (event: Event) => {
      const target = (event as CustomEvent).detail?.view as TeamView | undefined
      if (target && !hiddenSections.has(target)) setTeamView(target)
    }
    window.addEventListener('open-project', openProject)
    window.addEventListener('open-client', openClient)
    window.addEventListener('open-person', openPerson)
    window.addEventListener('open-section', openSection)
    return () => {
      window.removeEventListener('open-project', openProject)
      window.removeEventListener('open-client', openClient)
      window.removeEventListener('open-person', openPerson)
      window.removeEventListener('open-section', openSection)
    }
  }, [hiddenSections])

  useEffect(() => {
    document.documentElement.classList.toggle('ui-compact', localStorage.getItem('sinertegia-compact') === 'true')
  }, [])

  useEffect(() => {
    function handleOpenChat(e: Event) {
      const room = (e as CustomEvent).detail?.room
      if (room === 'team') setTeamView('chat_team')
      else if (room === 'client') setTeamView('chat_clients')
    }
    window.addEventListener('open-chat', handleOpenChat)
    return () => window.removeEventListener('open-chat', handleOpenChat)
  }, [])

  async function fetchTasks() {
    const { data } = await supabase
      .from('tasks')
      .select('*, project:projects(*, client:clients(*)), links:task_links(*), comments:task_comments(content, created_at)')
      .eq('assigned_to', user!.id)
      .is('archived_at', null)
      .order('priority', { ascending: true })
      .order('commitment_date', { ascending: true })
    setTasks(data || [])
    setLoading(false)
  }

  async function fetchProjects() {
    const { data } = await supabase
      .from('projects')
      .select('*, client:clients(*)')
      .eq('status', 'activo')
      .order('name')
    setProjects(data || [])
  }

  async function fetchTeamMembers() {
    const { data } = await supabase
      .from('users')
      .select('*')
      .in('role', ['team', 'admin'])
      .order('full_name')
    setTeamMembers(data || [])
  }

  async function fetchMyReviewTasks() {
    // Solo mostrar tareas que aún están esperando la revisión del usuario
    // Excluir las que ya fueron procesadas (aprobadas o con cambios solicitados)
    const { data } = await supabase
      .from('tasks')
      .select('*, project:projects(*, client:clients(*)), links:task_links(*)')
      .eq('review_status', 'pendiente_revision')
      .is('archived_at', null)
      .or(`reviewer_id.eq.${user!.id},approver_ids.cs.{${user!.id}}`)
      .order('created_at', { ascending: false })
    setMyReviewTasks((data as any) || [])
  }

  async function fetchReviewTasks() {
    const { data } = await supabase
      .from('tasks')
      .select('*, project:projects(*, client:clients(*)), links:task_links(*)')
      .is('archived_at', null)
      .or('review_status.eq.pendiente_revision,review_status.eq.pendiente_trafficker,client_approval.eq.cambios_solicitados')
      .order('created_at', { ascending: false })
    setReviewTasks((data as any) || [])
  }

  const byStatus = filter === 'todas' ? tasks.filter(t => t.status !== 'completada') : tasks.filter(t => t.status === filter)
  const byClient = clientFilter === 'todos' ? byStatus : byStatus.filter(t => t.project?.client?.name === clientFilter)
  const isOverdue = (t: Task) => t.commitment_date && t.status !== 'completada' && new Date(t.commitment_date) < new Date()
  const filtered = (priorityFilter === 'todos' ? byClient : byClient.filter(t => t.priority === priorityFilter)).slice().sort((a, b) => {
    const overdueDiff = Number(isOverdue(b)) - Number(isOverdue(a))
    if (overdueDiff) return overdueDiff
    const dateA = a.commitment_date ? new Date(a.commitment_date).getTime() : Number.MAX_SAFE_INTEGER
    const dateB = b.commitment_date ? new Date(b.commitment_date).getTime() : Number.MAX_SAFE_INTEGER
    return dateA - dateB
  })
  const clientOptions = Array.from(new Set(tasks.map(t => t.project?.client?.name).filter((n): n is string => !!n))).sort()
  const priorityOptions = (['critica', 'alta', 'media', 'baja'] as Priority[]).filter(p => tasks.some(t => t.priority === p))
  const visibleNavItems = TEAM_NAV_ITEMS.filter(item => !hiddenSections.has(item.id))

  const stats = {
    total: tasks.length,
    pendiente: tasks.filter(t => t.status === 'pendiente').length,
    en_progreso: tasks.filter(t => t.status === 'en_progreso').length,
    completada: tasks.filter(t => t.status === 'completada').length,
    vencidas: tasks.filter(isOverdue).length,
  }

  // Distribución de prioridades para la gráfica de dona
  const priorityData = [
    ...(Object.keys(PRIORITY_CHART) as Priority[]).map(priority => ({
      name: PRIORITY_CHART[priority].label,
      value: tasks.filter(task => task.status !== 'completada' && task.priority === priority).length,
      color: PRIORITY_CHART[priority].color,
    })),
    { name: 'Completadas', value: tasks.filter(task => task.status === 'completada').length, color: '#10B981' },
  ].filter(item => item.value > 0)

  // Tareas completadas por día de la semana (acumulado Lun → Dom)
  // Usa completion_date si existe; si no, cae a updated_at (que siempre se llena al cambiar de estatus)
  const completedByWeekday = WEEKDAYS.map(() => 0)
  tasks.forEach(t => {
    if (t.status === 'completada') {
      const dateStr = t.completion_date ? t.completion_date + 'T00:00:00' : t.updated_at
      if (!dateStr) return
      const jsDay = new Date(dateStr).getDay()
      const idx = jsDay === 0 ? 6 : jsDay - 1
      completedByWeekday[idx]++
    }
  })
  let runningTotal = 0
  const weeklyProgress = WEEKDAYS.map((day, i) => {
    runningTotal += completedByWeekday[i]
    return { day, completadas: runningTotal }
  })

  // Próximas 3 entregas (no completadas, con fecha de compromiso)
  const upcoming = tasks
    .filter(t => t.status !== 'completada' && t.commitment_date)
    .sort((a, b) => new Date(a.commitment_date!).getTime() - new Date(b.commitment_date!).getTime())
    .slice(0, 3)

  const localDateKey = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const todayKey = localDateKey(new Date())
  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  const activeTasks = tasks.filter(t => t.status !== 'completada')
  const todayTasks = activeTasks.filter(t => t.commitment_date?.slice(0, 10) === todayKey)
  const inProgressTasks = activeTasks.filter(t => t.status === 'en_progreso')
  const overdueTasks = activeTasks.filter(isOverdue)
  const completedThisWeek = tasks.filter(t => {
    if (t.status !== 'completada') return false
    const value = t.completion_date || t.updated_at
    return value ? new Date(value).getTime() >= weekStart.getTime() : false
  })
  const priorityWeight: Record<Priority, number> = { critica: 0, alta: 1, media: 2, baja: 3 }
  const priorityTasks = activeTasks.slice().sort((a, b) => {
    const overdueDiff = Number(isOverdue(b)) - Number(isOverdue(a))
    if (overdueDiff) return overdueDiff
    const dateA = a.commitment_date ? new Date(a.commitment_date).getTime() : Number.MAX_SAFE_INTEGER
    const dateB = b.commitment_date ? new Date(b.commitment_date).getTime() : Number.MAX_SAFE_INTEGER
    return priorityWeight[a.priority] - priorityWeight[b.priority] || dateA - dateB
  }).slice(0, 3)
  const currentTask = inProgressTasks[0] || priorityTasks[0]
  const attentionItems = [
    ...myReviewTasks.slice(0, 2).map(task => ({ task, label: 'Esperando tu revisión', color: 'purple' })),
    ...overdueTasks.slice(0, 2).map(task => ({ task, label: 'Tarea vencida', color: 'red' })),
    ...activeTasks.filter(t => t.review_status === 'cambios_solicitados' || t.client_approval === 'cambios_solicitados').slice(0, 2).map(task => ({ task, label: 'Cambios solicitados', color: 'orange' })),
    ...activeTasks.filter(t => !t.commitment_date).slice(0, 2).map(task => ({ task, label: 'Falta fecha de compromiso', color: 'amber' })),
  ].filter((item, index, array) => array.findIndex(other => other.task.id === item.task.id) === index).slice(0, 4)

  const formatShortDate = (value?: string) => value
    ? new Date(value.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    : 'Sin fecha'

  const nextActionFor = (task: Task) => {
    if (task.review_status === 'cambios_solicitados' || task.client_approval === 'cambios_solicitados') return { label: 'Corregir cambios', tone: 'orange' }
    if (!task.commitment_date) return { label: 'Agregar fecha', tone: 'amber' }
    if (task.status === 'pendiente') return { label: 'Empezar', tone: 'blue' }
    if (!task.links?.length) return { label: 'Adjuntar entregable', tone: 'purple' }
    if (!task.review_status) return { label: 'Enviar a revisión', tone: 'green' }
    return { label: 'Abrir tarea', tone: 'gray' }
  }

  async function handleNextAction(task: Task, event: React.MouseEvent) {
    event.stopPropagation()
    if (nextActionFor(task).label === 'Empezar') {
      await supabase.from('tasks').update({ status: 'en_progreso', start_date: todayKey }).eq('id', task.id)
      await fetchTasks()
      return
    }
    setSelectedTask(task)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando tareas...</div>

  const reviewBanners = (
    <>
      {/* Paneles de revisión para trafficker/lider */}
      {isTraffickerOrLider && reviewTasks.length > 0 && (() => {
        const pendingAuth = reviewTasks.filter((task) => {
          if (task.review_status !== 'pendiente_revision' && task.review_status !== 'pendiente_trafficker') return false
          const approverIds = task.approver_ids?.length ? task.approver_ids : (task.approver_id ? [task.approver_id] : [])
          return task.reviewer_id === user?.id || (!!user?.id && approverIds.includes(user.id))
        })
        const clientChanges = reviewTasks.filter((t: any) => t.client_approval === 'cambios_solicitados')
        return (
          <div className="mb-5 space-y-3">
            {pendingAuth.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <p className="text-sm font-bold text-yellow-800 mb-3">
                  🔍 {pendingAuth.length} tarea{pendingAuth.length > 1 ? 's' : ''} esperando tu autorización
                </p>
                <div className="space-y-2">
                  {pendingAuth.map((t: any) => (
                    <div key={t.id}
                      onClick={() => setSelectedTask(t)}
                      className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-yellow-100 cursor-pointer hover:border-yellow-300 transition">
                      <span className="text-yellow-500 shrink-0">🔍</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{t.title}</p>
                        <p className="text-xs text-gray-400">{t.project?.client?.name} — {t.project?.name}</p>
                      </div>
                      <span className="text-xs text-yellow-700 font-semibold bg-yellow-100 px-2 py-0.5 rounded-full shrink-0">Autorizar</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {clientChanges.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p className="text-sm font-bold text-orange-800 mb-3">
                  ✍️ {clientChanges.length} cliente{clientChanges.length > 1 ? 's solicitaron' : ' solicitó'} cambios
                </p>
                <div className="space-y-2">
                  {clientChanges.map((t: any) => (
                    <div key={t.id}
                      onClick={() => setSelectedTask(t)}
                      className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-orange-100 cursor-pointer hover:border-orange-300 transition">
                      <span className="text-orange-500 shrink-0">✍️</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{t.title}</p>
                        <p className="text-xs text-gray-400">{t.project?.client?.name} — {t.project?.name}</p>
                      </div>
                      <span className="text-xs text-orange-700 font-semibold bg-orange-100 px-2 py-0.5 rounded-full shrink-0">Ver cambios</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Panel: Tareas que me toca revisar (para cualquier miembro del equipo) */}
      {!isTraffickerOrLider && myReviewTasks.length > 0 && (
        <div className="mb-5">
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <p className="text-sm font-bold text-purple-800 mb-3">
              👀 {myReviewTasks.length} tarea{myReviewTasks.length > 1 ? 's' : ''} esperando tu revisión
            </p>
            <div className="space-y-2">
              {myReviewTasks.map((t: any) => (
                <div key={t.id}
                  onClick={() => setSelectedTask(t)}
                  className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-purple-100 cursor-pointer hover:border-purple-300 transition">
                  <span className="text-purple-500 shrink-0">👀</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{t.title}</p>
                    <p className="text-xs text-gray-400">{t.project?.client?.name} — {t.project?.name}</p>
                  </div>
                  <span className="text-xs text-purple-700 font-semibold bg-purple-100 px-2 py-0.5 rounded-full shrink-0">Revisar</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )

  const otherViews = (
    <>
      {/* Vista: Mi Calendario */}
      {teamView === 'calendar' && (
        <TeamCalendarView tasks={tasks} onSelectTask={setSelectedTask} onTasksChange={fetchTasks} />
      )}

      {/* Vista: Hoja de Ruta */}
      {teamView === 'roadmap' && <RoadmapView tasks={tasks} title="Mis tareas en el tiempo" onSelectTask={setSelectedTask} />}

      {/* Vista: Hoja de ruta de clientes (opcional, solo si un admin la activó) */}
      {teamView === 'client_roadmaps' && <ClientRoadmapsManager restricted />}

      {/* Vista: Chat del Equipo */}
      {teamView === 'chat_team' && <TeamMessagingHub />}

      {/* Vista: Chat con Clientes */}
      {teamView === 'chat_clients' && <ClientChatsHub />}

      {/* Vista: Entregables */}
      {teamView === 'entregables' && <ClientDeliverables />}

      {teamView === 'profile' && (
        <UserProfile
          embedded
          onChangePhoto={() => window.dispatchEvent(new CustomEvent('change-profile-photo'))}
          onChangePassword={() => window.dispatchEvent(new CustomEvent('change-profile-password'))}
        />
      )}
    </>
  )

  const taskTable = (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm v2-table-wrap">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 min-w-[220px]">Tarea</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                <button type="button" ref={clientFilterBtnRef} onClick={() => {
                  if (!clientFilterOpen && clientFilterBtnRef.current) {
                    const rect = clientFilterBtnRef.current.getBoundingClientRect()
                    setClientFilterPos({ top: rect.bottom + 4, left: rect.left })
                  }
                  setClientFilterOpen(o => !o)
                }}
                  className="flex items-center gap-1 hover:text-gray-900 transition">
                  Cliente
                  {clientFilter !== 'todos' && <span className="text-blue-600 font-normal">({clientFilter})</span>}
                  <ChevronDown size={13} />
                </button>
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Estatus</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                <button type="button" ref={priorityFilterBtnRef} onClick={() => {
                  if (!priorityFilterOpen && priorityFilterBtnRef.current) {
                    const rect = priorityFilterBtnRef.current.getBoundingClientRect()
                    setPriorityFilterPos({ top: rect.bottom + 4, left: rect.left })
                  }
                  setPriorityFilterOpen(o => !o)
                }}
                  className="flex items-center gap-1 hover:text-gray-900 transition">
                  Prioridad
                  {priorityFilter !== 'todos' && <span className="text-blue-600 font-normal">({PRIORITY_CHART[priorityFilter].label})</span>}
                  <ChevronDown size={13} />
                </button>
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Próxima acción</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap" title="Fecha de compromiso de entrega">Fecha de entrega</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Entregables</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Comentarios</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">No hay tareas en esta categoría</td></tr>
            )}
            {filtered.map(task => (
              <tr
                key={task.id}
                data-task-id={task.id}
                className={`hover:bg-gray-50 cursor-pointer transition ${focusedTaskId === task.id ? 'notification-task-focus' : isOverdue(task) ? 'bg-red-50' : ''}`}
                onClick={() => setSelectedTask(task)}
              >
                <td className="px-4 py-3 max-w-[260px]">
                  <div className="flex items-center gap-2">
                    {task.status === 'completada'
                      ? <CheckCircle size={16} className="text-green-500 shrink-0" />
                      : <Clock size={16} className={`shrink-0 ${isOverdue(task) ? 'text-red-500' : 'text-gray-400'}`} />
                    }
                    <span className={`font-medium truncate ${task.status === 'completada' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {task.title}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{task.project?.client?.name || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={task.status} /></td>
                <td className="px-4 py-3 whitespace-nowrap"><PriorityBadge priority={task.priority} /></td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {(() => {
                    const action = nextActionFor(task)
                    const tone = action.tone === 'blue' ? 'bg-blue-600 text-white hover:bg-blue-700' : action.tone === 'orange' ? 'bg-orange-50 text-orange-700 border-orange-200' : action.tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200' : action.tone === 'purple' ? 'bg-purple-50 text-purple-700 border-purple-200' : action.tone === 'green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-600 border-gray-200'
                    return <button type="button" onClick={event => handleNextAction(task, event)} className={`rounded-lg border border-transparent px-2.5 py-1 text-xs font-semibold transition ${tone}`}>{action.label}</button>
                  })()}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`flex items-center gap-1 text-xs ${isOverdue(task) ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                    <CalendarDays size={12} className="shrink-0" />
                    {task.commitment_date ? new Date(task.commitment_date).toLocaleDateString('es-MX') : '—'}
                    {isOverdue(task) && ' ⚠️'}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`flex items-center gap-1 text-xs ${task.links && task.links.length > 0 ? 'text-blue-500' : 'text-gray-300'}`}>
                    <FileText size={14} />
                    {task.links && task.links.length > 0 && task.links.length}
                  </span>
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  {(() => {
                    const taskComments = ((task.comments as any[]) || []).slice()
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                    const latest = taskComments[taskComments.length - 1]
                    if (!latest) {
                      return (
                        <span className="flex items-center gap-1 text-gray-300 text-xs">
                          <MessageSquare size={14} />
                        </span>
                      )
                    }
                    return (
                      <span title={latest.content} className="flex items-center gap-1.5 text-xs text-blue-600 min-w-0">
                        <MessageSquare size={14} className="shrink-0" />
                        <span className="truncate min-w-0">{latest.content}</span>
                        {taskComments.length > 1 && (
                          <span className="shrink-0 bg-blue-100 text-blue-700 rounded-full px-1.5 text-[10px] font-semibold">
                            +{taskComments.length - 1}
                          </span>
                        )}
                      </span>
                    )
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {clientFilterOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setClientFilterOpen(false)} />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-72 overflow-y-auto"
            style={{ top: clientFilterPos.top, left: clientFilterPos.left }}
          >
            <button type="button" onClick={() => { setClientFilter('todos'); setClientFilterOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-gray-50 transition ${clientFilter === 'todos' ? 'text-blue-600' : 'text-gray-700'}`}>
              Todos los clientes
            </button>
            {clientOptions.map(name => (
              <button key={name} type="button" onClick={() => { setClientFilter(name); setClientFilterOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-gray-50 transition ${clientFilter === name ? 'text-blue-600' : 'text-gray-700'}`}>
                {name}
              </button>
            ))}
          </div>
        </>
      )}

      {priorityFilterOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPriorityFilterOpen(false)} />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ top: priorityFilterPos.top, left: priorityFilterPos.left }}
          >
            <button type="button" onClick={() => { setPriorityFilter('todos'); setPriorityFilterOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-gray-50 transition ${priorityFilter === 'todos' ? 'text-blue-600' : 'text-gray-700'}`}>
              Todas las prioridades
            </button>
            {priorityOptions.map(p => (
              <button key={p} type="button" onClick={() => { setPriorityFilter(p); setPriorityFilterOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-gray-50 transition flex items-center gap-2 ${priorityFilter === p ? 'text-blue-600' : 'text-gray-700'}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_CHART[p].color }} />
                {PRIORITY_CHART[p].label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  const filterPills = (
    <div className="flex gap-2 mb-4">
      {(['todas', 'pendiente', 'en_progreso', 'completada'] as const).map(f => (
        <button
          key={f}
          onClick={() => setFilter(f)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${filter === f ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          {f === 'todas' ? 'Todas' : f === 'en_progreso' ? 'En progreso' : f.charAt(0).toUpperCase() + f.slice(1)}
        </button>
      ))}
    </div>
  )

  const taskModals = (
    <>
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => { fetchTasks(); fetchMyReviewTasks() }}
          onReviewDone={(taskId) => setMyReviewTasks(prev => prev.filter(t => t.id !== taskId))}
        />
      )}

      {showCreateTask && (
        <CreateTaskModal
          projects={projects}
          teamMembers={teamMembers}
          onClose={() => setShowCreateTask(false)}
          onCreated={() => { fetchTasks(); setShowCreateTask(false) }}
        />
      )}
    </>
  )

  // ── Vista embebida dentro del Admin ("Mis tareas"): se queda igual que antes ──
  if (embedded) {
    return (
      <div className="p-6 lg:p-8 max-w-[1500px] mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Mis tareas</h2>
            <p className="text-sm text-gray-500">Consulta y trabaja en las actividades que tienes asignadas.</p>
          </div>
          <button
            onClick={() => setShowCreateTask(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-700 to-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition"
          >
            <Plus size={16} /> Nueva tarea
          </button>
        </div>

        {reviewBanners}

        <>
          <div className="v2-stats-row">
            {[
              { label: 'Total de tareas', value: stats.total, icon: ClipboardList, bg: '#EEE9FE', color: '#7C3AED' },
              { label: 'Pendientes', value: stats.pendiente, icon: Clock, bg: '#FEF0DE', color: '#EA580C' },
              { label: 'En progreso', value: stats.en_progreso, icon: Loader2, bg: '#E8EEFE', color: '#2757EB' },
              { label: 'Completadas', value: stats.completada, icon: CheckCircle, bg: '#E4F7F0', color: '#0C8A66' },
              { label: 'Vencidas', value: stats.vencidas, icon: XCircle, bg: '#FCE4E8', color: '#E0304F' },
            ].map(({ label, value, icon: Icon, bg, color }) => (
              <div key={label} className="v2-stat-card">
                <div className="v2-stat-icon" style={{ background: bg }}>
                  <Icon size={17} color={color} />
                </div>
                <div className="min-w-0">
                  <p className="v2-stat-num">{value}</p>
                  <p className="v2-stat-label">{label} Â· {stats.total > 0 ? Math.round((value / stats.total) * 100) : 0}%</p>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6 items-stretch">
            <div className="lg:col-span-2 v2-surface flex flex-col min-h-[280px]">
              <p className="text-sm font-bold text-gray-800 mb-2 display">Resumen de progreso</p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={weeklyProgress}>
                  <defs><linearGradient id="adminProgressFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2757EB" stopOpacity={0.35} /><stop offset="95%" stopColor="#2757EB" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                  <Tooltip formatter={(value) => [value, 'Completadas']} />
                  <Area type="monotone" dataKey="completadas" stroke="#2757EB" strokeWidth={2} fill="url(#adminProgressFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="v2-surface flex flex-col min-h-[280px]">
              <p className="text-sm font-bold text-gray-800 mb-2 display">Tareas por prioridad</p>
              {priorityData.length === 0 ? <p className="text-xs text-gray-400 flex-1 flex items-center justify-center">{'Sin tareas a\u00fan'}</p> : <>
                <ResponsiveContainer width="100%" height={130}><PieChart><Pie data={priorityData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={2}>{priorityData.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
                <div className="flex flex-wrap gap-2.5 justify-center mt-2">{priorityData.map(item => <span key={item.name} className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: item.color }} /> {item.name} ({item.value})</span>)}</div>
              </>}
            </div>
            <div className="v2-surface flex flex-col min-h-[280px]">
              <p className="text-sm font-bold text-gray-800 mb-3 display">{'Pr\u00f3ximas entregas'}</p>
              {upcoming.length === 0 ? <p className="text-xs text-gray-400 flex-1 flex items-center justify-center text-center">{'No tienes entregas pr\u00f3ximas'}</p> : <div className="space-y-2.5 flex-1">{upcoming.map(task => <button type="button" key={task.id} className="flex w-full items-center gap-2.5 text-left" onClick={() => setSelectedTask(task)}><div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0"><CalendarDays size={14} className="text-purple-500" /></div><div className="min-w-0"><p className="text-xs text-gray-400">{new Date(`${task.commitment_date}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</p><p className="text-sm text-gray-700 truncate">{task.title}</p></div></button>)}</div>}
            </div>
          </div>
          {filterPills}
          {taskTable}
        </>

        {taskModals}
      </div>
    )
  }

  // ── Vista completa "Mi espacio" (rol equipo) ──
  return (
    <div className="v2app">
      <div className={`v2-shell ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <aside className="v2-sidebar">
          <div className="v2-brand">
            <button type="button" className="v2-brand-mark" title="Sinertegia Launch 57">
              <Logo size={26} />
            </button>
            {!sidebarCollapsed && (
              <div className="v2-brand-text">
                <div className="v2-brand-name">Sinertegia Launch 57</div>
                <div className="v2-brand-sub">Gestión de proyectos</div>
              </div>
            )}
          </div>

          {visibleNavItems.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setTeamView(id)}
              className={`v2-nav-item ${teamView === id ? 'active' : ''}`}>
              <Icon size={17} />
              {!sidebarCollapsed && label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setTeamView('profile')}
            className={`v2-profile-link ${teamView === 'profile' ? 'active' : ''}`}
            title="Mi perfil"
          >
            <UserRound size={17} />
            {!sidebarCollapsed && <span>Mi perfil</span>}
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('request-logout'))}
            className="v2-logout-link"
            title="Cerrar sesión"
          >
            <LogOut size={17} />
            {!sidebarCollapsed && <span>Cerrar sesión</span>}
          </button>
        </aside>

        <button
          type="button"
          onClick={() => setSidebarCollapsed(value => !value)}
          className="v2-sidebar-toggle"
          title={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>

        <div className="v2-main">
          <header className="v2-topbar">
            <span className="v2-top-title display">Hola, {user?.full_name?.split(' ')[0]} 👋</span>
            <div className="v2-top-spacer" />
            <button
              onClick={() => setShowCreateTask(true)}
              className="v2-btn v2-btn-primary"
            >
              <Plus size={16} /> Solicitar tarea
            </button>
            <TopBarActions />
          </header>

          <div className="v2-content">
            {teamView !== 'today' && reviewBanners}
            {otherViews}

            {teamView === 'today' && (
              <div className="space-y-5">
                <section className="rounded-2xl bg-gradient-to-r from-[#173c9f] via-[#2857d9] to-[#7b3fd1] p-6 text-white shadow-lg shadow-blue-900/10">
                  <p className="text-sm text-blue-100 mb-1">Tu espacio de trabajo</p>
                  <h1 className="text-2xl font-bold display">Hola, {user?.full_name?.split(' ')[0]} 👋</h1>
                  <p className="mt-1 text-sm text-blue-100">Esto es lo más importante para avanzar hoy.</p>
                  {currentTask ? (
                    <button type="button" onClick={() => setSelectedTask(currentTask)} className="mt-5 w-full max-w-2xl rounded-xl border border-white/20 bg-white/10 p-4 text-left backdrop-blur transition hover:bg-white/15">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15"><PlayCircle size={23} /></div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-100">Continúa donde te quedaste</p>
                          <p className="mt-1 truncate font-semibold">{currentTask.title}</p>
                          <p className="mt-0.5 text-xs text-blue-100">{currentTask.project?.client?.name || currentTask.project?.name || 'Trabajo interno'} · {currentTask.status === 'en_progreso' ? 'En progreso' : 'Lista para iniciar'}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold text-blue-700">Abrir tarea <ArrowRight size={14} /></span>
                      </div>
                    </button>
                  ) : (
                    <div className="mt-5 max-w-2xl rounded-xl border border-white/20 bg-white/10 p-4 text-sm text-blue-50">No tienes tareas pendientes. ¡Buen trabajo!</div>
                  )}
                </section>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[
                    { label: 'Para hoy', value: todayTasks.length, icon: CalendarDays, bg: 'bg-blue-50', color: 'text-blue-600' },
                    { label: 'En progreso', value: inProgressTasks.length, icon: Loader2, bg: 'bg-indigo-50', color: 'text-indigo-600' },
                    { label: 'Vencidas', value: overdueTasks.length, icon: AlertTriangle, bg: 'bg-red-50', color: 'text-red-600' },
                    { label: 'En revisión', value: myReviewTasks.length, icon: Eye, bg: 'bg-purple-50', color: 'text-purple-600' },
                    { label: 'Completadas esta semana', value: completedThisWeek.length, icon: CheckCircle, bg: 'bg-emerald-50', color: 'text-emerald-600' },
                  ].map(({ label, value, icon: Icon, bg, color }) => (
                    <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${bg}`}><Icon size={17} className={color} /></div>
                      <p className="text-2xl font-bold text-gray-900">{value}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                  <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-3">
                    <div className="mb-4 flex items-center justify-between">
                      <div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Prioridad de hoy</p><h2 className="mt-1 text-lg font-bold text-gray-900 display">Requiere mi atención</h2></div>
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">{attentionItems.length}</span>
                    </div>
                    {attentionItems.length ? <div className="space-y-2">{attentionItems.map(({ task, label, color }) => (
                      <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="flex w-full items-center gap-3 rounded-xl border border-gray-100 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color === 'red' ? 'bg-red-50 text-red-500' : color === 'orange' ? 'bg-orange-50 text-orange-500' : color === 'purple' ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'}`}>{color === 'purple' ? <Eye size={16} /> : <AlertTriangle size={16} />}</span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-gray-800">{label}</span><span className="block truncate text-xs text-gray-500">{task.title} · {task.project?.client?.name || task.project?.name || 'Trabajo interno'}</span></span>
                        <ArrowRight size={16} className="shrink-0 text-gray-400" />
                      </button>
                    ))}</div> : <div className="flex min-h-36 flex-col items-center justify-center text-center"><CheckCircle className="mb-2 text-emerald-500" size={28} /><p className="text-sm font-semibold text-gray-700">Todo está en orden</p><p className="text-xs text-gray-400">No hay asuntos urgentes por resolver.</p></div>}
                  </section>

                  <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
                    <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900 display">Próximas entregas</h2><button type="button" onClick={() => setTeamView('calendar')} className="text-xs font-semibold text-blue-600 hover:underline">Ver calendario</button></div>
                    {upcoming.length ? <div className="space-y-3">{upcoming.map(task => (
                      <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-gray-50">
                        <span className="flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-purple-50 text-purple-700"><CalendarDays size={14} /><span className="mt-0.5 text-[10px] font-bold">{formatShortDate(task.commitment_date)}</span></span>
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-gray-800">{task.title}</span><span className="block truncate text-xs text-gray-400">{task.project?.client?.name || task.project?.name || 'Trabajo interno'}</span></span>
                      </button>
                    ))}</div> : <p className="flex min-h-36 items-center justify-center text-center text-sm text-gray-400">No tienes entregas próximas.</p>}
                  </section>
                </div>

                <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Orden sugerido</p><h2 className="mt-1 text-lg font-bold text-gray-900 display">Mis tareas prioritarias</h2></div><button type="button" onClick={() => setTeamView('tasks')} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">Ver todas <ArrowRight size={13} /></button></div>
                  {priorityTasks.length ? <div className="divide-y divide-gray-100">{priorityTasks.map(task => (
                    <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-gray-50">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${task.priority === 'critica' ? 'bg-red-500' : task.priority === 'alta' ? 'bg-orange-500' : task.priority === 'media' ? 'bg-amber-400' : 'bg-green-500'}`} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-800">{task.title}</span><span className="block truncate text-xs text-gray-400">{task.project?.client?.name || task.project?.name || 'Trabajo interno'}</span></span>
                      <StatusBadge status={task.status} />
                      <span className={`hidden text-xs sm:block ${isOverdue(task) ? 'font-bold text-red-600' : 'text-gray-500'}`}>{formatShortDate(task.commitment_date)}</span>
                      <ArrowRight size={15} className="text-gray-400" />
                    </button>
                  ))}</div> : <p className="p-8 text-center text-sm text-gray-400">No tienes tareas pendientes.</p>}
                </section>
              </div>
            )}

            {teamView === 'tasks' && (<>
              {/* Stats con % del total */}
              <div className="v2-stats-row">
                {[
                  { label: 'Total de tareas', value: stats.total, icon: ClipboardList, bg: '#EEE9FE', color: '#7C3AED' },
                  { label: 'Pendientes', value: stats.pendiente, icon: Clock, bg: '#FEF0DE', color: '#EA580C' },
                  { label: 'En progreso', value: stats.en_progreso, icon: Loader2, bg: '#E8EEFE', color: '#2757EB' },
                  { label: 'Completadas', value: stats.completada, icon: CheckCircle, bg: '#E4F7F0', color: '#0C8A66' },
                  { label: 'Vencidas', value: stats.vencidas, icon: XCircle, bg: '#FCE4E8', color: '#E0304F' },
                ].map(({ label, value, icon: Icon, bg, color }) => (
                  <div key={label} className="v2-stat-card">
                    <div className="v2-stat-icon" style={{ background: bg }}>
                      <Icon size={17} color={color} />
                    </div>
                    <div className="min-w-0">
                      <p className="v2-stat-num">{value}</p>
                      <p className="v2-stat-label">{label} · {stats.total > 0 ? Math.round((value / stats.total) * 100) : 0}%</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Gráficas + próximas entregas */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6 items-stretch">
                <div className="lg:col-span-2 v2-surface flex flex-col min-h-[280px]">
                  <p className="text-sm font-bold text-gray-800 mb-2 display">Resumen de progreso</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={weeklyProgress}>
                      <defs>
                        <linearGradient id="progressFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2757EB" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#2757EB" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                      <Tooltip formatter={(v: any) => [v, 'Completadas']} />
                      <Area type="monotone" dataKey="completadas" stroke="#2757EB" strokeWidth={2} fill="url(#progressFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="v2-surface flex flex-col min-h-[280px]">
                  <p className="text-sm font-bold text-gray-800 mb-2 display">Tareas por prioridad</p>
                  {priorityData.length === 0 ? (
                    <p className="text-xs text-gray-400 flex-1 flex items-center justify-center text-center">Sin tareas aún</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={130}>
                        <PieChart>
                          <Pie data={priorityData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={2}>
                            {priorityData.map(d => <Cell key={d.name} fill={d.color} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap gap-2.5 justify-center mt-2">
                        {priorityData.map(d => (
                          <span key={d.name} className="flex items-center gap-1 text-[11px] text-gray-500">
                            <span className="w-2 h-2 rounded-full" style={{ background: d.color }} /> {d.name} ({d.value})
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="v2-surface flex flex-col min-h-[280px]">
                  <p className="text-sm font-bold text-gray-800 mb-3 display">Próximas entregas</p>
                  {upcoming.length === 0 ? (
                    <p className="text-xs text-gray-400 flex-1 flex items-center justify-center text-center">No tienes entregas próximas</p>
                  ) : (
                    <div className="space-y-2.5 flex-1">
                      {upcoming.map(t => (
                        <div key={t.id} className="flex items-center gap-2.5 cursor-pointer" onClick={() => setSelectedTask(t)}>
                          <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                            <CalendarDays size={14} className="text-purple-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-gray-400">
                              {new Date(t.commitment_date! + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                            </p>
                            <p className="text-sm text-gray-700 truncate">{t.title}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => setTeamView('calendar')}
                    className="mt-3 text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1">
                    Ver calendario →
                  </button>
                </div>
              </div>

              {filterPills}
              {taskTable}
            </>)}
          </div>
        </div>
      </div>

      {taskModals}
    </div>
  )
}

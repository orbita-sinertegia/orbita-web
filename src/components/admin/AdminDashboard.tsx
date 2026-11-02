import { useEffect, useState } from 'react'
import {
  Users,
  FolderKanban,
  TrendingUp,
  Calendar,
  ClipboardList,
  MessageSquare,
  MessageCircle,
  Map,
  Inbox,
  UserCheck,
  Link2,
  ShieldCheck,
  KeyRound,
  Plus,
  Search,
  CheckCircle2,
  ArrowRight,
  Activity,
  Clock3,
  RotateCcw,
  Sparkles,
  UserRound,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Workflow,
  ListChecks,
  History,
  Route,
  UserCheck2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task, Project, User, Client } from '../../types'
import Logo from '../shared/Logo'
import TopBarActions from '../shared/TopBarActions'
import ProjectDetail from './ProjectDetail'
import { isClientAttributableDelay } from '../../lib/taskDelays'
import TeamCapacity from './TeamCapacity'
import TeamTasksManager from './TeamTasksManager'
import TeamCalendar from './TeamCalendar'
import TeamPerformance from './TeamPerformance'
import AttendancePanel from './AttendancePanel'
import CreateTaskModal from './CreateTaskModal'
import CreateProjectModal from './CreateProjectModal'
import TeamDashboard from '../team/TeamDashboard'
import TeamMessagingHub from '../chat/TeamMessagingHub'
import ClientChatsHub from '../chat/ClientChatsHub'
import RoadmapView from '../roadmap/RoadmapView'
import TaskRequestsPanel from './TaskRequestsPanel'
import ClientAssignmentManager from './ClientAssignmentManager'
import ClientReportModal from './ClientReportModal'
import ClientDeliverables from './ClientDeliverables'
import RolePermissionsManager from './RolePermissionsManager'
import LicenseManager from './LicenseManager'
import FunnelTemplatesManager from './FunnelTemplatesManager'
import ClientRoadmapsManager from './ClientRoadmapsManager'
import { usePresence } from '../../hooks/usePresence'
import { useAuth } from '../../contexts/AuthContext'
import TaskDetailModal from '../team/TaskDetailModal'
import UserProfile from '../shared/UserProfile'
import '../../styles/DashboardV2.css'

type View =
  | 'overview'
  | 'project'
  | 'team'
  | 'team_tasks'
  | 'calendar'
  | 'performance'
  | 'attendance'
  | 'mytasks'
  | 'roadmap'
  | 'client_roadmaps'
  | 'requests'
  | 'chat_team'
  | 'chat_clients'
  | 'clientes'
  | 'entregables'
  | 'create'
  | 'create_project'
  | 'permisos'
  | 'licencia'
  | 'funnels'
  | 'profile'
type StatusFilter = 'activo' | 'pausado' | 'completado' | 'todos'

const STATUS_FILTER_LABELS: { value: StatusFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'activo', label: 'Activos' },
  { value: 'pausado', label: 'Pausados' },
  { value: 'completado', label: 'Completados' },
]

const ADMIN_NAV_ITEMS = [
  { id: 'overview', label: 'Proyectos', icon: FolderKanban },
  { id: 'team', label: 'Carga del equipo', icon: Users },
  { id: 'team_tasks', label: 'Tareas del equipo', icon: ListChecks },
  { id: 'calendar', label: 'Calendario', icon: Calendar },
  { id: 'performance', label: 'Rendimiento', icon: TrendingUp },
  { id: 'attendance', label: 'Asistencia', icon: UserCheck2 },
  { id: 'mytasks', label: 'Mis tareas', icon: ClipboardList },
  { id: 'roadmap', label: 'Hoja de Ruta', icon: Map },
  { id: 'client_roadmaps', label: 'Hoja de ruta de clientes', icon: Route },
  { id: 'clientes', label: 'Clientes', icon: UserCheck },
  { id: 'requests', label: 'Solicitudes', icon: Inbox },
  { id: 'chat_team', label: 'Chat Equipo', icon: MessageSquare },
  { id: 'chat_clients', label: 'Chat Clientes', icon: MessageCircle },
  { id: 'entregables', label: 'Entregables', icon: Link2 },
  { id: 'funnels', label: 'Embudos', icon: Workflow },
  { id: 'permisos', label: 'Usuarios y permisos', icon: KeyRound },
]

const AVATAR_COLORS = ['#2757EB', '#0EA5E9', '#EC4899', '#12B886', '#F59E0B', '#8B5CF6', '#EF4444', '#0891B2', '#DB2777']

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

function avatarColorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function fillClassFor(pct: number): string {
  if (pct >= 60) return 'g2'
  if (pct >= 30) return 'g1'
  return 'g0'
}

export default function AdminDashboard() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [teamMembers, setTeamMembers] = useState<User[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('overview')
  const onlineIds = usePresence()
  const [reportProject, setReportProject] = useState<Project | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('activo')
  const [notifTask, setNotifTask] = useState<Task | null>(null)
  const [reviewFocusTask, setReviewFocusTask] = useState<Task | null>(null)
  const [unreadTeamChat, setUnreadTeamChat] = useState(0)
  const [unreadClientChat, setUnreadClientChat] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [createProjectReturnView, setCreateProjectReturnView] = useState<View>('overview')
  const [adminPermissions, setAdminPermissions] = useState<Record<string, boolean>>({})
  const [roadmapClientId, setRoadmapClientId] = useState<string | null>(null)

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    if (!user || user.is_super_admin) return
    Promise.all([supabase.from('role_permissions').select('section_key, allowed').eq('role', 'admin'), supabase.from('user_permissions').select('section_key, allowed').eq('user_id', user.id)]).then(
      ([roleResult, userResult]) => {
        const next: Record<string, boolean> = {}
        ;(roleResult.data || []).forEach((row) => {
          next[row.section_key] = row.allowed
        })
        ;(userResult.data || []).forEach((row) => {
          next[row.section_key] = row.allowed
        })
        setAdminPermissions(next)
        setView((current) => {
          if (current !== 'permisos' && next[current] !== false) return current
          const fallback = ADMIN_NAV_ITEMS.find((item) => item.id !== 'permisos' && next[item.id] !== false)
          return (fallback?.id || 'overview') as View
        })
      },
    )
  }, [user])

  useEffect(() => {
    function handleOpenProject(e: Event) {
      const projectId = (e as CustomEvent).detail?.projectId
      const project = projects.find((item) => item.id === projectId)
      if (!project) return
      setSelectedProject(project)
      setView('project')
    }
    window.addEventListener('open-project', handleOpenProject)
    return () => window.removeEventListener('open-project', handleOpenProject)
  }, [projects])

  useEffect(() => {
    const openClient = () => setView('clientes')
    const openPerson = () => setView(user?.is_super_admin ? 'permisos' : 'team_tasks')
    const openFunnel = () => setView('funnels')
    const openSection = (event: Event) => {
      const target = (event as CustomEvent).detail?.view as View | undefined
      if (!target) return
      if (target === 'permisos' && !user?.is_super_admin) return
      if (!user?.is_super_admin && adminPermissions[target] === false) return
      setView(target)
    }
    window.addEventListener('open-client', openClient)
    window.addEventListener('open-person', openPerson)
    window.addEventListener('open-funnel', openFunnel)
    window.addEventListener('open-section', openSection)
    return () => {
      window.removeEventListener('open-client', openClient)
      window.removeEventListener('open-person', openPerson)
      window.removeEventListener('open-funnel', openFunnel)
      window.removeEventListener('open-section', openSection)
    }
  }, [adminPermissions, user])

  // ── open-task desde campanita ────────────────────────────────────────────
  useEffect(() => {
    async function handleOpenTask(e: Event) {
      const taskId = (e as CustomEvent).detail?.taskId
      if (!taskId) return
      const { data } = await supabase.from('tasks').select('*, project:projects(*, client:clients(*)), links:task_links(*)').eq('id', taskId).single()
      if (data) setNotifTask(data as Task)
    }
    window.addEventListener('open-task', handleOpenTask)
    return () => window.removeEventListener('open-task', handleOpenTask)
  }, [])

  // ── open-chat desde campanita ─────────────────────────────────────────────
  useEffect(() => {
    function handleOpenChat(e: Event) {
      const room = (e as CustomEvent).detail?.room
      if (room === 'team' && (user?.is_super_admin || adminPermissions.chat_team !== false)) setView('chat_team')
      else if (room === 'client' && (user?.is_super_admin || adminPermissions.chat_clients !== false)) setView('chat_clients')
    }
    window.addEventListener('open-chat', handleOpenChat)
    return () => window.removeEventListener('open-chat', handleOpenChat)
  }, [adminPermissions, user])

  // ── badges de chat en tiempo real ────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    let teamRoomId: string | null = null

    async function setupChatBadges() {
      const { data: teamRoom } = await supabase.from('chat_rooms').select('id').eq('type', 'team').maybeSingle()
      if (teamRoom) teamRoomId = teamRoom.id

      const channel = supabase
        .channel('admin-chat-badges')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
          const msg = payload.new as { user_id?: string; room_id?: string }
          if (msg.user_id === user?.id) return
          if (teamRoomId && msg.room_id === teamRoomId) {
            setUnreadTeamChat((n) => n + 1)
          } else {
            setUnreadClientChat((n) => n + 1)
          }
        })
        .subscribe()
      return () => {
        supabase.removeChannel(channel)
      }
    }

    const cleanup = setupChatBadges()
    return () => {
      cleanup.then((fn) => fn?.())
    }
  }, [user])

  async function fetchAll() {
    const [{ data: proj }, { data: tsk }, { data: team }, { data: cls }] = await Promise.all([
      supabase.from('projects').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('tasks').select('*, project:projects(*, client:clients(*)), assignee:users!assigned_to(*), links:task_links(*)').is('archived_at', null),
      supabase.from('users').select('*').eq('role', 'team').eq('active', true),
      supabase.from('clients').select('*').order('name'),
    ])
    setProjects(proj || [])
    setTasks(tsk || [])
    setTeamMembers(team || [])
    setClients(cls || [])
    setLoading(false)
  }

  function getProjectProgress(projectId: string) {
    const ptasks = tasks.filter((t) => t.project_id === projectId)
    if (!ptasks.length) return 0
    return (ptasks.filter((t) => t.status === 'completada').length / ptasks.length) * 100
  }

  // "Fuera de fecha" y la salud operativa solo cuentan retrasos de la agencia —
  // los del cliente se muestran aparte y no penalizan al equipo.
  const overdueTasks = tasks.filter((t) => t.commitment_date && t.status !== 'completada' && new Date(t.commitment_date) < new Date() && !isClientAttributableDelay(t))
  const clientDelayTasks = tasks.filter((t) => t.status !== 'completada' && isClientAttributableDelay(t))

  // Tareas que el equipo mandó a revisión y esperan autorización del trafficker
  const pendingTraffickerReview = tasks.filter((t) => t.review_status === 'pendiente_revision')
  // Tareas donde el cliente solicitó cambios
  const clientChangesRequested = tasks.filter((t) => t.client_approval === 'cambios_solicitados')
  const openTasks = tasks.filter((t) => t.status !== 'completada')
  const completedThisWeek = tasks.filter((t) => {
    if (!t.completion_date) return false
    const completedAt = new Date(`${t.completion_date}T00:00:00`)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setHours(0, 0, 0, 0)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
    return completedAt >= sevenDaysAgo
  })
  const atRiskProjectIds = new Set(overdueTasks.map((t) => t.project_id))
  const activeProjects = projects.filter((p) => p.status === 'activo')
  const healthyProjects = activeProjects.filter((p) => !atRiskProjectIds.has(p.id))
  const healthPct = activeProjects.length ? Math.round((healthyProjects.length / activeProjects.length) * 100) : 100
  const attentionTotal = pendingTraffickerReview.length + overdueTasks.length + clientChangesRequested.length + clientDelayTasks.length

  const filteredProjects = (statusFilter === 'todos' ? projects : projects.filter((p) => p.status === statusFilter)).sort((a, b) => {
    const urgency = (projectId: string) => {
      const projectTasks = tasks.filter((task) => task.project_id === projectId && task.status !== 'completada')
      const overdue = projectTasks.filter((task) => task.commitment_date && new Date(task.commitment_date) < new Date()).length
      const review = projectTasks.filter((task) => task.review_status === 'pendiente_revision').length
      const changes = projectTasks.filter((task) => task.client_approval === 'cambios_solicitados').length
      return overdue * 100 + review * 80 + changes * 70 + projectTasks.length
    }
    return urgency(b.id) - urgency(a.id)
  })

  // Rendimiento forma parte de la operación base de cualquier administrador.
  // No debe desaparecer por permisos heredados o registros antiguos.
  const permittedAdminItems = user?.is_super_admin
    ? ADMIN_NAV_ITEMS
    : ADMIN_NAV_ITEMS.filter((item) => item.id === 'performance' || item.id === 'attendance' || (item.id !== 'permisos' && adminPermissions[item.id] !== false))
  const navItems = [
    ...permittedAdminItems.map((item) => ({
      ...item,
      badge: item.id === 'chat_team' ? unreadTeamChat : item.id === 'chat_clients' ? unreadClientChat : 0,
    })),
    ...(user?.is_super_admin ? [{ id: 'licencia', label: 'Licencia', icon: ShieldCheck, badge: 0 }] : []),
  ]
  const navGroups = [
    {
      label: 'Operación',
      ids: ['overview', 'team', 'team_tasks', 'calendar', 'performance', 'attendance'],
    },
    { label: 'Trabajo', ids: ['mytasks', 'roadmap', 'client_roadmaps', 'requests'] },
    {
      label: 'Comunicación',
      ids: ['chat_team', 'chat_clients', 'entregables'],
    },
    { label: 'Administración', ids: ['clientes', 'funnels', 'permisos', 'licencia'] },
  ]

  function selectView(id: string) {
    if (!navItems.some((item) => item.id === id) && id !== 'profile') return
    setView(id as View)
    if (id === 'chat_team') setUnreadTeamChat(0)
    if (id === 'chat_clients') setUnreadClientChat(0)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>

  const currentNavLabel = view === 'profile' ? 'Mi perfil' : navItems.find((i) => i.id === view)?.label || 'Panel de Control'

  return (
    <div className="v2app">
      <div className={`v2-shell ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {/* ── Sidebar ── */}
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

          {navGroups.map((group) => {
            const groupItems = group.ids.map((id) => navItems.find((item) => item.id === id)).filter(Boolean) as typeof navItems
            if (!groupItems.length) return null
            return (
              <div key={group.label} className="v2-nav-group">
                {!sidebarCollapsed && <p className="v2-nav-group-label">{group.label}</p>}
                {groupItems.map(({ id, label, icon: Icon, badge }) => (
                  <button key={id} type="button" onClick={() => selectView(id)} className={`v2-nav-item ${view === id ? 'active' : ''}`}>
                    <Icon size={17} />
                    {!sidebarCollapsed && label}
                    {!sidebarCollapsed && !!badge && <span className="v2-badge">{badge > 9 ? '9+' : badge}</span>}
                  </button>
                ))}
              </div>
            )
          })}

          <button type="button" onClick={() => setView('profile')} className={`v2-profile-link ${view === 'profile' ? 'active' : ''}`} title="Mi perfil">
            <UserRound size={17} />
            {!sidebarCollapsed && <span>Mi perfil</span>}
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('request-logout'))} className="v2-logout-link" title="Cerrar sesión">
            <LogOut size={17} />
            {!sidebarCollapsed && <span>Cerrar sesión</span>}
          </button>
        </aside>

        <button
          type="button"
          onClick={() => setSidebarCollapsed((value) => !value)}
          className="v2-sidebar-toggle"
          title={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>

        {/* ── Main ── */}
        <div className="v2-main">
          <header className="v2-topbar">
            <span className="v2-top-title display">{currentNavLabel}</span>
            <div className="v2-top-spacer" />
            <TopBarActions />
          </header>

          <div className="v2-content">
            {/* ═══ Vista: Proyectos (overview) ═══ */}
            {view === 'overview' && (
              <>
                <div className="v2-page-head">
                  <div>
                    <h1 className="v2-page-title display">Panel de Control</h1>
                    <div className="v2-page-meta">
                      <span className="v2-stat-inline">
                        <b className="mono">{projects.filter((p) => p.status === 'activo').length}</b> proyectos activos
                      </span>
                      <span className="v2-sep" />
                      <span className="v2-stat-inline">
                        <b className="mono">{teamMembers.length}</b> personas en el equipo
                      </span>
                    </div>
                  </div>
                  <div className="v2-actions">
                    <button className="v2-btn v2-btn-ghost" onClick={() => { setCreateProjectReturnView('overview'); setView('create_project') }}>
                      <Plus /> Nuevo proyecto
                    </button>
                    <button className="v2-btn v2-btn-primary" onClick={() => setView('create')}>
                      <Plus /> Nueva tarea
                    </button>
                  </div>
                </div>

                <div className="v2-exec-grid">
                  <section className="v2-exec-summary">
                    <div className="v2-exec-summary-head">
                      <div>
                        <span className="v2-eyebrow">
                          <Sparkles size={13} /> Resumen ejecutivo
                        </span>
                        <h2>Así marcha la operación</h2>
                      </div>
                      <span className={`v2-health-pill ${healthPct >= 80 ? 'good' : healthPct >= 60 ? 'medium' : 'risk'}`}>
                        <span /> {healthPct}% saludable
                      </span>
                    </div>
                    <div className="v2-exec-metrics">
                      <button type="button" onClick={() => setStatusFilter('activo')}>
                        <span className="v2-metric-icon blue">
                          <FolderKanban />
                        </span>
                        <span>
                          <b className="mono">{activeProjects.length}</b>
                          <small>Proyectos activos</small>
                        </span>
                      </button>
                      <button type="button" onClick={() => setView('mytasks')}>
                        <span className="v2-metric-icon violet">
                          <Activity />
                        </span>
                        <span>
                          <b className="mono">{openTasks.length}</b>
                          <small>Tareas abiertas</small>
                        </span>
                      </button>
                      <button type="button" onClick={() => setView('performance')}>
                        <span className="v2-metric-icon green">
                          <CheckCircle2 />
                        </span>
                        <span>
                          <b className="mono">{completedThisWeek.length}</b>
                          <small>Terminadas en 7 días</small>
                        </span>
                      </button>
                      <button type="button" onClick={() => setView('team')}>
                        <span className="v2-metric-icon amber">
                          <Users />
                        </span>
                        <span>
                          <b className="mono">{teamMembers.length}</b>
                          <small>Personas activas</small>
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="v2-attention">
                    <div className="v2-attention-head">
                      <div>
                        <span className="v2-eyebrow">Prioridad de hoy</span>
                        <h2>Requiere atención</h2>
                      </div>
                      <span className={`v2-attention-total ${attentionTotal === 0 ? 'clear' : ''}`}>{attentionTotal === 0 ? 'Todo al día' : attentionTotal}</span>
                    </div>
                    {attentionTotal === 0 ? (
                      <div className="v2-attention-empty">
                        <CheckCircle2 />
                        <div>
                          <b>Todo al día</b>
                          <span>No tienes pendientes que atender.</span>
                        </div>
                      </div>
                    ) : (
                      <div className="v2-attention-list">
                        {pendingTraffickerReview.length > 0 && (
                          <button type="button" className="review" onClick={() => setReviewFocusTask(pendingTraffickerReview[0])}>
                            <span className="v2-attention-icon">
                              <Search />
                            </span>
                            <span>
                              <b>Por autorizar</b>
                              <small>{pendingTraffickerReview[0].title}</small>
                            </span>
                            <strong className="mono">{pendingTraffickerReview.length}</strong>
                            <ArrowRight />
                          </button>
                        )}
                        {overdueTasks.length > 0 && (
                          <button type="button" className="overdue" onClick={() => setReviewFocusTask(overdueTasks[0])}>
                            <span className="v2-attention-icon">
                              <Clock3 />
                            </span>
                            <span>
                              <b>Fuera de fecha</b>
                              <small>{overdueTasks[0].title}</small>
                            </span>
                            <strong className="mono">{overdueTasks.length}</strong>
                            <ArrowRight />
                          </button>
                        )}
                        {clientChangesRequested.length > 0 && (
                          <button type="button" className="changes" onClick={() => setReviewFocusTask(clientChangesRequested[0])}>
                            <span className="v2-attention-icon">
                              <RotateCcw />
                            </span>
                            <span>
                              <b>Cambios de clientes</b>
                              <small>{clientChangesRequested[0].title}</small>
                            </span>
                            <strong className="mono">{clientChangesRequested.length}</strong>
                            <ArrowRight />
                          </button>
                        )}
                        {clientDelayTasks.length > 0 && (
                          <button type="button" className="overdue" onClick={() => setReviewFocusTask(clientDelayTasks[0])}>
                            <span className="v2-attention-icon">
                              <History />
                            </span>
                            <span>
                              <b>Retrasos del cliente</b>
                              <small>{clientDelayTasks[0].title}</small>
                            </span>
                            <strong className="mono">{clientDelayTasks.length}</strong>
                            <ArrowRight />
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                </div>

                {/* Toolbar: tabs de estado */}
                <div className="v2-toolbar">
                  <div className="v2-tabs">
                    {STATUS_FILTER_LABELS.map(({ value, label }) => (
                      <button key={value} className={`v2-tab ${statusFilter === value ? 'active' : ''}`} onClick={() => setStatusFilter(value)}>
                        {label}
                        <span className="v2-count">{value === 'todos' ? projects.length : projects.filter((p) => p.status === value).length}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grid de proyectos */}
                {filteredProjects.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <FolderKanban size={32} className="mx-auto mb-2 opacity-30" />
                    <p>No hay proyectos {statusFilter !== 'todos' ? `"${STATUS_FILTER_LABELS.find((s) => s.value === statusFilter)?.label.toLowerCase()}"` : ''}</p>
                    <button onClick={() => { setCreateProjectReturnView('overview'); setView('create_project') }} className="mt-3 text-blue-600 text-sm hover:underline">
                      + Crear el primer proyecto
                    </button>
                  </div>
                ) : (
                  <div className="v2-grid">
                    {filteredProjects.map((project) => {
                      const pct = getProjectProgress(project.id)
                      const ptasks = tasks.filter((t) => t.project_id === project.id)
                      const done = ptasks.filter((t) => t.status === 'completada').length
                      const clientName = project.client?.name || '—'
                      const cardTier = pct === 100 ? 'done' : pct === 0 ? 'idle' : ''
                      const pillClass = project.status === 'activo' ? 'active' : project.status === 'pausado' ? 'paused' : 'completed'
                      return (
                        <article
                          key={project.id}
                          className={`v2-card ${cardTier}`}
                          onClick={() => {
                            setSelectedProject(project)
                            setView('project')
                          }}
                        >
                          <div className="v2-card-top">
                            <div
                              className="v2-avatar-sq"
                              style={{
                                background: `linear-gradient(145deg, ${avatarColorFor(clientName)}, ${avatarColorFor(clientName)}cc)`,
                              }}
                            >
                              {initialsOf(clientName)}
                            </div>
                            <div className="v2-card-headings">
                              <div className="v2-kicker-name">{clientName}</div>
                              <div className="v2-card-title">{project.name}</div>
                            </div>
                            <span className={`v2-pill ${pillClass}`}>
                              <span className="v2-pd" />
                              {project.status === 'activo' ? 'Activo' : project.status === 'pausado' ? 'Pausado' : 'Completado'}
                            </span>
                          </div>
                          <div>
                            <div className="v2-progress-row">
                              <span className="v2-progress-label">Progreso</span>
                              <span className={`v2-progress-val mono ${pct === 100 ? 'v2-v-done' : pct === 0 ? 'v2-v-idle' : pct >= 30 ? 'v2-v-warm' : 'v2-v-mid'}`}>
                                {Math.round(pct)}
                                <span style={{ fontSize: 11 }}>%</span>
                              </span>
                            </div>
                            <div className="v2-track">
                              <div className={`v2-fill ${fillClassFor(pct)}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <div className="v2-card-foot">
                            <span className="v2-foot-info">
                              <CheckCircle2 />{' '}
                              <b>
                                {done}/{ptasks.length}
                              </b>{' '}
                              tareas
                            </span>
                            <button
                              className="v2-link-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setReportProject(project)
                              }}
                            >
                              Ver reporte <ArrowRight />
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {/* Vista detalle de proyecto */}
            {view === 'project' && selectedProject && (
              <ProjectDetail
                key={selectedProject.id}
                project={projects.find(project => project.id === selectedProject.id) || selectedProject}
                tasks={tasks.filter((t) => t.project_id === selectedProject.id)}
                onBack={() => { setSelectedProject(null); setView('overview') }}
                onUpdate={fetchAll}
                teamMembers={teamMembers}
                projects={projects}
              />
            )}

            {/* Vista capacidad del equipo */}
            {view === 'team' && <TeamCapacity teamMembers={teamMembers} tasks={tasks} onAssign={() => setView('create')} />}

            {/* Vista de administraciÃ³n directa de tareas del equipo */}
            {view === 'team_tasks' && <TeamTasksManager teamMembers={teamMembers} tasks={tasks} onTasksChange={fetchAll} />}

            {/* Vista calendario */}
            {view === 'calendar' && <TeamCalendar teamMembers={teamMembers} tasks={tasks} onlineIds={onlineIds} onTasksChange={fetchAll} />}

            {/* Vista rendimiento */}
            {view === 'performance' && <TeamPerformance teamMembers={teamMembers} tasks={tasks} />}

            {/* Vista asistencia */}
            {view === 'attendance' && <AttendancePanel teamMembers={teamMembers} />}

            {/* Vista mis tareas */}
            {view === 'mytasks' && <TeamDashboard embedded />}

            {/* Vista hoja de ruta */}
            {view === 'roadmap' && <RoadmapView tasks={tasks} title="Todas las tareas del equipo" reportProjects={projects} onGenerateReport={setReportProject} />}

            {/* Vista hoja de ruta de clientes */}
            {view === 'client_roadmaps' && <ClientRoadmapsManager initialClientId={roadmapClientId} />}

            {/* Vista solicitudes de clientes */}
            {view === 'requests' && <TaskRequestsPanel />}

            {/* Vista chat interno del equipo */}
            {view === 'chat_team' && <TeamMessagingHub />}

            {/* Vista chat con clientes */}
            {view === 'chat_clients' && <ClientChatsHub initialClients={clients} />}

            {view === 'entregables' && <ClientDeliverables />}

            {/* Vista: Asignación de clientes */}
            {view === 'clientes' && <ClientAssignmentManager clients={clients} teamMembers={teamMembers} onCreateProject={() => { setCreateProjectReturnView('clientes'); setView('create_project') }} onOpenFunnels={() => setView('funnels')} onOpenRoadmap={clientId => { setRoadmapClientId(clientId); setView('client_roadmaps') }} />}

            {view === 'funnels' && <FunnelTemplatesManager />}

            {/* Vista: Permisos por rol */}
            {view === 'permisos' && user?.is_super_admin && <RolePermissionsManager />}

            {/* Vista: Licencia (solo súper admin) */}
            {view === 'licencia' && user?.is_super_admin && <LicenseManager />}

            {view === 'profile' && (
              <UserProfile
                embedded
                onChangePhoto={() => window.dispatchEvent(new CustomEvent('change-profile-photo'))}
                onChangePassword={() => window.dispatchEvent(new CustomEvent('change-profile-password'))}
              />
            )}
          </div>
        </div>
      </div>

      {reportProject && <ClientReportModal project={reportProject} tasks={tasks} onClose={() => setReportProject(null)} />}

      {/* Modal nueva tarea */}
      {view === 'create' && <CreateTaskModal projects={projects} teamMembers={teamMembers} onClose={() => setView('overview')} onCreated={fetchAll} />}

      {/* Modal nuevo proyecto */}
      {view === 'create_project' && <CreateProjectModal clients={clients} teamMembers={teamMembers} onClose={() => setView(createProjectReturnView)} onCreated={fetchAll} />}

      {/* Modal tarea desde campanita */}
      {notifTask && <TaskDetailModal task={notifTask} onClose={() => setNotifTask(null)} onUpdate={fetchAll} />}

      {/* Tarea exacta abierta desde "Requiere atención" */}
      {reviewFocusTask && <TaskDetailModal task={reviewFocusTask} reviewAttention onClose={() => setReviewFocusTask(null)} onUpdate={fetchAll} />}
    </div>
  )
}

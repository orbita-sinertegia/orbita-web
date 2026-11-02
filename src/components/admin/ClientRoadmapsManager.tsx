import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, Filter, Map as MapIcon, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Client, Project, Task, User } from '../../types'
import {
  type HealthStatus, compareByRisk, currentDisplayPhase, DISPLAY_PHASE_LABELS, DISPLAY_PHASE_ORDER,
  inferTemplateLabel, projectHealth,
} from '../../lib/roadmapPhases'
import ClientRoadmapView, { type DelayEventLike } from '../roadmap/ClientRoadmapView'

interface Props {
  /** El equipo solo ve sus clientes asignados o proyectos donde tiene tareas. El admin ve todo. */
  restricted?: boolean
  initialClientId?: string | null
}

const HEALTH_LABELS: Record<HealthStatus, { label: string; className: string }> = {
  atrasado: { label: '🔴 Atrasado', className: 'bg-red-100 text-red-700 border-red-200' },
  en_riesgo: { label: '🟡 En riesgo', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  en_tiempo: { label: '🟢 En tiempo', className: 'bg-green-100 text-green-700 border-green-200' },
}

function storageKey(userId: string) {
  return `client-roadmap-last-${userId}`
}

export default function ClientRoadmapsManager({ restricted = false, initialClientId }: Props) {
  const { user } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [delayEvents, setDelayEvents] = useState<Record<string, DelayEventLike[]>>({})
  const [teamMembers, setTeamMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [phaseFilter, setPhaseFilter] = useState('todas')
  const [healthFilter, setHealthFilter] = useState<'todos' | HealthStatus>('todos')
  const [responsibleFilter, setResponsibleFilter] = useState('todos')
  const [delayFilter, setDelayFilter] = useState<'todos' | 'cliente' | 'agencia'>('todos')

  useEffect(() => { void fetchAll() }, [])

  useEffect(() => {
    if (!initialClientId) return
    selectClient(initialClientId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, projects])

  async function fetchAll() {
    setLoading(true)
    let clientList: Client[] = []
    let projectList: Project[] = []

    if (restricted && user) {
      const clientIds = new Set<string>()
      const [{ data: assignments }, { data: taskRows }] = await Promise.all([
        supabase.from('client_team_members').select('client_id').eq('user_id', user.id),
        supabase.from('tasks').select('project_id').eq('assigned_to', user.id),
      ])
      ;(assignments || []).forEach((row: { client_id?: string }) => { if (row.client_id) clientIds.add(row.client_id) })
      const projectIds = [...new Set((taskRows || []).map((row: { project_id?: string }) => row.project_id).filter(Boolean))] as string[]
      if (projectIds.length > 0) {
        const { data: ownProjects } = await supabase.from('projects').select('client_id').in('id', projectIds)
        ;(ownProjects || []).forEach((row: { client_id?: string }) => { if (row.client_id) clientIds.add(row.client_id) })
      }
      if (clientIds.size > 0) {
        const { data } = await supabase.from('clients').select('*').in('id', [...clientIds]).order('name')
        clientList = data || []
        const { data: proj } = await supabase.from('projects').select('*, client:clients(*)').eq('status', 'activo').in('client_id', [...clientIds])
        projectList = proj || []
      }
    } else {
      const [{ data: cls }, { data: proj }, { data: team }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('projects').select('*, client:clients(*)').eq('status', 'activo'),
        supabase.from('users').select('*').in('role', ['team', 'admin']).eq('active', true),
      ])
      clientList = cls || []
      projectList = proj || []
      setTeamMembers(team || [])
    }

    setClients(clientList)
    setProjects(projectList)

    const projectIds = projectList.map(project => project.id)
    if (projectIds.length > 0) {
      const [{ data: taskRows }, { data: delayRows }] = await Promise.all([
        supabase.from('tasks').select('*, assignee:users!assigned_to(full_name)').in('project_id', projectIds).is('archived_at', null),
        supabase.from('project_delay_events').select('id, project_id, task_id, responsible, days, reason, created_at').in('project_id', projectIds),
      ])
      setTasks((taskRows as Task[]) || [])
      const byProject: Record<string, DelayEventLike[]> = {}
      ;(delayRows || []).forEach((row: DelayEventLike & { project_id: string }) => {
        byProject[row.project_id] = [...(byProject[row.project_id] || []), row]
      })
      setDelayEvents(byProject)
    } else {
      setTasks([])
      setDelayEvents({})
    }

    if (!initialClientId && user) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey(user.id)) || 'null')
        if (saved?.clientId && clientList.some(client => client.id === saved.clientId)) {
          setSelectedClientId(saved.clientId)
          const clientProjects = projectList.filter(project => project.client_id === saved.clientId)
          setSelectedProjectId(clientProjects.some(project => project.id === saved.projectId) ? saved.projectId : clientProjects[0]?.id || '')
        }
      } catch { /* localStorage inválido: se ignora y se parte del resumen */ }
    }

    setLoading(false)
  }

  function selectClient(clientId: string) {
    setSelectedClientId(clientId)
    const clientProjects = projects.filter(project => project.client_id === clientId)
    const projectId = clientProjects[0]?.id || ''
    setSelectedProjectId(projectId)
    if (user) localStorage.setItem(storageKey(user.id), JSON.stringify({ clientId, projectId }))
  }

  function selectProject(project: Project) {
    setSelectedClientId(project.client_id)
    setSelectedProjectId(project.id)
    if (user) localStorage.setItem(storageKey(user.id), JSON.stringify({ clientId: project.client_id, projectId: project.id }))
  }

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return clients
    return clients.filter(client => `${client.name} ${client.company || ''}`.toLowerCase().includes(query))
  }, [clients, search])

  const activeProjects = projects.filter(project => project.status === 'activo')

  const cards = useMemo(() => activeProjects.map(project => {
    const projectTasks = tasks.filter(task => task.project_id === project.id)
    const events = delayEvents[project.id] || []
    const health = projectHealth(projectTasks, project, events)
    const phase = currentDisplayPhase(projectTasks)
    const pendingClient = projectTasks.filter(task => task.department === 'cliente' && task.status !== 'completada')
    const overdueClient = pendingClient.filter(task => task.commitment_date && new Date(task.commitment_date) < new Date())
    const lider = projectTasks.find(task => task.department === 'lider')?.assignee?.full_name
    return { project, health, phase, pendingClient, overdueClient, lider, tasks: projectTasks }
  }), [activeProjects, tasks, delayEvents])

  const filteredCards = cards
    .filter(card => {
      if (search.trim() && !filteredClients.some(client => client.id === card.project.client_id)) return false
      if (phaseFilter !== 'todas' && card.phase !== phaseFilter) return false
      if (healthFilter !== 'todos' && card.health.status !== healthFilter) return false
      if (delayFilter === 'cliente' && card.health.clientDays === 0) return false
      if (delayFilter === 'agencia' && card.health.agencyDays === 0) return false
      if (responsibleFilter !== 'todos' && !card.tasks.some(task => task.assigned_to === responsibleFilter)) return false
      return true
    })
    .sort((a, b) => compareByRisk(
      { status: a.health.status, totalDays: a.health.clientDays + a.health.agencyDays || a.health.maxOverdueDays },
      { status: b.health.status, totalDays: b.health.clientDays + b.health.agencyDays || b.health.maxOverdueDays },
    ))

  const selectedProject = projects.find(project => project.id === selectedProjectId)
  const selectedClient = clients.find(client => client.id === selectedClientId)
  const clientProjects = projects.filter(project => project.client_id === selectedClientId)

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando hojas de ruta...</div>

  if (selectedProject) {
    const projectTasks = tasks.filter(task => task.project_id === selectedProject.id)
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <button type="button" onClick={() => { setSelectedProjectId(''); setSelectedClientId('') }} className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700">
          <ArrowLeft size={15} /> Volver al resumen
        </button>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{selectedClient?.name}</p>
          <h2 className="text-xl font-bold text-gray-900">{selectedProject.name}</h2>
          {clientProjects.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {clientProjects.map(project => (
                <button key={project.id} type="button" onClick={() => selectProject(project)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${project.id === selectedProjectId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {project.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <ClientRoadmapView project={selectedProject} tasks={projectTasks} delayEvents={delayEvents[selectedProject.id] || []} mode="interno" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900"><MapIcon size={20} className="text-blue-700" /> Hoja de ruta de clientes</h2>
        <p className="text-sm text-gray-500">Busca un cliente o revisa el resumen de todos los proyectos activos.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar cliente o empresa..."
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
        </div>
        {search.trim() && filteredClients.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {filteredClients.slice(0, 6).map(client => (
              <button key={client.id} type="button" onClick={() => selectClient(client.id)}
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                {client.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500"><Filter size={13} /> Filtros</span>
        <select value={phaseFilter} onChange={event => setPhaseFilter(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
          <option value="todas">Todas las fases</option>
          {DISPLAY_PHASE_ORDER.map(phase => <option key={phase} value={phase}>{DISPLAY_PHASE_LABELS[phase]}</option>)}
        </select>
        <select value={healthFilter} onChange={event => setHealthFilter(event.target.value as typeof healthFilter)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
          <option value="todos">Cualquier semáforo</option>
          <option value="atrasado">🔴 Atrasado</option>
          <option value="en_riesgo">🟡 En riesgo</option>
          <option value="en_tiempo">🟢 En tiempo</option>
        </select>
        {teamMembers.length > 0 && (
          <select value={responsibleFilter} onChange={event => setResponsibleFilter(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
            <option value="todos">Cualquier responsable</option>
            {teamMembers.map(member => <option key={member.id} value={member.id}>{member.full_name}</option>)}
          </select>
        )}
        <select value={delayFilter} onChange={event => setDelayFilter(event.target.value as typeof delayFilter)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
          <option value="todos">Retraso: cualquiera</option>
          <option value="cliente">Retraso: cliente</option>
          <option value="agencia">Retraso: agencia</option>
        </select>
      </div>

      {filteredCards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-400">No hay proyectos activos que coincidan con estos filtros.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCards.map(card => {
            const health = HEALTH_LABELS[card.health.status]
            return (
              <button key={card.project.id} type="button" onClick={() => selectProject(card.project)}
                className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold uppercase tracking-wide text-blue-600">{card.project.client?.name}</p>
                    <p className="truncate font-bold text-gray-900">{card.project.name}</p>
                    <p className="text-xs text-gray-400">{inferTemplateLabel(card.tasks)} · {card.project.recording_mode === 'remota' ? 'Remota' : 'Oficina'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${health.className}`}>{health.label}</span>
                </div>
                <p className="text-xs font-semibold text-gray-600">{DISPLAY_PHASE_LABELS[card.phase]}</p>
                {card.project.launch_date && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    🚀 {new Date(card.project.launch_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                    {(card.health.clientDays > 0 || card.health.agencyDays > 0) && (
                      <> · {card.health.clientDays > 0 && `+${card.health.clientDays}d cliente`}{card.health.clientDays > 0 && card.health.agencyDays > 0 && ' / '}{card.health.agencyDays > 0 && `+${card.health.agencyDays}d agencia`}</>
                    )}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                  <span>{card.pendingClient.length} pendiente{card.pendingClient.length === 1 ? '' : 's'} del cliente{card.overdueClient.length > 0 && <span className="ml-1 font-semibold text-red-600">({card.overdueClient.length} vencida{card.overdueClient.length === 1 ? '' : 's'})</span>}</span>
                  {card.lider && <span className="truncate">{card.lider}</span>}
                </div>
                <div className="mt-2 flex items-center justify-end text-xs font-semibold text-blue-600"><ChevronDown size={13} className="-rotate-90" /> Ver hoja de ruta</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

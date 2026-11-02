import { useState, useEffect, useRef } from 'react'
import { Search, X, FolderKanban, ClipboardList, Users, UserRound, Workflow, LayoutGrid } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

type ResultType = 'task' | 'project' | 'client' | 'person' | 'funnel' | 'section'
interface Result { id: string; type: ResultType; title: string; subtitle: string; target?: string }

const ADMIN_SECTIONS = [
  ['overview', 'Proyectos'], ['team', 'Carga del equipo'], ['team_tasks', 'Tareas del equipo'], ['calendar', 'Calendario'],
  ['performance', 'Rendimiento'], ['mytasks', 'Mis tareas'], ['roadmap', 'Hoja de Ruta'], ['clientes', 'Clientes'],
  ['requests', 'Solicitudes'], ['chat_team', 'Chat Equipo'], ['chat_clients', 'Chat Clientes'], ['entregables', 'Entregables'],
  ['funnels', 'Embudos'], ['permisos', 'Usuarios y permisos'], ['profile', 'Mi perfil'],
]
const TEAM_SECTIONS = [
  ['today', 'Mi día'], ['tasks', 'Mis tareas'], ['calendar', 'Mi calendario'], ['roadmap', 'Hoja de Ruta'],
  ['chat_team', 'Chat del Equipo'], ['chat_clients', 'Chat con Clientes'], ['entregables', 'Entregables'], ['profile', 'Mi perfil'],
]
const CLIENT_SECTIONS = [
  ['mistareas', 'Mis tareas'], ['progreso', 'Todas las tareas'], ['area', 'Tareas por área'],
  ['calendario', 'Calendario'], ['roadmap', 'Hoja de Ruta'], ['chat', 'Chat con el equipo'],
  ['entregables', 'Entregables'], ['profile', 'Mi perfil'],
]

function normalize(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
function matches(query: string, ...values: unknown[]) { return values.some(value => normalize(value).includes(query)) }

export default function GlobalSearch() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(value => !value) }
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 50)
    else { setQuery(''); setResults([]); setError(''); setLoading(false) }
  }, [open])

  useEffect(() => {
    if (!query.trim()) { requestId.current += 1; setResults([]); setError(''); setLoading(false); return }
    const timer = window.setTimeout(() => { void searchAll(query.trim()) }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function handleClick(event: MouseEvent) { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function searchAll(rawQuery: string) {
    const currentRequest = ++requestId.current
    const q = normalize(rawQuery)
    setLoading(true); setError('')
    try {
      const availableSections = user?.role === 'admin' ? ADMIN_SECTIONS : user?.role === 'client' ? CLIENT_SECTIONS : TEAM_SECTIONS
      const sections = availableSections
        .filter(([target]) => target !== 'permisos' || user?.is_super_admin)
        .filter(([, label]) => matches(q, label))
        .map(([target, label]) => ({ id: `section-${target}`, type: 'section' as const, title: label, subtitle: 'Ir a esta sección', target }))
      const responses = await Promise.all([
        supabase.from('tasks').select('id, title, description, status, department, priority, project:projects(name, client:clients(name, company))').is('archived_at', null).order('updated_at', { ascending: false }).limit(1000),
        supabase.from('projects').select('id, name, description, status, client:clients(name, company)').order('created_at', { ascending: false }).limit(500),
        supabase.from('clients').select('id, name, company, notes').order('name').limit(500),
        supabase.from('users').select('id, full_name, email, role, department').eq('active', true).order('full_name').limit(500),
        supabase.from('project_templates').select('id, name, description, icon, archived').eq('archived', false).order('name').limit(200),
      ])
      const [taskResponse, projectResponse, clientResponse, userResponse, funnelResponse] = responses
      const taskResults: Result[] = (taskResponse.data || []).filter((task: any) => matches(q, task.title, task.description, task.status, task.department, task.priority, task.project?.name, task.project?.client?.name, task.project?.client?.company)).slice(0, 8).map((task: any) => ({ id: task.id, type: 'task', title: task.title, subtitle: `${task.project?.client?.name || 'Sin cliente'} — ${task.project?.name || 'Sin proyecto'} · ${task.status}` }))
      const projectResults: Result[] = (projectResponse.data || []).filter((project: any) => matches(q, project.name, project.description, project.status, project.client?.name, project.client?.company)).slice(0, 8).map((project: any) => ({ id: project.id, type: 'project', title: project.name, subtitle: `${project.client?.name || 'Sin cliente'} · ${project.status}` }))
      const clientResults: Result[] = (clientResponse.data || []).filter((client: any) => matches(q, client.name, client.company, client.notes)).slice(0, 8).map((client: any) => ({ id: client.id, type: 'client', title: client.name, subtitle: client.company || 'Cliente' }))
      const personResults: Result[] = user?.role === 'client' ? [] : (userResponse.data || []).filter((person: any) => matches(q, person.full_name, person.email, person.role, person.department)).slice(0, 8).map((person: any) => ({ id: person.id, type: 'person', title: person.full_name, subtitle: `${person.department || 'Sin departamento'} · ${person.email || person.role}` }))
      const funnelResults: Result[] = user?.role !== 'admin' ? [] : (funnelResponse.data || []).filter((funnel: any) => matches(q, funnel.name, funnel.description)).slice(0, 8).map((funnel: any) => ({ id: funnel.id, type: 'funnel', title: funnel.name, subtitle: funnel.description || 'Plantilla de proyecto' }))
      if (currentRequest !== requestId.current) return
      setResults([...sections, ...taskResults, ...projectResults, ...clientResults, ...personResults, ...funnelResults])
      if (responses.some(response => response.error) && sections.length === 0 && responses.every(response => !response.data?.length)) setError('No fue posible consultar la información. Intenta de nuevo.')
    } catch {
      if (currentRequest === requestId.current) setError('No fue posible consultar la información. Intenta de nuevo.')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  function selectResult(result: Result) {
    const eventByType: Record<ResultType, string> = { task: 'open-task', project: 'open-project', client: 'open-client', person: 'open-person', funnel: 'open-funnel', section: 'open-section' }
    window.dispatchEvent(new CustomEvent(eventByType[result.type], { detail: { id: result.id, taskId: result.id, projectId: result.id, clientId: result.id, userId: result.id, funnelId: result.id, view: result.target } }))
    setOpen(false)
  }

  const typeIcon = { task: ClipboardList, project: FolderKanban, client: Users, person: UserRound, funnel: Workflow, section: LayoutGrid }
  const typeLabel = { task: 'Tarea', project: 'Proyecto', client: 'Cliente', person: 'Persona', funnel: 'Embudo', section: 'Sección' }
  const typeColor = { task: 'text-blue-500', project: 'text-purple-500', client: 'text-green-500', person: 'text-cyan-600', funnel: 'text-orange-500', section: 'text-gray-600' }

  return <>
    <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 bg-gray-100 hover:bg-gray-200 rounded-lg transition"><Search size={15} /><span className="hidden sm:block">Buscar...</span><kbd className="hidden sm:block text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-400">⌘K</kbd></button>
    {open && <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-24 px-4"><div ref={ref} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100"><Search size={18} className="text-gray-400 shrink-0" /><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar en toda la aplicación..." className="flex-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none" />{query && <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>}</div>
      <div className="max-h-96 overflow-y-auto">
        {loading && <div className="py-6 text-center text-sm text-gray-400">Buscando...</div>}
        {!loading && error && <div role="alert" className="py-6 px-4 text-center text-sm text-red-500">{error}</div>}
        {!loading && !error && query && results.length === 0 && <div className="py-6 text-center text-sm text-gray-400">Sin resultados para “{query}”</div>}
        {!loading && !query && <div className="py-6 text-center text-sm text-gray-400">Busca tareas, proyectos, clientes, personas, embudos o secciones</div>}
        {!loading && results.map(result => { const Icon = typeIcon[result.type]; return <button type="button" key={`${result.type}-${result.id}`} onClick={() => selectResult(result)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 cursor-pointer border-b border-gray-50 transition"><Icon size={16} className={`${typeColor[result.type]} shrink-0`} /><div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{result.title}</p><p className="text-xs text-gray-400 truncate">{result.subtitle}</p></div><span className={`text-xs font-semibold ${typeColor[result.type]} shrink-0`}>{typeLabel[result.type]}</span></button> })}
      </div>
      <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-400"><span>ESC para cerrar</span><span>⌘K para abrir</span></div>
    </div></div>}
  </>
}

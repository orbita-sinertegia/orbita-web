import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Link, Mail, Map as MapIcon, Plus, Search, UserPlus, Workflow, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Client, User } from '../../types'
import UserAvatar from '../shared/UserAvatar'

interface Assignment { id: string; client_id: string; user_id: string; user: User }
interface Props { clients: Client[]; teamMembers: User[]; onCreateProject: () => void; onOpenFunnels: () => void; onOpenRoadmap?: (clientId: string) => void }
type ClientFilter = 'todos' | 'sin_equipo' | 'con_equipo' | 'sin_acceso'

export default function ClientAssignmentManager({ clients, teamMembers, onCreateProject, onOpenFunnels, onOpenRoadmap }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [adding, setAdding] = useState<{ clientId: string; userId: string } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [invitedClientIds, setInvitedClientIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ClientFilter>('todos')
  const [sort, setSort] = useState<'attention' | 'name'>('attention')
  const [page, setPage] = useState(1)
  const pageSize = 8

  useEffect(() => { void fetchAssignments() }, [])

  async function fetchAssignments() {
    const [{ data }, { data: invitations }] = await Promise.all([
      supabase.from('client_team_members').select('*, user:users(*)'),
      supabase.from('client_invitations').select('client_id'),
    ])
    setAssignments((data || []) as unknown as Assignment[])
    setInvitedClientIds(new Set((invitations || []).map(row => row.client_id)))
  }

  function assignedTo(clientId: string) { return assignments.filter(item => item.client_id === clientId).map(item => item.user) }
  function availableToAdd(clientId: string) {
    const assignedIds = assignedTo(clientId).map(user => user.id)
    return teamMembers.filter(member => !assignedIds.includes(member.id))
  }

  async function addAssignment(clientId: string, userId: string) {
    setLoadingId(clientId)
    await supabase.from('client_team_members').insert({ client_id: clientId, user_id: userId })
    await fetchAssignments()
    setAdding(null)
    setLoadingId(null)
  }

  async function removeAssignment(clientId: string, userId: string) {
    setLoadingId(`${userId}${clientId}`)
    await supabase.from('client_team_members').delete().eq('client_id', clientId).eq('user_id', userId)
    await fetchAssignments()
    setLoadingId(null)
  }

  async function generateInviteLink(clientId: string) {
    const { data } = await supabase.from('client_invitations').insert({ client_id: clientId }).select('id').single()
    if (!data) return
    const url = `https://agencia.sinertegia.com?invite=${data.id}`
    setGeneratedLinks(previous => ({ ...previous, [clientId]: url }))
    setInvitedClientIds(previous => new Set(previous).add(clientId))
  }

  async function copyLink(clientId: string) {
    const link = generatedLinks[clientId]
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopiedId(clientId)
    window.setTimeout(() => setCopiedId(null), 2000)
  }

  const visibleClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    return clients.filter(client => {
      const teamCount = assignments.filter(item => item.client_id === client.id).length
      const hasAccess = !!client.user_id || invitedClientIds.has(client.id)
      if (filter === 'sin_equipo' && teamCount) return false
      if (filter === 'con_equipo' && !teamCount) return false
      if (filter === 'sin_acceso' && hasAccess) return false
      return !query || `${client.name} ${client.company}`.toLowerCase().includes(query)
    }).sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'es')
      const score = (client: Client) => (assignments.some(item => item.client_id === client.id) ? 0 : 2) + (client.user_id || invitedClientIds.has(client.id) ? 0 : 1)
      return score(b) - score(a) || a.name.localeCompare(b.name, 'es')
    })
  }, [clients, assignments, invitedClientIds, search, filter, sort])

  const totalPages = Math.max(1, Math.ceil(visibleClients.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedClients = visibleClients.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const attentionCount = clients.filter(client => !assignments.some(item => item.client_id === client.id) || (!client.user_id && !invitedClientIds.has(client.id))).length

  return (
    <div className="mx-auto max-w-[1320px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold text-gray-900">Clientes</h2><p className="text-sm text-gray-500">Gestiona clientes, accesos y equipos asignados.</p></div>
        <div className="flex flex-wrap gap-2"><button onClick={onOpenFunnels} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Workflow size={16} /> Administrar embudos</button><button onClick={onCreateProject} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"><Plus size={16} /> Nuevo cliente</button></div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="relative min-w-[240px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Buscar cliente..." className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div>
        {([['todos', 'Todos'], ['sin_equipo', 'Sin equipo'], ['con_equipo', 'Con equipo'], ['sin_acceso', 'Sin acceso']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => { setFilter(value); setPage(1) }} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${filter === value ? 'border-blue-200 bg-blue-50 text-blue-700' : value === 'sin_equipo' ? 'border-amber-100 bg-amber-50 text-amber-700' : value === 'con_equipo' ? 'border-green-100 bg-green-50 text-green-700' : value === 'sin_acceso' ? 'border-red-100 bg-red-50 text-red-600' : 'border-gray-200 text-gray-600'}`}>{label}</button>)}
        <select value={sort} onChange={event => { setSort(event.target.value as 'attention' | 'name'); setPage(1) }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600"><option value="attention">Pendientes primero</option><option value="name">Nombre A-Z</option></select>
      </div>

      <p className="text-sm text-gray-500"><b className="text-gray-800">{clients.length} clientes</b><span className="mx-2">·</span><span className="font-semibold text-orange-600">{attentionCount} requieren atención</span></p>

      <div className="grid gap-4 md:grid-cols-2">
        {pagedClients.map(client => {
          const assigned = assignedTo(client.id)
          const available = availableToAdd(client.id)
          const isAddingHere = adding?.clientId === client.id
          const access = client.user_id ? 'Completo' : invitedClientIds.has(client.id) ? 'Invitado' : 'Sin acceso'
          return <article key={client.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md">
            <div className="mb-4 flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><UserAvatar name={client.name} avatarUrl={client.avatar_url} size={42} /><div className="min-w-0"><p className="truncate font-bold text-gray-900">{client.name}</p><p className="truncate text-xs text-gray-500">{client.company || 'Cliente'}</p></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${assigned.length ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{assigned.length ? 'Con equipo' : 'Sin equipo'}</span></div>
            <div className="mb-3 flex items-center gap-2 text-xs text-gray-500"><Mail size={13} />Acceso: <b className={access === 'Completo' ? 'text-green-600' : access === 'Sin acceso' ? 'text-red-500' : 'text-blue-600'}>{access}</b></div>
            {assigned.length > 0 && <div className="mb-3 flex items-center gap-2"><span className="text-xs text-gray-500">Equipo asignado</span><div className="flex -space-x-2">{assigned.slice(0, 5).map(member => <span key={member.id} title={member.full_name} className="rounded-full ring-2 ring-white"><UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={26} /></span>)}{assigned.length > 5 && <span className="grid h-[26px] min-w-[26px] place-items-center rounded-full bg-gray-100 px-1 text-[10px] font-bold text-gray-600 ring-2 ring-white">+{assigned.length - 5}</span>}</div></div>}
            {generatedLinks[client.id] && <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2"><p className="flex-1 truncate font-mono text-xs text-green-700">{generatedLinks[client.id]}</p><button onClick={() => copyLink(client.id)} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-green-700">{copiedId === client.id ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}</button></div>}
            {isAddingHere && <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">{assigned.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{assigned.map(member => <span key={member.id} className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-gray-700"><UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={20} />{member.full_name}<button onClick={() => removeAssignment(client.id, member.id)} disabled={loadingId === `${member.id}${client.id}`} className="text-gray-400 hover:text-red-500"><X size={11} /></button></span>)}</div>}{available.length ? <div className="flex gap-2"><select value={adding.userId} onChange={event => setAdding({ clientId: client.id, userId: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="">Selecciona integrante</option>{available.map(member => <option key={member.id} value={member.id}>{member.full_name} · {member.department || 'Sin departamento'}</option>)}</select><button disabled={!adding.userId || loadingId === client.id} onClick={() => adding.userId && addAssignment(client.id, adding.userId)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Agregar</button></div> : <p className="text-xs text-gray-500">Todo el equipo disponible ya está asignado.</p>}</div>}
            <div className="grid grid-cols-2 gap-2"><button onClick={() => generateInviteLink(client.id)} className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"><Link size={13} /> {access === 'Sin acceso' ? 'Invitar cliente' : 'Nueva invitación'}</button><button onClick={() => setAdding(isAddingHere ? null : { clientId: client.id, userId: '' })} className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"><UserPlus size={13} /> {assigned.length ? 'Editar equipo' : 'Asignar equipo'}</button></div>
            {onOpenRoadmap && <button onClick={() => onOpenRoadmap(client.id)} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"><MapIcon size={13} /> Ver hoja de ruta</button>}
          </article>
        })}
      </div>

      {!pagedClients.length && <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-400">No hay clientes que coincidan con estos filtros.</div>}
      {totalPages > 1 && <div className="flex items-center justify-center gap-2"><button disabled={currentPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 disabled:opacity-40"><ChevronLeft size={15} /></button>{Array.from({ length: totalPages }, (_, index) => index + 1).map(number => <button key={number} onClick={() => setPage(number)} className={`h-8 min-w-8 rounded-lg px-2 text-xs font-bold ${currentPage === number ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-600'}`}>{number}</button>)}<button disabled={currentPage >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 disabled:opacity-40"><ChevronRight size={15} /></button></div>}
    </div>
  )
}

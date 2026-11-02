import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, LoaderCircle, MessageCircle, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Client, Project, User } from '../../types'
import ClientChatRoom from './ClientChatRoom'
import CreateTaskModal from '../admin/CreateTaskModal'
import UserAvatar from '../shared/UserAvatar'

interface Props {
  initialClients?: Client[]
}

type ChatFilter = 'all' | 'waiting' | 'unread'
type SortMode = 'activity' | 'name'

interface ConversationSummary {
  roomId?: string
  lastMessage: string
  lastAt?: string
  lastSenderRole?: string
  unread: number
}

function readStorageKey(userId: string, roomId: string) {
  return `sinertegia:client-chat-read:${userId}:${roomId}`
}

function shortTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer'
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

export default function ClientChatsHub({ initialClients }: Props) {
  const { user } = useAuth()
  const [clients, setClients] = useState<Client[]>(initialClients || [])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [teamMembers, setTeamMembers] = useState<User[]>([])
  const [summaries, setSummaries] = useState<Record<string, ConversationSummary>>({})
  const [convertTask, setConvertTask] = useState<{ content: string; messageId: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ChatFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('activity')

  async function fetchData() {
    if (!user) return
    setLoading(true)
    const [{ data: proj }, { data: team }] = await Promise.all([
      supabase.from('projects').select('*, client:clients(*)').eq('status', 'activo'),
      supabase.from('users').select('*').eq('role', 'team'),
    ])
    setProjects(proj || [])
    setTeamMembers(team || [])

    let clientList: Client[] = []
    if (user.role === 'admin') {
      const { data } = await supabase.from('clients').select('*').order('name')
      clientList = data || []
    } else {
      const clientIds = new Set<string>()
      const { data: assignments } = await supabase.from('client_team_members').select('client_id').eq('user_id', user.id)
      ;(assignments || []).forEach((item: { client_id?: string }) => { if (item.client_id) clientIds.add(item.client_id) })
      const { data: taskData } = await supabase.from('tasks').select('project_id').eq('assigned_to', user.id)
      const projectIds = [...new Set((taskData || []).map(item => item.project_id).filter(Boolean))]
      if (projectIds.length > 0) {
        const { data: projectData } = await supabase.from('projects').select('client_id').in('id', projectIds)
        ;(projectData || []).forEach((item: { client_id?: string }) => { if (item.client_id) clientIds.add(item.client_id) })
      }
      if (clientIds.size > 0) {
        const { data } = await supabase.from('clients').select('*').in('id', [...clientIds]).order('name')
        clientList = data || []
      }
    }

    const clientUserIds = clientList.map(client => client.user_id).filter(Boolean) as string[]
    if (clientUserIds.length > 0) {
      const { data: clientUsers } = await supabase.from('users').select('id, avatar_url').in('id', clientUserIds)
      const avatars = new Map((clientUsers || []).map(item => [item.id, item.avatar_url]))
      clientList = clientList.map(client => ({ ...client, avatar_url: client.user_id ? avatars.get(client.user_id) : undefined }))
    }

    setClients(clientList)
    setSelectedClient(current => current && clientList.some(client => client.id === current.id) ? current : clientList[0] || null)
    await refreshSummaries(clientList)
    setLoading(false)
  }

  async function refreshSummaries(clientList: Client[]) {
    if (!user || clientList.length === 0) return
    const clientIds = clientList.map(client => client.id)
    const { data: rooms } = await supabase.from('chat_rooms').select('id, client_id').eq('type', 'client').in('client_id', clientIds)
    if (!rooms?.length) {
      setSummaries({})
      return
    }
    const roomIds = rooms.map(room => room.id)
    const { data: messages } = await supabase.from('chat_messages')
      .select('id, room_id, sender_id, content, file_name, created_at, sender:users!sender_id(role)')
      .in('room_id', roomIds).order('created_at', { ascending: false }).limit(500)
    const roomByClient = new Map(rooms.map(room => [room.client_id, room.id]))
    const next: Record<string, ConversationSummary> = {}
    clientList.forEach(client => {
      const roomId = roomByClient.get(client.id)
      const roomMessages = (messages || []).filter(message => message.room_id === roomId)
      const latest = roomMessages[0]
      const lastRead = roomId ? localStorage.getItem(readStorageKey(user.id, roomId)) : null
      const unread = roomMessages.filter(message => message.sender_id !== user.id && (!lastRead || new Date(message.created_at) > new Date(lastRead))).length
      const sender = latest?.sender as unknown as { role?: string } | null
      next[client.id] = {
        roomId,
        lastMessage: latest?.content || (latest?.file_name ? `Archivo: ${latest.file_name}` : 'Sin mensajes todavía'),
        lastAt: latest?.created_at,
        lastSenderRole: sender?.role,
        unread,
      }
    })
    setSummaries(next)
  }

  useEffect(() => {
    // La carga asíncrona sincroniza la bandeja cuando cambia la sesión activa.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
    // La carga se reinicia únicamente cuando cambia la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (!user || clients.length === 0) return
    refreshSummaries(clients)
    const channel = supabase.channel(`client-hub-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => refreshSummaries(clients))
      .subscribe()
    const sync = () => { if (document.visibilityState === 'visible') refreshSummaries(clients) }
    const interval = window.setInterval(sync, 5000)
    window.addEventListener('focus', sync)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      supabase.removeChannel(channel)
    }
    // La suscripción se recrea al cambiar la lista visible de clientes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, user])

  function openConversation(client: Client) {
    setSelectedClient(client)
    const summary = summaries[client.id]
    if (user && summary?.roomId) {
      localStorage.setItem(readStorageKey(user.id, summary.roomId), new Date().toISOString())
      setSummaries(previous => ({ ...previous, [client.id]: { ...previous[client.id], unread: 0 } }))
    }
  }

  const visibleClients = useMemo(() => clients
    .filter(client => {
      const summary = summaries[client.id]
      const matchesSearch = `${client.name} ${client.company || ''} ${summary?.lastMessage || ''}`.toLowerCase().includes(search.toLowerCase())
      if (!matchesSearch) return false
      if (filter === 'waiting') return summary?.lastSenderRole === 'client'
      if (filter === 'unread') return (summary?.unread || 0) > 0
      return true
    })
    .sort((a, b) => sortMode === 'name'
      ? a.name.localeCompare(b.name)
      : new Date(summaries[b.id]?.lastAt || 0).getTime() - new Date(summaries[a.id]?.lastAt || 0).getTime()),
  [clients, filter, search, sortMode, summaries])

  if (loading) return <div className="flex h-64 items-center justify-center gap-2 text-sm text-gray-400"><LoaderCircle size={18} className="animate-spin" /> Cargando chats...</div>
  if (clients.length === 0) return <div className="py-16 text-center text-gray-400"><MessageCircle size={32} className="mx-auto mb-2 opacity-30" /><p>No hay clientes asignados</p></div>

  const selectedProject = projects.find(project => project.client_id === selectedClient?.id)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Chat con clientes</h1>
        <p className="mt-1 text-xs text-gray-500">Comunicación directa y organizada con tus clientes.</p>
      </div>

      <div className="client-chats-shell overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className={`client-chats-layout grid min-h-[650px] grid-cols-[330px_minmax(0,1fr)] ${selectedClient ? 'has-selection' : ''}`}>
          <aside className="client-chats-list flex min-h-0 flex-col border-r border-gray-200">
            <div className="border-b border-gray-100 p-3">
              <div className="mb-3 flex gap-1 border-b border-gray-100">
                {([['all', 'Todos'], ['waiting', 'Sin responder'], ['unread', 'No leídos']] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setFilter(value)} className={`relative flex-1 px-2 pb-2 text-xs font-semibold ${filter === value ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
                    {label}{filter === value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600" />}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <label className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2"><Search size={13} className="text-gray-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar cliente o mensaje..." className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
                <button type="button" onClick={() => setSortMode(current => current === 'activity' ? 'name' : 'activity')} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-600" title="Cambiar orden">{sortMode === 'activity' ? 'Actividad' : 'Nombre'} <ChevronDown size={12} /></button>
              </div>
            </div>

            <div className="max-h-[535px] flex-1 overflow-y-auto">
              {visibleClients.map(client => {
                const summary = summaries[client.id]
                const waiting = summary?.lastSenderRole === 'client'
                return <button key={client.id} type="button" onClick={() => openConversation(client)} className={`relative w-full border-b border-gray-50 px-3 py-3 text-left transition hover:bg-gray-50 ${selectedClient?.id === client.id ? 'bg-blue-50/80' : ''}`}>
                  {selectedClient?.id === client.id && <span className="absolute inset-y-0 left-0 w-0.5 bg-blue-600" />}
                  <div className="flex items-start gap-2.5">
                    <UserAvatar name={client.name} avatarUrl={client.avatar_url} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-gray-800">{client.name}</p>{waiting && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[8px] font-bold text-blue-600">Esperando respuesta</span>}<time className="ml-auto shrink-0 text-[9px] text-gray-400">{shortTime(summary?.lastAt)}</time></div>
                      <div className="mt-1 flex items-center gap-2"><p className="truncate text-xs text-gray-500">{summary?.lastMessage || client.company || 'Sin mensajes todavía'}</p>{!!summary?.unread && <span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">{summary.unread > 9 ? '9+' : summary.unread}</span>}</div>
                    </div>
                  </div>
                </button>
              })}
              {visibleClients.length === 0 && <div className="px-4 py-12 text-center text-xs text-gray-400">No hay conversaciones en este filtro.</div>}
            </div>
            <div className="border-t border-gray-100 px-4 py-3 text-[10px] text-gray-400">Mostrando {visibleClients.length} de {clients.length} conversaciones</div>
          </aside>

          <main className="client-chats-panel min-h-[650px] bg-gray-50/60 p-3">
            {selectedClient && <button type="button" onClick={() => setSelectedClient(null)} className="client-chats-back mb-3 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700"><ArrowLeft size={14} /> Conversaciones</button>}
            {selectedClient ? <ClientChatRoom client={selectedClient} projectName={selectedProject?.name} onConvertToTask={(content, messageId) => setConvertTask({ content, messageId })} /> : <div className="flex h-full items-center justify-center text-sm text-gray-400">Selecciona un cliente para ver el chat</div>}
          </main>
        </div>
      </div>

      {convertTask && <CreateTaskModal projects={projects} teamMembers={teamMembers} prefillTitle={convertTask.content} onClose={() => setConvertTask(null)} onCreated={() => setConvertTask(null)} />}
    </div>
  )
}

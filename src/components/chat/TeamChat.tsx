import { useEffect, useState, useRef } from 'react'
import type { MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Users, Music, MoreVertical, Trash2, Search, Reply, Smile, Pin, ListPlus, Link2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { ChatMessage, Project, Task, User } from '../../types'
import MentionInput from './MentionInput'
import CreateTaskModal from '../admin/CreateTaskModal'
import UserAvatar from '../shared/UserAvatar'

function renderWithMentions(content: string, userNames: string[]) {
  if (!content || !userNames.length) return <span>{content}</span>
  const escaped = userNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(@(?:${escaped.join('|')}))`, 'g')
  const parts = content.split(regex)
  return (
    <span>
      {parts.map((part, i) =>
        userNames.some(n => part === `@${n}`)
          ? <span key={i} className="bg-blue-100 text-blue-700 rounded px-0.5 font-semibold">{part}</span>
          : <span key={i}>{part}</span>
      )}
    </span>
  )
}

function FilePreview({ url, type, name, isMe }: { url: string; type: string; name: string; isMe: boolean }) {
  if (type === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={name} className="max-w-[200px] max-h-[200px] rounded-lg object-cover mt-1 hover:opacity-90 transition" />
      </a>
    )
  }
  if (type === 'audio') {
    return (
      <div className={`mt-1 flex items-center gap-2 rounded-xl px-3 py-2 ${isMe ? 'bg-blue-700' : 'bg-gray-100'}`}>
        <Music size={14} className={isMe ? 'text-blue-200' : 'text-gray-500'} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs truncate mb-1 ${isMe ? 'text-blue-200' : 'text-gray-500'}`}>{name}</p>
          <audio controls src={url} className="w-full h-8" style={{ maxWidth: '200px' }} />
        </div>
      </div>
    )
  }
  return null
}

async function getOrCreateTeamRoom(): Promise<string | null> {
  const { data: existing } = await supabase
    .from('chat_rooms').select('id').eq('type', 'team').maybeSingle()
  if (existing) return existing.id
  const { data: created } = await supabase
    .from('chat_rooms').insert({ type: 'team', name: 'Chat del Equipo' }).select('id').single()
  return created?.id || null
}

export default function TeamChat() {
  const { user } = useAuth()
  const [roomId, setRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatUsers, setChatUsers] = useState<User[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const [search, setSearch] = useState('')
  const [messageFilter, setMessageFilter] = useState<'todos' | 'menciones' | 'archivos' | 'tareas' | 'fijados'>('todos')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [reactionMessageId, setReactionMessageId] = useState<string | null>(null)
  const [convertMessage, setConvertMessage] = useState<ChatMessage | null>(null)
  const [linkMessage, setLinkMessage] = useState<ChatMessage | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [teamTasks, setTeamTasks] = useState<Task[]>([])
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [chatError, setChatError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { initRoom() }, [])

  useEffect(() => {
    if (!roomId) return
    const channel = supabase.channel(`team-chat-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        () => fetchMessages(roomId))
      .subscribe()
    const sync = () => { if (document.visibilityState === 'visible') fetchMessages(roomId) }
    const interval = window.setInterval(sync, 3000)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
      supabase.removeChannel(channel)
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId || !user) return
    const presence = supabase.channel(`team-presence-${roomId}`, { config: { presence: { key: user.id } } })
      .on('presence', { event: 'sync' }, () => setOnlineIds(new Set(Object.keys(presence.presenceState()))))
      .subscribe(async status => { if (status === 'SUBSCRIBED') await presence.track({ user_id: user.id, online_at: new Date().toISOString() }) })
    return () => { supabase.removeChannel(presence) }
  }, [roomId, user?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function initRoom() {
    const [id, { data: users }, { data: projectRows }, { data: taskRows }] = await Promise.all([
      getOrCreateTeamRoom(),
      supabase.from('users').select('*').in('role', ['admin', 'team']),
      supabase.from('projects').select('*, client:clients(*)').eq('status', 'activo'),
      supabase.from('tasks').select('*, project:projects(*, client:clients(*))').neq('status', 'completada').is('archived_at', null).order('updated_at', { ascending: false }).limit(100),
    ])
    setChatUsers(users || [])
    setProjects(projectRows || [])
    setTeamTasks((taskRows as Task[]) || [])
    if (id) { setRoomId(id); await fetchMessages(id) }
    setLoading(false)
  }

  async function fetchMessages(id: string) {
    const { data } = await supabase
      .from('chat_messages')
      .select('*, sender:users!sender_id(id, full_name, role)')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .limit(100)
    setMessages((data as ChatMessage[]) || [])
    if (user && (data || []).some(message => message.sender_id !== user.id && !((message.read_by as string[] | undefined) || []).includes(user.id))) {
      await supabase.rpc('mark_chat_room_read', { p_room_id: id })
    }
  }

  async function sendMessage() {
    if (!newMessage.trim() && !selectedFile) return
    if (!roomId || !user) return

    const content = newMessage.trim()
    setNewMessage('')
    const fileToSend = selectedFile
    setSelectedFile(null)

    let file_url: string | undefined
    let file_type: string | undefined
    let file_name: string | undefined

    if (fileToSend) {
      const path = `${roomId}/${Date.now()}_${fileToSend.name}`
      const { error } = await supabase.storage.from('chat-files').upload(path, fileToSend)
      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(path)
        file_url = publicUrl
        file_type = fileToSend.type.startsWith('image/') ? 'image' : 'audio'
        file_name = fileToSend.name
      }
    }

    await supabase.from('chat_messages').insert({
      room_id: roomId,
      sender_id: user.id,
      content: content || '',
      ...(replyTo ? { reply_to_id: replyTo.id } : {}),
      ...(file_url ? { file_url, file_type, file_name } : {}),
    })
    setReplyTo(null)

    const others = chatUsers.filter(u => u.id !== user.id)
    if (others.length > 0) {
      const messagePreview = content.slice(0, 100) + (content.length > 100 ? '...' : '')
      const { error: notifErr } = await supabase.from('notifications').insert(
        others.map(u => {
          const isMentioned = content.includes(`@${u.full_name}`)
          return {
            user_id: u.id,
            title: isMentioned ? `@${user.full_name} te mencionó en el chat` : `💬 ${user.full_name} en el Chat del Equipo`,
            message: messagePreview,
            type: isMentioned ? 'mention' : 'comment',
            read: false,
          }
        })
      )
      if (notifErr) console.error('Error al crear notificación de chat:', notifErr)
    }
    fetchMessages(roomId)
  }

  async function deleteForMe(msg: ChatMessage) {
    if (!user) return
    setOpenMenuId(null)
    const updated = [...(msg.deleted_for || []), user.id]
    await supabase.from('chat_messages').update({ deleted_for: updated }).eq('id', msg.id)
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, deleted_for: updated } : m))
  }

  async function deleteForEveryone(msg: ChatMessage) {
    if (!user) return
    setOpenMenuId(null)
    await supabase.from('chat_messages').delete().eq('id', msg.id).eq('sender_id', user.id)
    setMessages(prev => prev.filter(m => m.id !== msg.id))
  }

  function openMessageMenu(event: MouseEvent<HTMLButtonElement>, messageId: string, alignRight: boolean) {
    if (openMenuId === messageId) {
      setOpenMenuId(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 190
    const menuHeight = alignRight ? 286 : 250
    const gap = 6
    const left = Math.min(
      Math.max(8, alignRight ? rect.right - menuWidth : rect.left),
      window.innerWidth - menuWidth - 8,
    )
    const top = window.innerHeight - rect.bottom >= menuHeight + gap
      ? rect.bottom + gap
      : Math.max(8, rect.top - menuHeight - gap)
    setMenuPosition({ top, left })
    setOpenMenuId(messageId)
  }

  async function toggleReaction(msg: ChatMessage, emoji: string) {
    if (!user) return
    const reactions = { ...(msg.reactions || {}) }
    const users = reactions[emoji] || []
    reactions[emoji] = users.includes(user.id) ? users.filter(id => id !== user.id) : [...users, user.id]
    if (reactions[emoji].length === 0) delete reactions[emoji]
    const { error } = await supabase.from('chat_messages').update({ reactions }).eq('id', msg.id)
    if (error) setChatError('Primero hay que activar la actualización del chat en Supabase.')
    else setMessages(prev => prev.map(item => item.id === msg.id ? { ...item, reactions } : item))
    setReactionMessageId(null)
  }

  async function togglePin(msg: ChatMessage) {
    if (!roomId) return
    setOpenMenuId(null)
    if (!msg.is_pinned) await supabase.from('chat_messages').update({ is_pinned: false }).eq('room_id', roomId)
    const { error } = await supabase.from('chat_messages').update({ is_pinned: !msg.is_pinned }).eq('id', msg.id)
    if (error) setChatError('Primero hay que activar la actualización del chat en Supabase.')
    else await fetchMessages(roomId)
  }

  async function linkToTask(taskId: string) {
    if (!linkMessage) return
    const { error } = await supabase.from('chat_messages').update({ task_id: taskId }).eq('id', linkMessage.id)
    if (!error && roomId) await fetchMessages(roomId)
    setLinkMessage(null)
  }

  async function markConverted() {
    if (!convertMessage) return
    await supabase.from('chat_messages').update({ converted_to_task: true }).eq('id', convertMessage.id)
    if (roomId) await fetchMessages(roomId)
    setConvertMessage(null)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando chat...</div>

  const visibleMessages = messages.filter(message => {
    if ((message.deleted_for || []).includes(user?.id || '')) return false
    if (search.trim() && !(message.content || '').toLowerCase().includes(search.toLowerCase())) return false
    if (messageFilter === 'menciones') return !!user?.full_name && (message.content || '').includes(`@${user.full_name}`)
    if (messageFilter === 'archivos') return !!message.file_url
    if (messageFilter === 'tareas') return !!message.task_id || message.converted_to_task
    if (messageFilter === 'fijados') return !!message.is_pinned
    return true
  })
  const pinnedMessage = messages.find(message => message.is_pinned)

  return (
    <div className="flex flex-col h-[600px] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-white text-gray-800 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white"><Users size={17} /></span>
        <div>
          <h3 className="font-bold text-base">Chat del equipo</h3>
          <p className="text-xs text-gray-400">Solo visible para el equipo</p>
        </div>
        <div className="ml-3 hidden -space-x-2 sm:flex">{chatUsers.slice(0, 4).map(member => <span key={member.id} title={member.full_name} className="rounded-full border-2 border-white"><UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={26} isOnline={onlineIds.has(member.id)} /></span>)}{chatUsers.length > 4 && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-blue-50 text-[9px] font-bold text-blue-600">+{chatUsers.length - 4}</span>}</div>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500"><span className="h-2 w-2 rounded-full bg-green-500" />{onlineIds.size || 1} conectados</div>
      </div>

      {pinnedMessage && <button type="button" onClick={() => document.getElementById(`team-message-${pinnedMessage.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-left text-xs text-blue-800"><Pin size={13} className="fill-blue-600 text-blue-600" /><strong>Mensaje fijado:</strong><span className="truncate">{pinnedMessage.content || pinnedMessage.file_name}</span></button>}
      {chatError && <div className="flex items-center justify-between bg-amber-50 px-4 py-2 text-xs text-amber-700"><span>{chatError}</span><button onClick={() => setChatError('')}><X size={13} /></button></div>}

      <div className="border-b border-gray-100 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2"><Search size={14} className="text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar en el chat" className="w-full bg-transparent text-sm outline-none" /></div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">{([['todos', 'Todos'], ['menciones', 'Menciones'], ['archivos', 'Archivos'], ['tareas', 'Tareas'], ['fijados', 'Fijados']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setMessageFilter(value)} className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition ${messageFilter === value ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}>{label}</button>)}</div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50" onScroll={() => setOpenMenuId(null)}>
        {visibleMessages.length === 0 && (
          <div className="text-center text-gray-400 py-8">
            <Users size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No hay mensajes aún. ¡Sé el primero!</p>
          </div>
        )}
        {visibleMessages.map((msg, index) => {
          const isMe = msg.sender_id === user?.id
          const senderName = (msg.sender as any)?.full_name || 'Usuario'
          const initial = senderName.charAt(0).toUpperCase()
          const repliedMessage = msg.reply_to_id ? messages.find(item => item.id === msg.reply_to_id) : null
          const dateLabel = new Date(msg.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
          const previousDate = index > 0 ? new Date(visibleMessages[index - 1].created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : ''
          const readers = (msg.read_by || []).map(readerId => chatUsers.find(member => member.id === readerId)?.full_name).filter(Boolean) as string[]
          return (
            <div key={msg.id}>
            {dateLabel !== previousDate && <div className="my-3 flex items-center gap-3"><span className="h-px flex-1 bg-gray-200" /><span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-gray-400 shadow-sm">{dateLabel}</span><span className="h-px flex-1 bg-gray-200" /></div>}
            <div id={`team-message-${msg.id}`} className={`flex gap-2 group rounded-lg p-1 transition ${msg.is_pinned ? 'bg-blue-50 ring-1 ring-blue-100' : ''} ${isMe ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isMe ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-700'}`}>
                {initial}
              </div>
              <div className={`max-w-xs lg:max-w-md flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && <span className="text-xs text-gray-400 mb-1 ml-1">{senderName}</span>}
                {msg.deleted_for_everyone ? (
                  <div className="px-3 py-2 rounded-xl text-sm italic text-gray-400 bg-gray-100 border border-gray-200">
                    🚫 Mensaje eliminado
                  </div>
                ) : (
                  <>
                    {repliedMessage && <div className={`mb-1 max-w-full rounded-lg border-l-2 px-3 py-1.5 text-xs ${isMe ? 'border-blue-200 bg-blue-700 text-blue-100' : 'border-blue-500 bg-gray-100 text-gray-500'}`}><p className="font-semibold">Respuesta a {(repliedMessage.sender as any)?.full_name || 'mensaje'}</p><p className="truncate opacity-80">{repliedMessage.content || repliedMessage.file_name}</p></div>}
                    {msg.content && (
                      <div className={`px-3 py-2 rounded-xl text-sm ${isMe ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'}`}>
                        {renderWithMentions(msg.content, chatUsers.map(u => u.full_name))}
                      </div>
                    )}
                    {msg.file_url && msg.file_type && msg.file_name && (
                      <FilePreview url={msg.file_url} type={msg.file_type} name={msg.file_name} isMe={isMe} />
                    )}
                    {msg.task_id && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: msg.task_id } }))} className="mt-1 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600"><Link2 size={9} /> Ver tarea vinculada</button>}
                    {msg.converted_to_task && !msg.task_id && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-600"><ListPlus size={9} /> Convertido en tarea</span>}
                  </>
                )}
                {Object.entries(msg.reactions || {}).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{Object.entries(msg.reactions || {}).map(([emoji, ids]) => <button key={emoji} type="button" onClick={() => toggleReaction(msg, emoji)} className={`rounded-full border px-2 py-0.5 text-[11px] ${ids.includes(user?.id || '') ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}>{emoji} {ids.length}</button>)}</div>}
                <div className="flex items-center gap-1.5 mt-1 mx-1">
                  <span className="text-xs text-gray-300">
                    {new Date(msg.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && !msg.deleted_for_everyone && (
                    <span className={`max-w-[240px] truncate text-[10px] font-medium ${readers.length ? 'text-blue-500' : 'text-gray-400'}`} title={readers.join(', ')}>
                      {readers.length === 0 ? 'Enviado' : `Leído por ${readers.slice(0, 3).join(', ')}${readers.length > 3 ? ` y ${readers.length - 3} más` : ''}`}
                    </span>
                  )}
                  {!msg.deleted_for_everyone && (
                    <div className="relative">
                      <button type="button"
                        onClick={event => openMessageMenu(event, msg.id, isMe)}
                        className="text-gray-400 opacity-100 transition hover:text-gray-700 sm:opacity-0 sm:group-hover:opacity-100">
                        <MoreVertical size={13} />
                      </button>
                      {openMenuId === msg.id && createPortal(
                        <>
                          <button type="button" aria-label="Cerrar menú" className="fixed inset-0 z-[70] cursor-default" onClick={() => setOpenMenuId(null)} />
                          <div className="fixed z-[80] w-[190px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-2xl" style={{ top: menuPosition.top, left: menuPosition.left }}>
                            <button type="button" onClick={() => { setReplyTo(msg); setOpenMenuId(null) }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"><Reply size={12} /> Responder</button>
                            <button type="button" onClick={() => { setReactionMessageId(msg.id); setOpenMenuId(null) }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"><Smile size={12} /> Reaccionar</button>
                            <button type="button" onClick={() => togglePin(msg)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"><Pin size={12} /> {msg.is_pinned ? 'Desfijar mensaje' : 'Fijar mensaje'}</button>
                            <button type="button" onClick={() => { setConvertMessage(msg); setOpenMenuId(null) }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"><ListPlus size={12} /> Convertir en tarea</button>
                            <button type="button" onClick={() => { setLinkMessage(msg); setOpenMenuId(null) }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"><Link2 size={12} /> Vincular con una tarea</button>
                            <button type="button" onClick={() => deleteForMe(msg)}
                              className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                              <Trash2 size={12} /> Borrar para mí
                            </button>
                            {isMe && (
                              <button type="button" onClick={() => deleteForEveryone(msg)}
                                className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                                <Trash2 size={12} /> Borrar para todos
                              </button>
                            )}
                          </div>
                        </>,
                        document.body,
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-100 p-3 bg-white">
        {replyTo && <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-blue-500 bg-blue-50 px-3 py-2 text-xs"><Reply size={13} className="text-blue-600" /><div className="min-w-0 flex-1"><p className="font-semibold text-blue-700">Respondiendo a {(replyTo.sender as any)?.full_name || 'mensaje'}</p><p className="truncate text-gray-500">{replyTo.content || replyTo.file_name}</p></div><button type="button" onClick={() => setReplyTo(null)} className="text-gray-400"><X size={14} /></button></div>}
        <MentionInput
          value={newMessage}
          onChange={setNewMessage}
          onSend={sendMessage}
          onFileSelect={setSelectedFile}
          selectedFile={selectedFile}
          onClearFile={() => setSelectedFile(null)}
          users={chatUsers.filter(u => u.id !== user?.id)}
          placeholder="Escribe un mensaje... (@ para mencionar)"
        />
      </div>

      {reactionMessageId && (() => { const target = messages.find(message => message.id === reactionMessageId); return target ? <><div className="fixed inset-0 z-40" onClick={() => setReactionMessageId(null)} /><div className="fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl">{['👍', '❤️', '🎉', '✅', '👏', '😂'].map(emoji => <button key={emoji} type="button" onClick={() => toggleReaction(target, emoji)} className="rounded-xl p-2 text-xl hover:bg-gray-100">{emoji}</button>)}</div></> : null })()}

      {convertMessage && <CreateTaskModal projects={projects} teamMembers={chatUsers} prefillTitle={convertMessage.content || convertMessage.file_name || 'Tarea desde el chat'} onClose={() => setConvertMessage(null)} onCreated={markConverted} />}

      {linkMessage && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"><div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-gray-100 px-5 py-4"><div><h3 className="font-bold text-gray-900">Vincular con una tarea</h3><p className="mt-0.5 text-xs text-gray-400">El mensaje quedará conectado a la tarea elegida.</p></div><button type="button" onClick={() => setLinkMessage(null)} className="text-gray-400"><X size={18} /></button></div><div className="max-h-80 divide-y divide-gray-100 overflow-y-auto">{teamTasks.map(task => <button key={task.id} type="button" onClick={() => linkToTask(task.id)} className="w-full px-5 py-3 text-left hover:bg-blue-50"><p className="truncate text-sm font-semibold text-gray-800">{task.title}</p><p className="mt-0.5 truncate text-xs text-gray-400">{task.project?.client?.name || task.project?.name || 'Trabajo interno'}</p></button>)}{teamTasks.length === 0 && <p className="p-8 text-center text-sm text-gray-400">No hay tareas activas.</p>}</div></div></div>}
    </div>
  )
}

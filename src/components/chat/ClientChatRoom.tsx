import { useEffect, useState, useRef } from 'react'
import { BriefcaseBusiness, Plus, CheckCircle, Music, MoreVertical, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { ChatMessage, Client, User } from '../../types'
import MentionInput from './MentionInput'
import UserAvatar from '../shared/UserAvatar'

function renderWithMentions(content: string, userNames: string[]) {
  if (!userNames.length) return <span>{content}</span>
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

interface Props {
  client: Client
  projectName?: string
  onConvertToTask?: (content: string, messageId: string) => void
}

async function getOrCreateClientRoom(clientId: string, clientName: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('chat_rooms')
    .select('id')
    .eq('type', 'client')
    .eq('client_id', clientId)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created } = await supabase
    .from('chat_rooms')
    .insert({ type: 'client', client_id: clientId, name: `Chat - ${clientName}` })
    .select('id')
    .single()

  return created?.id || null
}

export default function ClientChatRoom({ client, projectName, onConvertToTask }: Props) {
  const { user } = useAuth()
  const [roomId, setRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatUsers, setChatUsers] = useState<User[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageSnapshotRef = useRef('')

  const isTeamOrAdmin = user?.role === 'admin' || user?.role === 'team'

  useEffect(() => {
    setLoading(true)
    setMessages([])
    initRoom()
  }, [client.id])

  useEffect(() => {
    if (!roomId) return
    const channel = supabase
      .channel(`client-chat-${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_messages',
        filter: `room_id=eq.${roomId}`,
      }, () => fetchMessages(roomId))
      .subscribe()

    // Realtime es la vía principal. Esta sincronización corta cubre pestañas
    // suspendidas o proyectos donde la publicación de Realtime tarde en llegar.
    const sync = () => { if (document.visibilityState === 'visible') fetchMessages(roomId) }
    const interval = window.setInterval(sync, 2500)
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function initRoom() {
    const [id, { data: assignments }] = await Promise.all([
      getOrCreateClientRoom(client.id, client.name),
      supabase.from('client_team_members').select('user_id').eq('client_id', client.id),
    ])
    if (assignments && assignments.length > 0) {
      const ids = assignments.map((a: any) => a.user_id)
      const { data: users } = await supabase.from('users').select('*').in('id', ids)
      setChatUsers(users || [])
    }
    if (id) {
      setRoomId(id)
      await fetchMessages(id)
    }
    setLoading(false)
  }

  async function fetchMessages(id: string) {
    const { data } = await supabase
      .from('chat_messages')
      .select('*, sender:users!sender_id(id, full_name, role)')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .limit(100)
    const next = (data as ChatMessage[]) || []
    const snapshot = JSON.stringify(next.map(message => [
      message.id,
      message.content,
      message.file_url,
      message.converted_to_task,
      message.deleted_for_everyone,
      message.deleted_for,
      message.read_by,
    ]))
    if (snapshot !== messageSnapshotRef.current) {
      messageSnapshotRef.current = snapshot
      setMessages(next)
    }
    if (user && next.some(message => message.sender_id !== user.id && !(message.read_by || []).includes(user.id))) {
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
      ...(file_url ? { file_url, file_type, file_name } : {}),
    })
    // Equipo → notifica al cliente. Cliente → notifica a todo el equipo asignado.
    const others: { id: string; full_name: string }[] = isTeamOrAdmin
      ? (client.user_id && client.user_id !== user.id ? [{ id: client.user_id, full_name: client.name }] : [])
      : chatUsers.filter(u => u.id !== user.id)

    if (others.length > 0) {
      const messagePreview = content.slice(0, 100) + (content.length > 100 ? '...' : '')
      await supabase.from('notifications').insert(
        others.map(u => {
          const isMentioned = content.includes(`@${u.full_name}`)
          return {
            user_id: u.id,
            title: isMentioned ? `@${user.full_name} te mencionó en el chat` : `💬 ${user.full_name} en el chat de ${client.name}`,
            message: messagePreview,
            type: isMentioned ? 'mention' : 'comment',
            read: false,
          }
        })
      )
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

  async function handleConvertToTask(msg: ChatMessage) {
    await supabase
      .from('chat_messages')
      .update({ converted_to_task: true })
      .eq('id', msg.id)
    setMessages(prev =>
      prev.map(m => m.id === msg.id ? { ...m, converted_to_task: true } : m)
    )
    if (onConvertToTask) onConvertToTask(msg.content, msg.id)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-400">Cargando chat...</div>
  }

  const visibleMessages = messages.filter(m => !(m.deleted_for || []).includes(user?.id || ''))

  return (
    <div className="client-chat-room flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="client-chat-header flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3">
        <UserAvatar name={client.name} avatarUrl={client.avatar_url} size={34} />
        <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-gray-900">{client.name}</h3>
        <p className="truncate text-xs text-gray-400">{client.company} · Chat con el equipo</p>
        </div>
        {projectName && <span className="ml-auto flex max-w-[220px] items-center gap-1.5 truncate rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700"><BriefcaseBusiness size={12} className="shrink-0" /><span className="truncate">Proyecto: {projectName}</span></span>}
      </div>

      {/* Messages */}
      <div className="client-chat-messages flex-1 space-y-3 overflow-y-auto bg-[#f8f9fc] p-4">
        {visibleMessages.length === 0 && (
          <div className="text-center text-gray-400 py-8">
            <p className="text-sm">No hay mensajes aún.</p>
            <p className="text-xs mt-1 text-gray-400">
              {isTeamOrAdmin
                ? `Esperando mensaje de ${client.name}.`
                : 'Escríbenos lo que necesitas.'}
            </p>
          </div>
        )}
        {visibleMessages.map(msg => {
          const senderRole = (msg.sender as any)?.role
          const isClientMsg = senderRole === 'client'
          const isMe = msg.sender_id === user?.id
          const senderName = (msg.sender as any)?.full_name || 'Usuario'
          const initial = senderName.charAt(0).toUpperCase()

          return (
            <div key={msg.id} className={`flex gap-2 group ${isMe ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isClientMsg ? 'bg-red-100 text-red-700' : 'bg-blue-600 text-white'}`}>
                {initial}
              </div>
              <div className={`max-w-xs lg:max-w-md flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && (
                  <span className="text-xs text-gray-400 mb-1 ml-1">{senderName}</span>
                )}
                {msg.deleted_for_everyone ? (
                  <div className="px-3 py-2 rounded-xl text-sm italic text-gray-400 bg-gray-100 border border-gray-200">
                    🚫 Mensaje eliminado
                  </div>
                ) : (
                  <>
                    {msg.content && (
                      <div className={`client-chat-bubble px-3 py-2 rounded-xl text-sm ${isMe ? 'client-chat-bubble-me bg-blue-600 text-white rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'}`}>
                        {renderWithMentions(msg.content, chatUsers.map(u => u.full_name))}
                        {msg.converted_to_task && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                            <CheckCircle size={10} /> Tarea creada
                          </span>
                        )}
                      </div>
                    )}
                    {msg.file_url && msg.file_type === 'image' && (
                      <a href={msg.file_url} target="_blank" rel="noreferrer">
                        <img src={msg.file_url} alt={msg.file_name || 'imagen'} className="max-w-[200px] max-h-[200px] rounded-xl object-cover mt-1 hover:opacity-90 transition" />
                      </a>
                    )}
                    {msg.file_url && msg.file_type === 'audio' && (
                      <div className={`mt-1 flex items-center gap-2 rounded-xl px-3 py-2 ${isMe ? 'bg-blue-700' : 'bg-gray-100'}`}>
                        <Music size={14} className={isMe ? 'text-blue-200' : 'text-gray-500'} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate mb-1 ${isMe ? 'text-blue-200' : 'text-gray-500'}`}>{msg.file_name}</p>
                          <audio controls src={msg.file_url} className="w-full h-8" style={{ maxWidth: '200px' }} />
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center gap-2 mt-1 mx-1">
                  <span className="text-xs text-gray-300">
                    {new Date(msg.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && !msg.deleted_for_everyone && (
                    <span className={`text-[10px] font-medium ${(msg.read_by || []).length > 0 ? 'text-blue-500' : 'text-gray-400'}`}>
                      {(msg.read_by || []).length > 0 ? 'Leído' : 'Enviado'}
                    </span>
                  )}
                  {/* Botón "Crear tarea" solo para equipo/admin viendo mensajes del cliente */}
                  {isTeamOrAdmin && isClientMsg && !msg.converted_to_task && !msg.deleted_for_everyone && (
                    <button
                      onClick={() => handleConvertToTask(msg)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition"
                    >
                      <Plus size={10} /> Crear tarea
                    </button>
                  )}
                  {!msg.deleted_for_everyone && (
                    <div className="relative">
                      <button type="button"
                        onClick={() => setOpenMenuId(o => o === msg.id ? null : msg.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-600 transition">
                        <MoreVertical size={13} />
                      </button>
                      {openMenuId === msg.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                          <div className={`client-chat-menu absolute z-20 top-5 ${isMe ? 'right-0' : 'left-0'} bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]`}>
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
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="client-chat-composer border-t border-gray-100 p-3 bg-white">
        <MentionInput
          value={newMessage}
          onChange={setNewMessage}
          onSend={sendMessage}
          onFileSelect={setSelectedFile}
          selectedFile={selectedFile}
          onClearFile={() => setSelectedFile(null)}
          users={chatUsers.filter(u => u.id !== user?.id)}
          placeholder={isTeamOrAdmin ? `Responder a ${client.name}... (@ para mencionar)` : 'Escribe tu mensaje... (@ para mencionar)'}
        />
      </div>
    </div>
  )
}

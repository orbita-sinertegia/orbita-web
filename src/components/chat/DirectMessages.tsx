import { useEffect, useRef, useState } from 'react'
import { Search, Send, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { User } from '../../types'
import UserAvatar from '../shared/UserAvatar'

interface DirectMessage { id: string; conversation_id: string; sender_id: string; content: string; created_at: string; deleted_for?: string[] }

export default function DirectMessages() {
  const { user } = useAuth()
  const [members, setMembers] = useState<User[]>([])
  const [selected, setSelected] = useState<User | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadMembers() }, [user?.id])
  useEffect(() => { if (selected) openConversation(selected) }, [selected?.id])
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase.channel(`direct-${conversationId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` }, () => loadMessages(conversationId)).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadMembers() {
    if (!user) return
    const { data } = await supabase.from('users').select('*').in('role', ['admin', 'team']).eq('active', true).neq('id', user.id).order('full_name')
    setMembers(data || [])
    setSelected((data || [])[0] || null)
    setLoading(false)
  }

  async function openConversation(member: User) {
    if (!user) return
    setMessages([])
    const ids = [user.id, member.id].sort()
    const pairKey = ids.join(':')
    let { data } = await supabase.from('direct_conversations').select('id').eq('pair_key', pairKey).maybeSingle()
    if (!data) {
      const created = await supabase.from('direct_conversations').insert({ user_a: ids[0], user_b: ids[1], pair_key: pairKey }).select('id').single()
      data = created.data
    }
    if (data?.id) { setConversationId(data.id); await loadMessages(data.id) }
  }

  async function loadMessages(id: string) {
    const { data } = await supabase.from('direct_messages').select('*').eq('conversation_id', id).order('created_at').limit(150)
    setMessages((data as DirectMessage[]) || [])
  }

  async function send() {
    if (!text.trim() || !conversationId || !user || !selected) return
    const content = text.trim(); setText('')
    await supabase.from('direct_messages').insert({ conversation_id: conversationId, sender_id: user.id, content })
    await supabase.from('notifications').insert({ user_id: selected.id, title: `💬 Mensaje privado de ${user.full_name}`, message: content.slice(0, 100), type: 'comment', read: false })
    await loadMessages(conversationId)
  }

  const visibleMembers = members.filter(member => member.full_name.toLowerCase().includes(search.toLowerCase()))
  if (loading) return <div className="flex h-64 items-center justify-center text-gray-400">Cargando equipo...</div>

  return <div className="flex h-[min(680px,calc(100vh-210px))] min-h-[520px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:flex-row">
    <aside className="flex h-56 w-full shrink-0 flex-col border-b border-gray-200 bg-gray-50/70 md:h-auto md:w-64 md:border-b-0 md:border-r">
      <div className="border-b border-gray-200 p-3"><div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"><Search size={14} className="text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar integrante" className="w-full bg-transparent text-xs outline-none" /></div></div>
      <div className="min-h-0 flex-1 overflow-y-auto">{visibleMembers.map(member => <button key={member.id} onClick={() => setSelected(member)} className={`flex w-full items-center gap-3 border-b border-gray-100 px-3 py-3 text-left transition ${selected?.id === member.id ? 'bg-blue-50 border-l-2 border-l-blue-600' : 'hover:bg-gray-50'}`}><UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={36} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-gray-800">{member.full_name}</span><span className="block truncate text-xs capitalize text-gray-400">{member.department || member.role}</span></span></button>)}</div>
    </aside>
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {selected ? <><header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-500 text-xs font-bold text-white">{selected.full_name.charAt(0)}</span><div><p className="text-sm font-bold text-gray-800">{selected.full_name}</p><p className="text-xs text-gray-400">Conversación privada</p></div></header><div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 p-4">{messages.length === 0 && <div className="flex h-full flex-col items-center justify-center text-center text-gray-400"><Users size={28} className="mb-2 opacity-30" /><p className="text-sm">Inicia una conversación con {selected.full_name.split(' ')[0]}</p></div>}{messages.map(message => { const mine = message.sender_id === user?.id; return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[70%] rounded-xl px-3 py-2 text-sm ${mine ? 'rounded-br-none bg-blue-600 text-white' : 'rounded-bl-none border border-gray-200 bg-white text-gray-800'}`}><p>{message.content}</p><p className={`mt-1 text-[10px] ${mine ? 'text-blue-200' : 'text-gray-300'}`}>{new Date(message.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p></div></div>})}<div ref={bottomRef} /></div><div className="flex gap-2 border-t border-gray-100 p-3"><input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} placeholder={`Mensaje para ${selected.full_name.split(' ')[0]}...`} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" /><button onClick={send} disabled={!text.trim()} className="rounded-xl bg-blue-600 px-4 text-white disabled:opacity-40"><Send size={16} /></button></div></> : <div className="flex h-full items-center justify-center text-gray-400">Selecciona un integrante</div>}
    </section>
  </div>
}

import { useCallback, useEffect, useState, useRef } from 'react'
import { Bell, CheckCheck, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface Notification {
  id: string
  title: string
  message: string
  type: string
  task_id?: string
  read: boolean
  created_at: string
}

export default function NotificationBell() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'todas' | 'no_leidas'>('todas')
  const ref = useRef<HTMLDivElement>(null)

  const fetchNotifications = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications(data || [])
  }, [user])

  useEffect(() => {
    if (user) {
      const initialFetch = window.setTimeout(() => { void fetchNotifications() }, 0)
      const channel = supabase
        .channel(`notifications-${user.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        }, () => fetchNotifications())
        .subscribe()
      return () => { window.clearTimeout(initialFetch); supabase.removeChannel(channel) }
    }
  }, [user, fetchNotifications])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user!.id).eq('read', false)
    fetchNotifications()
  }

  async function markReadOnly(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  async function deleteNotification(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setNotifications(prev => prev.filter(n => n.id !== id))
    await supabase.from('notifications').delete().eq('id', id)
  }

  function taskTitleFromMessage(message: string) {
    return message.match(/["“]([^"”]+)["”]/)?.[1]?.trim()
  }

  async function openNotification(notification: Notification) {
    await supabase.from('notifications').update({ read: true }).eq('id', notification.id)
    setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n))
    if (notification.task_id || notification.type === 'task' || notification.type === 'review' || notification.type === 'approval' || notification.type === 'change_request') {
      setOpen(false)
      window.dispatchEvent(new CustomEvent('open-task', { detail: {
        taskId: notification.task_id,
        taskTitle: taskTitleFromMessage(notification.message),
      } }))
    } else if (notification.title?.includes('Chat del Equipo')) {
      setOpen(false)
      window.dispatchEvent(new CustomEvent('open-chat', { detail: { room: 'team' } }))
    } else if (notification.title?.includes('en el chat de')) {
      setOpen(false)
      window.dispatchEvent(new CustomEvent('open-chat', { detail: { room: 'client' } }))
    }
  }

  const unread = notifications.filter(n => !n.read).length

  const unreadMentions = notifications.filter(n => !n.read && n.type === 'mention').length

  const visibleNotifications = filter === 'no_leidas' ? notifications.filter(n => !n.read) : notifications

  const typeIcon: Record<string, string> = {
    task: '📋',
    review: '🔍',
    comment: '💬',
    chat: '💬',
    mention: '@',
    task_request: '📩',
    deadline: '⚠️',
    attendance: '🕘',
  }

  return (
    <div className="flex items-center gap-1" ref={ref}>
      {/* Badge @ para menciones */}
      {unreadMentions > 0 && (
        <span className="flex items-center justify-center bg-purple-600 text-white text-xs font-bold w-6 h-6 rounded-full cursor-default" title={`${unreadMentions} mención${unreadMentions > 1 ? 'es' : ''} sin leer`}>
          @
        </span>
      )}
      <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition">
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h4 className="font-semibold text-gray-800 text-sm">Notificaciones</h4>
            {unread > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                <CheckCheck size={13} /> Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
            <button type="button" onClick={() => setFilter('todas')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition ${filter === 'todas' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              Todas
            </button>
            <button type="button" onClick={() => setFilter('no_leidas')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition ${filter === 'no_leidas' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              No leídas{unread > 0 ? ` (${unread})` : ''}
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {visibleNotifications.length === 0 && (
              <div className="py-8 text-center text-gray-400 text-sm">
                {filter === 'no_leidas' ? 'No tienes notificaciones sin leer' : 'No tienes notificaciones'}
              </div>
            )}
            {visibleNotifications.map(n => (
              <div key={n.id} onClick={() => openNotification(n)}
                className={`group px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition ${!n.read ? 'bg-blue-50' : ''}`}>
                <div className="flex items-start gap-2">
                  <span className="text-base shrink-0 mt-0.5">{typeIcon[n.type] || '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium text-gray-800 ${!n.read ? 'font-semibold' : ''}`}>{n.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(n.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {(n.task_id || n.type === 'task' || n.type === 'review') && (
                      <span className="mt-2 inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                        Abrir tarea →
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!n.read && (
                      <button type="button" onClick={e => markReadOnly(e, n.id)} title="Marcar como leída"
                        className="opacity-0 group-hover:opacity-100 transition text-gray-400 hover:text-green-600 p-1 rounded hover:bg-green-50">
                        <Check size={13} />
                      </button>
                    )}
                    <button type="button" onClick={e => deleteNotification(e, n.id)} title="Eliminar notificación"
                      className="opacity-0 group-hover:opacity-100 transition text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                      <X size={13} />
                    </button>
                    {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1.5 group-hover:hidden" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

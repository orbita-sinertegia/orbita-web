import { useState, useEffect } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Client, Project, User } from '../../types'
import { DEPT_LABELS, DEPT_ORDER } from '../../data/projectTemplates'

interface Props {
  client: Client
  project: Project | null
  onClose: () => void
  onSent: () => void
}

export default function RequestTaskModal({ client, project, onClose, onSent }: Props) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [department, setDepartment] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [teamMembers, setTeamMembers] = useState<User[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    supabase
      .from('users')
      .select('*')
      .in('role', ['admin', 'team'])
      .then(({ data }) => setTeamMembers(data || []))
  }, [])

  const filteredMembers = department
    ? teamMembers.filter(m => !m.department || m.department === department)
    : teamMembers

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !department || !user) return
    setSending(true)
    setSubmitError('')

    const { error: requestError } = await supabase.from('task_requests').insert({
      client_id: client.id,
      requester_id: user.id,
      project_id: project?.id || null,
      department,
      assigned_to: assignedTo || null,
      title: title.trim(),
      description: description.trim() || null,
      status: 'pendiente',
    })

    if (requestError) {
      console.error('No se pudo enviar la solicitud:', requestError)
      setSubmitError('No pudimos guardar tu solicitud. Intenta nuevamente o avisa al equipo.')
      setSending(false)
      return
    }

    // Notificar a todos los líderes
    const { data: leaders } = await supabase
      .from('users')
      .select('id')
      .eq('department', 'lider')

    if (leaders && leaders.length > 0) {
      await supabase.from('notifications').insert(
        leaders.map(l => ({
          user_id: l.id,
          title: '📋 Nueva solicitud de tarea',
          message: `${client.name} solicita: "${title.trim()}" — Área: ${DEPT_LABELS[department] || department}`,
          type: 'task_request',
        }))
      )
    }

    // También notificar a admins
    const { data: admins } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')

    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert(
        admins.map(a => ({
          user_id: a.id,
          title: '📋 Nueva solicitud de tarea',
          message: `${client.name} solicita: "${title.trim()}" — Área: ${DEPT_LABELS[department] || department}`,
          type: 'task_request',
        }))
      )
    }

    setSending(false)
    setSent(true)
    setTimeout(() => { onSent(); onClose() }, 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-700 to-red-600 text-white">
          <div>
            <h2 className="font-bold text-base">Solicitar una tarea</h2>
            <p className="text-xs text-white/70 mt-0.5">Tu solicitud será revisada por el líder del equipo</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        {sent ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">✅</div>
            <p className="font-semibold text-gray-800 text-lg">¡Solicitud enviada!</p>
            <p className="text-sm text-gray-500 mt-1">El líder del equipo la revisará pronto.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {submitError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</div>}
            {/* Título */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">¿Qué necesitas? *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                placeholder="Ej: Guiones para 3 nuevos anuncios de Facebook"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Descripción */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Descripción / detalles</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Explica con más detalle lo que necesitas, el tono, referencias, fecha ideal..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Departamento */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Área del equipo *</label>
              <select
                value={department}
                onChange={e => { setDepartment(e.target.value); setAssignedTo('') }}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Selecciona el área...</option>
                {DEPT_ORDER.filter(d => d !== 'cliente').map(dept => (
                  <option key={dept} value={dept}>{DEPT_LABELS[dept]}</option>
                ))}
              </select>
            </div>

            {/* Integrante del equipo */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                ¿Hay alguien específico del equipo? <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <select
                value={assignedTo}
                onChange={e => setAssignedTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Sin preferencia — el líder decide</option>
                {filteredMembers.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}{m.department ? ` — ${DEPT_LABELS[m.department] || m.department}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Proyecto */}
            {project && (
              <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                <span className="text-xs text-blue-600 font-medium">Proyecto:</span>
                <span className="text-xs text-blue-800">{project.name}</span>
              </div>
            )}

            {/* Botón */}
            <button
              type="submit"
              disabled={sending || !title.trim() || !department}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-700 to-red-600 text-white font-semibold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50 mt-2"
            >
              {sending
                ? <><Loader2 size={16} className="animate-spin" /> Enviando solicitud...</>
                : <><Send size={16} /> Enviar solicitud al líder</>
              }
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

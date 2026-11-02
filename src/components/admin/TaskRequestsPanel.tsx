import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock, User, RefreshCw, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DEPT_LABELS, DEPT_COLORS } from '../../data/projectTemplates'

interface TaskRequest {
  id: string
  client_id: string
  requester_id: string
  project_id?: string
  assigned_to?: string
  title: string
  description?: string
  department: string
  status: string
  created_at: string
  client?: { name: string; company: string }
  requester?: { full_name: string }
  assignee?: { full_name: string }
  project?: { name: string }
}

function normalizeRequestStatus(status?: string): 'pendiente' | 'aprobada' | 'rechazada' {
  const value = (status || '').trim().toLowerCase()
  if (['aprobada', 'aprobado', 'approved', 'aceptada', 'aceptado', 'completada'].includes(value)) return 'aprobada'
  if (['rechazada', 'rechazado', 'rejected', 'cancelada', 'cancelado'].includes(value)) return 'rechazada'
  return 'pendiente'
}

export default function TaskRequestsPanel() {
  const [requests, setRequests] = useState<TaskRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pendiente' | 'aprobada' | 'rechazada' | 'todas'>('pendiente')

  useEffect(() => {
    fetchRequests()
    const channel = supabase.channel('admin-task-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_requests' }, fetchRequests)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchRequests() {
    setError('')
    const { data, error: requestsError } = await supabase
      .from('task_requests')
      .select('*')
      .order('created_at', { ascending: false })

    if (requestsError) {
      console.error('No se pudieron cargar las solicitudes:', requestsError)
      setRequests([])
      setError('No se pudieron cargar las solicitudes. Revisa los permisos de Supabase o intenta nuevamente.')
      setLoading(false)
      return
    }

    const raw = (data || []) as TaskRequest[]
    const clientIds = [...new Set(raw.map(request => request.client_id).filter(Boolean))]
    const userIds = [...new Set(raw.flatMap(request => [request.requester_id, request.assigned_to]).filter(Boolean) as string[])]
    const projectIds = [...new Set(raw.map(request => request.project_id).filter(Boolean) as string[])]
    const [{ data: clientRows }, { data: userRows }, { data: projectRows }] = await Promise.all([
      clientIds.length ? supabase.from('clients').select('id,name,company').in('id', clientIds) : Promise.resolve({ data: [] }),
      userIds.length ? supabase.from('users').select('id,full_name').in('id', userIds) : Promise.resolve({ data: [] }),
      projectIds.length ? supabase.from('projects').select('id,name').in('id', projectIds) : Promise.resolve({ data: [] }),
    ])
    const clientsById = new Map((clientRows || []).map(row => [row.id, { name: row.name, company: row.company }]))
    const usersById = new Map((userRows || []).map(row => [row.id, { full_name: row.full_name }]))
    const projectsById = new Map((projectRows || []).map(row => [row.id, { name: row.name }]))
    setRequests(raw.map(request => ({
      ...request,
      status: normalizeRequestStatus(request.status),
      client: clientsById.get(request.client_id),
      requester: usersById.get(request.requester_id),
      assignee: request.assigned_to ? usersById.get(request.assigned_to) : undefined,
      project: request.project_id ? projectsById.get(request.project_id) : undefined,
    })))
    setLoading(false)
  }

  async function approve(req: TaskRequest) {
    setProcessingId(req.id)
    setError('')
    const { data: approvedRequest, error: approveError } = await supabase
      .from('task_requests')
      .update({ status: 'aprobada', updated_at: new Date().toISOString() })
      .eq('id', req.id)
      .select('id, status')
      .maybeSingle()
    if (approveError || !approvedRequest || normalizeRequestStatus(approvedRequest.status) !== 'aprobada') {
      setError(approveError?.message ? `No se pudo aprobar la solicitud: ${approveError.message}` : 'Supabase no guardo la aprobacion. Revisa los permisos de actualizacion de task_requests.')
      setProcessingId(null)
      return
    }
    setRequests(current => current.map(item => item.id === req.id ? { ...item, status: 'aprobada' } : item))
    // Notificar al cliente
    const { data: clientUser } = await supabase
      .from('clients')
      .select('user_id')
      .eq('id', req.client_id)
      .maybeSingle()
    if (clientUser?.user_id) {
      await supabase.from('notifications').insert({
        user_id: clientUser.user_id,
        title: '✅ Tu solicitud fue aprobada',
        message: `"${req.title}" fue aprobada y se está procesando.`,
        type: 'task_request',
      })
    }
    await fetchRequests()
    setProcessingId(null)
  }

  async function reject(req: TaskRequest) {
    setProcessingId(req.id)
    setError('')
    const { data: rejectedRequest, error: rejectError } = await supabase
      .from('task_requests')
      .update({ status: 'rechazada', updated_at: new Date().toISOString() })
      .eq('id', req.id)
      .select('id, status')
      .maybeSingle()
    if (rejectError || !rejectedRequest) setError(rejectError?.message ? `No se pudo rechazar la solicitud: ${rejectError.message}` : 'Supabase no guardo el rechazo. Revisa los permisos de task_requests.')
    else setRequests(current => current.map(item => item.id === req.id ? { ...item, status: 'rechazada' } : item))
    await fetchRequests()
    setProcessingId(null)
  }

  const filtered = filter === 'todas' ? requests : requests.filter(r => r.status === filter)
  const pending = requests.filter(r => r.status === 'pendiente').length
  const approved = requests.filter(r => r.status === 'aprobada').length
  const rejected = requests.filter(r => r.status === 'rechazada').length

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400">Cargando solicitudes...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-gray-900 text-lg">Solicitudes de tareas</h3>
          <p className="text-sm text-gray-500">Peticiones enviadas por los clientes</p>
        </div>
        <div className="flex items-center gap-2">
        <button type="button" onClick={fetchRequests} disabled={loading} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50" title="Actualizar solicitudes"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        {pending > 0 && (
          <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1.5 rounded-full">
            {pending} pendiente{pending > 1 ? 's' : ''}
          </span>
        )}
        </div>
      </div>

      {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} />{error}</div>}

      {/* Filtros */}
      <div className="flex gap-2 mb-5">
        {(['pendiente', 'aprobada', 'rechazada', 'todas'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f === 'pendiente' ? `⏳ Pendientes (${pending})` : f === 'aprobada' ? `✅ Aprobadas (${approved})` : f === 'rechazada' ? `❌ Rechazadas (${rejected})` : `📋 Todas (${requests.length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Clock size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No hay solicitudes {filter !== 'todas' ? `"${filter}"` : ''}</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(req => (
          <div key={req.id} className={`bg-white border rounded-xl p-5 shadow-sm ${req.status === 'pendiente' ? 'border-orange-200' : req.status === 'aprobada' ? 'border-green-200' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Cliente y estado */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">{req.client?.name || 'Cliente'}</span>
                  {req.project && <span className="text-xs text-gray-400">· {req.project.name}</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    req.status === 'pendiente' ? 'bg-orange-100 text-orange-700' :
                    req.status === 'aprobada' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {req.status === 'pendiente' ? '⏳ Pendiente' : req.status === 'aprobada' ? '✅ Aprobada' : '❌ Rechazada'}
                  </span>
                </div>

                {/* Título */}
                <p className="font-semibold text-gray-800 mb-1">{req.title}</p>
                {req.description && <p className="text-sm text-gray-500 mb-2">{req.description}</p>}

                {/* Etiquetas */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${DEPT_COLORS[req.department] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {DEPT_LABELS[req.department] || req.department}
                  </span>
                  {req.assignee && (
                    <span className="text-xs flex items-center gap-1 text-gray-500">
                      <User size={11} /> {req.assignee.full_name}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {new Date(req.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              {/* Botones de acción */}
              {req.status === 'pendiente' && (
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => approve(req)}
                    disabled={processingId === req.id}
                    className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
                  >
                    <CheckCircle size={13} /> Aprobar
                  </button>
                  <button
                    onClick={() => reject(req)}
                    disabled={processingId === req.id}
                    className="flex items-center gap-1.5 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 text-xs font-semibold px-3 py-2 rounded-lg transition"
                  >
                    <XCircle size={13} /> Rechazar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

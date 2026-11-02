import { useEffect, useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Clock, Building2, Star, ChevronLeft, ChevronRight, X, Copy, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task, User, Department } from '../../types'
import UserAvatar from '../shared/UserAvatar'
import { resolvedWorkSchedule } from '../../lib/workSchedule'
import { countsForTeamOnTimeMetric, wasDeliveredOnTime } from '../../lib/taskDelays'

interface Props {
  teamMembers: User[]
  tasks: Task[]
}

interface AsistenciaRow {
  user_id: string
  date: string
  laborable: boolean
  estado: 'a_tiempo' | 'retardo' | 'sin_registro' | 'pendiente' | 'descanso' | 'dia_extra'
  minutos_regulares: number
  minutos_extra: number
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface RatingRow {
  task_id: string
  stars: number
}

const DEPT_LABELS: Record<string, string> = {
  edicion: 'Edición', grabacion: 'Grabación', diseno: 'Diseño',
  copy: 'Copy', webmaster: 'Webmaster', trafficker: 'Trafficker',
  lider: 'Líder', cliente: 'Cliente',
}

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'edicion', label: 'Edición' }, { value: 'grabacion', label: 'Grabación' },
  { value: 'diseno', label: 'Diseño' }, { value: 'copy', label: 'Copy' },
  { value: 'webmaster', label: 'Webmaster' }, { value: 'trafficker', label: 'Trafficker' },
  { value: 'lider', label: 'Líder de Proyecto' },
]

function scoreColor(val: number, good = 80, bad = 50) {
  if (val >= good) return { text: 'text-green-600', bg: 'bg-green-500' }
  if (val >= bad) return { text: 'text-yellow-600', bg: 'bg-yellow-400' }
  return { text: 'text-red-600', bg: 'bg-red-400' }
}

function StarDisplay({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={12}
          className={i <= Math.round(value) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 fill-gray-200'} />
      ))}
      <span className="text-xs font-bold text-gray-700 ml-1">{value > 0 ? value.toFixed(1) : '—'}</span>
    </div>
  )
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()} – ${sunday.toLocaleDateString('es-MX', opts)}`
  }
  return `${monday.toLocaleDateString('es-MX', opts)} – ${sunday.toLocaleDateString('es-MX', opts)}`
}

export default function TeamPerformance({ teamMembers, tasks }: Props) {
  const [asistencia, setAsistencia] = useState<AsistenciaRow[]>([])
  const [ratings, setRatings] = useState<RatingRow[]>([])
  const [period, setPeriod] = useState<'semana' | 'mes'>('semana')
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()))
  const [showInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState<{ email: string; full_name: string; role: 'team' | 'admin'; department: Department | '' }>({ email: '', full_name: '', role: 'team', department: '' })
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  async function generateTeamInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteForm.email.trim()) return
    setInviteSaving(true); setInviteError('')
    const { data, error } = await supabase.from('team_invitations').insert({ email: inviteForm.email.trim(), full_name: inviteForm.full_name.trim() || null, role: inviteForm.role, department: inviteForm.department || null }).select('id').single()
    if (error || !data) { setInviteError('No se pudo generar la invitación: ' + (error?.message || '')); setInviteSaving(false); return }
    setInviteLink(`https://agencia.sinertegia.com?team_invite=${data.id}`); setInviteSaving(false)
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000)
  }

  function closeInviteModal() {
    setInviteForm({ email: '', full_name: '', role: 'team', department: '' }); setInviteLink(''); setInviteError('')
  }
  useEffect(() => {
    fetchAsistencia()
    fetchRatings()
  }, [period, weekStart])

  function prevWeek() { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }
  function nextWeek() { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }
  const isCurrentWeek = getMondayOf(new Date()).toDateString() === weekStart.toDateString()

  async function fetchAsistencia() {
    let fromStr: string
    let toStr: string
    if (period === 'semana') {
      fromStr = toDateKey(weekStart)
      const end = new Date(weekStart); end.setDate(weekStart.getDate() + 6)
      toStr = toDateKey(end)
    } else {
      const now = new Date()
      fromStr = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1))
      toStr = toDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    }
    const { data } = await supabase.rpc('asistencia_rango', { p_from: fromStr, p_to: toStr, p_tolerancia: 5 })
    setAsistencia((data as AsistenciaRow[]) || [])
  }

  async function fetchRatings() {
    const taskIds = tasks.map(t => t.id)
    if (!taskIds.length) return
    const { data } = await supabase
      .from('task_ratings')
      .select('task_id, stars')
      .in('task_id', taskIds)
    setRatings((data as RatingRow[]) || [])
  }

  function getMemberKPIs(member: User) {
    const memberId = member.id
    const workSchedule = resolvedWorkSchedule(member)
    const enabledDays = Object.values(workSchedule).filter(day => day.enabled)
    const weeklyHours = enabledDays.reduce((total, day) => total + (day.end - day.start), 0)
    const expectedHours = period === 'semana' ? weeklyHours : Math.round(weeklyHours * 4.33)
    const scheduleLabel = enabledDays.length
      ? `${enabledDays.length} días · ${weeklyHours}h/semana`
      : 'Sin jornada asignada'

    const memberTasks = tasks.filter(t => t.assigned_to === memberId)
    const completed = memberTasks.filter(t => t.status === 'completada')
    const memberAsistencia = asistencia.filter(a => a.user_id === memberId)

    // 1. Horas trabajadas
    const regularMins = memberAsistencia.reduce((acc, a) => acc + (a.minutos_regulares || 0), 0)
    const overtimeMins = memberAsistencia.reduce((acc, a) => acc + (a.minutos_extra || 0), 0)
    const totalHours = ((regularMins + overtimeMins) / 60)

    // 2. Puntualidad según asistencia_rango (horario individual, gracia de 5 min ya aplicada
    // en el servidor). Faltar (sin_registro) sí baja el %; solo cuenta la primera entrada del día.
    const diasEvaluados = memberAsistencia.filter(a => a.laborable && (a.estado === 'a_tiempo' || a.estado === 'retardo' || a.estado === 'sin_registro'))
    const onTimeDias = diasEvaluados.filter(a => a.estado === 'a_tiempo')
    const onTimeRate = diasEvaluados.length > 0
      ? Math.round((onTimeDias.length / diasEvaluados.length) * 100) : 0

    // 3. Trabajos entregados
    const delivered = completed.length

    // 4. Sin retrabajos (tareas completadas con change_count = 0)
    const noRetrabajo = completed.filter(t => !((t as any).change_count) || (t as any).change_count === 0)
    const noRetrabajoRate = completed.length > 0
      ? Math.round((noRetrabajo.length / completed.length) * 100) : 0

    // 5. Calificación del cliente (promedio de estrellas en sus tareas)
    const taskIds = memberTasks.map(t => t.id)
    const memberRatings = ratings.filter(r => taskIds.includes(r.task_id))
    const avgRating = memberRatings.length > 0
      ? memberRatings.reduce((acc, r) => acc + r.stars, 0) / memberRatings.length : 0

    // 6. Entregas a tiempo (completion_date <= commitment_date), excluyendo las tareas
    // del departamento cliente y las que ya quedaron marcadas como retraso del cliente.
    const countedTasks = memberTasks.filter(countsForTeamOnTimeMetric)
    const countedCompleted = countedTasks.filter(t => t.status === 'completada' && t.commitment_date)
    const onTimeDeliveries = countedCompleted.filter(wasDeliveredOnTime)
    const entregasATiempoRate = countedCompleted.length > 0
      ? Math.round((onTimeDeliveries.length / countedCompleted.length) * 100) : 0

    // Score general (promedio ponderado)
    const score = Math.round(
      (onTimeRate * 0.1) +
      (entregasATiempoRate * 0.1) +
      (noRetrabajoRate * 0.25) +
      (Math.min(delivered * 10, 100) * 0.2) +
      (avgRating * 20 * 0.2) +
      ((expectedHours > 0 ? Math.min(totalHours / expectedHours * 100, 100) : 0) * 0.15)
    )

    return { regularMins, overtimeMins, totalHours, onTimeRate, delivered, noRetrabajoRate, entregasATiempoRate, countedCompletedCount: countedCompleted.length, avgRating, score, sessionCount: diasEvaluados.length, scheduleLabel }
  }

  const allKPIs = teamMembers.map(m => ({ member: m, kpis: getMemberKPIs(m) }))
    .sort((a, b) => b.kpis.score - a.kpis.score)

  const generalKPIs = useMemo(() => {
    const active = allKPIs.filter(x => x.kpis.sessionCount > 0 || x.kpis.delivered > 0)
    if (active.length === 0) return null
    const totalHours = allKPIs.reduce((s, x) => s + x.kpis.totalHours, 0)
    const totalDelivered = allKPIs.reduce((s, x) => s + x.kpis.delivered, 0)
    const avgOnTime = active.length > 0
      ? Math.round(active.reduce((s, x) => s + x.kpis.onTimeRate, 0) / active.filter(x => x.kpis.sessionCount > 0).length || 0) : 0
    const withDeliveries = allKPIs.filter(x => x.kpis.delivered > 0)
    const avgNoRetrabajo = withDeliveries.length > 0
      ? Math.round(withDeliveries.reduce((s, x) => s + x.kpis.noRetrabajoRate, 0) / withDeliveries.length) : 0
    const withRatings = allKPIs.filter(x => x.kpis.avgRating > 0)
    const avgRating = withRatings.length > 0
      ? withRatings.reduce((s, x) => s + x.kpis.avgRating, 0) / withRatings.length : 0
    const avgScore = active.length > 0
      ? Math.round(active.reduce((s, x) => s + x.kpis.score, 0) / active.length) : 0
    return { totalHours, totalDelivered, avgOnTime, avgNoRetrabajo, avgRating, avgScore }
  }, [allKPIs])

  return (
    <div>
      {/* Header con filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h3 className="font-bold text-gray-800 text-lg">Scorecard del equipo</h3>
        <div className="flex items-center gap-2">
          {/* Toggle semana/mes */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            {(['semana', 'mes'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-4 py-1.5 text-sm font-medium transition ${period === p ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {p === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
          {/* Navegación de semana */}
          {period === 'semana' && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-2 py-1">
              <button onClick={prevWeek} className="p-1 hover:bg-gray-200 rounded transition">
                <ChevronLeft size={15} className="text-gray-600" />
              </button>
              <span className="text-xs font-semibold text-gray-700 px-1 min-w-[130px] text-center">
                {isCurrentWeek ? 'Esta semana' : formatWeekRange(weekStart)}
              </span>
              <button onClick={nextWeek} disabled={isCurrentWeek}
                className="p-1 hover:bg-gray-200 rounded transition disabled:opacity-30">
                <ChevronRight size={15} className="text-gray-600" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Rendimiento general del equipo */}
      {generalKPIs && (
        <div className="bg-gradient-to-r from-blue-700 to-blue-900 rounded-2xl p-5 mb-6 text-white">
          <p className="text-xs font-semibold text-blue-200 uppercase tracking-wide mb-3">Rendimiento general del equipo</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{generalKPIs.totalHours.toFixed(0)}h</p>
              <p className="text-xs text-blue-200 mt-0.5">Horas totales</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${generalKPIs.avgOnTime >= 80 ? 'text-green-300' : generalKPIs.avgOnTime >= 50 ? 'text-yellow-300' : 'text-red-300'}`}>
                {generalKPIs.avgOnTime}%
              </p>
              <p className="text-xs text-blue-200 mt-0.5">A tiempo promedio</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{generalKPIs.totalDelivered}</p>
              <p className="text-xs text-blue-200 mt-0.5">Entregas totales</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${generalKPIs.avgNoRetrabajo >= 80 ? 'text-green-300' : generalKPIs.avgNoRetrabajo >= 50 ? 'text-yellow-300' : 'text-red-300'}`}>
                {generalKPIs.avgNoRetrabajo}%
              </p>
              <p className="text-xs text-blue-200 mt-0.5">Sin retrabajo</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${generalKPIs.avgScore >= 80 ? 'text-green-300' : generalKPIs.avgScore >= 50 ? 'text-yellow-300' : 'text-red-300'}`}>
                {generalKPIs.avgScore}
              </p>
              <p className="text-xs text-blue-200 mt-0.5">Score promedio</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabla scorecard */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Persona</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500">
                  <div className="flex flex-col items-center">
                    <Clock size={13} className="mb-0.5 text-blue-500" />
                    Horas
                  </div>
                </th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500">
                  <div className="flex flex-col items-center">
                    <span className="text-base">⏰</span>
                    A tiempo
                  </div>
                </th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500">
                  <div className="flex flex-col items-center">
                    <span className="text-base">✅</span>
                    Entregados
                  </div>
                </th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500">
                  <div className="flex flex-col items-center">
                    <span className="text-base">📆</span>
                    Entregas a tiempo
                  </div>
                </th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500">
                  <div className="flex flex-col items-center">
                    <span className="text-base">🔄</span>
                    Sin retrabajo
                  </div>
                </th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500">
                  <div className="flex flex-col items-center">
                    <Star size={13} className="mb-0.5 text-yellow-400 fill-yellow-400" />
                    Calif. cliente
                  </div>
                </th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allKPIs.map(({ member, kpis }, idx) => {
                const sc = scoreColor(kpis.score)
                return (
                  <tr key={member.id} className={`hover:bg-gray-50 transition ${idx === 0 ? 'bg-yellow-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={32} />
                        <div>
                          <p className="font-medium text-gray-800">{member.full_name}</p>
                          <p className="text-xs text-gray-400">{member.department ? DEPT_LABELS[member.department] : '—'}</p>
                        </div>
                        {idx === 0 && kpis.score > 0 && <span className="text-xs bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded-full font-semibold">🏆</span>}
                      </div>
                    </td>

                    {/* Horas trabajadas */}
                    <td className="px-4 py-3 text-center">
                      <div>
                        <p className="font-bold text-gray-800">{kpis.totalHours.toFixed(1)}h</p>
                        {kpis.overtimeMins > 0 && (
                          <p className="text-xs text-orange-500 font-medium">+{(kpis.overtimeMins / 60).toFixed(1)}h extra</p>
                        )}
                        <p className="text-xs text-gray-400">{kpis.sessionCount} días</p>
                      </div>
                    </td>

                    {/* A tiempo */}
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold text-sm ${scoreColor(kpis.onTimeRate).text}`}>
                        {kpis.sessionCount > 0 ? `${kpis.onTimeRate}%` : '—'}
                      </span>
                    </td>

                    {/* Trabajos entregados */}
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-gray-800">{kpis.delivered}</span>
                    </td>

                    {/* Entregas a tiempo */}
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold text-sm ${kpis.countedCompletedCount > 0 ? scoreColor(kpis.entregasATiempoRate).text : 'text-gray-400'}`}>
                        {kpis.countedCompletedCount > 0 ? `${kpis.entregasATiempoRate}%` : '—'}
                      </span>
                    </td>

                    {/* Sin retrabajo */}
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold text-sm ${kpis.delivered > 0 ? scoreColor(kpis.noRetrabajoRate).text : 'text-gray-400'}`}>
                        {kpis.delivered > 0 ? `${kpis.noRetrabajoRate}%` : '—'}
                      </span>
                    </td>

                    {/* Calificación */}
                    <td className="px-4 py-3 text-center">
                      <StarDisplay value={kpis.avgRating} />
                    </td>

                    {/* Score general */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full ${sc.bg}`} style={{ width: `${kpis.score}%` }} />
                        </div>
                        <span className={`text-sm font-bold ${sc.text} w-8 text-right`}>{kpis.score > 0 ? kpis.score : '—'}</span>
                        {kpis.score >= 80 ? <TrendingUp size={13} className="text-green-500" /> : kpis.score > 0 ? <TrendingDown size={13} className="text-red-400" /> : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tarjetas individuales */}
      <h4 className="font-semibold text-gray-700 mb-3">Detalle por persona</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allKPIs.map(({ member, kpis }) => (
          <div key={member.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={36} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 truncate">{member.full_name}</p>
                <p className="text-xs text-gray-400">{member.department ? DEPT_LABELS[member.department] : '—'}</p>
              </div>
              <div className={`text-lg font-bold ${scoreColor(kpis.score).text}`}>
                {kpis.score > 0 ? kpis.score : '—'}
              </div>
            </div>

            <div className="space-y-2.5">
              {/* Horas */}
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-gray-500"><Clock size={12} /> Horas trabajadas</span>
                <div className="text-right">
                  <span className="font-bold text-gray-800">{kpis.totalHours.toFixed(1)}h</span>
                  {kpis.overtimeMins > 0 && <span className="text-orange-500 ml-1">+{(kpis.overtimeMins / 60).toFixed(1)}h extra</span>}
                </div>
              </div>

              {/* A tiempo */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">⏰ Conectadas a tiempo</span>
                  <span className={`font-bold ${scoreColor(kpis.onTimeRate).text}`}>
                    {kpis.sessionCount > 0 ? `${kpis.onTimeRate}%` : '—'}
                  </span>
                </div>
                {kpis.sessionCount > 0 && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${scoreColor(kpis.onTimeRate).bg}`} style={{ width: `${kpis.onTimeRate}%` }} />
                  </div>
                )}
              </div>

              {/* Entregados */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">✅ Trabajos entregados</span>
                <span className="font-bold text-gray-800">{kpis.delivered}</span>
              </div>

              {/* Entregas a tiempo */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">📆 Entregas a tiempo</span>
                <span className={`font-bold ${kpis.countedCompletedCount > 0 ? scoreColor(kpis.entregasATiempoRate).text : 'text-gray-400'}`}>
                  {kpis.countedCompletedCount > 0 ? `${kpis.entregasATiempoRate}%` : '—'}
                </span>
              </div>

              {/* Sin retrabajo */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">🔄 Sin retrabajo</span>
                  <span className={`font-bold ${kpis.delivered > 0 ? scoreColor(kpis.noRetrabajoRate).text : 'text-gray-400'}`}>
                    {kpis.delivered > 0 ? `${kpis.noRetrabajoRate}%` : '—'}
                  </span>
                </div>
                {kpis.delivered > 0 && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${scoreColor(kpis.noRetrabajoRate).bg}`} style={{ width: `${kpis.noRetrabajoRate}%` }} />
                  </div>
                )}
              </div>

              {/* Calificación */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">⭐ Calif. del cliente</span>
                <StarDisplay value={kpis.avgRating} />
              </div>

              {/* Ubicaciones */}
              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                <span>🕘 {kpis.scheduleLabel}</span>
                {kpis.sessionCount > 0 && <span className="flex items-center gap-1"><Building2 size={11} />{kpis.sessionCount} días</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Score calculado con: 10% puntualidad · 10% entregas a tiempo · 25% sin retrabajo · 20% entregas · 20% calificación cliente · 15% horas
      </p>

      {/* Modal: agregar integrante al equipo */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Agregar integrante</h3>
              <button onClick={closeInviteModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-4">
              {!inviteLink ? (
                <form onSubmit={generateTeamInvite} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Correo electrónico *</label>
                    <input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                      required placeholder="correo@ejemplo.com"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Nombre (opcional)</label>
                    <input value={inviteForm.full_name} onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))}
                      placeholder="Nombre completo"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Rol</label>
                      <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value as 'team' | 'admin' }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="team">Equipo</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Departamento</label>
                      <select value={inviteForm.department} onChange={e => setInviteForm(f => ({ ...f, department: e.target.value as Department }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="">Sin departamento</option>
                        {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {inviteError && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inviteError}</p>}
                  <button type="submit" disabled={inviteSaving}
                    className="w-full bg-gradient-to-r from-blue-700 to-red-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:opacity-90 transition disabled:opacity-50">
                    {inviteSaving ? 'Generando...' : 'Generar link de invitación'}
                  </button>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Comparte este link con <strong>{inviteForm.email}</strong> por WhatsApp o correo — al abrirlo podrá crear su contraseña y unirse.
                  </p>
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-green-700 flex-1 truncate font-mono">{inviteLink}</p>
                    <button onClick={copyInviteLink} className="shrink-0 flex items-center gap-1 text-xs font-semibold text-green-700 hover:text-green-900 transition">
                      {linkCopied ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
                    </button>
                  </div>
                  <button onClick={closeInviteModal}
                    className="w-full bg-gray-100 text-gray-700 text-sm font-semibold py-2.5 rounded-lg hover:bg-gray-200 transition">
                    Listo
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

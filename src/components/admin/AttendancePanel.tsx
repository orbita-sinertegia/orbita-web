import { useEffect, useMemo, useState, useCallback } from 'react'
import { AlertTriangle, CalendarRange, CheckCircle2, Clock, Download, HelpCircle, Moon, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { User } from '../../types'
import UserAvatar from '../shared/UserAvatar'
import { cdmxDateKey } from '../../lib/workSchedule'

interface Props { teamMembers: User[] }

interface AsistenciaRow {
  user_id: string
  full_name: string
  department: string | null
  date: string
  laborable: boolean
  inicio_programado_min: number | null
  fin_programado_min: number | null
  entrada: string | null
  ubicacion: string | null
  retardo_min: number | null
  primera_actividad: string | null
  primera_actividad_tipo: string | null
  ultima_actividad: string | null
  salida: string | null
  salida_automatica: boolean
  minutos_regulares: number
  minutos_extra: number
  estado: 'a_tiempo' | 'retardo' | 'sin_registro' | 'pendiente' | 'descanso' | 'dia_extra'
}

const DEPT_LABELS: Record<string, string> = {
  edicion: 'Edición', grabacion: 'Grabación', diseno: 'Diseño',
  copy: 'Copy', webmaster: 'Webmaster', trafficker: 'Trafficker',
  lider: 'Líder', cliente: 'Cliente',
}

const ESTADO_LABELS: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  a_tiempo: { label: 'A tiempo', className: 'bg-green-100 text-green-700', icon: <CheckCircle2 size={12} /> },
  retardo: { label: 'Retardo', className: 'bg-orange-100 text-orange-700', icon: <AlertTriangle size={12} /> },
  sin_registro: { label: 'Sin registro', className: 'bg-red-100 text-red-700', icon: <AlertTriangle size={12} /> },
  pendiente: { label: 'Pendiente', className: 'bg-gray-100 text-gray-500', icon: <Clock size={12} /> },
  descanso: { label: 'Descanso', className: 'bg-slate-100 text-slate-400', icon: <Moon size={12} /> },
  dia_extra: { label: 'Día extra', className: 'bg-blue-100 text-blue-700', icon: <Clock size={12} /> },
}

function minToHHMM(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—'
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' })
}

function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(1) + 'h'
}

function diffMinutes(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

export default function AttendancePanel({ teamMembers }: Props) {
  const [tab, setTab] = useState<'hoy' | 'rango'>('hoy')
  const [todayRows, setTodayRows] = useState<AsistenciaRow[]>([])
  const [rangeRows, setRangeRows] = useState<AsistenciaRow[]>([])
  const [from, setFrom] = useState(() => cdmxDateKey(getMondayOf(new Date())))
  const [to, setTo] = useState(() => cdmxDateKey(new Date()))
  const [loading, setLoading] = useState(false)
  const [correcting, setCorrecting] = useState<AsistenciaRow | null>(null)

  const avatarByUserId = useMemo(() => new Map(teamMembers.map(m => [m.id, m])), [teamMembers])

  const fetchToday = useCallback(async () => {
    const today = cdmxDateKey(new Date())
    const { data } = await supabase.rpc('asistencia_rango', { p_from: today, p_to: today, p_tolerancia: 5 })
    setTodayRows((data as AsistenciaRow[]) || [])
  }, [])

  const fetchRange = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('asistencia_rango', { p_from: from, p_to: to, p_tolerancia: 5 })
    setRangeRows((data as AsistenciaRow[]) || [])
    setLoading(false)
  }, [from, to])

  // La primera carga se difiere un tick para no llamar setState de forma síncrona dentro del efecto.
  useEffect(() => {
    const first = setTimeout(fetchToday, 0)
    const id = setInterval(fetchToday, 60000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [fetchToday])

  useEffect(() => {
    if (tab !== 'rango') return
    const t = setTimeout(fetchRange, 0)
    return () => clearTimeout(t)
  }, [tab, fetchRange])

  const summary = useMemo(() => {
    const counts: Record<string, number> = { a_tiempo: 0, retardo: 0, sin_registro: 0, pendiente: 0, descanso: 0 }
    for (const row of todayRows) if (row.estado in counts) counts[row.estado]++
    return counts
  }, [todayRows])

  async function openCorrection(row: AsistenciaRow) {
    setCorrecting(row)
  }

  async function submitCorrection(sessionId: string, startedAt: string, endedAt: string, reason: string) {
    const { error } = await supabase.rpc('admin_corregir_sesion', {
      p_session_id: sessionId,
      p_started_at: new Date(startedAt).toISOString(),
      p_ended_at: endedAt ? new Date(endedAt).toISOString() : null,
      p_reason: reason,
    })
    if (!error) {
      setCorrecting(null)
      fetchToday()
      if (tab === 'rango') fetchRange()
    }
    return error
  }

  const perPersonRange = useMemo(() => {
    const byUser = new Map<string, { full_name: string; department: string | null; rows: AsistenciaRow[] }>()
    for (const row of rangeRows) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, { full_name: row.full_name, department: row.department, rows: [] })
      byUser.get(row.user_id)!.rows.push(row)
    }
    return Array.from(byUser.entries()).map(([userId, info]) => {
      const laborables = info.rows.filter(r => r.laborable)
      const aTiempo = laborables.filter(r => r.estado === 'a_tiempo')
      const retardos = laborables.filter(r => r.estado === 'retardo')
      const sinRegistro = laborables.filter(r => r.estado === 'sin_registro')
      const salidasAuto = info.rows.filter(r => r.salida_automatica)
      const minutosRetardo = laborables.reduce((acc, r) => acc + (r.retardo_min || 0), 0)
      const conEntrada = info.rows.filter(r => r.entrada && r.inicio_programado_min !== null)
      const promedioEntradaMin = conEntrada.length
        ? Math.round(conEntrada.reduce((acc, r) => {
            const d = new Date(r.entrada!)
            const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
            return acc + local.getHours() * 60 + local.getMinutes()
          }, 0) / conEntrada.length)
        : null
      const minutosRegulares = info.rows.reduce((acc, r) => acc + (r.minutos_regulares || 0), 0)
      const minutosExtra = info.rows.reduce((acc, r) => acc + (r.minutos_extra || 0), 0)
      return {
        userId, full_name: info.full_name, department: info.department,
        diasLaborables: laborables.length, aTiempo: aTiempo.length, retardos: retardos.length,
        sinRegistro: sinRegistro.length, minutosRetardo, promedioEntradaMin,
        minutosRegulares, minutosExtra, salidasAuto: salidasAuto.length,
      }
    }).sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [rangeRows])

  function exportCSV() {
    const header = ['Persona', 'Departamento', 'Días laborables', 'A tiempo', 'Retardos', 'Sin registro', 'Minutos de retardo', 'Hora promedio de entrada', 'Horas regulares', 'Horas extra', 'Salidas no registradas']
    const lines = perPersonRange.map(p => [
      p.full_name, p.department ? DEPT_LABELS[p.department] || p.department : '—', p.diasLaborables, p.aTiempo, p.retardos, p.sinRegistro,
      p.minutosRetardo, minToHHMM(p.promedioEntradaMin), fmtHours(p.minutosRegulares), fmtHours(p.minutosExtra), p.salidasAuto,
    ])
    const csv = [header, ...lines].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `asistencia_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h3 className="font-bold text-gray-800 text-lg">Asistencia</h3>
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          {(['hoy', 'rango'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium transition ${tab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {t === 'hoy' ? 'Hoy' : 'Semana / rango'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'hoy' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            {(['a_tiempo', 'retardo', 'sin_registro', 'pendiente', 'descanso'] as const).map(estado => (
              <div key={estado} className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
                <p className={`text-2xl font-bold ${ESTADO_LABELS[estado].className.split(' ')[1]}`}>{summary[estado]}</p>
                <p className="text-xs text-gray-400 mt-1">{ESTADO_LABELS[estado].label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-3 font-semibold">Persona</th>
                    <th className="px-4 py-3 font-semibold">Horario</th>
                    <th className="px-4 py-3 font-semibold">Entrada</th>
                    <th className="px-4 py-3 font-semibold">Ubicación</th>
                    <th className="px-4 py-3 font-semibold">Retardo</th>
                    <th className="px-4 py-3 font-semibold">1ª actividad</th>
                    <th className="px-4 py-3 font-semibold">Última actividad</th>
                    <th className="px-4 py-3 font-semibold">Salida</th>
                    <th className="px-4 py-3 font-semibold">Horas</th>
                    <th className="px-4 py-3 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {todayRows.map(row => {
                    const member = avatarByUserId.get(row.user_id)
                    const brecha = diffMinutes(row.entrada, row.primera_actividad)
                    const estado = ESTADO_LABELS[row.estado] || ESTADO_LABELS.pendiente
                    return (
                      <tr key={row.user_id} className="hover:bg-gray-50 transition align-top">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <UserAvatar name={row.full_name} avatarUrl={member?.avatar_url} size={28} />
                            <div>
                              <p className="font-medium text-gray-800">{row.full_name}</p>
                              <p className="text-xs text-gray-400">{row.department ? DEPT_LABELS[row.department] || row.department : '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.laborable ? `${minToHHMM(row.inicio_programado_min)}–${minToHHMM(row.fin_programado_min)}` : 'Descanso'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {fmtTime(row.entrada)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 capitalize">{row.ubicacion?.replace('_', ' ') || '—'}</td>
                        <td className="px-4 py-3">
                          {row.retardo_min ? <span className="text-orange-600 font-semibold">+{row.retardo_min} min</span> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-700">{fmtTime(row.primera_actividad)} <span className="text-gray-400">{row.primera_actividad_tipo ? `(${row.primera_actividad_tipo})` : ''}</span></p>
                          {brecha !== null && brecha > 30 && (
                            <p className="text-xs text-red-600 font-semibold flex items-center gap-1 mt-0.5"><HelpCircle size={11} />{brecha} min sin actividad</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{fmtTime(row.ultima_actividad)}</td>
                        <td className="px-4 py-3">
                          {row.salida_automatica ? (
                            <div>
                              <p className="text-xs text-red-600 font-semibold">Salida no registrada</p>
                              <button onClick={() => openCorrection(row)} className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline">Corregir</button>
                            </div>
                          ) : fmtTime(row.salida)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {fmtHours(row.minutos_regulares)}
                          {row.minutos_extra > 0 && <span className="text-orange-500 ml-1">+{fmtHours(row.minutos_extra)}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${estado.className}`}>
                            {estado.icon}{estado.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {todayRows.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Sin datos de asistencia para hoy.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'rango' && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-5 bg-white border border-gray-200 rounded-xl p-3">
            <CalendarRange size={16} className="text-gray-400" />
            <label className="text-xs text-gray-500 font-semibold">Desde
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="ml-2 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-gray-500 font-semibold">Hasta
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="ml-2 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
            </label>
            <button onClick={exportCSV} className="ml-auto flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800">
              <Download size={14} /> Exportar CSV
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-3 font-semibold">Persona</th>
                    <th className="px-4 py-3 font-semibold text-center">Días laborables</th>
                    <th className="px-4 py-3 font-semibold text-center">A tiempo</th>
                    <th className="px-4 py-3 font-semibold text-center">Retardos</th>
                    <th className="px-4 py-3 font-semibold text-center">Sin registro</th>
                    <th className="px-4 py-3 font-semibold text-center">Min. retardo</th>
                    <th className="px-4 py-3 font-semibold text-center">Entrada promedio</th>
                    <th className="px-4 py-3 font-semibold text-center">Horas</th>
                    <th className="px-4 py-3 font-semibold text-center">Salidas no reg.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {perPersonRange.map(p => (
                    <tr key={p.userId} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{p.full_name}</p>
                        <p className="text-xs text-gray-400">{p.department ? DEPT_LABELS[p.department] || p.department : '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700">{p.diasLaborables}</td>
                      <td className="px-4 py-3 text-center text-green-600 font-semibold">{p.aTiempo}</td>
                      <td className="px-4 py-3 text-center text-orange-600 font-semibold">{p.retardos}</td>
                      <td className="px-4 py-3 text-center text-red-600 font-semibold">{p.sinRegistro}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{p.minutosRetardo}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{minToHHMM(p.promedioEntradaMin)}</td>
                      <td className="px-4 py-3 text-center text-gray-700">
                        {fmtHours(p.minutosRegulares)}{p.minutosExtra > 0 && <span className="text-orange-500 ml-1">+{fmtHours(p.minutosExtra)}</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{p.salidasAuto}</td>
                    </tr>
                  ))}
                  {!loading && perPersonRange.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin datos en este rango.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {correcting && (
        <CorrectionModal
          row={correcting}
          onClose={() => setCorrecting(null)}
          onSubmit={submitCorrection}
        />
      )}
    </div>
  )
}

function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function CorrectionModal({ row, onClose, onSubmit }: {
  row: AsistenciaRow
  onClose: () => void
  onSubmit: (sessionId: string, startedAt: string, endedAt: string, reason: string) => Promise<{ message: string } | null>
}) {
  const [sessionId, setSessionId] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      let query = supabase.from('work_sessions').select('id, started_at, ended_at')
        .eq('user_id', row.user_id).eq('date', row.date).eq('auto_closed', true)
      if (row.salida) query = query.eq('ended_at', row.salida)
      const { data } = await query.order('started_at', { ascending: false }).limit(1)
      const session = data?.[0]
      if (session) {
        setSessionId(session.id)
        setStartedAt(toLocalInput(session.started_at))
        setEndedAt(session.ended_at ? toLocalInput(session.ended_at) : '')
      }
    })()
  }, [row])

  async function handleSubmit() {
    if (!sessionId) { setError('No se encontró la sesión a corregir.'); return }
    if (!reason.trim()) { setError('El motivo es obligatorio.'); return }
    setSaving(true); setError('')
    const result = await onSubmit(sessionId, startedAt, endedAt, reason.trim())
    if (result) setError('No se pudo guardar la corrección: ' + result.message)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Corregir sesión de {row.full_name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Entrada
            <input type="datetime-local" value={startedAt} onChange={e => setStartedAt(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Salida
            <input type="datetime-local" value={endedAt} onChange={e => setEndedAt(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Motivo *
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Ej. olvidó registrar salida, se confirmó con la persona"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <button onClick={handleSubmit} disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar corrección'}
          </button>
        </div>
      </div>
    </div>
  )
}

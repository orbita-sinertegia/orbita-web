import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Info, Target, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task, User } from '../../types'
import UserAvatar from '../shared/UserAvatar'
import { DEPT_LABELS } from '../../data/projectTemplates'
import { addLocalDays, cdmxTodayKey, localDateKey, parseDateOnly } from '../../lib/dates'
import {
  DEFAULT_WEIGHTS, POINTS_GOAL, STUCK_IN_PROGRESS_DAYS, WORK_TYPES, computeMemberWeek, weekRange,
  type AttendanceDay, type Goal, type MemberWeek, type ScoreTask, type Weights,
} from '../../lib/weeklyScorecard'

interface Props {
  teamMembers: User[]
  adminMembers?: User[]
  tasks: Task[]
}

const TYPE_LABEL: Record<string, string> = { ...Object.fromEntries(WORK_TYPES.map(type => [type.key, type.label])), [POINTS_GOAL]: 'Puntos totales', retrabajo: 'Retrabajo' }
const SEMAPHORE_CLASS = { verde: 'bg-green-500', amarillo: 'bg-yellow-400', rojo: 'bg-red-500' } as const
const FLAG_LABEL = { subutilizado: 'Poca carga asignada', bajo_rendimiento: 'Bajo rendimiento', sin_carga: 'Sin carga esta semana' } as const

function shortRange(mondayKey: string) {
  const monday = parseDateOnly(mondayKey)!
  const saturday = addLocalDays(monday, 5)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('es-MX', opts)} – ${saturday.toLocaleDateString('es-MX', opts)}`
}

const dash = (value: number | null, suffix = '%') => (value === null ? '—' : `${value}${suffix}`)

export default function WeeklyScorecard({ teamMembers, adminMembers = [], tasks }: Props) {
  const [weekKey, setWeekKey] = useState(() => weekRange(cdmxTodayKey()).monday)
  const [department, setDepartment] = useState('all')
  const [includeAdmins, setIncludeAdmins] = useState(false)
  const [attendance, setAttendance] = useState<AttendanceDay[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS)
  const [setupReady, setSetupReady] = useState<boolean | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [form, setForm] = useState({ scope: 'user' as 'user' | 'department', target: '', workType: 'anuncio', amount: '' })
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const week = weekRange(weekKey)
  const currentMonday = weekRange(cdmxTodayKey()).monday

  const members = useMemo(() => {
    const seen = new Set(teamMembers.map(member => member.id))
    const admins = includeAdmins ? adminMembers.filter(member => !seen.has(member.id) && !member.directory_hidden) : []
    return [...teamMembers, ...admins].filter(member => department === 'all' || member.department === department)
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [teamMembers, adminMembers, includeAdmins, department])
  const departments = useMemo(() => [...new Set([...teamMembers, ...adminMembers].map(member => member.department).filter(Boolean) as string[])].sort(), [teamMembers, adminMembers])

  const loadSetup = useCallback(async () => {
    const [goalsRes, weightsRes] = await Promise.all([
      supabase.from('team_goals').select('*'),
      supabase.from('work_type_weights').select('work_type, points'),
    ])
    if (goalsRes.error || weightsRes.error) {
      // Las tablas aún no existen (falta correr el SQL): el tablero funciona sin metas.
      setSetupReady(false)
      setGoals([])
      setWeights(DEFAULT_WEIGHTS)
      return
    }
    setSetupReady(true)
    setGoals((goalsRes.data as Goal[]) || [])
    const loaded: Weights = { ...DEFAULT_WEIGHTS }
    ;((weightsRes.data as { work_type: string; points: number }[]) || []).forEach(row => { loaded[row.work_type] = Number(row.points) })
    setWeights(loaded)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { void loadSetup() }, 0)
    return () => clearTimeout(timer)
  }, [loadSetup])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('asistencia_rango', { p_from: week.monday, p_to: week.saturday, p_tolerancia: 5 })
      .then(({ data }) => { if (!cancelled) setAttendance((data as AttendanceDay[]) || []) })
    return () => { cancelled = true }
  }, [week.monday, week.saturday])

  const rows = useMemo(() => members.map(member => ({
    member,
    metrics: computeMemberWeek(member, tasks as unknown as ScoreTask[], attendance, goals, week.monday, { weights }),
  })), [members, tasks, attendance, goals, week.monday, weights])

  function moveWeek(direction: number) {
    setWeekKey(current => localDateKey(addLocalDays(parseDateOnly(current)!, direction * 7)))
  }

  async function saveGoal() {
    const amount = Number(form.amount)
    if (!form.target || !(amount >= 0) || form.amount === '') return setMessage({ tone: 'error', text: 'Elige a quién aplica la meta y escribe una cantidad.' })
    const scope: { user_id: string | null; department: string | null } = form.scope === 'user' ? { user_id: form.target, department: null } : { user_id: null, department: form.target }
    const existing = goals.find(goal => goal.work_type === form.workType && (form.scope === 'user' ? goal.user_id === form.target : !goal.user_id && goal.department === form.target))
    const { data: auth } = await supabase.auth.getUser()
    const payload = { ...scope, work_type: form.workType, weekly_target: amount, updated_by: auth.user?.id || null, updated_at: new Date().toISOString() }
    const { error } = existing?.id
      ? await supabase.from('team_goals').update(payload).eq('id', existing.id)
      : await supabase.from('team_goals').insert(payload)
    if (error) return setMessage({ tone: 'error', text: `No se pudo guardar la meta: ${error.message}` })
    setMessage({ tone: 'ok', text: 'Meta guardada.' })
    setForm(current => ({ ...current, amount: '' }))
    await loadSetup()
  }

  async function deleteGoal(goal: Goal) {
    if (!goal.id) return
    const { error } = await supabase.from('team_goals').delete().eq('id', goal.id)
    if (error) return setMessage({ tone: 'error', text: `No se pudo borrar la meta: ${error.message}` })
    await loadSetup()
  }

  async function saveWeights() {
    const changes = Object.entries(weightDraft).filter(([, value]) => value !== '' && Number(value) >= 0)
    if (!changes.length) return
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase.from('work_type_weights').upsert(changes.map(([workType, value]) => ({
      work_type: workType, label: TYPE_LABEL[workType] || workType, points: Number(value), updated_by: auth.user?.id || null, updated_at: new Date().toISOString(),
    })))
    if (error) return setMessage({ tone: 'error', text: `No se pudieron guardar los puntos: ${error.message}` })
    setWeightDraft({})
    setMessage({ tone: 'ok', text: 'Puntos por tipo de trabajo guardados.' })
    await loadSetup()
  }

  const memberName = (id?: string | null) => [...teamMembers, ...adminMembers].find(member => member.id === id)?.full_name || 'Persona'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-800">Tablero semanal</h3>
          <p className="text-xs text-gray-500">Lunes a sábado (hora CDMX). Rendimiento contra la meta de cada persona.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={department} onChange={event => setDepartment(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">
            <option value="all">Todos los departamentos</option>
            {departments.map(dept => <option key={dept} value={dept}>{DEPT_LABELS[dept] || dept}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={includeAdmins} onChange={event => setIncludeAdmins(event.target.checked)} /> Incluir administradores</label>
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1">
            <button type="button" aria-label="Semana anterior" onClick={() => moveWeek(-1)} className="rounded p-1 hover:bg-gray-200"><ChevronLeft size={15} /></button>
            <span className="min-w-[130px] text-center text-xs font-semibold text-gray-700">{week.monday === currentMonday ? `Esta semana · ${shortRange(week.monday)}` : shortRange(week.monday)}</span>
            <button type="button" aria-label="Semana siguiente" onClick={() => moveWeek(1)} disabled={week.monday >= currentMonday} className="rounded p-1 hover:bg-gray-200 disabled:opacity-30"><ChevronRight size={15} /></button>
          </div>
        </div>
      </div>

      {setupReady === false && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <span>Las metas todavía no están activadas en la base de datos (falta correr <code>sql/2026-11-02_tablero_semanal.sql</code>). Se muestran los números sin semáforo y con los puntos por defecto (VSL 3, anuncio 1…).</span>
        </div>
      )}
      {message && <div role="status" className={`rounded-xl border px-4 py-2 text-xs ${message.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text} <button type="button" className="ml-2 font-semibold underline" onClick={() => setMessage(null)}>Cerrar</button></div>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-[1180px] w-full text-left text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2.5">Persona</th>
              <th className="px-3 py-2.5">Rendimiento</th>
              <th className="px-3 py-2.5">Trabajos</th>
              <th className="px-3 py-2.5" title="Entregas comprometidas en la semana o completadas en ella">Asignadas / hechas</th>
              <th className="px-3 py-2.5" title="Completadas en o antes de su fecha de entrega (sin retrasos del cliente)">A tiempo</th>
              <th className="px-3 py-2.5" title="Promedio de días de inicio (o creación) a completada">Tiempo de entrega</th>
              <th className="px-3 py-2.5" title="Sin cambios solicitados ni retrabajo">1ª aprobación</th>
              <th className="px-3 py-2.5" title="Días con entrada / días laborables">Asistencia</th>
              <th className="px-3 py-2.5" title="Entradas a tiempo (5 min de gracia) / días con entrada">Puntualidad</th>
              <th className="px-3 py-2.5" title={`En progreso más de ${STUCK_IN_PROGRESS_DAYS} días, detenidas o sin fecha`}>Atoradas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ member, metrics }) => <ScoreRow key={member.id} member={member} m={metrics} />)}
            {rows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-gray-400">No hay integrantes con este filtro.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-gray-500"><Info size={12} className="mt-0.5 shrink-0" />Tipo de trabajo según el título y el departamento (p. ej. “Editar 6 anuncios” = 6 anuncios). El retrabajo (🔄) no suma puntos. Las tareas del cliente y los retrasos atribuidos al cliente no cuentan en “A tiempo”. Archivadas excluidas.</p>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <button type="button" onClick={() => setEditorOpen(open => !open)} className="flex w-full items-center justify-between px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-sm font-bold text-gray-800"><Target size={15} className="text-blue-600" /> Metas semanales y puntos por tipo</span>
          <ChevronDown size={16} className={`text-gray-400 transition ${editorOpen ? 'rotate-180' : ''}`} />
        </button>
        {editorOpen && (
          <div className="grid gap-5 border-t border-gray-100 p-4 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs text-gray-500">La meta de una persona manda sobre la de su departamento. Usa “Puntos totales” para comparar roles distintos, o un tipo (p. ej. 12 anuncios).</p>
              <div className="grid grid-cols-2 gap-2">
                <select disabled={!setupReady} value={form.scope} onChange={event => setForm({ ...form, scope: event.target.value as 'user' | 'department', target: '' })} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
                  <option value="user">Por persona</option>
                  <option value="department">Por departamento</option>
                </select>
                <select disabled={!setupReady} value={form.target} onChange={event => setForm({ ...form, target: event.target.value })} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
                  <option value="">{form.scope === 'user' ? 'Elige persona' : 'Elige departamento'}</option>
                  {form.scope === 'user'
                    ? [...teamMembers, ...adminMembers].filter((member, index, list) => list.findIndex(other => other.id === member.id) === index).map(member => <option key={member.id} value={member.id}>{member.full_name}</option>)
                    : departments.map(dept => <option key={dept} value={dept}>{DEPT_LABELS[dept] || dept}</option>)}
                </select>
                <select disabled={!setupReady} value={form.workType} onChange={event => setForm({ ...form, workType: event.target.value })} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
                  <option value={POINTS_GOAL}>Puntos totales</option>
                  {WORK_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
                </select>
                <input disabled={!setupReady} type="number" min={0} step="0.5" placeholder="Cantidad por semana" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
              </div>
              <button type="button" disabled={!setupReady} onClick={() => void saveGoal()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:bg-gray-300">Guardar meta</button>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {goals.length === 0 && <li className="px-3 py-3 text-xs text-gray-400">{setupReady ? 'Aún no hay metas.' : 'Disponible al correr el SQL del tablero.'}</li>}
                {goals.slice().sort((a, b) => (a.user_id ? memberName(a.user_id) : DEPT_LABELS[a.department || ''] || '').localeCompare(b.user_id ? memberName(b.user_id) : DEPT_LABELS[b.department || ''] || '')).map(goal => (
                  <li key={goal.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span><strong>{goal.user_id ? memberName(goal.user_id) : `Depto. ${DEPT_LABELS[goal.department || ''] || goal.department}`}</strong> · {goal.weekly_target} {TYPE_LABEL[goal.work_type] || goal.work_type} / semana</span>
                    <button type="button" aria-label="Borrar meta" onClick={() => void deleteGoal(goal)} className="text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Puntos por unidad de trabajo (para comparar roles): una VSL vale más que un anuncio.</p>
              <div className="grid grid-cols-2 gap-2">
                {WORK_TYPES.map(type => (
                  <label key={type.key} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2 py-1.5 text-xs">
                    <span className="truncate">{type.label}</span>
                    <input disabled={!setupReady} type="number" min={0} step="0.5" value={weightDraft[type.key] ?? String(weights[type.key] ?? type.points)} onChange={event => setWeightDraft({ ...weightDraft, [type.key]: event.target.value })} className="w-16 rounded border border-gray-200 px-1.5 py-1 text-right" />
                  </label>
                ))}
              </div>
              <button type="button" disabled={!setupReady || !Object.keys(weightDraft).length} onClick={() => void saveWeights()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:bg-gray-300">Guardar puntos</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function ScoreRow({ member, m }: { member: User; m: MemberWeek }) {
  const types = Object.entries(m.byType)
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <div className="flex items-center gap-2"><UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={28} /><div><p className="font-semibold text-gray-800">{member.full_name}</p><p className="text-[10px] text-gray-400">{member.role === 'admin' ? 'Administrador' : DEPT_LABELS[member.department || ''] || 'Sin departamento'}</p></div></div>
      </td>
      <td className="px-3 py-3">
        {m.goalPct !== null ? (
          <div className="flex items-center gap-2">
            <span className={`h-3 w-3 shrink-0 rounded-full ${SEMAPHORE_CLASS[m.semaphore!]}`} title={m.semaphore!} />
            <div><p className="text-sm font-bold text-gray-800">{m.goalPct}%</p><p className="text-[10px] text-gray-500">{Object.entries(m.goals).map(([type, target]) => `${type === POINTS_GOAL ? m.completedPoints : (m.byType[type]?.units || 0)}/${target} ${TYPE_LABEL[type] || type}`).join(' · ')}</p></div>
          </div>
        ) : (
          <div><p className="text-sm font-bold text-gray-800">{m.completedPoints} pts</p><p className="text-[10px] text-gray-400">Sin meta</p></div>
        )}
        {m.loadFlag && <p className={`mt-1 text-[10px] font-semibold ${m.loadFlag === 'bajo_rendimiento' ? 'text-red-600' : 'text-amber-600'}`}>{FLAG_LABEL[m.loadFlag]}</p>}
      </td>
      <td className="px-3 py-3">
        <p className="font-semibold text-gray-800">{m.completedCount} · {m.completedPoints} pts</p>
        <p className="text-[10px] text-gray-500">{types.length ? types.map(([type, slot]) => `${TYPE_LABEL[type] || type} ${slot.units}`).join(' · ') : '—'}</p>
        {m.reworkCount > 0 && <p className="text-[10px] text-orange-600">{m.reworkCount} retrabajo{m.reworkCount === 1 ? '' : 's'}</p>}
      </td>
      <td className="px-3 py-3"><p className="font-semibold text-gray-800">{m.assignedCount} / {m.completedOfAssigned}</p><p className="text-[10px] text-gray-400">{m.assignedPoints} pts asignados</p></td>
      <td className="px-3 py-3"><p className="font-semibold text-gray-800">{dash(m.onTimePct)}</p><p className="text-[10px] text-gray-400">{m.onTimeCount}/{m.onTimeEvaluated}{m.clientExcluded > 0 ? ` · ${m.clientExcluded} excluida${m.clientExcluded === 1 ? '' : 's'} (cliente)` : ''}</p></td>
      <td className="px-3 py-3 font-semibold text-gray-800">{m.avgDeliveryDays === null ? '—' : `${m.avgDeliveryDays} días`}</td>
      <td className="px-3 py-3"><p className="font-semibold text-gray-800">{dash(m.firstPassPct)}</p><p className="text-[10px] text-gray-400">{m.firstPassCount}/{m.firstPassEvaluated}</p></td>
      <td className="px-3 py-3"><p className="font-semibold text-gray-800">{dash(m.attendancePct)}</p><p className="text-[10px] text-gray-400">{m.attendedDays}/{m.scheduledDays} días</p></td>
      <td className="px-3 py-3"><p className="font-semibold text-gray-800">{dash(m.punctualityPct)}</p><p className="text-[10px] text-gray-400">{m.onTimeCheckIns}/{m.attendedDays}</p></td>
      <td className="px-3 py-3" title={`En progreso >${STUCK_IN_PROGRESS_DAYS} días: ${m.stuck.inProgressTooLong} · Detenidas: ${m.stuck.blocked} · Sin fecha: ${m.stuck.undated}`}>
        <p className={`font-semibold ${m.stuck.total > 0 ? 'text-red-600' : 'text-gray-800'}`}>{m.stuck.total}</p>
        <p className="text-[10px] text-gray-400">{m.stuck.inProgressTooLong} lentas · {m.stuck.blocked} det. · {m.stuck.undated} s/fecha</p>
      </td>
    </tr>
  )
}

/**
 * Agenda del equipo (Hoy / Semana / Mes por persona). Lógica pura, sin React ni Supabase.
 *
 * Reglas:
 * - Fecha efectiva de una tarea = "Mi compromiso" (commitment_date); si no tiene, "La necesito para" (needed_date).
 * - "En la ventana": pendiente (no realizada, no en revisión) con fecha efectiva entre hoy y el fin de la ventana.
 *   Hoy = solo hoy · Semana = hasta el domingo de esta semana · Mes = hasta el último día del mes. Todo en fecha CDMX.
 * - "Atrasada": pendiente con fecha efectiva antes de hoy.
 * - "En revisión": no realizada y con review_status pendiente_revision / pendiente_trafficker / en_revision / aprobada.
 * - "Sin planear": pendiente, no en revisión, sin ninguna fecha.
 * - Se ignoran tareas archivadas y las pendientes de proyectos finalizados.
 * - Personas: equipo + admins activos, sin cuentas de cliente (sin duplicados).
 */
import { cdmxTodayKey, localDateKey, parseDateOnly } from './dates'

export type AgendaWindow = 'hoy' | 'semana' | 'mes'

export const AGENDA_WINDOW_LABELS: Record<AgendaWindow, string> = { hoy: 'Hoy', semana: 'Semana', mes: 'Mes' }

export interface AgendaTask {
  id: string
  title: string
  assigned_to: string
  department?: string | null
  status: string
  commitment_date?: string | null
  needed_date?: string | null
  review_status?: string | null
  archived_at?: string | null
  project?: { status?: string | null; name?: string | null } | null
}

export interface AgendaPerson {
  id: string
  full_name: string
  role: string
  department?: string | null
  active?: boolean
}

export interface AgendaRow<T extends AgendaTask, P extends AgendaPerson> {
  person: P
  due: T[]
  overdue: T[]
  inReview: T[]
  undated: T[]
}

const REVIEW_STATES = new Set(['pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada'])

export function effectiveDate(task: AgendaTask): string | null {
  return task.commitment_date || task.needed_date || null
}

export function isInReview(task: AgendaTask): boolean {
  return task.status !== 'completada' && !!task.review_status && REVIEW_STATES.has(task.review_status)
}

/** Último día (YYYY-MM-DD) de la ventana a partir de hoy (CDMX). */
export function windowEndKey(window: AgendaWindow, todayKey: string): string {
  const today = parseDateOnly(todayKey)!
  if (window === 'hoy') return todayKey
  if (window === 'semana') {
    const end = new Date(today)
    const day = today.getDay() // 0 = domingo
    end.setDate(today.getDate() + (day === 0 ? 0 : 7 - day))
    return localDateKey(end)
  }
  return localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0))
}

function isCounted(task: AgendaTask): boolean {
  if (task.archived_at) return false
  if (task.status === 'completada') return false
  if (task.project?.status === 'completado') return false
  return true
}

/** Personas de la agenda: activas, sin clientes, sin duplicados, ordenadas por nombre. */
export function agendaPeople<P extends AgendaPerson>(...lists: P[][]): P[] {
  const seen = new Map<string, P>()
  for (const list of lists) for (const person of list) {
    if (!person || person.role === 'client' || person.active === false || seen.has(person.id)) continue
    seen.set(person.id, person)
  }
  return [...seen.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
}

const byDate = <T extends AgendaTask>(a: T, b: T) => (effectiveDate(a) || '9999').localeCompare(effectiveDate(b) || '9999')

export function buildAgenda<T extends AgendaTask, P extends AgendaPerson>(
  people: P[],
  tasks: T[],
  window: AgendaWindow,
  options: { todayKey?: string; department?: string } = {},
): AgendaRow<T, P>[] {
  const todayKey = options.todayKey || cdmxTodayKey()
  const endKey = windowEndKey(window, todayKey)
  const dept = options.department || ''
  const filtered = dept ? people.filter(p => (dept === 'sin_departamento' ? !p.department : p.department === dept)) : people
  return filtered.map(person => {
    const mine = tasks.filter(task => task.assigned_to === person.id && isCounted(task))
    const inReview = mine.filter(isInReview)
    const pending = mine.filter(task => !isInReview(task))
    const due = pending.filter(task => {
      const key = effectiveDate(task)
      return !!key && key >= todayKey && key <= endKey
    }).sort(byDate)
    const overdue = pending.filter(task => {
      const key = effectiveDate(task)
      return !!key && key < todayKey
    }).sort(byDate)
    const undated = pending.filter(task => !effectiveDate(task))
    return { person, due, overdue, inReview: inReview.sort(byDate), undated }
  })
}

/** Departamentos presentes entre las personas (para el filtro). */
export function agendaDepartments(people: AgendaPerson[]): string[] {
  const set = new Set<string>()
  let none = false
  for (const p of people) {
    if (p.department) set.add(p.department)
    else none = true
  }
  return [...[...set].sort(), ...(none ? ['sin_departamento'] : [])]
}

// Tablero semanal del equipo: cálculos puros (sin React ni Supabase) para poder probarlos.
//
// Semana = lunes a sábado en America/Mexico_City (el domingo se suma a la semana que termina
// para las entregas, pero no es día laborable para asistencia).
//
// Tipo de trabajo: primero el campo explícito tasks.work_type / tasks.work_units (si existe en
// la base); si no, una heurística por título + departamento (ver classifyTask).
import type { Task, User } from '../types'
import { addLocalDays, cdmxTodayKey, daysBetweenKeys, localDateKey, mondayOf, parseDateOnly } from './dates'
import { countsForTeamOnTimeMetric, isClientAttributableDelay } from './taskDelays'

export const WORK_TYPES = [
  { key: 'vsl', label: 'VSL', points: 3 },
  { key: 'anuncio', label: 'Anuncio', points: 1 },
  { key: 'video', label: 'Video (gracias, edificación)', points: 2 },
  { key: 'pagina', label: 'Página / embudo', points: 2 },
  { key: 'imagen', label: 'Imagen / pieza de diseño', points: 0.5 },
  { key: 'guion', label: 'Guion / copy / prompt', points: 1 },
  { key: 'campana', label: 'Campaña', points: 2 },
  { key: 'grabacion', label: 'Sesión de grabación', points: 2 },
  { key: 'otro', label: 'Otra tarea', points: 1 },
] as const

export type WorkType = typeof WORK_TYPES[number]['key'] | 'retrabajo'
export const POINTS_GOAL = 'puntos' // work_type especial de team_goals: meta de puntos totales
export const STUCK_IN_PROGRESS_DAYS = 7
export const REWORK_PREFIX = '🔄 Retrabajo: '

export type Weights = Record<string, number>
export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(WORK_TYPES.map(type => [type.key, type.points]))

export interface Goal {
  id?: string
  user_id?: string | null
  department?: string | null
  work_type: string
  weekly_target: number
}

export interface AttendanceDay {
  user_id: string
  date: string
  laborable: boolean
  estado: 'a_tiempo' | 'retardo' | 'sin_registro' | 'pendiente' | 'descanso' | 'dia_extra'
}

export type ScoreTask = Pick<Task, 'id' | 'project_id' | 'title' | 'department' | 'status' | 'assigned_to' | 'commitment_date' | 'completion_date' | 'start_date' | 'created_at' | 'review_status' | 'client_approval' | 'change_count' | 'delay_responsible'> & {
  updated_at?: string | null
  archived_at?: string | null
  work_type?: string | null
  work_units?: number | null
}

const normalize = (value: string) => value.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function quantity(title: string, words: RegExp): number {
  const match = new RegExp(`(\\d+)\\s+(?:${words.source})`).exec(title)
  return match ? Math.max(1, Number(match[1])) : 1
}

export function isReworkTask(task: Pick<Task, 'title'>): boolean {
  return task.title.startsWith(REWORK_PREFIX) || normalize(task.title).startsWith('🔄 retrabajo')
}

/** Tipo de trabajo y unidades de una tarea (p. ej. "Editar 6 anuncios" → anuncio × 6). */
export function classifyTask(task: Pick<ScoreTask, 'title' | 'department' | 'work_type' | 'work_units'>): { type: WorkType; units: number } {
  if (isReworkTask(task)) return { type: 'retrabajo', units: 0 }
  if (task.work_type && (task.work_type === 'retrabajo' || WORK_TYPES.some(type => type.key === task.work_type))) {
    return { type: task.work_type as WorkType, units: task.work_units && task.work_units > 0 ? task.work_units : 1 }
  }
  const t = normalize(task.title)
  const dept = task.department
  const ads = /anuncios?|ads\b/
  if (dept === 'edicion' || dept === 'grabacion') {
    if (/anuncio/.test(t)) return { type: 'anuncio', units: quantity(t, /anuncios?/) }
    if (/\bvsl\b/.test(t)) return { type: 'vsl', units: 1 }
    if (/video|edificacion|gracias/.test(t)) return { type: 'video', units: 1 }
    if (dept === 'grabacion' && /grab|sesion/.test(t)) return { type: 'grabacion', units: 1 }
    return { type: 'otro', units: 1 }
  }
  if (dept === 'diseno') {
    if (/landing|\blp\b|pagina|presentacion/.test(t) && !/imagen|mockup|miniatura/.test(t)) return { type: 'pagina', units: 1 }
    if (/imagen|imagenes|carrusel|mockup|miniatura|disen/.test(t)) return { type: 'imagen', units: quantity(t, /imagen(?:es)?|carrusel(?:es)?|piezas?/) }
    return { type: 'otro', units: 1 }
  }
  if (dept === 'webmaster') {
    if (/pagina|funnel|embudo|landing/.test(t)) return { type: 'pagina', units: 1 }
    return { type: 'otro', units: 1 }
  }
  if (dept === 'copy') {
    if (/guion|prompt|texto|copy/.test(t)) return { type: 'guion', units: 1 }
    return { type: 'otro', units: 1 }
  }
  if (dept === 'trafficker' && /campan/.test(t)) return { type: 'campana', units: 1 }
  if (ads.test(t) && /editar/.test(t)) return { type: 'anuncio', units: quantity(t, /anuncios?/) }
  return { type: 'otro', units: 1 }
}

export function pointsFor(type: WorkType, units: number, weights: Weights = DEFAULT_WEIGHTS): number {
  if (type === 'retrabajo') return 0
  return (weights[type] ?? DEFAULT_WEIGHTS[type] ?? 1) * units
}

/** Día (CDMX) en que se completó: completion_date o, si falta, la fecha de updated_at. */
export function completionKey(task: Pick<ScoreTask, 'status' | 'completion_date' | 'updated_at'>): string | null {
  if (task.status !== 'completada') return null
  if (task.completion_date) return task.completion_date.slice(0, 10)
  return task.updated_at ? cdmxTodayKey(new Date(task.updated_at)) : null
}

/** Aprobada a la primera: sin cambios del cliente, sin "cambios solicitados" y sin tarea de retrabajo. */
export function isFirstPass(task: ScoreTask, all: ScoreTask[]): boolean {
  if ((task.change_count ?? 0) > 0) return false
  if (task.review_status === 'cambios_solicitados' || task.client_approval === 'cambios_solicitados') return false
  const reworkTitle = REWORK_PREFIX + task.title
  return !all.some(other => other.project_id === task.project_id && other.title === reworkTitle)
}

export interface WeekRange { monday: string; saturday: string; sunday: string; workdays: string[] }

export function weekRange(anyDayKey: string): WeekRange {
  const monday = mondayOf(parseDateOnly(anyDayKey)!)
  const days = Array.from({ length: 7 }, (_, index) => localDateKey(addLocalDays(monday, index)))
  return { monday: days[0], saturday: days[5], sunday: days[6], workdays: days.slice(0, 6) }
}

const inWeek = (key: string | null | undefined, week: WeekRange) => !!key && key.slice(0, 10) >= week.monday && key.slice(0, 10) <= week.sunday

export type Semaphore = 'verde' | 'amarillo' | 'rojo'
export function semaphore(pct: number | null): Semaphore | null {
  if (pct === null) return null
  return pct >= 100 ? 'verde' : pct >= 80 ? 'amarillo' : 'rojo'
}

/** Metas de una persona: las suyas mandan sobre las de su departamento (por tipo de trabajo). */
export function goalsFor(member: Pick<User, 'id' | 'department'>, goals: Goal[]): Record<string, number> {
  const result: Record<string, number> = {}
  goals.filter(goal => !goal.user_id && goal.department && goal.department === member.department)
    .forEach(goal => { result[goal.work_type] = Number(goal.weekly_target) })
  goals.filter(goal => goal.user_id === member.id)
    .forEach(goal => { result[goal.work_type] = Number(goal.weekly_target) })
  Object.keys(result).forEach(key => { if (!(result[key] > 0)) delete result[key] })
  return result
}

export interface MemberWeek {
  completedCount: number
  completedPoints: number
  byType: Record<string, { count: number; units: number; points: number }>
  reworkCount: number
  goals: Record<string, number>
  goalPoints: number | null
  goalPct: number | null
  semaphore: Semaphore | null
  assignedCount: number
  assignedPoints: number
  completedOfAssigned: number
  loadFlag: 'subutilizado' | 'bajo_rendimiento' | 'sin_carga' | null
  onTimeEvaluated: number
  onTimeCount: number
  onTimePct: number | null
  clientExcluded: number
  avgDeliveryDays: number | null
  firstPassEvaluated: number
  firstPassCount: number
  firstPassPct: number | null
  scheduledDays: number
  attendedDays: number
  attendancePct: number | null
  onTimeCheckIns: number
  punctualityPct: number | null
  stuck: { inProgressTooLong: number; blocked: number; undated: number; total: number }
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

export function computeMemberWeek(
  member: Pick<User, 'id' | 'department'>,
  allTasks: ScoreTask[],
  attendance: AttendanceDay[],
  goals: Goal[],
  weekAnyDayKey: string,
  options: { weights?: Weights; now?: Date } = {},
): MemberWeek {
  const weights = options.weights || DEFAULT_WEIGHTS
  const week = weekRange(weekAnyDayKey)
  const todayKey = cdmxTodayKey(options.now)
  const asOf = todayKey < week.sunday ? todayKey : week.sunday
  const live = allTasks.filter(task => !task.archived_at)
  const mine = live.filter(task => task.assigned_to === member.id)

  // ── Trabajos completados en la semana ──
  const completed = mine.filter(task => inWeek(completionKey(task), week))
  const output = completed.filter(task => !isReworkTask(task))
  const byType: MemberWeek['byType'] = {}
  let completedPoints = 0
  output.forEach(task => {
    const { type, units } = classifyTask(task)
    const points = pointsFor(type, units, weights)
    const slot = byType[type] || (byType[type] = { count: 0, units: 0, points: 0 })
    slot.count++; slot.units += units; slot.points += points
    completedPoints += points
  })

  // ── Meta ──
  const memberGoals = goalsFor(member, goals)
  let goalPoints: number | null = null
  let achievedForGoal = 0
  if (memberGoals[POINTS_GOAL]) {
    goalPoints = memberGoals[POINTS_GOAL]
    achievedForGoal = completedPoints
  } else {
    const typed = Object.entries(memberGoals).filter(([type]) => type !== POINTS_GOAL)
    if (typed.length) {
      goalPoints = typed.reduce((sum, [type, target]) => sum + pointsFor(type as WorkType, target, weights), 0)
      achievedForGoal = typed.reduce((sum, [type]) => sum + (byType[type]?.points || 0), 0)
    }
  }
  const goalPct = goalPoints ? Math.round((achievedForGoal / goalPoints) * 100) : null

  // ── Carga asignada: entregas comprometidas en la semana + lo completado en la semana ──
  const assigned = mine.filter(task => !isReworkTask(task) && (inWeek(task.commitment_date, week) || output.includes(task)))
  const assignedPoints = assigned.reduce((sum, task) => { const c = classifyTask(task); return sum + pointsFor(c.type, c.units, weights) }, 0)
  const completedOfAssigned = assigned.filter(task => output.includes(task)).length
  let loadFlag: MemberWeek['loadFlag'] = null
  if (goalPct !== null && goalPct < 80 && goalPoints) loadFlag = assignedPoints < goalPoints * 0.8 ? 'subutilizado' : 'bajo_rendimiento'
  else if (goalPct === null && assigned.length === 0) loadFlag = 'sin_carga'

  // ── Entregas a tiempo (sin retrasos atribuibles al cliente) ──
  const withDate = output.filter(task => task.commitment_date)
  const counted = withDate.filter(task => countsForTeamOnTimeMetric(task) && !isClientAttributableDelay(task))
  const onTimeCount = counted.filter(task => completionKey(task)! <= task.commitment_date!.slice(0, 10)).length

  // ── Tiempo de entrega: de inicio (o creación) a completada ──
  const durations = output.map(task => {
    const start = task.start_date?.slice(0, 10) || (task.created_at ? cdmxTodayKey(new Date(task.created_at)) : null)
    const end = completionKey(task)
    return start && end ? Math.max(0, daysBetweenKeys(start, end)) : null
  }).filter((days): days is number => days !== null)
  const avgDeliveryDays = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null

  // ── Calidad: aprobadas a la primera ──
  // Las que siguen en revisión aún no se pueden calificar (salvo que ya tengan retrabajo).
  const inReview = (task: ScoreTask) => task.review_status === 'pendiente_revision' || task.review_status === 'pendiente_trafficker' || task.review_status === 'en_revision'
  const firstPassPool = output.filter(task => !inReview(task) || !isFirstPass(task, live))
  const firstPassCount = firstPassPool.filter(task => isFirstPass(task, live)).length

  // ── Asistencia y puntualidad (asistencia_rango ya aplica horario individual y 5 min de gracia) ──
  const days = attendance.filter(day => day.user_id === member.id && week.workdays.includes(day.date) && day.laborable && ['a_tiempo', 'retardo', 'sin_registro'].includes(day.estado))
  const attendedDays = days.filter(day => day.estado !== 'sin_registro').length
  const onTimeCheckIns = days.filter(day => day.estado === 'a_tiempo').length

  // ── Tareas atoradas (al cierre de la semana o a hoy) ──
  const active = mine.filter(task => task.status !== 'completada' && !isReworkTask(task))
  const inProgressTooLong = active.filter(task => {
    if (task.status !== 'en_progreso') return false
    const start = task.start_date?.slice(0, 10) || (task.created_at ? cdmxTodayKey(new Date(task.created_at)) : null)
    return !!start && daysBetweenKeys(start, asOf) > STUCK_IN_PROGRESS_DAYS
  }).length
  const blocked = active.filter(task => task.status === 'bloqueada').length
  const undated = active.filter(task => !task.commitment_date).length

  return {
    completedCount: output.length,
    completedPoints: Math.round(completedPoints * 10) / 10,
    byType,
    reworkCount: completed.length - output.length,
    goals: memberGoals,
    goalPoints,
    goalPct,
    semaphore: semaphore(goalPct),
    assignedCount: assigned.length,
    assignedPoints: Math.round(assignedPoints * 10) / 10,
    completedOfAssigned,
    loadFlag,
    onTimeEvaluated: counted.length,
    onTimeCount,
    onTimePct: pct(onTimeCount, counted.length),
    clientExcluded: withDate.length - counted.length,
    avgDeliveryDays,
    firstPassEvaluated: firstPassPool.length,
    firstPassCount,
    firstPassPct: pct(firstPassCount, firstPassPool.length),
    scheduledDays: days.length,
    attendedDays,
    attendancePct: pct(attendedDays, days.length),
    onTimeCheckIns,
    punctualityPct: pct(onTimeCheckIns, attendedDays),
    stuck: { inProgressTooLong, blocked, undated, total: inProgressTooLong + blocked + undated },
  }
}

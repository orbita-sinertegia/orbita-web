// Fechas ESTIMADAS para la hoja de ruta (se calculan en el navegador; no se guardan).
//
// Las tareas sin fecha de entrega (commitment_date) reciben un rango aproximado a partir
// de hoy, siguiendo el orden de las fases del embudo. Cuando alguien pone una fecha real,
// esa tarea deja de ser estimada y, si su fecha cae después del estimado, las fases
// siguientes se recorren detrás de ella.
//
// Supuestos (ajustables en ESTIMATE_PHASE_DAYS):
// - Días hábiles: lunes a sábado (el sábado cuenta como día completo); el domingo y los
//   feriados oficiales (src/lib/holidays.ts) no se trabajan.
// - Cada fase dura un número fijo de días hábiles; Producción · Video y Producción · Páginas
//   corren en paralelo después de Guiones; Revisión empieza cuando terminan ambas.
// - Dentro de una fase, cada departamento reparte sus tareas en secuencia dentro de la
//   duración de la fase; departamentos distintos trabajan en paralelo.
// - Una dependencia (depends_on_task_id) empuja la tarea al día hábil siguiente al fin de
//   la tarea de la que depende.
import type { Department, Task } from '../types'
import { PHASES, type Phase, inferPhase } from '../data/projectTemplates'
import { addLocalDays, cdmxTodayKey, localDateKey, parseDateOnly } from './dates'
import { isHoliday } from './holidays'

export const ESTIMATE_PHASE_DAYS: Record<Phase, number> = {
  entrada: 3,
  estrategia: 4,
  guiones: 5,
  produccion_video: 10,
  produccion_paginas: 10,
  revision: 3,
  lanzamiento: 2,
  optimizacion: 5,
}

// Tipo de embudo del proyecto (projects.funnel_type, opcional).
export const FUNNEL_TYPES = ['low2funnel', 'vsl_high_ticket', 'high_ticket', 'restaurante', 'webinar', 'otro'] as const
export type FunnelType = typeof FUNNEL_TYPES[number]
export const FUNNEL_TYPE_LABELS: Record<FunnelType, string> = {
  low2funnel: 'Low2funnel',
  vsl_high_ticket: 'VSL High Ticket',
  high_ticket: 'High Ticket',
  restaurante: 'Restaurante',
  webinar: 'Webinar',
  otro: 'Otro',
}

// Etapa del proyecto (projects.stage, opcional): en proceso de construcción o ya corriendo campañas.
export const PROJECT_STAGES = ['en_proceso', 'corriendo'] as const
export type ProjectStage = typeof PROJECT_STAGES[number]
export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  en_proceso: 'En proceso',
  corriendo: 'Corriendo campañas',
}

// Duración (días hábiles) de cada fase por tipo de embudo. Por ahora todos usan los mismos
// valores; para ajustar uno basta con cambiar su entrada, p. ej. restaurante: { ...base, guiones: 3 }.
export const ESTIMATE_PHASE_DAYS_BY_FUNNEL: Record<FunnelType, Record<Phase, number>> = {
  low2funnel: { ...ESTIMATE_PHASE_DAYS },
  vsl_high_ticket: { ...ESTIMATE_PHASE_DAYS },
  high_ticket: { ...ESTIMATE_PHASE_DAYS },
  // Restaurante: solo anuncios (sin páginas ni VSL), ciclo más corto.
  restaurante: {
    entrada: 2,
    estrategia: 2,
    guiones: 3,
    produccion_video: 5,
    produccion_paginas: 0,
    revision: 2,
    lanzamiento: 1,
    optimizacion: 5,
  },
  webinar: { ...ESTIMATE_PHASE_DAYS },
  otro: { ...ESTIMATE_PHASE_DAYS },
}

/** Duraciones de fase para un tipo de embudo; sin tipo (o desconocido) usa ESTIMATE_PHASE_DAYS. */
export function phaseDaysFor(funnelType?: string | null): Record<Phase, number> {
  return (funnelType && ESTIMATE_PHASE_DAYS_BY_FUNNEL[funnelType as FunnelType]) || ESTIMATE_PHASE_DAYS
}

/** Datos del proyecto que deciden si se estima y con qué duraciones. Todos opcionales. */
export interface EstimateProjectInfo {
  status?: string | null
  stage?: string | null
  funnel_type?: string | null
}

/**
 * Solo se estiman proyectos activos que no estén ya corriendo campañas. Sin estado o sin
 * etapa conocidos (p. ej. antes de crear la columna stage) se estima.
 */
export function shouldEstimateProject(info?: EstimateProjectInfo | null): boolean {
  if (!info) return true
  if (info.status && info.status !== 'activo') return false
  return info.stage !== 'corriendo'
}

// Etapas en orden; las fases de una misma etapa corren en paralelo.
export const ESTIMATE_STAGES: Phase[][] = [
  ['entrada'], ['estrategia'], ['guiones'], ['produccion_video', 'produccion_paginas'],
  ['revision'], ['lanzamiento'], ['optimizacion'],
]

export interface EstimatedSpan { start: string; end: string }

export type EstimateTask = Pick<Task, 'id' | 'title' | 'department' | 'status' | 'commitment_date' | 'completion_date' | 'start_date' | 'depends_on_task_id'> & {
  phase?: string | null
  archived_at?: string | null
}

/** Día hábil: lunes a sábado, sin feriados oficiales (src/lib/holidays.ts). */
export function isWorkingDay(date: Date): boolean {
  return date.getDay() !== 0 && !isHoliday(localDateKey(date))
}

/** El mismo día si es hábil; si es domingo, el lunes. */
export function nextWorkingDay(date: Date): Date {
  let result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  while (!isWorkingDay(result)) result = addLocalDays(result, 1)
  return result
}

/** Avanza `amount` días hábiles desde `date` (que se normaliza a día hábil). */
export function addWorkingDays(date: Date, amount: number): Date {
  let result = nextWorkingDay(date)
  for (let step = 0; step < amount; step++) result = nextWorkingDay(addLocalDays(result, 1))
  return result
}

function phaseOf(task: EstimateTask): Phase {
  const stored = task.phase as Phase | null | undefined
  return stored && (PHASES as readonly string[]).includes(stored) ? stored : inferPhase(task.title, task.department as Department)
}

const maxKey = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b)

/**
 * Calcula rangos estimados para las tareas pendientes SIN commitment_date de UN proyecto.
 * Devuelve un mapa id → { start, end } ('YYYY-MM-DD'). Las tareas con fecha real, las
 * completadas y las archivadas no se estiman (pero las fechas reales sí recorren el plan).
 */
export function estimateProjectSchedule(
  tasks: EstimateTask[],
  options: { now?: Date; projectStart?: string | null; funnelType?: string | null } = {},
): Map<string, EstimatedSpan> {
  const result = new Map<string, EstimatedSpan>()
  const phaseDays = phaseDaysFor(options.funnelType)
  const todayKey = cdmxTodayKey(options.now)
  const startKey = options.projectStart && options.projectStart.slice(0, 10) > todayKey ? options.projectStart.slice(0, 10) : todayKey
  let cursor = nextWorkingDay(parseDateOnly(startKey)!)
  const live = tasks.filter(task => !task.archived_at)
  const endOf = new Map<string, string>() // fin conocido (real o estimado) para dependencias
  live.forEach(task => {
    const end = task.commitment_date || (task.status === 'completada' ? task.completion_date : null)
    if (end) endOf.set(task.id, end.slice(0, 10))
  })

  for (const stage of ESTIMATE_STAGES) {
    let stageEnd = null as string | null
    for (const phase of stage) {
      const phaseTasks = live.filter(task => phaseOf(task) === phase)
      const pending = phaseTasks.filter(task => task.status !== 'completada')
      if (!pending.length) continue
      pending.filter(task => task.commitment_date).forEach(task => { stageEnd = maxKey(stageEnd, task.commitment_date!.slice(0, 10)) })
      const undated = pending.filter(task => !task.commitment_date)
      const days = Math.max(1, phaseDays[phase] ?? ESTIMATE_PHASE_DAYS[phase])
      const byDepartment = new Map<string, EstimateTask[]>()
      undated.forEach(task => byDepartment.set(task.department, [...(byDepartment.get(task.department) || []), task]))
      byDepartment.forEach(list => list.forEach((task, index) => {
        const first = Math.floor((index * days) / list.length)
        const last = Math.max(first, Math.floor(((index + 1) * days) / list.length) - 1)
        let start = addWorkingDays(cursor, first)
        let end = addWorkingDays(cursor, last)
        const length = last - first
        const depEnd = task.depends_on_task_id ? endOf.get(task.depends_on_task_id) : undefined
        if (depEnd && depEnd >= localDateKey(start)) {
          start = nextWorkingDay(addLocalDays(parseDateOnly(depEnd)!, 1))
          end = addWorkingDays(start, length)
        }
        // Si ya se empezó (start_date), el rango arranca ese día.
        if (task.start_date && task.start_date.slice(0, 10) < localDateKey(start)) start = parseDateOnly(task.start_date)!
        const span = { start: localDateKey(start), end: localDateKey(end) }
        result.set(task.id, span)
        endOf.set(task.id, span.end)
        stageEnd = maxKey(stageEnd, span.end)
      }))
    }
    if (stageEnd && stageEnd >= localDateKey(cursor)) cursor = nextWorkingDay(addLocalDays(parseDateOnly(stageEnd)!, 1))
  }
  return result
}

export type EstimatePlanTask = EstimateTask & { project_id: string; project?: EstimateProjectInfo | null }

/**
 * Estima todas las tareas, agrupadas por proyecto. Solo los proyectos activos que no estén
 * corriendo campañas (ver shouldEstimateProject) reciben estimados; el resto se queda igual.
 * `projectInfo` acepta el estado como texto (compatibilidad) o un objeto con status/stage/funnel_type;
 * lo que falte se toma de `task.project`.
 */
export function estimateRoadmap(
  tasks: EstimatePlanTask[],
  projectInfo: Record<string, string | EstimateProjectInfo | null | undefined> = {},
  now?: Date,
): Map<string, EstimatedSpan> {
  const byProject = new Map<string, EstimatePlanTask[]>()
  tasks.forEach(task => byProject.set(task.project_id, [...(byProject.get(task.project_id) || []), task]))
  const all = new Map<string, EstimatedSpan>()
  byProject.forEach((list, projectId) => {
    const given = projectInfo[projectId]
    const explicit: EstimateProjectInfo = typeof given === 'string' ? { status: given } : given || {}
    const fromTask = list.find(task => task.project)?.project || {}
    const info: EstimateProjectInfo = {
      status: explicit.status ?? fromTask.status,
      stage: explicit.stage ?? fromTask.stage,
      funnel_type: explicit.funnel_type ?? fromTask.funnel_type,
    }
    if (!shouldEstimateProject(info)) return
    estimateProjectSchedule(list, { now, funnelType: info.funnel_type }).forEach((span, id) => all.set(id, span))
  })
  return all
}

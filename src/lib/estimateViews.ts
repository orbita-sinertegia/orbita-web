// Utilidades puras para mostrar los estimados de la hoja de ruta fuera del Gantt:
// rangos por fase, lanzamiento estimado y colocación en los calendarios.
// Los estimados se calculan en el navegador (roadmapEstimate.ts) y nunca se guardan.
import type { Department, Task } from '../types'
import { PHASES, type Phase, inferPhase } from '../data/projectTemplates'
import { estimateRoadmap, type EstimatedSpan, type EstimatePlanTask, type EstimateProjectInfo } from './roadmapEstimate'

export type EstimateMap = Map<string, EstimatedSpan>
export type EstimateProject = EstimateProjectInfo & { id: string }

/**
 * Junta las tareas visibles con las de contexto (mismos proyectos, solo para planear),
 * sin duplicados ni archivadas, y estima por proyecto.
 */
export function computeProjectEstimates(
  tasks: EstimatePlanTask[],
  contextTasks: EstimatePlanTask[] = [],
  projects: EstimateProject[] = [],
  now?: Date,
): EstimateMap {
  const seen = new Set<string>()
  const plan: EstimatePlanTask[] = []
  for (const task of [...tasks, ...contextTasks]) {
    if (!task || seen.has(task.id) || task.archived_at || !task.project_id) continue
    seen.add(task.id)
    plan.push(task)
  }
  const info: Record<string, EstimateProjectInfo> = {}
  projects.forEach(project => { if (project?.id) info[project.id] = { status: project.status, stage: project.stage, funnel_type: project.funnel_type } })
  return estimateRoadmap(plan, info, now)
}

type DatedTask = Pick<Task, 'id' | 'status' | 'commitment_date' | 'start_date' | 'completion_date'> & { archived_at?: string | null }

/** Una tarea se muestra como estimada si está pendiente, sin fecha de entrega y tiene estimado. */
export function isEstimatedTask(task: DatedTask, estimates: EstimateMap): boolean {
  return !task.archived_at && task.status !== 'completada' && !task.commitment_date && estimates.has(task.id)
}

export interface TaskRange { start: string; end: string; estimated: boolean }

/** Rango de una tarea: real (inicio/entrega) o estimado. null si no tiene ninguno. */
export function taskRange(task: DatedTask, estimates: EstimateMap): TaskRange | null {
  if (isEstimatedTask(task, estimates)) {
    const span = estimates.get(task.id)!
    return { start: span.start, end: span.end, estimated: true }
  }
  const start = (task.start_date || task.commitment_date || (task.status === 'completada' ? task.completion_date : null))?.slice(0, 10)
  const end = (task.commitment_date || (task.status === 'completada' ? task.completion_date : null) || task.start_date)?.slice(0, 10)
  if (!start || !end) return null
  return start <= end ? { start, end, estimated: false } : { start: end, end: start, estimated: false }
}

/**
 * Día en que la tarea aparece en un calendario por día: su fecha de entrega real o, si es
 * estimada, el último día de su rango estimado (la entrega aproximada).
 */
export function calendarDayOf(task: DatedTask, estimates: EstimateMap): { key: string; estimated: boolean } | null {
  if (task.commitment_date) return { key: task.commitment_date.slice(0, 10), estimated: false }
  if (isEstimatedTask(task, estimates)) return { key: estimates.get(task.id)!.end, estimated: true }
  return null
}

/** ¿El rango [start, end] toca el intervalo [from, to]? (claves 'YYYY-MM-DD') */
export function rangeOverlaps(range: Pick<TaskRange, 'start' | 'end'>, fromKey: string, toKey: string): boolean {
  return range.start <= toKey && range.end >= fromKey
}

export type DisplayPhaseKey = Exclude<Phase, 'produccion_video' | 'produccion_paginas'> | 'produccion'

export function displayPhaseOf(phase: Phase): DisplayPhaseKey {
  return phase === 'produccion_video' || phase === 'produccion_paginas' ? 'produccion' : phase
}

type PhaseRangeTask = DatedTask & Pick<Task, 'title' | 'department'> & { phase?: string | null }

function phaseOfTask(task: PhaseRangeTask): Phase {
  const stored = task.phase as Phase | null | undefined
  return stored && (PHASES as readonly string[]).includes(stored) ? stored : inferPhase(task.title, task.department as Department)
}

/**
 * Rango de fechas de cada fase (agrupando Producción) a partir de fechas reales y estimadas.
 * `estimated` es true si alguna tarea PENDIENTE de la fase depende de un estimado; si todas
 * las pendientes tienen fecha real (o la fase terminó), el rango es "sólido".
 */
export function phaseDateRanges(tasks: PhaseRangeTask[], estimates: EstimateMap): Partial<Record<DisplayPhaseKey, TaskRange>> {
  const result: Partial<Record<DisplayPhaseKey, TaskRange>> = {}
  tasks.filter(task => !task.archived_at).forEach(task => {
    const range = taskRange(task, estimates)
    if (!range) return
    const key = displayPhaseOf(phaseOfTask(task))
    const current = result[key]
    result[key] = current
      ? { start: range.start < current.start ? range.start : current.start, end: range.end > current.end ? range.end : current.end, estimated: current.estimated || range.estimated }
      : { ...range }
  })
  return result
}

/**
 * Lanzamiento estimado cuando el proyecto no tiene launch_date: fin de la fase Lanzamiento o,
 * si no hay tareas de lanzamiento, el fin más tardío de las fases previas (sin Optimización).
 * Solo se devuelve si algún estimado interviene (si todo es real, no se adivina).
 */
export function estimatedLaunchDate(
  project: { launch_date?: string | null },
  ranges: Partial<Record<DisplayPhaseKey, TaskRange>>,
): string | null {
  if (project.launch_date) return null
  const launch = ranges.lanzamiento
  if (launch) return launch.estimated ? launch.end : null
  const before = (['entrada', 'estrategia', 'guiones', 'produccion', 'revision'] as DisplayPhaseKey[])
    .map(key => ranges[key]).filter(Boolean) as TaskRange[]
  if (!before.some(range => range.estimated)) return null
  return before.reduce((max, range) => (range.end > max ? range.end : max), before[0].end)
}

import type { Department, Project, Task } from '../types'
import { PHASES, type Phase, inferPhase, WEBINAR_ONLY_TITLES } from '../data/projectTemplates'

export { PHASES, type Phase }

// Fases que se muestran agrupadas como "Producción" en la línea horizontal de la hoja de ruta.
export type DisplayPhase = Exclude<Phase, 'produccion_video' | 'produccion_paginas'> | 'produccion'

export const DISPLAY_PHASE_ORDER: DisplayPhase[] = [
  'entrada', 'estrategia', 'guiones', 'produccion', 'revision', 'lanzamiento', 'optimizacion',
]

export const DISPLAY_PHASE_LABELS: Record<DisplayPhase, string> = {
  entrada: 'Entrada',
  estrategia: 'Estrategia',
  guiones: 'Guiones',
  produccion: 'Producción',
  revision: 'Revisión',
  lanzamiento: 'Lanzamiento',
  optimizacion: 'Optimización',
}

// Quién responde por cada fase (solo para la vista interna; nunca se muestra al cliente).
export function phaseResponsibleLabel(phase: Phase, recordingMode: 'oficina' | 'remota' = 'oficina'): string {
  if (phase === 'produccion_video') return recordingMode === 'oficina' ? 'Grabación / Edición' : 'Cliente / Edición'
  const labels: Record<Phase, string> = {
    entrada: 'Líder', estrategia: 'Copy', guiones: 'Líder', produccion_video: '', produccion_paginas: 'Webmaster',
    revision: 'Líder', lanzamiento: 'Trafficker', optimizacion: 'Trafficker',
  }
  return labels[phase] || 'Equipo'
}

export type PhaseTask = Pick<Task, 'title' | 'department' | 'phase' | 'status' | 'review_status' | 'commitment_date'>

/** Una tarea está hecha solo si está completada y, si tuvo revisión, fue aprobada. */
export function isTaskDone(task: Pick<Task, 'status' | 'review_status'>): boolean {
  return task.status === 'completada' && (!task.review_status || task.review_status === 'aprobada')
}

export function effectivePhase(task: Pick<Task, 'title' | 'department' | 'phase'>): Phase {
  return (task.phase as Phase) || inferPhase(task.title, task.department as Department)
}

export interface PhaseStats { phase: Phase; total: number; done: number; pct: number }

export function phaseStats(tasks: PhaseTask[], phase: Phase): PhaseStats {
  const phaseTasks = tasks.filter(task => effectivePhase(task) === phase)
  const done = phaseTasks.filter(isTaskDone).length
  return { phase, total: phaseTasks.length, done, pct: phaseTasks.length ? Math.round((done / phaseTasks.length) * 100) : 100 }
}

export interface DisplayPhaseStats { phase: DisplayPhase; total: number; done: number; pct: number; lanes?: { produccion_video: PhaseStats; produccion_paginas: PhaseStats } }

export function displayPhaseStats(tasks: PhaseTask[], phase: DisplayPhase): DisplayPhaseStats {
  if (phase === 'produccion') {
    const video = phaseStats(tasks, 'produccion_video')
    const paginas = phaseStats(tasks, 'produccion_paginas')
    const total = video.total + paginas.total
    const done = video.done + paginas.done
    return { phase, total, done, pct: total ? Math.round((done / total) * 100) : 100, lanes: { produccion_video: video, produccion_paginas: paginas } }
  }
  const stats = phaseStats(tasks, phase)
  return { phase, total: stats.total, done: stats.done, pct: stats.pct }
}

/** La fase actual es la primera (en orden) que no está al 100%; si todas lo están, la última. */
export function currentDisplayPhase(tasks: PhaseTask[]): DisplayPhase {
  for (const phase of DISPLAY_PHASE_ORDER) {
    const stats = displayPhaseStats(tasks, phase)
    if (stats.total === 0) continue
    if (stats.pct < 100) return phase
  }
  return DISPLAY_PHASE_ORDER[DISPLAY_PHASE_ORDER.length - 1]
}

/** Avance general: promedio ponderado por número de tareas (equivalente a hechas/total). */
export function overallProgress(tasks: PhaseTask[]): number {
  if (!tasks.length) return 0
  const done = tasks.filter(isTaskDone).length
  return Math.round((done / tasks.length) * 100)
}

export interface DelayEventLike { responsible: 'cliente' | 'agencia'; days?: number | null }

export interface LaunchDelayBreakdown { totalDays: number; clientDays: number; agencyDays: number }

/** N (cliente) + M (agencia) siempre suma exactamente la diferencia entre fecha actual y original. */
export function launchDelayBreakdown(
  project: Pick<Project, 'launch_date' | 'launch_date_original'>,
  delayEvents: DelayEventLike[],
): LaunchDelayBreakdown {
  if (!project.launch_date || !project.launch_date_original) return { totalDays: 0, clientDays: 0, agencyDays: 0 }
  const totalDays = Math.max(0, Math.round((new Date(project.launch_date).getTime() - new Date(project.launch_date_original).getTime()) / 86400000))
  const clientDaysSum = delayEvents.filter(event => event.responsible === 'cliente').reduce((sum, event) => sum + (event.days || 0), 0)
  const clientDays = Math.min(Math.max(0, clientDaysSum), totalDays)
  return { totalDays, clientDays, agencyDays: totalDays - clientDays }
}

export type HealthStatus = 'atrasado' | 'en_riesgo' | 'en_tiempo'

export interface ProjectHealth extends LaunchDelayBreakdown {
  status: HealthStatus
  maxOverdueDays: number
}

function daysUntil(dateStr: string, today: Date): number {
  return Math.round((new Date(dateStr + 'T00:00:00').getTime() - new Date(today.toDateString()).getTime()) / 86400000)
}

/**
 * Semáforo del proyecto: refleja el estado sin importar de quién es la culpa.
 * El desglose cliente/agencia se calcula por separado y se muestra junto al semáforo.
 */
export function projectHealth(
  tasks: PhaseTask[],
  project: Pick<Project, 'launch_date' | 'launch_date_original'>,
  delayEvents: DelayEventLike[],
  today: Date = new Date(),
): ProjectHealth {
  const breakdown = launchDelayBreakdown(project, delayEvents)
  const launchLate = !!(project.launch_date && project.launch_date_original && project.launch_date > project.launch_date_original)
  const activeTasks = tasks.filter(task => task.status !== 'completada' && task.commitment_date)
  const overdueDays = activeTasks
    .map(task => -daysUntil(task.commitment_date as string, today))
    .filter(days => days > 0)
  const maxOverdueDays = overdueDays.length ? Math.max(...overdueDays) : 0

  if (launchLate || maxOverdueDays > 3) return { ...breakdown, status: 'atrasado', maxOverdueDays }
  if (maxOverdueDays >= 1) return { ...breakdown, status: 'en_riesgo', maxOverdueDays }

  const current = currentDisplayPhase(tasks)
  const dueSoonNotStarted = tasks.some(task => {
    if (task.status !== 'pendiente' || !task.commitment_date) return false
    if (current === 'produccion'
      ? !(effectivePhase(task) === 'produccion_video' || effectivePhase(task) === 'produccion_paginas')
      : effectivePhase(task) !== current) return false
    const diff = daysUntil(task.commitment_date, today)
    return diff >= 0 && diff <= 2
  })
  if (dueSoonNotStarted) return { ...breakdown, status: 'en_riesgo', maxOverdueDays }

  return { ...breakdown, status: 'en_tiempo', maxOverdueDays }
}

const HEALTH_RANK: Record<HealthStatus, number> = { atrasado: 0, en_riesgo: 1, en_tiempo: 2 }

/** Orden por riesgo: atrasado → en riesgo → en tiempo, y dentro de cada uno, más días de retraso primero. */
export function compareByRisk(a: { status: HealthStatus; totalDays: number }, b: { status: HealthStatus; totalDays: number }): number {
  return HEALTH_RANK[a.status] - HEALTH_RANK[b.status] || b.totalDays - a.totalDays
}

export interface Milestone {
  key: string
  label: string
  date?: string
  status: 'done' | 'current' | 'upcoming'
  detail?: string
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00')
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Hitos de la hoja de ruta, incluida la grabación con la modalidad y los hitos posteriores al lanzamiento. */
export function buildMilestones(project: Pick<Project, 'recording_mode' | 'launch_date'>, tasks: PhaseTask[]): Milestone[] {
  const modalidad = project.recording_mode || 'oficina'
  const doneOf = (phase: Phase) => { const stats = phaseStats(tasks, phase); return stats.total > 0 && stats.pct === 100 }
  const entradaDone = doneOf('entrada')
  const guionesDone = doneOf('guiones')
  const produccionDone = doneOf('produccion_video') && doneOf('produccion_paginas')
  const revisionDone = doneOf('revision')
  const launch = project.launch_date
  const launched = !!launch && new Date(launch + 'T00:00:00') <= new Date()

  const milestones: Milestone[] = [
    { key: 'kickoff', label: 'Kickoff', status: entradaDone ? 'done' : 'current' },
    { key: 'guiones', label: 'Aprobación de guiones', status: guionesDone ? 'done' : entradaDone ? 'current' : 'upcoming' },
    {
      key: 'grabacion',
      label: 'Grabación',
      detail: modalidad === 'oficina' ? 'Responsable: Grabación' : 'Responsable: Cliente',
      status: doneOf('produccion_video') ? 'done' : guionesDone ? 'current' : 'upcoming',
    },
    { key: 'aprobacion_final', label: 'Aprobación final', status: revisionDone ? 'done' : produccionDone ? 'current' : 'upcoming' },
    { key: 'lanzamiento', label: 'Lanzamiento', date: launch || undefined, status: launched ? 'done' : revisionDone ? 'current' : 'upcoming' },
  ]

  if (launch) {
    milestones.push({ key: 'reporte_72h', label: 'Reporte 72h', date: addDays(launch, 3), status: 'upcoming' })
    milestones.push({ key: 'nueva_tanda', label: 'Nueva tanda de creativos', date: addDays(launch, 14), status: 'upcoming' })
    milestones.push({ key: 'reunion_mensual', label: 'Reunión mensual', date: addDays(launch, 30), status: 'upcoming' })
  }

  return milestones
}

/** Heurística de plantilla para tarjetas de resumen: no hay columna que la guarde en projects. */
export function inferTemplateLabel(tasks: Pick<Task, 'title'>[]): string {
  if (tasks.some(task => WEBINAR_ONLY_TITLES.has(task.title))) return 'Webinar'
  if (tasks.length > 0) return 'VSL'
  return 'Personalizado'
}

export function dueLabel(commitmentDate: string, today: Date = new Date()): { text: string; late: boolean } {
  const start = new Date(today); start.setHours(0, 0, 0, 0)
  const due = new Date(commitmentDate + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - start.getTime()) / 86400000)
  if (diffDays < 0) return { text: `Vencida hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? '' : 's'}`, late: true }
  if (diffDays === 0) return { text: 'Vence hoy', late: false }
  return { text: `Vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`, late: false }
}

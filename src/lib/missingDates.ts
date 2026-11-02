import type { Project, Task } from '../types'
import { PHASES, effectivePhase, isTaskDone } from './roadmapPhases'

export type MissionTask = Pick<
  Task,
  'id' | 'title' | 'department' | 'status' | 'review_status' | 'commitment_date' |
  'assigned_to' | 'project_id' | 'phase' | 'created_at' | 'updated_at'
> & { project?: Pick<Project, 'status' | 'launch_date'> & Partial<Project> | null }

/** Una tarea es "misión sin fecha" si no está hecha (incluye en revisión/cambios solicitados), no tiene
 * fecha compromiso, no es del departamento cliente, y su proyecto no está terminado. */
export function isUndatedMission(task: MissionTask): boolean {
  if (task.department === 'cliente') return false
  if (task.commitment_date) return false
  if (isTaskDone(task)) return false
  if (task.project?.status === 'completado') return false
  return true
}

export function filterUndatedMissions<T extends MissionTask>(tasks: T[], userId: string): T[] {
  return tasks.filter(task => task.assigned_to === userId && isUndatedMission(task))
}

/**
 * Orden: primero el proyecto más avanzado/activo — se usa la fecha de lanzamiento más próxima como
 * proxy de avance (un proyecto con lanzamiento cercano está más adelantado en el embudo); los proyectos
 * sin fecha de lanzamiento van después, ordenados por actividad más reciente (updated_at máximo entre
 * sus misiones). Dentro de cada proyecto, por fase del embudo y luego por fecha de creación.
 */
export function orderMissions<T extends MissionTask>(missions: T[]): T[] {
  const lastActivityByProject = new Map<string, string>()
  for (const mission of missions) {
    const prev = lastActivityByProject.get(mission.project_id) || ''
    const current = mission.updated_at || ''
    if (current > prev) lastActivityByProject.set(mission.project_id, current)
  }

  const projectIds = [...new Set(missions.map(mission => mission.project_id))]
  const projectRank = new Map<string, number>()
  projectIds
    .map(id => {
      const sample = missions.find(mission => mission.project_id === id)!
      return { id, launchDate: sample.project?.launch_date || null, activity: lastActivityByProject.get(id) || '' }
    })
    .sort((a, b) => {
      if (a.launchDate && b.launchDate) return a.launchDate < b.launchDate ? -1 : a.launchDate > b.launchDate ? 1 : 0
      if (a.launchDate && !b.launchDate) return -1
      if (!a.launchDate && b.launchDate) return 1
      return a.activity > b.activity ? -1 : a.activity < b.activity ? 1 : 0
    })
    .forEach((entry, index) => projectRank.set(entry.id, index))

  return [...missions].sort((a, b) => {
    const rankDiff = (projectRank.get(a.project_id) ?? 0) - (projectRank.get(b.project_id) ?? 0)
    if (rankDiff !== 0) return rankDiff
    const phaseDiff = PHASES.indexOf(effectivePhase(a)) - PHASES.indexOf(effectivePhase(b))
    if (phaseDiff !== 0) return phaseDiff
    return (a.created_at || '').localeCompare(b.created_at || '')
  })
}

/** Compara claves de fecha "YYYY-MM-DD" (strings), sin necesidad de construir Date. */
export function isPastDate(dateKey: string, todayKey: string): boolean {
  return dateKey < todayKey
}

export function isAfterLaunch(dateKey: string, launchDate?: string | null): boolean {
  return !!launchDate && dateKey > launchDate
}

export interface ShouldShowMissingDatesModalArgs {
  role: 'admin' | 'team' | 'client'
  hasSessionToday: boolean
  checkInGateOpen: boolean
  skippedOn: string | null
  todayKey: string
  count: number
}

export function shouldShowMissingDatesModal(args: ShouldShowMissingDatesModalArgs): boolean {
  if (args.role !== 'team') return false
  if (!args.hasSessionToday) return false
  if (args.checkInGateOpen) return false
  if (args.count <= 0) return false
  if (args.skippedOn === args.todayKey) return false
  return true
}

export function countUndatedByAssignee(tasks: MissionTask[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (!task.assigned_to || !isUndatedMission(task)) continue
    counts.set(task.assigned_to, (counts.get(task.assigned_to) || 0) + 1)
  }
  return counts
}

// Estado de un proyecto (projects.status) y quién puede cambiarlo.
// En la base los valores siguen siendo activo / pausado / completado; en pantalla
// 'completado' se muestra como "Finalizado": el cliente ya no trabaja con la agencia.
import type { Project, Task, User } from '../types'

export type ProjectStatus = Project['status']

export const PROJECT_STATUSES: ProjectStatus[] = ['activo', 'pausado', 'completado']

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  activo: 'Activo',
  pausado: 'Pausado',
  completado: 'Finalizado',
}

export const PROJECT_STATUS_HINTS: Record<ProjectStatus, string> = {
  activo: 'Se trabaja normal y tiene fechas estimadas.',
  pausado: 'Sigue visible, pero sin fechas estimadas.',
  completado: 'El cliente ya no trabaja con nosotros. Tú eliges: archivar sus tareas pendientes (vuelven si lo reactivas) o eliminarlas para siempre. Realizadas y entregadas se conservan.',
}

export function projectStatusLabel(status: string | null | undefined): string {
  return (status && PROJECT_STATUS_LABELS[status as ProjectStatus]) || 'Activo'
}

/** Solo el super admin activo puede cambiar el estado de un proyecto (la base también lo exige). */
export function canChangeProjectStatus(user: Pick<User, 'is_super_admin' | 'active'> | null | undefined): boolean {
  return !!user?.is_super_admin && user.active !== false
}

/** Solo el super admin activo puede eliminar proyectos (la base también lo exige). */
export function canDeleteProjects(user: Pick<User, 'is_super_admin' | 'active'> | null | undefined): boolean {
  return canChangeProjectStatus(user)
}

/** Solo un administrador activo, o el super admin, puede borrar tareas definitivamente (la base también lo exige). */
export function canDeleteTasks(user: Pick<User, 'role' | 'is_super_admin' | 'active'> | null | undefined): boolean {
  return !!user && user.active !== false && (user.role === 'admin' || !!user.is_super_admin)
}

/** Aviso tras eliminar una tarea para siempre. */
export function taskDeletedNotice(title: string): string {
  return `Tarea “${title}” eliminada para siempre.`
}

/** Solo el super admin puede cambiar el estatus o la fecha de realización de una tarea desde "Editar tarea". */
export function canEditTaskStatus(user: Pick<User, 'is_super_admin' | 'active'> | null | undefined): boolean {
  return canChangeProjectStatus(user)
}

export function isFinalizedProject(project: Pick<Project, 'status'> | null | undefined): boolean {
  return project?.status === 'completado'
}

type StatusTask = Pick<Task, 'status'> & { project?: Pick<Project, 'status'> | null }

/**
 * Tarea "dormida": pendiente (no completada) en un proyecto finalizado. Se oculta por omisión de
 * las vistas activas. Las completadas se quedan como historial (métricas, hoja de ruta).
 */
export function isDormantTask(task: StatusTask): boolean {
  return task.status !== 'completada' && isFinalizedProject(task.project)
}

export function hideDormantTasks<T extends StatusTask>(tasks: T[], showFinalized = false): T[] {
  return showFinalized ? tasks : tasks.filter(task => !isDormantTask(task))
}

/** Orden para elegir proyecto por omisión: activos, luego pausados, al final finalizados. */
export function sortProjectsByStatus<T extends Pick<Project, 'status'>>(projects: T[]): T[] {
  const rank = (status: string) => (status === 'activo' ? 0 : status === 'pausado' ? 1 : 2)
  return [...projects].sort((a, b) => rank(a.status) - rank(b.status))
}

/**
 * Revisiones que cuentan como "entregada" (mismo criterio que Entregables del cliente:
 * en revisión o aprobada). 'cambios_solicitados' es retrabajo pendiente: no cuenta.
 */
export const DELIVERED_REVIEW_STATUSES = ['pendiente_revision', 'pendiente_trafficker', 'en_revision', 'aprobada'] as const

type KeepTask = Pick<Task, 'status'> & { review_status?: string | null }

/** Al finalizar un proyecto se conservan las realizadas y las entregadas (en revisión o aprobadas). */
export function isDeliveredTask(task: KeepTask): boolean {
  return task.status === 'completada' || (DELIVERED_REVIEW_STATUSES as readonly string[]).includes(task.review_status || '')
}

/** Tareas que se eliminarían para siempre al finalizar (pendientes y no entregadas, archivadas incluidas). */
export function tasksDeletedOnFinalize<T extends KeepTask>(tasks: T[]): T[] {
  return tasks.filter(task => !isDeliveredTask(task))
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export type FinalizeMode = 'archivar' | 'borrar'

/** Marca (tasks.archived_via) de las tareas archivadas al finalizar; se restauran al reactivar. */
export const FINALIZE_ARCHIVE_MARKER = 'proyecto_finalizado'

export interface FinalizeCounts {
  /** Pendientes no entregadas y sin archivar: las que se archivan (o se eliminan). */
  active: number
  /** Pendientes no entregadas que ya estaban archivadas: solo "Eliminar" las borra. */
  archived: number
}

type CountTask = KeepTask & { archived_at?: string | null }

export function finalizeCounts(tasks: CountTask[]): FinalizeCounts {
  const pending = tasksDeletedOnFinalize(tasks)
  return {
    active: pending.filter(task => !task.archived_at).length,
    archived: pending.filter(task => !!task.archived_at).length,
  }
}

/** Texto del diálogo de Finalizado. counts null = todavía contando. */
export function finalizeChoiceText(counts: FinalizeCounts | null): string {
  if (!counts) return 'Contando tareas pendientes…'
  if (counts.active === 0 && counts.archived === 0) return 'No hay tareas pendientes. Las realizadas y entregadas se conservan.'
  const extra = counts.archived ? ` (y ${counts.archived} ${plural(counts.archived, 'pendiente ya archivada', 'pendientes ya archivadas')})` : ''
  return `Este proyecto tiene ${counts.active} ${plural(counts.active, 'tarea pendiente', 'tareas pendientes')}${extra}. Las realizadas y las entregadas (en revisión o aprobadas) se conservan siempre. ¿Qué hacemos con las pendientes?`
}

/** Texto de la segunda confirmación de "Eliminar para siempre". */
export function finalizeDeleteWarning(counts: FinalizeCounts): string {
  const total = counts.active + counts.archived
  return `Se ${plural(total, 'eliminará', 'eliminarán')} para siempre ${total} ${plural(total, 'tarea', 'tareas')} (con sus comentarios, enlaces, subtareas y tiempos). Esto no se puede deshacer y reactivar el proyecto no las recupera.`
}

/** Aviso tras finalizar con el conteo que devuelve finalize_project. */
export function finalizeResultNotice(mode: FinalizeMode, count: number | null): string {
  if (count === null) return 'Proyecto finalizado.'
  if (count === 0) return 'Proyecto finalizado. No había tareas pendientes.'
  return mode === 'archivar'
    ? `Proyecto finalizado. Se ${plural(count, 'archivó', 'archivaron')} ${count} ${plural(count, 'tarea pendiente', 'tareas pendientes')}; vuelven si lo reactivas.`
    : `Proyecto finalizado. Se ${plural(count, 'eliminó', 'eliminaron')} para siempre ${count} ${plural(count, 'tarea pendiente', 'tareas pendientes')}.`
}

/** Aviso al reactivar un proyecto finalizado. restored null = no se pudo contar. */
export function reactivateNotice(restored: number | null): string {
  if (restored === null) return 'Proyecto reactivado.'
  if (restored === 0) return 'Proyecto reactivado. No había tareas archivadas al finalizar.'
  return `Proyecto reactivado. Se ${plural(restored, 'restauró', 'restauraron')} ${restored} ${plural(restored, 'tarea', 'tareas')} que se ${plural(restored, 'había', 'habían')} archivado al finalizar.`
}

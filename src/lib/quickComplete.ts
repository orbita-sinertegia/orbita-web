/**
 * TEMPORAL — "palomita verde" para marcar tareas como realizadas de un clic (solo super admin).
 * Tony la pidió solo por estos días, mientras se pone al día la aplicación.
 * Para quitarla: poner ENABLE_QUICK_COMPLETE en false (o borrar este archivo y sus usos:
 * buscar "ENABLE_QUICK_COMPLETE" / "quickComplete").
 * Usa la misma RPC que el editor de estatus del super admin (super_admin_set_task_status),
 * así la auditoría queda igual.
 */
import type { Task, User } from '../types'
import { canChangeProjectStatus } from './projectStatus'

export const ENABLE_QUICK_COMPLETE = true

type Editor = Pick<User, 'is_super_admin' | 'active'> | null | undefined

/** ¿Mostrar la palomita para esta tarea? Solo super admin, no realizadas ni archivadas. */
export function canQuickComplete(user: Editor, task: Pick<Task, 'status' | 'archived_at'>, enabled = ENABLE_QUICK_COMPLETE): boolean {
  return enabled && canChangeProjectStatus(user) && task.status !== 'completada' && !task.archived_at
}

/** ¿Mostrar "Marcar realizadas" en la barra de selección? */
export function canBulkQuickComplete(user: Editor, enabled = ENABLE_QUICK_COMPLETE): boolean {
  return enabled && canChangeProjectStatus(user)
}

/** Fecha de realización null → la base pone hoy (CDMX). */
export function quickCompleteArgs(taskId: string) {
  return { p_task_id: taskId, p_status: 'completada', p_completion_date: null }
}

/** Deshacer: regresa al estatus anterior (la base limpia la fecha de realización). */
export function undoQuickCompleteArgs(taskId: string, previousStatus: Task['status']) {
  return { p_task_id: taskId, p_status: previousStatus === 'completada' ? 'pendiente' : previousStatus, p_completion_date: null }
}

export interface QuickCompleteUndo { taskId: string; title: string; previousStatus: Task['status'] }

export function quickCompleteNotice(title: string): string {
  return `“${title}” marcada como realizada.`
}

export function quickUndoNotice(title: string): string {
  return `Se deshizo: “${title}” volvió a su estatus anterior.`
}

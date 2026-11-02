import type { Task } from '../types'

type DelayTask = Pick<Task, 'department' | 'commitment_date' | 'status' | 'delay_responsible' | 'completion_date'>

export function isOverdue(task: Pick<Task, 'commitment_date' | 'status'>, today: Date = new Date()): boolean {
  return !!task.commitment_date && task.status !== 'completada' && new Date(task.commitment_date) < today
}

/**
 * Retraso atribuible al cliente: una marca explícita manda; si no hay marca,
 * solo las tareas del departamento cliente vencidas cuentan como suyas — una tarea
 * de Grabación vencida sin marca es responsabilidad de la agencia por default.
 */
export function isClientAttributableDelay(task: DelayTask, today: Date = new Date()): boolean {
  if (task.delay_responsible === 'cliente') return true
  if (task.delay_responsible === 'agencia') return false
  return task.department === 'cliente' && isOverdue(task, today)
}

export function delayDaysFor(task: DelayTask, today: Date = new Date()): number {
  if (!task.commitment_date) return 0
  const end = task.completion_date ? new Date(task.completion_date) : today
  const start = new Date(task.commitment_date)
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000))
}

/** Excluye del scorecard del equipo las tareas del cliente y los retrasos ya atribuidos al cliente. */
export function countsForTeamOnTimeMetric(task: Pick<Task, 'department' | 'delay_responsible'>): boolean {
  return task.department !== 'cliente' && task.delay_responsible !== 'cliente'
}

export function wasDeliveredOnTime(task: Pick<Task, 'commitment_date' | 'completion_date'>): boolean {
  if (!task.commitment_date || !task.completion_date) return false
  return task.completion_date <= task.commitment_date
}

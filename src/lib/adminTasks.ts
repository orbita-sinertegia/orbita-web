import type { Task } from '../types'

export type TaskFormValues = {
  title: string
  description: string
  assigned_to: string
  department: Task['department']
  priority: Task['priority']
  phase: string
  start_date: string
  needed_date: string
  commitment_date: string
  approver_ids: string[]
  depends_on_task_id: string
  project_id: string
}

export type TaskChangeValue = string | string[] | null
export type TaskChanges = Partial<Record<keyof TaskFormValues, TaskChangeValue>>

const EDITABLE_FIELDS: (keyof TaskFormValues)[] = [
  'title', 'description', 'assigned_to', 'department', 'priority', 'phase',
  'start_date', 'needed_date', 'commitment_date', 'approver_ids',
  'depends_on_task_id', 'project_id',
]

// Campos que en la base son nulleables: un valor vacío en el formulario significa "quitar
// el dato", no la cadena vacía (que admin_update_task guardaría tal cual).
const NULLABLE_ON_EMPTY = new Set<keyof TaskFormValues>([
  'description', 'phase', 'start_date', 'needed_date', 'commitment_date', 'depends_on_task_id',
])

export function isArchived(task: Pick<Task, 'archived_at'>): boolean {
  return !!task.archived_at
}

export function excludeArchived<T extends Pick<Task, 'archived_at'>>(tasks: T[]): T[] {
  return tasks.filter(task => !isArchived(task))
}

/** Solo los campos que cambiaron respecto a `original`, listos para admin_update_task. */
export function buildTaskChanges(original: Task, form: TaskFormValues): TaskChanges {
  const changes: TaskChanges = {}
  for (const key of EDITABLE_FIELDS) {
    const rawNext = form[key]
    const next: TaskChangeValue = Array.isArray(rawNext)
      ? rawNext
      : (NULLABLE_ON_EMPTY.has(key) && rawNext.trim() === '' ? null : rawNext)
    const rawPrev = (original as unknown as Record<string, unknown>)[key]
    const prev: TaskChangeValue = Array.isArray(rawPrev) ? (rawPrev as string[]) : ((rawPrev as string | null | undefined) ?? null)
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      changes[key] = next
    }
  }
  return changes
}

export type TaskStatusValue = Task['status']

export interface TaskStatusChange {
  p_status: TaskStatusValue
  p_completion_date: string | null
}

/**
 * Cambio de estatus / fecha de realización (solo super admin, vía super_admin_set_task_status).
 * null si no cambió nada. Al reabrir (dejar de estar completada) la fecha se limpia; al marcar
 * completada sin fecha, el servidor pone la de hoy (CDMX).
 */
export function buildStatusChange(
  original: Pick<Task, 'status' | 'completion_date'>,
  status: TaskStatusValue,
  completionDate: string,
): TaskStatusChange | null {
  const nextDate = status === 'completada' ? (completionDate.trim() ? completionDate.trim().slice(0, 10) : null) : null
  const prevDate = original.status === 'completada' ? (original.completion_date ? original.completion_date.slice(0, 10) : null) : null
  if (status === original.status && (status !== 'completada' || nextDate === prevDate || nextDate === null)) return null
  return { p_status: status, p_completion_date: nextDate }
}

const PASSTHROUGH_PATTERNS = [
  /solo (los )?administradores/i,
  /solo un administrador/i,
  /campo no permitido/i,
  /departamento cliente/i,
  /no tiene usuario/i,
  /no puede depender de/i,
  /ya está archivada/i,
  /no está archivada/i,
  /solo se pueden eliminar/i,
  /no se puede editar una tarea archivada/i,
  /la tarea no existe/i,
  /el título no puede estar vacío/i,
  /no se puede deshacer/i,
  /solo el super admin/i,
  /estatus no válido/i,
]

/** Traduce errores de admin_update_task/admin_archive_task/etc. a español claro. Los
 * mensajes que ya vienen en español claro (los que nosotros mismos escribimos con `raise
 * exception`) se muestran tal cual; solo se reemplazan los mensajes técnicos de
 * Postgres/PostgREST por uno genérico. */
export function friendlyTaskError(message: string | null | undefined): string {
  const raw = (message || '').trim()
  if (!raw) return 'No se pudo completar la acción. Intenta de nuevo.'
  if (PASSTHROUGH_PATTERNS.some(pattern => pattern.test(raw))) return raw
  if (/could not find the function|function .* does not exist/i.test(raw)) {
    return 'Esta opción necesita actualizar la base de datos (falta correr el SQL más reciente).'
  }
  if (/^(new row|duplicate key|violates|permission denied for|invalid input syntax)/i.test(raw)) {
    return 'No se pudo guardar el cambio. Verifica los datos e intenta de nuevo.'
  }
  return raw
}

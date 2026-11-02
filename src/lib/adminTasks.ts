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

/**
 * Confirmación de borrado definitivo: exige escribir el título EXACTO (sensible a
 * mayúsculas) salvo espacios al inicio/fin, para que copiar y pegar siga funcionando pero
 * no se pueda confirmar "a ciegas" con cualquier texto parecido.
 */
export function canConfirmPermanentDelete(input: string, title: string): boolean {
  const normalizedInput = input.trim()
  return normalizedInput.length > 0 && normalizedInput === title.trim()
}

const PASSTHROUGH_PATTERNS = [
  /solo (los )?administradores/i,
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
]

/** Traduce errores de admin_update_task/admin_archive_task/etc. a español claro. Los
 * mensajes que ya vienen en español claro (los que nosotros mismos escribimos con `raise
 * exception`) se muestran tal cual; solo se reemplazan los mensajes técnicos de
 * Postgres/PostgREST por uno genérico. */
export function friendlyTaskError(message: string | null | undefined): string {
  const raw = (message || '').trim()
  if (!raw) return 'No se pudo completar la acción. Intenta de nuevo.'
  if (PASSTHROUGH_PATTERNS.some(pattern => pattern.test(raw))) return raw
  if (/^(new row|duplicate key|violates|permission denied for|invalid input syntax)/i.test(raw)) {
    return 'No se pudo guardar el cambio. Verifica los datos e intenta de nuevo.'
  }
  return raw
}

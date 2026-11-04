/**
 * Selección múltiple de tareas (casillas junto al nombre) y acciones masivas:
 * archivar, reasignar y fecha "La necesito para" (admins), eliminar para siempre y marcar
 * realizadas (solo super admin).
 * Funciones puras para poder probarlas sin React.
 */

export type BulkTaskAction = 'archivar' | 'eliminar' | 'completar' | 'reasignar' | 'necesito'
export type SelectAllState = 'none' | 'some' | 'all'

export interface BulkTaskRef {
  id: string
  title: string
  // Opcionales: solo los usan reasignar / fecha para saber qué saltar.
  department?: string | null
  status?: string | null
  assigned_to?: string | null
  needed_date?: string | null
}
export interface BulkFailure extends BulkTaskRef { error: string }
export interface BulkResult { action: BulkTaskAction; okIds: string[]; failed: BulkFailure[]; skipped?: BulkFailure[] }

export interface BulkTarget {
  /** Reasignar: id de la persona nueva. */
  assigneeId?: string
  /** Fecha "La necesito para": 'YYYY-MM-DD', o '' para quitarla. */
  neededDate?: string
  /** Solo el super admin edita tareas ya realizadas (misma regla que la edición en línea). */
  canEditCompleted?: boolean
}

/** Motivo para saltar una tarea en reasignar / fecha ('' = se procesa). */
export function bulkSkipReason(action: BulkTaskAction, task: BulkTaskRef, target: BulkTarget = {}): string {
  if (action !== 'reasignar' && action !== 'necesito') return ''
  if (task.status === 'completada' && !target.canEditCompleted) return 'Ya está realizada: solo el super admin la edita.'
  if (action === 'reasignar') {
    if (task.department === 'cliente') return 'Es tarea del cliente: siempre la tiene el usuario cliente del proyecto.'
    if (target.assigneeId && task.assigned_to === target.assigneeId) return 'Ya estaba asignada a esa persona.'
    return ''
  }
  const next = (target.neededDate || '').slice(0, 10)
  const prev = (task.needed_date || '').slice(0, 10)
  if (next === prev) return next ? 'Ya tenía esa fecha.' : 'No tenía fecha.'
  return ''
}

/** Cambios para admin_update_task (la misma RPC del lápiz: dispara las notificaciones de reasignación). */
export function bulkUpdateChanges(action: BulkTaskAction, target: BulkTarget): Record<string, string | null> | null {
  if (action === 'reasignar') return target.assigneeId ? { assigned_to: target.assigneeId } : null
  if (action === 'necesito') return { needed_date: target.neededDate ? target.neededDate.slice(0, 10) : null }
  return null
}

/** Marca o desmarca una tarea. */
export function toggleSelected(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]
}

/** Solo cuentan las seleccionadas que siguen visibles (filtros, tareas ya borradas o archivadas). */
export function visibleSelection(selected: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds)
  return selected.filter(id => visible.has(id))
}

/** Estado de la casilla "seleccionar todas": vacía, a medias (indeterminada) o llena. */
export function selectAllState(selected: string[], visibleIds: string[]): SelectAllState {
  if (!visibleIds.length) return 'none'
  const count = visibleSelection(selected, visibleIds).length
  if (count === 0) return 'none'
  return count === visibleIds.length ? 'all' : 'some'
}

/** Clic en "seleccionar todas": si ya están todas las visibles, las quita; si no, las agrega. */
export function toggleSelectAll(selected: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds)
  if (selectAllState(selected, visibleIds) === 'all') return selected.filter(id => !visible.has(id))
  return [...selected.filter(id => !visible.has(id)), ...visibleIds]
}

export function selectedCountLabel(count: number): string {
  return count === 1 ? '1 seleccionada' : `${count} seleccionadas`
}

function plural(count: number): string {
  return count === 1 ? '1 tarea' : `${count} tareas`
}

/** Texto del diálogo de confirmación. */
export function bulkConfirmText(action: BulkTaskAction, count: number): string {
  if (action === 'eliminar') return `Se eliminarán para siempre ${plural(count)}, con sus comentarios, enlaces, subtareas, tiempos y calificaciones. Esta acción es permanente y no se puede deshacer.`
  if (action === 'completar') return `Se marcarán ${plural(count)} como realizadas, con fecha de realización de hoy. Las que ya estaban realizadas se quedan igual.`
  if (action === 'reasignar') return `Se reasignarán ${plural(count)} a la persona que elijas. Cada quien recibe su aviso. Las tareas del cliente se saltan.`
  if (action === 'necesito') return `Se cambiará la fecha "La necesito para" de ${plural(count)}.`
  return `Se moverán ${plural(count)} a Archivadas. Puedes restaurarlas después.`
}

/** Aviso final (también cuando algunas fallan). */
export function bulkResultNotice(result: BulkResult): string {
  const ok = result.okIds.length
  const failed = result.failed.length
  const skipped = result.skipped?.length || 0
  const verb = result.action === 'eliminar' ? (ok === 1 ? 'eliminada para siempre' : 'eliminadas para siempre')
    : result.action === 'completar' ? (ok === 1 ? 'marcada como realizada' : 'marcadas como realizadas')
      : result.action === 'reasignar' ? (ok === 1 ? 'reasignada' : 'reasignadas')
        : result.action === 'necesito' ? 'con fecha actualizada'
          : (ok === 1 ? 'archivada' : 'archivadas')
  const skippedText = skipped ? ` Se ${skipped === 1 ? 'saltó' : 'saltaron'} ${plural(skipped)}.` : ''
  if (!failed) return ok || !skipped ? `${plural(ok)} ${verb}.${skippedText}` : `No hubo cambios.${skippedText}`
  const failVerb = result.action === 'eliminar' ? 'eliminar' : result.action === 'completar' ? 'marcar como realizada'
    : result.action === 'reasignar' ? 'reasignar' : result.action === 'necesito' ? 'cambiar la fecha de' : 'archivar'
  if (!ok) return `No se pudo ${failVerb} ninguna de las ${plural(failed)}.${skippedText}`
  return `${plural(ok)} ${verb}. No se pudo ${failVerb} ${plural(failed)}.${skippedText}`
}

/**
 * Corre la acción tarea por tarea (en orden, sin paralelo) y junta los errores.
 * `run` devuelve '' si salió bien o el mensaje de error.
 */
export async function runBulk(
  action: BulkTaskAction,
  tasks: BulkTaskRef[],
  run: (task: BulkTaskRef) => Promise<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult> {
  const okIds: string[] = []
  const failed: BulkFailure[] = []
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    let error: string
    try {
      error = await run(task)
    } catch (thrown) {
      const message = (thrown as { message?: unknown } | null)?.message
      error = typeof message === 'string' && message ? message : String(thrown || 'Error desconocido')
    }
    if (error) failed.push({ ...task, error })
    else okIds.push(task.id)
    onProgress?.(i + 1, tasks.length)
  }
  return { action, okIds, failed }
}

import { useState } from 'react'
import { CalendarDays, CheckCircle2, Trash2, UserRoundPen, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { friendlyTaskError } from '../../lib/adminTasks'
import { quickCompleteArgs } from '../../lib/quickComplete'
import { bulkConfirmText, bulkResultNotice, bulkSkipReason, bulkUpdateChanges, runBulk, type BulkFailure, type BulkResult, type BulkTaskAction, type BulkTaskRef } from '../../lib/taskSelection'

interface Props {
  action: BulkTaskAction
  tasks: BulkTaskRef[]
  onClose: () => void
  /** Se llama al terminar (todas bien, o después de leer qué falló / qué se saltó). */
  onDone: (result: BulkResult) => void
  /** Reasignar: personas activas para elegir. */
  members?: { id: string; full_name: string }[]
  /** Solo el super admin edita tareas realizadas al reasignar o cambiar la fecha. */
  canEditCompleted?: boolean
}

/**
 * Acciones en lote (selección múltiple), una tarea a la vez, con avance y fallas parciales.
 * Reasignar / Fecha "La necesito para": RPC admin_update_task (la misma del lápiz → avisos de reasignación).
 * Eliminar: RPC super_admin_delete_task (solo administradores; la base también lo exige).
 * Completar (TEMPORAL, ENABLE_QUICK_COMPLETE): RPC super_admin_set_task_status (solo super admin).
 */
const ACTION_UI = {
  eliminar: { verb: 'Eliminar', running: 'Eliminando', header: 'border-red-100 bg-gradient-to-r from-red-50 to-orange-50', badge: 'bg-red-100 text-red-600', button: 'bg-red-600 hover:bg-red-700', Icon: Trash2 },
  completar: { verb: 'Marcar como realizadas', running: 'Marcando', header: 'border-emerald-100 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-600', button: 'bg-emerald-600 hover:bg-emerald-700', Icon: CheckCircle2 },
  reasignar: { verb: 'Reasignar', running: 'Reasignando', header: 'border-blue-100 bg-blue-50', badge: 'bg-blue-100 text-blue-600', button: 'bg-blue-600 hover:bg-blue-700', Icon: UserRoundPen },
  necesito: { verb: 'Cambiar fecha de', running: 'Guardando', header: 'border-orange-100 bg-orange-50', badge: 'bg-orange-100 text-orange-600', button: 'bg-orange-600 hover:bg-orange-700', Icon: CalendarDays },
} as const

const plural = (count: number) => (count === 1 ? '1 tarea' : `${count} tareas`)

export default function BulkTaskActionModal({ action, tasks, onClose, onDone, members = [], canEditCompleted = false }: Props) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [assigneeId, setAssigneeId] = useState('')
  const [neededDate, setNeededDate] = useState('')
  const [clearDate, setClearDate] = useState(false)
  const isDelete = action === 'eliminar'
  const isUpdate = action === 'reasignar' || action === 'necesito'
  const ui = ACTION_UI[action]
  const count = tasks.length
  const target = { assigneeId, neededDate: clearDate ? '' : neededDate, canEditCompleted }
  const missingInput = (action === 'reasignar' && !assigneeId) || (action === 'necesito' && !clearDate && !neededDate)
  // Sin persona/fecha elegida aún, solo se marcan los saltos que no dependen de la elección (cliente, realizadas).
  const skipReason = (task: BulkTaskRef) => {
    const reason = bulkSkipReason(action, task, target)
    return missingInput && /^(Ya estaba|Ya tenía|No tenía)/.test(reason) ? '' : reason
  }
  const skippedPreview: BulkFailure[] = isUpdate
    ? tasks.map(task => ({ ...task, error: skipReason(task) })).filter(item => item.error)
    : []
  const toRun = isUpdate ? tasks.filter(task => !skippedPreview.some(item => item.id === task.id)) : tasks

  async function confirm() {
    if (running || result || !count || missingInput) return
    setRunning(true)
    setProgress(0)
    const changes = bulkUpdateChanges(action, target)
    const skipped = skippedPreview
    const outcome = await runBulk(action, toRun, async task => {
      if (isUpdate) {
        const { error } = await supabase.rpc('admin_update_task', { p_task_id: task.id, p_changes: changes })
        return error ? friendlyTaskError(error.message) : ''
      }
      if (action === 'completar') {
        const { error } = await supabase.rpc('super_admin_set_task_status', quickCompleteArgs(task.id))
        return error ? friendlyTaskError(error.message) : ''
      }
      const { data, error } = await supabase.rpc('super_admin_delete_task', { p_task_id: task.id })
      if (error) return friendlyTaskError(error.message)
      return data === task.id ? '' : 'No se confirmó el borrado.'
    }, done => setProgress(done))
    const full: BulkResult = isUpdate ? { ...outcome, skipped } : outcome
    setRunning(false)
    if (!full.failed.length && !(full.skipped?.length)) {
      onDone(full)
      return
    }
    setResult(full)
  }

  function close() {
    if (running) return
    if (result) onDone(result)
    else onClose()
  }

  const title = action === 'completar'
    ? `Marcar ${plural(count)} como realizadas`
    : action === 'necesito' ? `Fecha "La necesito para" de ${plural(count)}`
      : `${ui.verb} ${plural(count)}`
  const Icon = ui.Icon
  const runCount = toRun.length
  const confirmLabel = isDelete ? `Sí, eliminar ${count} para siempre`
    : action === 'completar' ? `Marcar ${count} como realizadas`
      : action === 'reasignar' ? `Reasignar ${runCount}`
        : clearDate ? `Quitar fecha a ${runCount}` : `Guardar fecha en ${runCount}`
  const hasFailures = !!result?.failed.length

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => {
      if (event.target === event.currentTarget) close()
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="bulk-task-title" aria-describedby="bulk-task-description"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className={`flex items-start justify-between border-b px-6 py-5 ${ui.header}`}>
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ui.badge}`}><Icon size={19} /></div>
            <div>
              <h2 id="bulk-task-title" className="text-lg font-bold text-gray-900">{title}</h2>
              {isDelete && <p className="mt-1 text-sm text-gray-600">Esta acción es permanente y no se puede deshacer.</p>}
            </div>
          </div>
          <button type="button" aria-label="Cerrar" onClick={close} disabled={running} className="text-gray-400 hover:text-gray-600 disabled:opacity-50"><X size={20} /></button>
        </div>

        <div className="px-6 py-5">
          {!result ? (
            <>
              <p id="bulk-task-description" className="text-sm leading-6 text-gray-600">{bulkConfirmText(action, count)}</p>

              {action === 'reasignar' && (
                <div className="mt-4">
                  <label htmlFor="bulk-assignee" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Asignar a</label>
                  <select id="bulk-assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} disabled={running}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Selecciona persona</option>
                    {members.map(member => <option key={member.id} value={member.id}>{member.full_name}</option>)}
                  </select>
                </div>
              )}

              {action === 'necesito' && (
                <div className="mt-4 space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="radio" name="bulk-needed-mode" checked={!clearDate} onChange={() => setClearDate(false)} disabled={running} /> Poner fecha
                  </label>
                  <input type="date" aria-label='Fecha "La necesito para"' value={neededDate} onChange={e => { setNeededDate(e.target.value); setClearDate(false) }} disabled={running || clearDate}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="radio" name="bulk-needed-mode" checked={clearDate} onChange={() => setClearDate(true)} disabled={running} /> Quitar la fecha
                  </label>
                </div>
              )}

              <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                {tasks.map(task => {
                  const skip = skippedPreview.find(item => item.id === task.id)
                  return <li key={task.id} className={`truncate ${skip ? 'text-gray-400 line-through' : ''}`} title={skip?.error}>• {task.title}</li>
                })}
              </ul>
              {skippedPreview.length > 0 && (
                <p className="mt-2 text-xs font-medium text-amber-700">{`Se ${skippedPreview.length === 1 ? 'saltará' : 'saltarán'} ${plural(skippedPreview.length)} (tachadas; pasa el cursor para ver el motivo).`}</p>
              )}

              {running && <p role="status" className="mt-4 text-sm font-semibold text-gray-700">{ui.running} {progress} de {isUpdate ? runCount : count}...</p>}
            </>
          ) : (
            <div role="alert" className={`rounded-lg border px-4 py-3 text-sm ${hasFailures ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <p id="bulk-task-description" className="font-semibold">{bulkResultNotice(result)}</p>
              {hasFailures && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                  {result.failed.map(item => <li key={item.id}><b>“{item.title}”</b>: {item.error}</li>)}
                </ul>
              )}
              {!!result.skipped?.length && (
                <>
                  <p className="mt-2 text-xs font-semibold">Se saltaron:</p>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-xs">
                    {result.skipped.map(item => <li key={item.id}><b>“{item.title}”</b>: {item.error}</li>)}
                  </ul>
                </>
              )}
              {hasFailures && <p className="mt-2 text-xs text-red-600">Las que fallaron se quedan seleccionadas para que lo intentes de nuevo.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:justify-end">
          {!result ? (
            <>
              <button type="button" onClick={onClose} disabled={running}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={confirm} disabled={running || !count || missingInput || (isUpdate && runCount === 0)}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${ui.button}`}>
                <Icon size={16} /> {running ? `${ui.running}...` : confirmLabel}
              </button>
            </>
          ) : (
            <button type="button" onClick={close}
              className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800">
              Entendido
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

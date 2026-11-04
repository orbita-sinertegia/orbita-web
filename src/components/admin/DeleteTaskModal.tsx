import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task } from '../../types'
import { friendlyTaskError } from '../../lib/adminTasks'

interface Props {
  task: Pick<Task, 'id' | 'title'>
  onClose: () => void
  /** Se llama solo cuando la base confirmó el borrado. */
  onDeleted: (title: string) => void
}

/**
 * Eliminar una tarea para siempre (solo super admin, RPC super_admin_delete_task).
 * Funciona también con tareas sin archivar. Queda una foto en task_audit_log.
 */
export default function DeleteTaskModal({ task, onClose, onDeleted }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirmDelete() {
    if (saving) return
    setSaving(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('super_admin_delete_task', { p_task_id: task.id })
    setSaving(false)
    if (rpcError || data !== task.id) {
      setError(rpcError ? friendlyTaskError(rpcError.message) : 'No se confirmó el borrado. Intenta de nuevo.')
      return
    }
    onDeleted(task.title)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving) onClose()
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-description"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-red-100 bg-gradient-to-r from-red-50 to-orange-50 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600"><Trash2 size={19} /></div>
            <div>
              <h2 id="delete-task-title" className="text-lg font-bold text-gray-900">Eliminar tarea</h2>
              <p className="mt-1 text-sm text-gray-600">Esta acción es permanente y no se puede deshacer.</p>
            </div>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={saving} className="text-gray-400 hover:text-gray-600 disabled:opacity-50"><X size={20} /></button>
        </div>
        <div className="px-6 py-5">
          <p id="delete-task-description" className="text-sm leading-6 text-gray-600">
            Se eliminará para siempre <span className="font-bold text-gray-900">“{task.title}”</span>, con sus comentarios, enlaces, subtareas, tiempos y calificaciones. No se puede deshacer.
          </p>
          <p className="mt-3 text-xs text-gray-500">Si solo quieres quitarla de las listas, mejor archívala: se puede recuperar.</p>
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={confirmDelete} disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60">
            <Trash2 size={16} /> {saving ? 'Eliminando...' : 'Sí, eliminar para siempre'}
          </button>
        </div>
      </div>
    </div>
  )
}

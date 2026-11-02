import { useState } from 'react'
import { Archive, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task } from '../../types'
import { friendlyTaskError } from '../../lib/adminTasks'

interface Props {
  task: Task
  onClose: () => void
  onArchived: (updatedTask: Task) => void
}

export default function ArchiveTaskModal({ task, onClose, onArchived }: Props) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirmArchive() {
    setSaving(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('admin_archive_task', {
      p_task_id: task.id,
      p_reason: reason.trim() || null,
    })
    setSaving(false)
    if (rpcError) {
      setError(friendlyTaskError(rpcError.message))
      return
    }
    onArchived(data as Task)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Archive size={18} className="text-amber-600" /> Archivar tarea
          </h3>
          <button type="button" onClick={onClose} disabled={saving} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            La misión <span className="font-semibold text-gray-900">“{task.title}”</span> se moverá a Archivadas.
            Puedes restaurarla después.
          </p>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Motivo (opcional)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Ej: proyecto cancelado, tarea duplicada..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && <p role="alert" className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmArchive}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-60"
            >
              <Archive size={15} /> {saving ? 'Archivando...' : 'Archivar tarea'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

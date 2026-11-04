import { Archive, CalendarDays, CheckCircle2, Trash2, UserRoundPen, X } from 'lucide-react'
import { selectedCountLabel, type SelectAllState } from '../../lib/taskSelection'

/** Casilla con estado "a medias" (indeterminado) para seleccionar tareas. */
export function TaskCheckbox({ state, onToggle, label }: { state: SelectAllState | boolean; onToggle: () => void; label: string }) {
  const checked = state === true || state === 'all'
  const mixed = state === 'some'
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      title={label}
      ref={el => { if (el) el.indeterminate = mixed }}
      onChange={onToggle}
      onClick={event => event.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-blue-600"
    />
  )
}

interface BarProps {
  count: number
  canArchive: boolean
  canDelete: boolean
  onArchive: () => void
  onDelete: () => void
  onClear: () => void
  /** TEMPORAL (ENABLE_QUICK_COMPLETE): "Marcar realizadas", solo super admin. */
  canComplete?: boolean
  onComplete?: () => void
  /** Reasignar y fecha "La necesito para" en lote (admins y super admin). */
  canEdit?: boolean
  onReassign?: () => void
  onSetNeeded?: () => void
}

/** Barra de acciones cuando hay 1+ tareas seleccionadas. */
export default function TaskSelectionBar({ count, canArchive, canDelete, onArchive, onDelete, onClear, canComplete = false, onComplete, canEdit = false, onReassign, onSetNeeded }: BarProps) {
  if (count < 1) return null
  return (
    <div role="toolbar" aria-label="Acciones para tareas seleccionadas" className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2.5">
      <span className="mr-auto text-sm font-semibold text-blue-800">{selectedCountLabel(count)}</span>
      {canEdit && onReassign && (
        <button type="button" onClick={onReassign} className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">
          <UserRoundPen size={14} /> Reasignar
        </button>
      )}
      {canEdit && onSetNeeded && (
        <button type="button" onClick={onSetNeeded} className="flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-50">
          <CalendarDays size={14} /> Fecha “La necesito para”
        </button>
      )}
      {canArchive && (
        <button type="button" onClick={onArchive} className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-50">
          <Archive size={14} /> Archivar
        </button>
      )}
      {canComplete && onComplete && (
        <button type="button" onClick={onComplete} className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
          <CheckCircle2 size={14} /> Marcar realizadas
        </button>
      )}
      {canDelete && (
        <button type="button" onClick={onDelete} className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50">
          <Trash2 size={14} /> Eliminar
        </button>
      )}
      <button type="button" onClick={onClear} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 hover:bg-white hover:text-gray-800">
        <X size={14} /> Quitar selección
      </button>
    </div>
  )
}
